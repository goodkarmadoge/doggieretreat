import { WEEKDAYS, type Weekday } from "@/models/types";

/**
 * All dates are handled as local calendar dates in yyyy-mm-dd form. The app is
 * single-timezone (Asia/Singapore, UTC+8) and never stores instants, which
 * keeps "next Thursday" from drifting across a UTC boundary.
 */

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function fromISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function weekdayOf(iso: string): Weekday {
  // JS getDay(): 0 = Sunday. WEEKDAYS is Mon-first.
  const js = fromISODate(iso).getDay();
  return WEEKDAYS[(js + 6) % 7];
}

export function addDays(iso: string, n: number): string {
  const d = fromISODate(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

export function formatLong(iso: string): string {
  return fromISODate(iso).toLocaleDateString("en-SG", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function formatShort(iso: string): string {
  return fromISODate(iso).toLocaleDateString("en-SG", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** Monday of the week containing `iso`. */
export function startOfWeek(iso: string): string {
  const d = fromISODate(iso);
  const js = d.getDay();
  return addDays(iso, -((js + 6) % 7));
}

/**
 * Next occurrence of `weekday` strictly after `from`. When `nextWeek` is set,
 * resolve within the following calendar week instead — which is what staff mean
 * by "move Luna to Thursday next week".
 */
export function resolveWeekday(from: string, weekday: Weekday, nextWeek: boolean): string {
  const target = WEEKDAYS.indexOf(weekday);
  if (nextWeek) {
    const nextMonday = addDays(startOfWeek(from), 7);
    return addDays(nextMonday, target);
  }
  for (let i = 1; i <= 7; i++) {
    const candidate = addDays(from, i);
    if (weekdayOf(candidate) === weekday) return candidate;
  }
  return from;
}
