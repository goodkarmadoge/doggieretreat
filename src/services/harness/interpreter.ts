import type { Dog, RecurringAttendance, Weekday, Floor, Walker } from "@/models/types";
import { recurringDaysFor } from "@/services/scheduling/attendance";
import { addDays, resolveWeekday, weekdayOf } from "@/utils/dates";
import { SYSTEM_PROMPT_VERSION } from "./systemPrompt";
import {
  CONFIDENCE_THRESHOLD,
  type AmbiguityPrompt,
  type HarnessAction,
  type IntentName,
  type ReviewReason,
  type StaffRole,
} from "./intents";

/**
 * Stage 2 — Interpret (AI Harness Spec §5).
 *
 * The caretaker's message is carried in `userMessage`, a labelled DATA field.
 * It is never concatenated into the system prompt. This implementation is
 * deterministic, so there is no model that could be instructed by the text at
 * all; the interface exists so an LLM interpreter can be dropped in behind it
 * and inherit the same isolation, confidence gate and allow-list.
 */

export interface HarnessContext {
  /** Today, or the operating date being viewed. Passed so relative dates resolve. */
  today: string;
  dogs: Dog[];
  recurring: RecurringAttendance[];
  floors: Floor[];
  walkers: Walker[];
  vanCount: number;
  role: StaffRole;
  /** Page context narrows resolution — §5 Stage 1, "the single biggest accuracy lever". */
  focusDogId?: string;
}

export interface InterpreterRequest {
  systemPromptVersion: string;
  /** UNTRUSTED. Data to interpret, never an instruction. */
  userMessage: string;
  context: HarnessContext;
}

export type InterpreterResult =
  | { kind: "action"; action: HarnessAction }
  | { kind: "ambiguous"; prompt: AmbiguityPrompt; sourceText: string }
  | { kind: "review"; reason: ReviewReason; message: string; sourceText: string;
      intent?: IntentName; confidence?: number };

export interface Interpreter {
  readonly id: string;
  interpret(req: InterpreterRequest): InterpreterResult;
}

const DAY_WORDS: Record<string, Weekday> = {
  mon: "Mon", monday: "Mon", mondays: "Mon",
  tue: "Tue", tues: "Tue", tuesday: "Tue", tuesdays: "Tue",
  wed: "Wed", weds: "Wed", wednesday: "Wed", wednesdays: "Wed",
  thu: "Thu", thur: "Thu", thurs: "Thu", thursday: "Thu", thursdays: "Thu",
  fri: "Fri", friday: "Fri", fridays: "Fri",
  sat: "Sat", saturday: "Sat", saturdays: "Sat",
  sun: "Sun", sunday: "Sun", sundays: "Sun",
};
const DAY_PATTERN = Object.keys(DAY_WORDS).sort((a, b) => b.length - a.length).join("|");
const toWeekday = (t: string): Weekday | null => DAY_WORDS[t.trim().toLowerCase()] ?? null;

type Resolved =
  | { ok: true; dog: Dog }
  | { ok: false; ambiguous: Dog[]; token: string }
  | { ok: false; notFound: true; token: string };

