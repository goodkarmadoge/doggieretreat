import type {
  AttendanceException,
  Dog,
  RecurringAttendance,
  TransportOverride,
} from "@/models/types";
import { weekdayOf } from "@/utils/dates";

/**
 * Single source of truth for "who is here on date X".
 *
 * Every planner calls this rather than keeping its own copy of attendance,
 * which is what makes a schedule change propagate to walks, floors and
 * transport at once.
 *
 * Resolution order:
 *   1. recurring rows active on that date (activeFrom <= date < activeUntil)
 *   2. exceptions override recurring, in both directions
 */
export function attendingOn(
  date: string,
  dogs: Dog[],
  recurring: RecurringAttendance[],
  exceptions: AttendanceException[]
): Dog[] {
  const weekday = weekdayOf(date);

  const recurringDogIds = new Set(
    recurring
      .filter(
        (r) =>
          r.weekday === weekday &&
          r.activeFrom <= date &&
          (!r.activeUntil || date < r.activeUntil)
      )
      .map((r) => r.dogId)
  );

  const dayExceptions = exceptions.filter((e) => e.date === date);
  for (const e of dayExceptions) {
    if (e.status === "added") recurringDogIds.add(e.dogId);
    else recurringDogIds.delete(e.dogId);
  }

  return dogs.filter((d) => d.active && recurringDogIds.has(d.id));
}

export function recurringDaysFor(
  dogId: string,
  recurring: RecurringAttendance[],
  onDate: string
): string[] {
  return recurring
    .filter(
      (r) =>
        r.dogId === dogId &&
        r.activeFrom <= onDate &&
        (!r.activeUntil || onDate < r.activeUntil)
    )
    .map((r) => r.weekday);
}

export function needsPickup(
  dog: Dog,
  date: string,
  overrides: TransportOverride[]
): boolean {
  const o = overrides.find(
    (x) => x.dogId === dog.id && x.date === date && x.type === "pickup"
  );
  if (o) return o.required;
  return dog.defaultPickup === true;
}

export function needsDropoff(
  dog: Dog,
  date: string,
  overrides: TransportOverride[]
): boolean {
  const o = overrides.find(
    (x) => x.dogId === dog.id && x.date === date && x.type === "dropoff"
  );
  if (o) return o.required;
  return dog.defaultDropoff === true;
}
