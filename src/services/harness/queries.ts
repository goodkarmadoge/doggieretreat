import type { AttendanceException, Dog, RecurringAttendance, Walker } from "@/models/types";
import { attendingOn, needsDropoff, needsPickup, recurringDaysFor } from "@/services/scheduling/attendance";
import { addDays, formatLong, toISODate, weekdayOf } from "@/utils/dates";
import { WEEKDAYS, type Weekday } from "@/models/types";
import type { HarnessContext } from "./interpreter";
import { resolveDog } from "./interpreter";

/**
 * Read-only questions.
 *
 * The intent taxonomy in the harness spec is entirely about making changes,
 * so a perfectly reasonable question — "how many dogs are scheduled for
 * Thursday?" — fell through to NEEDS_HUMAN_REVIEW and filled a queue meant for
 * genuine safety escalations.
 *
 * Questions are handled separately and answered immediately. They change
 * nothing, so they need no confirmation, no permission tier and no audit
 * entry: there is nothing to approve or undo. Keeping them out of the
 * mutation pipeline entirely is what stops the review queue becoming noise.
 */

export interface QueryAnswer {
  headline: string;
  detail: string[];
  /** Names to render as chips, when the answer is a list of dogs. */
  chips?: string[];
  /** Set when the question is about a specific date, so the UI can offer to jump there. */
  date?: string;
}

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10,
  dec: 11, december: 11,
};

const DAY_WORDS: Record<string, Weekday> = {
  mon: "Mon", monday: "Mon", tue: "Tue", tues: "Tue", tuesday: "Tue",
  wed: "Wed", wednesday: "Wed", thu: "Thu", thur: "Thu", thurs: "Thu",
  thursday: "Thu", fri: "Fri", friday: "Fri", sat: "Sat", saturday: "Sat",
  sun: "Sun", sunday: "Sun",
};

/**
 * Resolve a date phrase. Handles "Thursday August 13", "13 Aug", "tomorrow",
 * "next Monday" and plain ISO. Year is inferred from today when omitted,
 * rolling forward if the date has already passed this year.
 */
