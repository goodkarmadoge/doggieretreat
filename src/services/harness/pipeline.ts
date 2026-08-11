import { db } from "@/db/database";
import {
  addException, linkIncompatible, moveOneTime, moveRecurringDay,
  recordAudit, setBehaviorColor, setVanAssignment, unlinkIncompatible, updateDog,
} from "@/db/repository";
import type { BehaviorColor, Weekday } from "@/models/types";
import {
  CONFIDENCE_THRESHOLD, INTENTS, ROLE_RANK,
  type HarnessAction, type ReviewItem, type ReviewReason, type StaffRole,
} from "./intents";
import { deterministicInterpreter, type HarnessContext, type InterpreterResult } from "./interpreter";
import { interpretWithLlm } from "./llmInterpreter";
import { SYSTEM_PROMPT_VERSION } from "./systemPrompt";
import { validateAction, type ValidationResult } from "./validate";

/**
 * Stages 4 and 5 — Risk-tier / confirm, then Apply and log
 * (AI Harness Spec §5, §6 Layers 4–6).
 */

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export interface PipelineMeta {
  /** Which interpreter actually produced the reading. */
  interpreter: "gemini" | "deterministic";
  model?: string;
  /** The model's one-line account of its reading. Displayed, never executed. */
  rationale?: string;
  note?: string;
}

export type PipelineOutcome =
  /** Applied straight away because the intent is auto-apply tier. Undo offered. */
  | { kind: "applied"; action: HarnessAction; undo: () => Promise<void>; warnings: string[] }
  /** Needs an explicit tap to confirm before anything changes. */
  | { kind: "confirm"; action: HarnessAction; validation: ValidationResult }
  /** Two or more dogs share the typed name. Never guessed for safety actions. */
  | { kind: "ambiguous"; token: string; candidates: { id: string; name: string; breed?: string }[] }
  /** Queued for a person. Nothing fired. */
  | { kind: "review"; item: ReviewItem };

export type PipelineResult = PipelineOutcome & { meta: PipelineMeta };

/**
 * Runs a caretaker message through the whole harness.
 *
 * Note what is NOT here: at no point is `message` concatenated into the system
 * prompt, and at no point can it name an action that is not in the allow-list.
 * It travels as the `userMessage` data field and comes out the other side as
 * either one allow-listed structured action or a review item.
 */
export async function runHarness(
  message: string,
  ctx: HarnessContext,
  opts: { useLlm?: boolean } = {}
): Promise<PipelineResult> {
  /*
   * Stage 2. Which interpreter read the message changes NOTHING downstream —
   * validation, risk tiering, permissions and logging are identical either
   * way. An LLM reading is treated as exactly as untrusted as a regex one.
   */
  let result: InterpreterResult;
  let meta: PipelineMeta;

  if (opts.useLlm) {
    const outcome = await interpretWithLlm(message, ctx);
    result = outcome.result;
    meta = {
      interpreter: outcome.status === "used" ? "gemini" : "deterministic",
      model: outcome.model,
      rationale: outcome.rationale,
      note: outcome.note,
    };
  } else {
    result = deterministicInterpreter.interpret({
      systemPromptVersion: SYSTEM_PROMPT_VERSION,
      userMessage: message, // DATA, never instruction
      context: ctx,
    });
    meta = { interpreter: "deterministic" };
  }

  if (result.kind === "ambiguous") {
    return {
      kind: "ambiguous",
      token: result.prompt.token,
      candidates: result.prompt.candidates.map((d) => ({ id: d.id, name: d.name, breed: d.breed })),
      meta,
    };
  }

  if (result.kind === "review") {
    return {
      kind: "review",
      item: await queueReview(message, result.reason, result.message, ctx, result.intent, result.confidence),
      meta,
    };
  }

  const action = result.action;
  const def = INTENTS[action.intent];

  // Confidence gate (§7). Below threshold never even reaches a confirm prompt.
  if (action.confidence < CONFIDENCE_THRESHOLD) {
    return {
      kind: "review",
      item: await queueReview(
        message, "low_confidence",
        `Karma was only ${Math.round(action.confidence * 100)}% sure this meant "${def.label}", which is below the ${Math.round(CONFIDENCE_THRESHOLD * 100)}% threshold.`,
        ctx, action.intent, action.confidence
      ),
      meta,
    };
  }

  // Stage 3 — deterministic validation, before any tiering decision.
  const validation = validateAction(action, ctx);
  if (!validation.ok) {
    return {
      kind: "review",
      item: await queueReview(
        message, "validation_failed", validation.errors.join(" "), ctx, action.intent, action.confidence
      ),
      meta,
    };
  }

  // §8 permission model, enforced here rather than asked of the interpreter.
  if (ROLE_RANK[ctx.role] < ROLE_RANK[def.minRole]) {
    return {
      kind: "review",
      item: await queueReview(
        message, "insufficient_permission",
        `"${def.label}" needs approval from ${roleLabel(def.minRole)}. It has been queued for review with your wording kept.`,
        ctx, action.intent, action.confidence
      ),
      meta,
    };
  }

  // Stage 4 — risk tiering.
  if (def.risk === "auto_apply") {
    const undo = await applyAction(action, ctx, "auto-applied", meta);
    return { kind: "applied", action, undo, warnings: validation.warnings, meta };
  }

  // confirm and admin_only both require an explicit human tap.
  return { kind: "confirm", action, validation, meta };
}

