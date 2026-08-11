import type { Dog, Floor, Walker, Weekday } from "@/models/types";
import { addDays, resolveWeekday } from "@/utils/dates";
import type { HarnessAction } from "./intents";

/**
 * Canonical builders for every allow-listed action.
 *
 * Both interpreters — deterministic and Gemini-backed — funnel through here,
 * so the preview wording, the date arithmetic and the stated consequences are
 * identical whichever route a message took. The model never writes any of this
 * text; it only decides which builder applies and with which dogs.
 */

export function buildFlagIncompatibility(
  primary: Dog, others: Dog[], source: string, confidence: number
): HarnessAction {
  return {
    intent: "flag_incompatibility",
    params: {
      primary_dog_id: primary.id,
      incompatible_with_dog_ids: others.map((d) => d.id),
      reason: source,
    },
    confidence,
    source_text: source,
    dogIds: [primary.id, ...others.map((d) => d.id)],
    preview: `Mark ${primary.name} as incompatible with ${others.map((d) => d.name).join(", ")}`,
    detail: [
      "Written in both directions, so whichever record is opened shows the flag.",
      "Applies to today's and all future walk groups, floor plans and van manifests.",
      "Stays until an admin removes it.",
    ],
    recurring: true,
  };
}

export function buildRemoveIncompatibility(
  a: Dog, b: Dog, source: string, confidence: number
): HarnessAction {
  return {
    intent: "remove_incompatibility",
    params: { dogAId: a.id, dogBId: b.id },
    confidence,
    source_text: source,
    dogIds: [a.id, b.id],
    preview: `Remove the incompatibility between ${a.name} and ${b.name}`,
    detail: [
      "They could be grouped together again on walks, floors and vans.",
      "Removing a safety flag is an admin action.",
    ],
    recurring: true,
  };
}

export function buildAttendance(
  dog: Dog, date: string, absent: boolean, source: string, confidence: number
): HarnessAction {
  return {
    intent: absent ? "mark_absent" : "mark_present",
    params: { dogId: dog.id, date },
    confidence,
    source_text: source,
    dogIds: [dog.id],
    preview: `${absent ? "Mark" : "Add"} ${dog.name} ${absent ? "absent" : "as attending"} on ${date}`,
    detail: [
      "One date only. The recurring schedule is untouched.",
      absent
        ? "They drop out of that day's walks, floors and transport."
        : "They join that day's walks, floors and transport.",
    ],
    effectiveDate: date,
    recurring: false,
  };
}

export function buildVanMove(
  dog: Dog, vanIndex: number, date: string, source: string, confidence: number
): HarnessAction {
  return {
    intent: "reassign_van",
    params: { dogId: dog.id, vanIndex, date },
    confidence,
    source_text: source,
    dogIds: [dog.id],
    preview: `Move ${dog.name} to Van ${vanIndex + 1} on ${date}`,
    detail: [
      "Applies to both the morning pickup and evening drop-off run for that date.",
      "Dogs share a vehicle for the whole run, so this is checked against incompatibility flags.",
    ],
    effectiveDate: date,
    recurring: false,
  };
}

export function buildRoomMove(
  dog: Dog, floor: Floor, date: string, source: string, confidence: number
): HarnessAction {
  return {
    intent: "reassign_room",
    params: { dogId: dog.id, floorId: floor.id, date },
    confidence,
    source_text: source,
    dogIds: [dog.id],
    preview: `Move ${dog.name} to ${floor.name} on ${date}`,
    detail: ["Today only. Checked against floor capacity and incompatibility flags."],
    effectiveDate: date,
    recurring: false,
  };
}

export function buildWalkMove(
  dog: Dog, walker: Walker, date: string, source: string, confidence: number
): HarnessAction {
  return {
    intent: "reassign_walk_group",
    params: { dogId: dog.id, walkerId: walker.id, date },
    confidence,
    source_text: source,
    dogIds: [dog.id],
    preview: `Move ${dog.name} into ${walker.name}'s walk group on ${date}`,
    detail: ["Today only, applied immediately with undo."],
    effectiveDate: date,
    recurring: false,
  };
}

export function buildColour(
  dog: Dog, colour: "green" | "yellow" | "red", source: string, confidence: number
): HarnessAction {
  const detail = [`Currently ${dog.behaviorColor ?? "not assessed"}.`];
  if (colour === "red") {
    detail.push("Red dogs walk 1:1, and floor placement routes to staff review.");
  }
  return {
    intent: "set_behaviour_colour",
    params: { dogId: dog.id, colour },
    confidence,
    source_text: source,
    dogIds: [dog.id],
    preview: `Set ${dog.name} to ${colour}`,
    detail,
    recurring: true,
  };
}

export function buildMedicalNote(
  dog: Dog, note: string, source: string, confidence: number
): HarnessAction {
  return {
    intent: "flag_medical_note",
    params: { dogId: dog.id, note },
    confidence,
    source_text: source,
    dogIds: [dog.id],
    preview: `Add a medical note to ${dog.name}`,
    detail: [
      `Note: "${note}"`,
      "Medical information is never applied automatically — it routes to a person.",
    ],
    recurring: true,
  };
}

export function buildReschedule(
  dog: Dog,
  opts: {
    fromDay: Weekday | null;
    toDay: Weekday;
    recurring: boolean;
    nextWeek: boolean;
    today: string;
  },
  source: string,
  confidence: number
): HarnessAction {
  const { fromDay, toDay, recurring, nextWeek, today } = opts;
  const effective = recurring ? addDays(today, 1) : resolveWeekday(today, toDay, nextWeek);
  const toDate = recurring ? undefined : resolveWeekday(today, toDay, nextWeek);
  const fromDate = fromDay && !recurring ? resolveWeekday(today, fromDay, nextWeek) : undefined;

  return {
    intent: "reschedule_service",
    params: {
      dogId: dog.id,
      service: "daycare",
      fromWeekday: fromDay,
      toWeekday: toDay,
      fromDate,
      toDate,
      effectiveFrom: effective,
      recurring,
    },
    confidence,
    source_text: source,
    dogIds: [dog.id],
    preview: recurring
      ? `Move ${dog.name} from ${fromDay} to ${toDay} going forward`
      : fromDate
        ? `Move ${dog.name} from ${fromDate} to ${toDate}`
        : `Add ${dog.name} on ${toDate}`,
    detail: recurring
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
    recurring,
  };
}
