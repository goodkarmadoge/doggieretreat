import type { Dog, Weekday } from "@/models/types";
import { recurringDaysFor } from "@/services/scheduling/attendance";
import {
  buildAttendance, buildColour, buildFlagIncompatibility, buildMedicalNote,
  buildRemoveIncompatibility, buildReschedule, buildRoomMove, buildVanMove, buildWalkMove,
} from "./actionBuilders";
import {
  deterministicInterpreter, resolveDateHint, resolveDog, toWeekday,
  type HarnessContext, type InterpreterResult,
} from "./interpreter";
import { SYSTEM_PROMPT_VERSION } from "./systemPrompt";

/**
 * Gemini-backed interpretation, layered over the deterministic path.
 *
 * What the model is allowed to do: read one sentence and say which
 * allow-listed intent it is, plus which dog NAMES and rough parameters.
 *
 * What the model is NOT allowed to do — all of this stays in code:
 *   - resolve a name to a database id (fabrication and wrong-Max risk)
 *   - compute a date (drift and timezone bugs)
 *   - write the preview or the stated consequences
 *   - pick a risk tier, bypass validation, or apply anything
 *
 * It also never sees the system prompt as something it could be told to
 * ignore: that lives server-side in /api/interpret, and the caretaker's text
 * travels in a separate labelled field.
 */

export type LlmStatus = "used" | "unavailable" | "fell_back";

export interface LlmOutcome {
  result: InterpreterResult;
  status: LlmStatus;
  model?: string;
  /** The model's own one-line reading, shown for transparency. Never executed. */
  rationale?: string;
  note?: string;
}

interface Extraction {
  intent: string;
  primary_dog: string;
  other_dogs: string[];
  weekday_from: string;
  weekday_to: string;
  timing_hint: string;
  recurring: boolean;
  van_number: number;
  floor_number: number;
  walker_name: string;
  colour: string;
  note: string;
  confidence: number;
  rationale: string;
}

/** Cheap probe so the UI can show whether Karma has a model behind it. */
let cachedAvailability: { at: number; available: boolean } | null = null;

export async function llmAvailable(): Promise<boolean> {
  if (cachedAvailability && Date.now() - cachedAvailability.at < 60_000) {
    return cachedAvailability.available;
  }
  try {
    const res = await fetch("/api/interpret", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userMessage: "ping", context: {} }),
    });
    // 503 means the key is not configured; anything else means the route works.
    const available = res.status !== 503;
    cachedAvailability = { at: Date.now(), available };
    return available;
  } catch {
    cachedAvailability = { at: Date.now(), available: false };
    return false;
  }
}

export async function interpretWithLlm(
  message: string,
  ctx: HarnessContext
): Promise<LlmOutcome> {
  const fallback = (status: LlmStatus, note?: string): LlmOutcome => ({
    result: deterministicInterpreter.interpret({
      systemPromptVersion: SYSTEM_PROMPT_VERSION,
      userMessage: message,
      context: ctx,
    }),
    status,
    note,
  });

  let payload: { extraction?: Extraction; model?: string; message?: string };
  try {
    const res = await fetch("/api/interpret", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userMessage: message,
        context: {
          today: ctx.today,
          weekday: new Date(ctx.today).toLocaleDateString("en-SG", { weekday: "long" }),
          dogNames: ctx.dogs.filter((d) => d.active).map((d) => d.name),
          walkerNames: ctx.walkers.map((w) => w.name),
          vanCount: ctx.vanCount,
          floorNames: ctx.floors.map((f) => f.name),
        },
      }),
    });

    if (res.status === 503) {
      return fallback("unavailable", "No Gemini key configured, so Karma used its built-in phrase matching.");
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      return fallback("fell_back", body.message ?? `Gemini call failed (${res.status}).`);
    }
    payload = await res.json();
  } catch {
    return fallback("fell_back", "Could not reach the interpretation service.");
  }

  const ex = payload.extraction;
  if (!ex) return fallback("fell_back", "Gemini returned nothing usable.");

  const built = materialise(ex, message, ctx);
  if (!built) {
    // The model read it as nothing actionable. Try the deterministic parser
    // before giving up — it recognises some phrasings very cheaply.
    const det = deterministicInterpreter.interpret({
      systemPromptVersion: SYSTEM_PROMPT_VERSION,
      userMessage: message,
      context: ctx,
    });
    if (det.kind === "action") {
      return { result: det, status: "fell_back", model: payload.model,
        note: "Gemini did not recognise this, but the built-in matcher did." };
    }
    return {
      result: {
        kind: "review",
        reason: "no_matching_intent",
        message:
          ex.rationale?.trim()
            ? `Karma read this as: "${ex.rationale.trim()}" — which isn't one of the actions it's allowed to take, so it's gone for review.`
            : "Karma could not map this to one of the actions it is allowed to take, so it has been sent for review rather than guessed at.",
        sourceText: message,
        confidence: ex.confidence,
      },
      status: "used",
      model: payload.model,
      rationale: ex.rationale,
    };
  }

  return { result: built, status: "used", model: payload.model, rationale: ex.rationale };
}

