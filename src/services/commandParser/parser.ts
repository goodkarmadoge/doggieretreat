import type {
  BehaviorColor,
  Dog,
  ParseResult,
  ProposedChange,
  RecurringAttendance,
  Weekday,
} from "@/models/types";
import {
  addException,
  linkIncompatible,
  moveOneTime,
  moveRecurringDay,
  setBehaviorColor,
  setTransportOverride,
} from "@/db/repository";
import { recurringDaysFor } from "@/services/scheduling/attendance";
import { addDays, resolveWeekday, todayISO, weekdayOf } from "@/utils/dates";

/**
 * Deterministic staff command interpreter.
 *
 * Everything goes through this interface, so an LLM-backed parser can be
 * dropped in later without touching the command bar or the confirmation step.
 */
export interface ParseContext {
  dogs: Dog[];
  recurring: RecurringAttendance[];
  today: string;
}

export interface CommandParser {
  readonly name: string;
  parse(input: string, ctx: ParseContext): ParseResult;
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

function toWeekday(token: string): Weekday | null {
  return DAY_WORDS[token.trim().toLowerCase()] ?? null;
}

/** Resolve a name fragment to exactly one active dog, or report ambiguity. */
function resolveDog(
  token: string,
  dogs: Dog[]
): { dog?: Dog; candidates?: Dog[] } {
  const q = token.trim().toLowerCase().replace(/[.,!?]$/, "");
  if (!q) return {};

  const active = dogs.filter((d) => d.active);
  const exact = active.filter((d) => d.name.toLowerCase() === q);
  if (exact.length === 1) return { dog: exact[0] };
  if (exact.length > 1) return { candidates: exact };

  const partial = active.filter((d) => d.name.toLowerCase().startsWith(q));
  if (partial.length === 1) return { dog: partial[0] };
  if (partial.length > 1) return { candidates: partial };

  const loose = active.filter((d) => q.includes(d.name.toLowerCase()));
  if (loose.length === 1) return { dog: loose[0] };
  if (loose.length > 1) return { candidates: loose };

  return {};
}

function notFound(token: string): ParseResult {
  return { ok: false, error: `No active dog matches "${token.trim()}".` };
}

export const deterministicParser: CommandParser = {
  name: "deterministic",

  parse(input: string, ctx: ParseContext): ParseResult {
    const text = input.trim().replace(/\s+/g, " ");
    if (!text) return { ok: false, error: "Type a change to preview it." };

    /* ---- compatibility ---- */
    const compat = text.match(
      /^(.+?)\s+(?:cannot|can't|cant|must not|should not|shouldn't|does not|doesn't|do not|don't)\s+(?:be\s+)?(?:get along|getting along|grouped|group|walk|walked|placed|placed together|go|be)\s*(?:with)\s+(.+)$/i
    );
    if (compat) {
      const a = resolveDog(compat[1], ctx.dogs);
      if (a.candidates) return { ok: false, ambiguous: { token: compat[1], candidates: a.candidates } };
      if (!a.dog) return notFound(compat[1]);

      const b = resolveDog(compat[2], ctx.dogs);
      if (b.candidates) return { ok: false, ambiguous: { token: compat[2], candidates: b.candidates } };
      if (!b.dog) return notFound(compat[2]);

      if (a.dog.id === b.dog.id) {
        return { ok: false, error: "A dog cannot be flagged against itself." };
      }

      const dogA = a.dog;
      const dogB = b.dog;
      return {
        ok: true,
        change: {
          kind: "compatibility",
          summary: `Flag ${dogA.name} and ${dogB.name} as not compatible`,
          detail: [
            "Written in both directions — the flag applies whichever record is opened.",
            "Takes effect immediately in walk groups, floor placement and van manifests.",
          ],
          dogIds: [dogA.id, dogB.id],
          recurring: true,
          apply: () => linkIncompatible(dogA.id, dogB.id),
        } satisfies ProposedChange,
      };
    }

    /* ---- behaviour colour ---- */
    const behaviour = text.match(
      /^(?:change|set|mark|make|update)\s+(.+?)(?:'s)?\s+(?:behaviour|behavior|colour|color)?\s*(?:to|as)\s+(green|yellow|red)\b/i
    );
    if (behaviour) {
      const r = resolveDog(behaviour[1], ctx.dogs);
      if (r.candidates) return { ok: false, ambiguous: { token: behaviour[1], candidates: r.candidates } };
      if (!r.dog) return notFound(behaviour[1]);

      const dog = r.dog;
      const color = behaviour[2].toLowerCase() as BehaviorColor;
      const detail = [
        `Currently ${dog.behaviorColor ?? "not assessed"}.`,
      ];
      if (color === "red") {
        detail.push("Red dogs walk 1:1, and floor placement will route to Needs Staff Review until a floor rule is configured.");
      }
      return {
        ok: true,
        change: {
          kind: "behavior",
          summary: `Set ${dog.name} to ${color}`,
          detail,
          dogIds: [dog.id],
          recurring: true,
          apply: () => setBehaviorColor(dog.id, color),
        },
      };
    }

    /* ---- transport ---- */
    const transport = text.match(
      new RegExp(
        `^(.+?)\\s+(?:needs|requires|wants|to have)\\s+(?:a\\s+)?(pickup|pick[- ]?up|dropoff|drop[- ]?off)\\b\\s*(.*)$`,
        "i"
      )
    );
    if (transport) {
      const r = resolveDog(transport[1], ctx.dogs);
      if (r.candidates) return { ok: false, ambiguous: { token: transport[1], candidates: r.candidates } };
      if (!r.dog) return notFound(transport[1]);

      const dog = r.dog;
      const kind: "pickup" | "dropoff" = /pick/i.test(transport[2]) ? "pickup" : "dropoff";
      const when = transport[3] ?? "";

      const dayMatch = when.match(new RegExp(`\\b(${DAY_PATTERN})\\b`, "i"));
      const nextWeek = /next week/i.test(when);
      let date: string;

      if (dayMatch) {
        date = resolveWeekday(ctx.today, toWeekday(dayMatch[1])!, nextWeek);
      } else if (/tomorrow/i.test(when)) {
        date = addDays(ctx.today, 1);
      } else {
        date = ctx.today;
      }

      return {
        ok: true,
        change: {
          kind: "transport",
          summary: `${kind === "pickup" ? "Pickup" : "Drop-off"} for ${dog.name} on ${date}`,
          detail: [
            `Overrides ${dog.name}'s standing preference for this date only.`,
            "The stop joins that day's route and is grouped with any other dog at the same address.",
          ],
          dogIds: [dog.id],
          effectiveDate: date,
          recurring: false,
          apply: () => setTransportOverride(dog.id, date, kind, true),
        },
      };
    }

    /* ---- schedule ---- */
    const schedule = text.match(
      new RegExp(
        `^(?:move|change|switch|shift|put)\\s+(.+?)\\s+(?:from\\s+(${DAY_PATTERN})\\s+)?(?:to|onto|into)\\s+(${DAY_PATTERN})\\b\\s*(.*)$`,
        "i"
      )
    );
    if (schedule) {
      const r = resolveDog(schedule[1], ctx.dogs);
      if (r.candidates) return { ok: false, ambiguous: { token: schedule[1], candidates: r.candidates } };
      if (!r.dog) return notFound(schedule[1]);

      const dog = r.dog;
      const toDay = toWeekday(schedule[3]);
      if (!toDay) return { ok: false, error: `"${schedule[3]}" is not a weekday.` };

      const tail = schedule[4] ?? "";
      const goingForward = /going forward|from now on|permanently|every week|onwards?/i.test(tail);
      const nextWeek = /next week/i.test(tail);

      const currentDays = recurringDaysFor(dog.id, ctx.recurring, ctx.today) as Weekday[];
      let fromDay = schedule[2] ? toWeekday(schedule[2]) : null;

      if (!fromDay) {
        if (currentDays.length === 1) fromDay = currentDays[0];
        else if (currentDays.length === 0) fromDay = null;
      }

      if (goingForward) {
        if (!fromDay) {
          return {
            ok: false,
            error:
              currentDays.length > 1
                ? `${dog.name} attends ${currentDays.join(", ")}. Say which day to move, e.g. "move ${dog.name} from ${currentDays[0]} to ${toDay} going forward".`
                : `${dog.name} has no recurring day to move. Add one on the dog's profile first.`,
          };
        }
        const effective = addDays(ctx.today, 1);
        const fromFixed = fromDay;
        return {
          ok: true,
          change: {
            kind: "schedule_recurring",
            summary: `Move ${dog.name} from ${fromFixed} to ${toDay} going forward`,
            detail: [
              `The ${fromFixed} booking is closed from ${effective}, not deleted — past attendance stays intact.`,
              `A new recurring ${toDay} booking starts ${effective}.`,
            ],
            dogIds: [dog.id],
            effectiveDate: effective,
            recurring: true,
            apply: () => moveRecurringDay(dog.id, fromFixed, toDay, effective),
          },
        };
      }

      const toDate = resolveWeekday(ctx.today, toDay, nextWeek);

      if (fromDay) {
        const fromDate = resolveWeekday(ctx.today, fromDay, nextWeek);
        const fromFixed = fromDay;
        return {
          ok: true,
          change: {
            kind: "schedule_onetime",
            summary: `Move ${dog.name} from ${fromDate} to ${toDate}`,
            detail: [
              "One-time only. The recurring schedule is untouched.",
              `${dog.name} drops off ${fromFixed} ${fromDate} and appears on ${toDay} ${toDate}.`,
            ],
            dogIds: [dog.id],
            effectiveDate: toDate,
            recurring: false,
            apply: () => moveOneTime(dog.id, fromDate, toDate),
          },
        };
      }

      return {
        ok: true,
        change: {
          kind: "schedule_onetime",
          summary: `Add ${dog.name} on ${toDate}`,
          detail: [
            "One-time addition. The recurring schedule is untouched.",
            `${dog.name} has no recurring ${toDay}, so this is added as an exception.`,
          ],
          dogIds: [dog.id],
          effectiveDate: toDate,
          recurring: false,
          apply: () => addException(dog.id, toDate, "added", "Added via command bar"),
        },
      };
    }

    return {
      ok: false,
      error:
        "Could not interpret that. Try: “Move Luna to Thursday next week”, “Move Mochi from Monday to Wednesday going forward”, “Bear needs pickup this Friday”, “Luna cannot be grouped with Pepper”, or “Change Koda to yellow”.",
    };
  },
};

export const EXAMPLE_COMMANDS = [
  "Move Luna to Thursday next week",
  "Move Mochi from Monday to Wednesday going forward",
  "Bear needs pickup this Friday",
  "Luna cannot be grouped with Pepper",
  "Change Buddy to yellow",
];

export { todayISO, weekdayOf };