function resolveDog(token: string, dogs: Dog[]): Resolved {
  const q = token.trim().toLowerCase().replace(/[.,!?'"]+$/g, "");
  const active = dogs.filter((d) => d.active);
  if (!q) return { ok: false, notFound: true, token };

  const exact = active.filter((d) => d.name.toLowerCase() === q);
  if (exact.length === 1) return { ok: true, dog: exact[0] };
  if (exact.length > 1) return { ok: false, ambiguous: exact, token };

  const starts = active.filter((d) => d.name.toLowerCase().startsWith(q));
  if (starts.length === 1) return { ok: true, dog: starts[0] };
  if (starts.length > 1) return { ok: false, ambiguous: starts, token };

  const inside = active.filter((d) => q.includes(d.name.toLowerCase()));
  if (inside.length === 1) return { ok: true, dog: inside[0] };
  if (inside.length > 1) return { ok: false, ambiguous: inside, token };

  return { ok: false, notFound: true, token };
}

/** "A, B and C" -> individual name tokens. */
function splitNames(list: string): string[] {
  return list
    .split(/\s*(?:,|;|\band\b|&)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

const dogNames = (ids: string[], dogs: Dog[]) =>
  ids.map((id) => dogs.find((d) => d.id === id)?.name ?? id).join(", ");

export const deterministicInterpreter: Interpreter = {
  id: "deterministic-v2",

  interpret(req: InterpreterRequest): InterpreterResult {
    const source = req.userMessage;
    const text = source.trim().replace(/\s+/g, " ");
    const { dogs, today, floors, walkers, vanCount } = req.context;

    const review = (
      reason: ReviewReason, message: string, intent?: IntentName, confidence?: number
    ): InterpreterResult => ({ kind: "review", reason, message, sourceText: source, intent, confidence });

    if (!text) {
      return review("no_matching_intent", "Nothing was typed.");
    }

    /* ---------- remove_incompatibility (checked before flag) ---------- */
    const unflag = text.match(
      /^(?:remove|clear|delete)?\s*(?:the\s+)?(?:incompatibility|conflict|flag)?\s*(?:between\s+)?(.+?)\s+(?:and|with)\s+(.+?)(?:\s+(?:is|are)\s+(?:fine|ok|okay))?$/i
    );
    const fineNow = text.match(
      /^(?:actually,?\s+)?(.+?)\s+and\s+(.+?)\s+(?:are|is)\s+(?:fine|ok|okay|good)(?:\s+now)?\.?$/i
    );
    const unflagMatch = fineNow ?? (/^(?:remove|clear|delete)\b/i.test(text) ? unflag : null);
    if (unflagMatch) {
      const a = resolveDog(unflagMatch[1], dogs);
      if (!a.ok && "ambiguous" in a) return { kind: "ambiguous", prompt: { token: a.token, candidates: a.ambiguous }, sourceText: source };
      if (!a.ok) return review("no_matching_intent", `No active dog matches "${unflagMatch[1].trim()}".`);
      const b = resolveDog(unflagMatch[2], dogs);
      if (!b.ok && "ambiguous" in b) return { kind: "ambiguous", prompt: { token: b.token, candidates: b.ambiguous }, sourceText: source };
      if (!b.ok) return review("no_matching_intent", `No active dog matches "${unflagMatch[2].trim()}".`);

      return {
        kind: "action",
        action: {
          intent: "remove_incompatibility",
          params: { dogAId: a.dog.id, dogBId: b.dog.id },
          confidence: 0.88,
          source_text: source,
          dogIds: [a.dog.id, b.dog.id],
          preview: `Remove the incompatibility between ${a.dog.name} and ${b.dog.name}`,
          detail: [
            "They could be grouped together again on walks, floors and vans.",
            "Removing a safety flag is an admin action.",
          ],
          recurring: true,
        },
      };
    }

    /* ---------- flag_incompatibility ---------- */
    const compat = text.match(
      /^(.+?)\s+(?:cannot|can't|cant|must not|should not|shouldn't|does not|doesn't|do not|don't)\s+(?:be\s+)?(?:get along|getting along|grouped|group|walk|walked|placed|go|be)\s*(?:with)\s+(.+)$/i
    );
    if (compat) {
      const primary = resolveDog(compat[1], dogs);
      if (!primary.ok && "ambiguous" in primary)
        return { kind: "ambiguous", prompt: { token: primary.token, candidates: primary.ambiguous }, sourceText: source };
      if (!primary.ok) return review("no_matching_intent", `No active dog matches "${compat[1].trim()}".`);

      const others: Dog[] = [];
      for (const token of splitNames(compat[2])) {
        const r = resolveDog(token, dogs);
        if (!r.ok && "ambiguous" in r)
          return { kind: "ambiguous", prompt: { token: r.token, candidates: r.ambiguous }, sourceText: source };
        if (!r.ok) return review("no_matching_intent", `No active dog matches "${token}".`);
        if (r.dog.id !== primary.dog.id) others.push(r.dog);
      }
      if (!others.length) {
        return review("no_matching_intent", "A dog cannot be flagged against itself.");
      }

      return {
        kind: "action",
        action: {
          intent: "flag_incompatibility",
          params: {
            primary_dog_id: primary.dog.id,
            incompatible_with_dog_ids: others.map((d) => d.id),
            reason: source,
          },
          confidence: 0.92,
          source_text: source,
          dogIds: [primary.dog.id, ...others.map((d) => d.id)],
          preview: `Mark ${primary.dog.name} as incompatible with ${others.map((d) => d.name).join(", ")}`,
          detail: [
            "Written in both directions, so whichever record is opened shows the flag.",
            "Applies to today's and all future walk groups, floor plans and van manifests.",
            "Stays until an admin removes it.",
          ],
          recurring: true,
        },
      };
    }

    /* ---------- flag_medical_note ---------- */
    const medical = text.match(
      /^(.+?)\s+(?:needs|requires|is on|takes)\s+(.*(?:meds?|medication|medicine|insulin|antibiotic|eye drops|tablet).*)$/i
    );
    if (medical) {
      const r = resolveDog(medical[1], dogs);
      if (!r.ok && "ambiguous" in r)
        return { kind: "ambiguous", prompt: { token: r.token, candidates: r.ambiguous }, sourceText: source };
      if (!r.ok) return review("no_matching_intent", `No active dog matches "${medical[1].trim()}".`);

      return {
        kind: "action",
        action: {
          intent: "flag_medical_note",
          params: { dogId: r.dog.id, note: medical[2].trim() },
          confidence: 0.8,
          source_text: source,
          dogIds: [r.dog.id],
          preview: `Add a medical note to ${r.dog.name}`,
          detail: [
            `Note: "${medical[2].trim()}"`,
            "Medical information is never applied automatically — it routes to a person.",
          ],
          recurring: true,
        },
      };
    }

    /* ---------- mark_absent / mark_present ---------- */
    const attend = text.match(
      new RegExp(
        `^(.+?)\\s+(?:is|isn't|is not|will not be|won't be|wont be|will be)\\s+(not coming|coming|in|out|absent|away|attending|here)\\b\\s*(.*)$`,
        "i"
      )
    );
    if (attend) {
      const r = resolveDog(attend[1], dogs);
      if (!r.ok && "ambiguous" in r)
        return { kind: "ambiguous", prompt: { token: r.token, candidates: r.ambiguous }, sourceText: source };
      if (!r.ok) return review("no_matching_intent", `No active dog matches "${attend[1].trim()}".`);

      const negated = /isn't|is not|won't|wont|will not|not coming|absent|away|out/i.test(
        `${attend[0]}`
      );
      const when = attend[3] ?? "";
      const date = resolveDate(when, today);

      const intent: IntentName = negated ? "mark_absent" : "mark_present";
      return {
        kind: "action",
        action: {
          intent,
          params: { dogId: r.dog.id, date },
          confidence: 0.85,
          source_text: source,
          dogIds: [r.dog.id],
          preview: `${negated ? "Mark" : "Add"} ${r.dog.name} ${negated ? "absent" : "as attending"} on ${date}`,
          detail: [
            "One date only. The recurring schedule is untouched.",
            negated
              ? "They drop out of that day's walks, floors and transport."
              : "They join that day's walks, floors and transport.",
          ],
          effectiveDate: date,
          recurring: false,
        },
      };
    }

    /* ---------- reassign_van ---------- */
    const van = text.match(
      /^(?:take|put|move|switch)\s+(.+?)\s+(?:on|onto|to|into)\s+van\s*(\d+)\b/i
    ) ?? text.match(/^(.+?)\s+(?:goes|should go)\s+(?:on|in)\s+van\s*(\d+)\b/i);
    if (van) {
      const r = resolveDog(van[1].replace(/\s+off\s+van\s*\d+\s*,?/i, ""), dogs);
      if (!r.ok && "ambiguous" in r)
        return { kind: "ambiguous", prompt: { token: r.token, candidates: r.ambiguous }, sourceText: source };
      if (!r.ok) return review("no_matching_intent", `No active dog matches "${van[1].trim()}".`);

      const vanIndex = Number(van[2]) - 1;
      if (vanIndex < 0 || vanIndex >= vanCount) {
        return review(
          "validation_failed",
          `There is no Van ${van[2]}. The fleet has ${vanCount} van${vanCount === 1 ? "" : "s"}.`,
          "reassign_van"
        );
      }
      return {
        kind: "action",
        action: {
          intent: "reassign_van",
          params: { dogId: r.dog.id, vanIndex, date: today },
          confidence: 0.87,
          source_text: source,
          dogIds: [r.dog.id],
          preview: `Move ${r.dog.name} to Van ${vanIndex + 1} on ${today}`,
          detail: [
            "Applies to both the morning pickup and evening drop-off run for that date.",
            "Dogs share a vehicle for the whole run, so this is checked against incompatibility flags.",
          ],
          effectiveDate: today,
          recurring: false,
        },
      };
    }

    /* ---------- reassign_room (floors) ---------- */
    const room = text.match(/^(?:put|move|switch)\s+(.+?)\s+(?:on|onto|to|into)\s+(?:floor|room)\s*(\d+)\b/i);
    if (room) {
      const r = resolveDog(room[1], dogs);
      if (!r.ok && "ambiguous" in r)
        return { kind: "ambiguous", prompt: { token: r.token, candidates: r.ambiguous }, sourceText: source };
      if (!r.ok) return review("no_matching_intent", `No active dog matches "${room[1].trim()}".`);

      const ordered = [...floors].sort((a, b) => a.order - b.order);
      const floor = ordered[Number(room[2]) - 1];
      if (!floor) {
        return review("validation_failed", `There is no Floor ${room[2]}.`, "reassign_room");
      }
      return {
        kind: "action",
        action: {
          intent: "reassign_room",
          params: { dogId: r.dog.id, floorId: floor.id, date: today },
          confidence: 0.87,
          source_text: source,
          dogIds: [r.dog.id],
          preview: `Move ${r.dog.name} to ${floor.name} on ${today}`,
          detail: ["Today only. Checked against floor capacity and incompatibility flags."],
          effectiveDate: today,
          recurring: false,
        },
      };
    }

    /* ---------- reassign_walk_group ---------- */
    const walk = text.match(
      /^(?:put|move|switch|assign)\s+(.+?)\s+(?:in|into|to|with|onto)\s+(?:the\s+)?(.+?)(?:'s)?\s*(?:group|walk|walking group)?$/i
    );
    if (walk) {
      const r = resolveDog(walk[1], dogs);
      if (r.ok) {
        const walkerToken = walk[2].trim().toLowerCase().replace(/'s$/, "");
        const walker = walkers.find(
          (w) => w.name.toLowerCase() === walkerToken || w.name.toLowerCase().startsWith(walkerToken)
        );
        if (walker) {
          return {
            kind: "action",
            action: {
              intent: "reassign_walk_group",
              params: { dogId: r.dog.id, walkerId: walker.id, date: today },
              confidence: 0.84,
              source_text: source,
              dogIds: [r.dog.id],
              preview: `Move ${r.dog.name} into ${walker.name}'s walk group on ${today}`,
              detail: ["Today only, applied immediately with undo."],
              effectiveDate: today,
              recurring: false,
            },
          };
        }
      }
    }

    /* ---------- set_behaviour_colour ---------- */
    const colour = text.match(
      /^(?:change|set|mark|make|update)\s+(.+?)(?:'s)?\s+(?:behaviour|behavior|colour|color)?\s*(?:to|as)\s+(green|yellow|red)\b/i
    );
    if (colour) {
      const r = resolveDog(colour[1], dogs);
      if (!r.ok && "ambiguous" in r)
        return { kind: "ambiguous", prompt: { token: r.token, candidates: r.ambiguous }, sourceText: source };
      if (!r.ok) return review("no_matching_intent", `No active dog matches "${colour[1].trim()}".`);

      const c = colour[2].toLowerCase() as "green" | "yellow" | "red";
      const detail = [`Currently ${r.dog.behaviorColor ?? "not assessed"}.`];
      if (c === "red") {
        detail.push("Red dogs walk 1:1, and floor placement routes to staff review.");
      }
      return {
        kind: "action",
        action: {
          intent: "set_behaviour_colour",
          params: { dogId: r.dog.id, colour: c },
          confidence: 0.9,
          source_text: source,
          dogIds: [r.dog.id],
          preview: `Set ${r.dog.name} to ${c}`,
          detail,
          recurring: true,
        },
      };
    }

    /* ---------- reschedule_service ---------- */
    const sched = text.match(
      new RegExp(
        `^(?:move|change|switch|shift|reschedule)\\s+(.+?)(?:'s)?\\s*(?:daycare|booking)?\\s*(?:from\\s+(${DAY_PATTERN})\\s+)?(?:to|onto|into)\\s+(${DAY_PATTERN})\\b\\s*(.*)$`,
        "i"
      )
    );
    if (sched) {
      const r = resolveDog(sched[1], dogs);
      if (!r.ok && "ambiguous" in r)
        return { kind: "ambiguous", prompt: { token: r.token, candidates: r.ambiguous }, sourceText: source };
      if (!r.ok) return review("no_matching_intent", `No active dog matches "${sched[1].trim()}".`);

      const toDay = toWeekday(sched[3]);
      if (!toDay) return review("no_matching_intent", `"${sched[3]}" is not a weekday.`);

      const tail = sched[4] ?? "";
      const goingForward = /going forward|from now on|permanently|every week|onwards?/i.test(tail);
      const nextWeek = /next week/i.test(tail);
      const current = recurringDaysFor(r.dog.id, req.context.recurring, today) as Weekday[];
      let fromDay = sched[2] ? toWeekday(sched[2]) : null;
      if (!fromDay && current.length === 1) fromDay = current[0];

      if (goingForward && !fromDay) {
        return review(
          "no_matching_intent",
          current.length > 1
            ? `${r.dog.name} attends ${current.join(", ")}. Say which day to move, e.g. "move ${r.dog.name} from ${current[0]} to ${toDay} going forward".`
            : `${r.dog.name} has no recurring day to move.`,
          "reschedule_service"
        );
      }

      const effective = goingForward ? addDays(today, 1) : resolveWeekday(today, toDay, nextWeek);
      const fromDate = fromDay && !goingForward ? resolveWeekday(today, fromDay, nextWeek) : undefined;

      return {
        kind: "action",
        action: {
          intent: "reschedule_service",
          params: {
            dogId: r.dog.id,
            service: "daycare",
            fromWeekday: fromDay,
            toWeekday: toDay,
            fromDate,
            toDate: goingForward ? undefined : resolveWeekday(today, toDay, nextWeek),
            effectiveFrom: effective,
            recurring: goingForward,
          },
          confidence: 0.88,
          source_text: source,
          dogIds: [r.dog.id],
          preview: goingForward
            ? `Move ${r.dog.name} from ${fromDay} to ${toDay} going forward`
            : fromDate
              ? `Move ${r.dog.name} from ${fromDate} to ${resolveWeekday(today, toDay, nextWeek)}`
              : `Add ${r.dog.name} on ${resolveWeekday(today, toDay, nextWeek)}`,
          detail: goingForward
            ? [
                `The ${fromDay} booking closes from ${effective} rather than being deleted, so past attendance stays intact.`,
                `A new recurring ${toDay} booking starts ${effective}.`,
                "Recurring changes update the standing record, not just today's plan.",
              ]
            : [
                "One-time only. The recurring schedule is untouched.",
                "Transport, walks and floors for that date update automatically.",
              ],
          effectiveDate: effective,
          recurring: goingForward,
        },
      };
    }

    /*
     * No allow-listed intent matched. Per §6 Layer 2 the safe default is to ask
     * a person — the message is preserved and queued, never silently dropped.
     */
    return review(
      "no_matching_intent",
      "Karma could not map this to one of the actions it is allowed to take, so it has been sent for review rather than guessed at.",
      undefined,
      0
    );
  },
};

function resolveDate(when: string, today: string): string {
  const dayMatch = when.match(new RegExp(`\\b(${DAY_PATTERN})\\b`, "i"));
  const nextWeek = /next week/i.test(when);
  if (dayMatch) {
    const wd = toWeekday(dayMatch[1]);
    if (wd) {
      if (wd === weekdayOf(today) && !nextWeek) return today;
      return resolveWeekday(today, wd, nextWeek);
    }
  }
  if (/tomorrow/i.test(when)) return addDays(today, 1);
  return today;
}

export { CONFIDENCE_THRESHOLD, SYSTEM_PROMPT_VERSION };