/**
 * Turn a flat extraction into an allow-listed action, or an ambiguity prompt.
 * Every identity, date and wording decision below is deterministic.
 */
function materialise(
  ex: Extraction,
  source: string,
  ctx: HarnessContext
): InterpreterResult | null {
  const conf = ex.confidence;

  const one = (name: string): { dog?: Dog; amb?: InterpreterResult } => {
    const r = resolveDog(name, ctx.dogs);
    if (r.ok) return { dog: r.dog };
    if ("ambiguous" in r) {
      return {
        amb: { kind: "ambiguous", prompt: { token: r.token, candidates: r.ambiguous }, sourceText: source },
      };
    }
    return {};
  };

  const notFound = (name: string): InterpreterResult => ({
    kind: "review",
    reason: "ambiguous_dog",
    message: `Karma read a dog called "${name}", which isn't on the active roster. Nothing was changed.`,
    sourceText: source,
    confidence: conf,
  });

  if (ex.intent === "none" || !ex.intent) return null;

  const primary = one(ex.primary_dog);
  if (primary.amb) return primary.amb;
  if (!primary.dog) return ex.primary_dog ? notFound(ex.primary_dog) : null;
  const dog = primary.dog;

  switch (ex.intent) {
    case "flag_incompatibility":
    case "remove_incompatibility": {
      const others: Dog[] = [];
      for (const n of ex.other_dogs) {
        const r = one(n);
        if (r.amb) return r.amb;
        if (!r.dog) return notFound(n);
        if (r.dog.id !== dog.id) others.push(r.dog);
      }
      if (!others.length) return null;
      return {
        kind: "action",
        action:
          ex.intent === "flag_incompatibility"
            ? buildFlagIncompatibility(dog, others, source, conf)
            : buildRemoveIncompatibility(dog, others[0], source, conf),
      };
    }

    case "mark_absent":
    case "mark_present": {
      const date = resolveDateHint(ex.timing_hint || "", ctx.today);
      return {
        kind: "action",
        action: buildAttendance(dog, date, ex.intent === "mark_absent", source, conf),
      };
    }

    case "reassign_van": {
      const idx = ex.van_number - 1;
      if (idx < 0 || idx >= ctx.vanCount) {
        return {
          kind: "review",
          reason: "validation_failed",
          message: `Karma read this as Van ${ex.van_number}, but the fleet has ${ctx.vanCount}.`,
          sourceText: source,
          confidence: conf,
        };
      }
      return { kind: "action", action: buildVanMove(dog, idx, ctx.today, source, conf) };
    }

    case "reassign_room": {
      const ordered = [...ctx.floors].sort((a, b) => a.order - b.order);
      const floor = ordered[ex.floor_number - 1];
      if (!floor) {
        return {
          kind: "review",
          reason: "validation_failed",
          message: `Karma read this as Floor ${ex.floor_number}, which doesn't exist.`,
          sourceText: source,
          confidence: conf,
        };
      }
      return { kind: "action", action: buildRoomMove(dog, floor, ctx.today, source, conf) };
    }

    case "reassign_walk_group": {
      const q = ex.walker_name.trim().toLowerCase();
      const walker =
        ctx.walkers.find((w) => w.name.toLowerCase() === q) ??
        ctx.walkers.find((w) => w.name.toLowerCase().startsWith(q));
      if (!walker) {
        return {
          kind: "review",
          reason: "no_matching_intent",
          message: `Karma read a walker called "${ex.walker_name}", who isn't on the roster.`,
          sourceText: source,
          confidence: conf,
        };
      }
      return { kind: "action", action: buildWalkMove(dog, walker, ctx.today, source, conf) };
    }

    case "set_behaviour_colour": {
      if (!["green", "yellow", "red"].includes(ex.colour)) return null;
      return {
        kind: "action",
        action: buildColour(dog, ex.colour as "green" | "yellow" | "red", source, conf),
      };
    }

    case "flag_medical_note": {
      const note = ex.note.trim();
      if (note.length < 3) return null;
      return { kind: "action", action: buildMedicalNote(dog, note, source, conf) };
    }

    case "reschedule_service": {
      const toDay = toWeekday(ex.weekday_to);
      if (!toDay) return null;
      let fromDay: Weekday | null = toWeekday(ex.weekday_from);
      const current = recurringDaysFor(dog.id, ctx.recurring, ctx.today) as Weekday[];
      if (!fromDay && current.length === 1) fromDay = current[0];

      if (ex.recurring && !fromDay) {
        return {
          kind: "review",
          reason: "no_matching_intent",
          message:
            current.length > 1
              ? `${dog.name} attends ${current.join(", ")}. Say which day to move, e.g. "move ${dog.name} from ${current[0]} to ${toDay} going forward".`
              : `${dog.name} has no recurring day to move.`,
          sourceText: source,
          confidence: conf,
        };
      }

      return {
        kind: "action",
        action: buildReschedule(
          dog,
          {
            fromDay,
            toDay,
            recurring: ex.recurring,
            nextWeek: /next week/i.test(ex.timing_hint),
            today: ctx.today,
          },
          source,
          conf
        ),
      };
    }
  }
  return null;
}