/** Called when the person taps Confirm on a confirm/admin-tier action. */
export async function confirmAction(
  action: HarnessAction,
  ctx: HarnessContext,
  meta?: PipelineMeta
): Promise<() => Promise<void>> {
  return applyAction(action, ctx, "confirmed", meta);
}

function roleLabel(r: StaffRole): string {
  return r === "admin" ? "an admin" : r === "shift_lead" ? "a shift lead" : "a caretaker";
}

async function queueReview(
  sourceText: string,
  reason: ReviewReason,
  message: string,
  ctx: HarnessContext,
  intent?: HarnessAction["intent"],
  confidence?: number
): Promise<ReviewItem> {
  const item: ReviewItem = {
    id: uid(),
    createdAt: new Date().toISOString(),
    sourceText,
    reason,
    message,
    intent,
    confidence,
    contextDate: ctx.today,
    submittedByRole: ctx.role,
    resolved: false,
  };
  await db.reviewQueue.add(item);
  await recordAudit({
    action: `Routed to review — ${reason.replace(/_/g, " ")}`,
    newValue: sourceText,
  });
  return item;
}

/**
 * Stage 5 — Apply and log. Returns an undo closure.
 *
 * Undo restores the specific fields this action touched rather than replaying
 * a whole snapshot, which keeps it safe when other edits happened in between.
 */