export function parseDateExpression(text: string, today: string): string | null {
  const t = text.toLowerCase();

  const iso = t.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];

  if (/\btoday\b/.test(t)) return today;
  if (/\btomorrow\b/.test(t)) return addDays(today, 1);
  if (/\byesterday\b/.test(t)) return addDays(today, -1);

  const [ty, tm, td] = today.split("-").map(Number);

  // "August 13" / "Aug 13th" / "13 August"
  const monthNames = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");
  const md =
    t.match(new RegExp(`\\b(${monthNames})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`)) ??
    t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthNames})\\b`));
  if (md) {
    const monthToken = MONTHS[md[1]] !== undefined ? md[1] : md[2];
    const dayToken = MONTHS[md[1]] !== undefined ? md[2] : md[1];
    const month = MONTHS[monthToken];
    const day = Number(dayToken);
    if (month !== undefined && day >= 1 && day <= 31) {
      let year = ty;
      const candidate = new Date(year, month, day);
      const todayDate = new Date(ty, tm - 1, td);
      // A bare month/day more than six months in the past means next year.
      if (candidate.getTime() < todayDate.getTime() - 183 * 864e5) year += 1;
      return toISODate(new Date(year, month, day));
    }
  }

  // "next Thursday" / "this Friday" / bare "Thursday"
  const dayMatch = t.match(
    new RegExp(`\\b(next|this|coming)?\\s*(${Object.keys(DAY_WORDS).sort((a, b) => b.length - a.length).join("|")})\\b`)
  );
  if (dayMatch) {
    const target = DAY_WORDS[dayMatch[2]];
    const wantNext = dayMatch[1] === "next";
    for (let i = wantNext ? 7 : 0; i <= 21; i++) {
      const candidate = addDays(today, i);
      if (weekdayOf(candidate) === target) {
        // "this Thursday" on a Thursday means today.
        if (i === 0 && !wantNext) return candidate;
        if (i > 0) return candidate;
      }
    }
  }

  return null;
}

interface QueryContext extends HarnessContext {
  exceptions: AttendanceException[];
  transportOverrides: { dogId: string; date: string; type: "pickup" | "dropoff"; required: boolean }[];
}

const nameList = (dogs: Dog[]) => dogs.map((d) => d.name).sort((a, b) => a.localeCompare(b));

/**
 * Deterministic question matching. Runs BEFORE the mutation interpreter so a
 * question never reaches the change pipeline in the first place.
 */
export function answerQuestion(raw: string, ctx: QueryContext): QueryAnswer | null {
  const text = raw.trim().replace(/\s+/g, " ");
  const t = text.toLowerCase();

  // Only treat it as a question if it looks like one. A bare statement should
  // still be read as a change request.
  const looksLikeQuestion =
    /\?$/.test(text) ||
    /^(how many|how much|who|what|which|when|is |are |does |do |can |show|list|tell me|count)\b/.test(t);
  if (!looksLikeQuestion) return null;

  const attending = (date: string) =>
    attendingOn(date, ctx.dogs, ctx.recurring, ctx.exceptions);

  /* ---- attendance for a date ---- */
  if (/\b(scheduled|attending|booked|coming in|in on|here|roster)\b/.test(t) ||
      /^(how many dogs|who('s| is)? (in|coming))/.test(t)) {
    const date = parseDateExpression(text, ctx.today) ?? ctx.today;
    const dogs = attending(date);
    const colours = {
      green: dogs.filter((d) => d.behaviorColor === "green").length,
      yellow: dogs.filter((d) => d.behaviorColor === "yellow").length,
      red: dogs.filter((d) => d.behaviorColor === "red").length,
      none: dogs.filter((d) => d.behaviorColor === null).length,
    };
    const wantsList = /\bwho\b|\blist\b|\bwhich dogs\b/.test(t);

    return {
      headline: `${dogs.length} ${dogs.length === 1 ? "dog is" : "dogs are"} scheduled for ${formatLong(date)}`,
      detail: dogs.length
        ? [
            `${colours.green} green · ${colours.yellow} yellow · ${colours.red} red` +
              (colours.none ? ` · ${colours.none} not yet assessed` : ""),
          ]
        : ["Nobody is booked in on that date."],
      chips: wantsList || dogs.length <= 24 ? nameList(dogs) : undefined,
      date,
    };
  }

  /* ---- transport counts ---- */
  if (/\b(pickup|pick up|pick-ups|pickups|drop ?off|dropoffs|transport|van)\b/.test(t)) {
    const date = parseDateExpression(text, ctx.today) ?? ctx.today;
    const dogs = attending(date);
    const isDrop = /drop/.test(t);
    const needing = dogs.filter((d) =>
      isDrop
        ? needsDropoff(d, date, ctx.transportOverrides as never)
        : needsPickup(d, date, ctx.transportOverrides as never)
    );
    return {
      headline: `${needing.length} ${isDrop ? "drop-off" : "pickup"}${needing.length === 1 ? "" : "s"} on ${formatLong(date)}`,
      detail: [`Out of ${dogs.length} attending that day.`],
      chips: nameList(needing),
      date,
    };
  }

  /* ---- who does a dog not get along with ---- */
  const conflictQ = text.match(
    /\b(?:who|what dogs?)\b.*\b(?:can(?:'|no)?t|cannot|doesn'?t|does not|not)\b.*\b(?:with|near|around)?\s*([A-Z][\w'-]*)\s*\??$/i
  ) ?? text.match(/\b(?:conflicts?|incompatib\w*)\b.*?\b(?:for|with|does)\s+([A-Z][\w'-]*)/i);
  if (conflictQ) {
    const r = resolveDog(conflictQ[1], ctx.dogs);
    if (r.ok) {
      const others = r.dog.incompatibleDogIds
        .map((id) => ctx.dogs.find((d) => d.id === id))
        .filter((d): d is Dog => !!d);
      return {
        headline: others.length
          ? `${r.dog.name} must not be grouped with ${others.length} ${others.length === 1 ? "dog" : "dogs"}`
          : r.dog.conflictsReviewed
            ? `${r.dog.name} has no recorded conflicts`
            : `Nobody has checked ${r.dog.name}'s conflicts yet`,
        detail: others.length
          ? ["Applies to walk groups, floor placement and van manifests."]
          : r.dog.conflictsReviewed
            ? ["Someone has confirmed this, so it is a real answer rather than a gap."]
            : ["That is different from having none — it means it has not been assessed."],
        chips: nameList(others),
      };
    }
  }

  /* ---- setup gaps ---- */
  if (/\b(need|needs|missing|without|not (yet )?(assessed|set|checked))\b/.test(t)) {
    const active = ctx.dogs.filter((d) => d.active);
    const withDays = new Set(ctx.recurring.filter((r) => !r.activeUntil).map((r) => r.dogId));

    if (/colour|color|behaviour|behavior/.test(t)) {
      const dogs = active.filter((d) => d.behaviorColor === null);
      return {
        headline: `${dogs.length} ${dogs.length === 1 ? "dog needs" : "dogs need"} a behaviour colour`,
        detail: ["Until assessed, they are held out of every walk group and floor plan."],
        chips: nameList(dogs),
      };
    }
    if (/conflict|compat/.test(t)) {
      const dogs = active.filter((d) => !d.conflictsReviewed);
      return {
        headline: `${dogs.length} ${dogs.length === 1 ? "dog has" : "dogs have"} never had conflicts checked`,
        detail: ["Nobody has confirmed who they can and cannot be grouped with."],
        chips: nameList(dogs),
      };
    }
    if (/day|schedule|daycare/.test(t)) {
      const dogs = active.filter((d) => !withDays.has(d.id));
      return {
        headline: `${dogs.length} ${dogs.length === 1 ? "dog has" : "dogs have"} no daycare days`,
        detail: ["They never appear on any day's roster."],
        chips: nameList(dogs),
      };
    }
  }

  /* ---- a dog's schedule ---- */
  const whenQ = text.match(/\bwhen\b.*?\b([A-Z][\w'-]*)\b/i) ??
                text.match(/\b([A-Z][\w'-]*)(?:'s)?\s+(?:days|schedule)\b/i);
  if (whenQ) {
    const r = resolveDog(whenQ[1], ctx.dogs);
    if (r.ok) {
      const days = recurringDaysFor(r.dog.id, ctx.recurring, ctx.today) as Weekday[];
      const ordered = WEEKDAYS.filter((d) => days.includes(d));
      return {
        headline: ordered.length
          ? `${r.dog.name} attends ${ordered.join(", ")}`
          : `${r.dog.name} has no recurring daycare days`,
        detail: ordered.length
          ? ["One-off changes are shown on the dog's profile."]
          : ["They will not appear on any roster until days are set."],
      };
    }
  }

  /* ---- who is walking with X ---- */
  const walkerQ = text.match(/\b(?:who|which dogs?)\b.*\bwith\s+([A-Z][\w'-]*)/i);
  if (walkerQ) {
    const q = walkerQ[1].toLowerCase();
    const walker: Walker | undefined =
      ctx.walkers.find((w) => w.name.toLowerCase() === q) ??
      ctx.walkers.find((w) => w.name.toLowerCase().startsWith(q));
    if (walker) {
      return {
        headline: `Walk groups are generated per day`,
        detail: [
          `Open the Walk Planner for the date you mean to see ${walker.name}'s group.`,
          "Groups change whenever attendance or conflicts change, so there is no standing answer.",
        ],
      };
    }
  }

  return null;
}
