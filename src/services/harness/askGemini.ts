import type { AttendanceException, Dog, RecurringAttendance } from "@/models/types";
import { WEEKDAYS, type Weekday } from "@/models/types";
import { attendingOn, recurringDaysFor } from "@/services/scheduling/attendance";
import { formatLong } from "@/utils/dates";
import type { HarnessContext } from "./interpreter";
import type { QueryAnswer } from "./queries";

/**
 * Open-ended question answering.
 *
 * The deterministic query engine handles the common shapes instantly and for
 * free. This is the fallback for everything else — "which dogs are red and
 * coming in on Friday", "who lives near Bishan", "is anyone double-booked".
 *
 * The model is given a compact snapshot of the roster and told to answer only
 * from it. It has no route to an action: this path returns prose, never an
 * intent, so there is nothing to validate, tier or confirm.
 */

export interface AskContext extends HarnessContext {
  exceptions: AttendanceException[];
}

/**
 * Compact, readable snapshot. One line per dog keeps it well inside a sensible
 * token budget for a 50-dog roster while staying legible enough that a wrong
 * answer can be traced back to the data it came from.
 */
export function buildSnapshot(ctx: AskContext): string {
  const active = ctx.dogs.filter((d) => d.active);
  const byId = new Map(ctx.dogs.map((d) => [d.id, d.name]));

  const lines = active.map((d) => {
    const days = (recurringDaysFor(d.id, ctx.recurring, ctx.today) as Weekday[]);
    const ordered = WEEKDAYS.filter((w) => days.includes(w));
    const transport =
      [d.defaultPickup ? "pickup" : null, d.defaultDropoff ? "dropoff" : null]
        .filter(Boolean).join("+") || "none";
    const conflicts = d.incompatibleDogIds.map((id) => byId.get(id) ?? id);
    return [
      d.name,
      `colour=${d.behaviorColor ?? "not-assessed"}`,
      `days=${ordered.join("/") || "none"}`,
      `transport=${transport}`,
      conflicts.length ? `avoids=${conflicts.join("/")}` : "avoids=none",
      d.conflictsReviewed ? "conflicts-checked" : "conflicts-unchecked",
      d.breed ? `breed=${d.breed}` : "",
      d.address ? `area=${areaOf(d.address)}` : "",
      d.vaccinationStatus ? `vax=${d.vaccinationStatus}` : "",
    ].filter(Boolean).join(", ");
  });

  // A week of attendance, so "who's in on Friday" is answerable without the
  // model having to work out the recurrence rules itself.
  const week: string[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDaysLocal(ctx.today, i);
    const dogs = attendingOn(date, ctx.dogs, ctx.recurring, ctx.exceptions);
    week.push(`${date} (${formatLong(date).split(",")[0]}): ${dogs.length} dogs — ${dogs.map((d) => d.name).join(", ") || "none"}`);
  }

  return [
    `TODAY: ${ctx.today}`,
    `VANS: ${ctx.vanCount}`,
    `FLOORS: ${ctx.floors.map((f) => `${f.name} (capacity ${f.capacity})`).join("; ") || "none"}`,
    `WALKERS: ${ctx.walkers.map((w) => `${w.name}${w.available ? "" : " (unavailable)"}`).join(", ") || "none"}`,
    "",
    `DOGS (${active.length} active):`,
    ...lines,
    "",
    "ATTENDANCE FOR THE NEXT 7 DAYS:",
    ...week,
    "",
    "RULES IN FORCE: Red dogs walk 1:1. Dogs listed as avoiding each other are never",
    "grouped together on walks, floors or vans. A dog with colour=not-assessed is held",
    "out of automatic grouping entirely.",
  ].join("\n");
}

function areaOf(address: string): string {
  // Just the recognisable place, not the full postal address.
  const m = address.match(/(?:Blk\s+\d+\s+)?([A-Za-z][A-Za-z' ]+?)(?:\s+(?:Ave|Avenue|St|Street|Rd|Road|Dr|Drive|Cres|Lane|Link|Way|Central|Terrace|Park|View|Vale|Field))\b/);
  return (m?.[1] ?? address.split(",")[0]).trim().slice(0, 28);
}

export type AskOutcome =
  | { kind: "answer"; answer: QueryAnswer; model: string }
  | { kind: "unavailable"; message: string };

export async function askGemini(question: string, ctx: AskContext): Promise<AskOutcome> {
  let res: Response;
  try {
    res = await fetch("/api/interpret", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "answer", question, snapshot: buildSnapshot(ctx) }),
    });
  } catch {
    return { kind: "unavailable", message: "Couldn't reach the assistant. Check the connection." };
  }

  if (res.status === 503) {
    return {
      kind: "unavailable",
      message: "Karma can answer set questions offline, but open-ended ones need a Gemini key on the server.",
    };
  }
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as { message?: string };
    return { kind: "unavailable", message: b.message ?? `The assistant failed (${res.status}).` };
  }

  const data = (await res.json()) as {
    answer?: string; dogNames?: string[]; grounded?: boolean; model?: string;
  };
  const text = (data.answer ?? "").trim();
  if (!text) return { kind: "unavailable", message: "The assistant had nothing to say." };

  return {
    kind: "answer",
    model: data.model ?? "gemini",
    answer: {
      headline: text,
      detail: data.grounded === false
        ? ["Karma couldn't find this in the roster data, so treat it with caution."]
        : [],
      chips: (data.dogNames ?? []).slice(0, 40),
    },
  };
}

function addDaysLocal(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  const p = (v: number) => String(v).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}