async function applyAction(
  action: HarnessAction,
  ctx: HarnessContext,
  how: "auto-applied" | "confirmed",
  meta?: PipelineMeta
): Promise<() => Promise<void>> {
  const def = INTENTS[action.intent];
  const p = action.params;
  let undo: () => Promise<void> = async () => {};

  switch (action.intent) {
    case "flag_incompatibility": {
      const primary = String(p.primary_dog_id);
      const others = (p.incompatible_with_dog_ids as string[]) ?? [];
      const added: string[] = [];
      for (const other of others) {
        const dog = await db.dogs.get(primary);
        if (dog && !dog.incompatibleDogIds.includes(other)) added.push(other);
        await linkIncompatible(primary, other);
      }
      undo = async () => {
        for (const other of added) await unlinkIncompatible(primary, other);
      };
      break;
    }

    case "remove_incompatibility": {
      const a = String(p.dogAId);
      const b = String(p.dogBId);
      await unlinkIncompatible(a, b);
      undo = async () => { await linkIncompatible(a, b); };
      break;
    }

    case "set_behaviour_colour": {
      const dogId = String(p.dogId);
      const before = (await db.dogs.get(dogId))?.behaviorColor ?? null;
      await setBehaviorColor(dogId, p.colour as BehaviorColor);
      undo = async () => { await setBehaviorColor(dogId, before); };
      break;
    }

    case "reschedule_service": {
      const dogId = String(p.dogId);
      if (p.recurring) {
        await moveRecurringDay(
          dogId, p.fromWeekday as Weekday, p.toWeekday as Weekday, String(p.effectiveFrom)
        );
      } else if (p.fromDate) {
        await moveOneTime(dogId, String(p.fromDate), String(p.toDate));
      } else {
        await addException(dogId, String(p.toDate), "added", "Added via Karma");
      }
      break;
    }

    case "mark_absent":
    case "mark_present": {
      const dogId = String(p.dogId);
      const date = String(p.date);
      const existing = await db.exceptions
        .where("dogId").equals(dogId).filter((e) => e.date === date).toArray();
      await addException(
        dogId, date, action.intent === "mark_absent" ? "removed" : "added", "Set via Karma"
      );
      undo = async () => {
        const now = await db.exceptions
          .where("dogId").equals(dogId).filter((e) => e.date === date).toArray();
        for (const e of now) await db.exceptions.delete(e.id);
        for (const e of existing) await db.exceptions.add(e);
      };
      break;
    }

    case "reassign_van": {
      const dogId = String(p.dogId);
      const vanIndex = Number(p.vanIndex);
      const date = String(p.date);
      const before = await db.vanOverrides
        .filter((o) => o.dogId === dogId && o.date === date).toArray();
      for (const type of ["pickup", "dropoff"] as const) {
        await setVanAssignment(date, type, dogId, vanIndex);
      }
      undo = async () => {
        const now = await db.vanOverrides
          .filter((o) => o.dogId === dogId && o.date === date).toArray();
        for (const o of now) await db.vanOverrides.delete(o.id);
        for (const o of before) await db.vanOverrides.add(o);
      };
      break;
    }

    case "reassign_room": {
      const dogId = String(p.dogId);
      const floorId = String(p.floorId);
      const date = String(p.date);
      const before = await db.floorLocks.filter((l) => l.date === date).toArray();
      // Remove from every other floor, then pin onto the target.
      for (const lock of before) {
        if (lock.floorId === floorId) continue;
        if (!lock.dogIds.includes(dogId)) continue;
        await db.floorLocks.put({ ...lock, dogIds: lock.dogIds.filter((d) => d !== dogId) });
      }
      const target = before.find((l) => l.floorId === floorId);
      await db.floorLocks.put({
        id: `${date}:${floorId}`,
        date, floorId,
        dogIds: Array.from(new Set([...(target?.dogIds ?? []), dogId])),
      });
      undo = async () => {
        await db.floorLocks.filter((l) => l.date === date).delete();
        for (const l of before) await db.floorLocks.add(l);
      };
      break;
    }

    case "reassign_walk_group": {
      const dogId = String(p.dogId);
      const walkerId = String(p.walkerId);
      const date = String(p.date);
      const before = await db.walkLocks.filter((l) => l.date === date).toArray();
      for (const lock of before) {
        if (lock.walkerId === walkerId) continue;
        if (!lock.dogIds.includes(dogId)) continue;
        await db.walkLocks.put({ ...lock, dogIds: lock.dogIds.filter((d) => d !== dogId) });
      }
      const target = before.find((l) => l.walkerId === walkerId);
      await db.walkLocks.put({
        id: `${date}:${walkerId}`,
        date, walkerId,
        dogIds: Array.from(new Set([...(target?.dogIds ?? []), dogId])),
      });
      undo = async () => {
        await db.walkLocks.filter((l) => l.date === date).delete();
        for (const l of before) await db.walkLocks.add(l);
      };
      break;
    }

    case "flag_medical_note": {
      const dogId = String(p.dogId);
      const dog = await db.dogs.get(dogId);
      const before = dog?.operationalNotes ?? "";
      const next = [before, `Medical: ${String(p.note)}`].filter(Boolean).join("\n");
      await updateDog(dogId, { operationalNotes: next });
      undo = async () => { await updateDog(dogId, { operationalNotes: before }); };
      break;
    }
  }

  // §6 Layer 6 — the log always retains the original wording and the structured
  // action, so any change can be explained, disputed or rolled back.
  await recordAudit({
    action: `Karma · ${def.label} (${how}, ${def.risk.replace(/_/g, "-")})`,
    dogId: action.dogIds[0],
    dogName: ctx.dogs.find((d) => d.id === action.dogIds[0])?.name,
    previousValue: action.source_text,
    newValue:
      `${action.intent} · ${Math.round(action.confidence * 100)}% · ${ctx.role}` +
      // Which interpreter read it is part of the audit trail, so a disputed
      // change can be traced to a model version rather than guessed at.
      (meta ? ` · via ${meta.interpreter}${meta.model ? ` (${meta.model})` : ""}` : ""),
  });

  return undo;
}

export { CONFIDENCE_THRESHOLD, INTENTS };
export type { HarnessContext, ValidationResult };
