import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import clsx from "clsx";
import type { Dog, RecurringAttendance } from "@/models/types";

/**
 * Why this exists.
 *
 * The planners were reporting unplaced dogs on every single weekday, and the
 * cause was never the algorithms — it was that a large share of records had
 * never been enriched. A dog with no behaviour colour is held out of every
 * walk and floor plan, forever, and the app said so in a red panel that was
 * therefore always red. Staff learn to ignore a warning that is always on.
 *
 * This turns that standing condition into a finite, countable piece of work
 * with a link straight to the screen that fixes it.
 */

export interface SetupGap {
  key: string;
  label: string;
  count: number;
  consequence: string;
  href: string;
}

export function computeGaps(dogs: Dog[], recurring: RecurringAttendance[]): SetupGap[] {
  const active = dogs.filter((d) => d.active);
  const withDays = new Set(recurring.filter((r) => !r.activeUntil).map((r) => r.dogId));

  return [
    {
      key: "colour",
      label: "no behaviour colour",
      count: active.filter((d) => d.behaviorColor === null).length,
      consequence: "Held out of every walk group and floor plan until assessed.",
      href: "#/dogs?fix=colour",
    },
    {
      key: "days",
      label: "no daycare days",
      count: active.filter((d) => !withDays.has(d.id)).length,
      consequence: "Never appear on any day's roster, so they are invisible to planning.",
      href: "#/dogs?fix=days",
    },
    {
      key: "transport",
      label: "no transport preference",
      count: active.filter((d) => d.defaultPickup === null && d.defaultDropoff === null).length,
      consequence: "Left off pickup and drop-off runs entirely.",
      href: "#/dogs?fix=transport",
    },
    {
      key: "conflicts",
      label: "conflicts never checked",
      count: active.filter((d) => !d.conflictsReviewed).length,
      consequence: "Nobody has confirmed who they can and cannot be grouped with.",
      href: "#/dogs?fix=conflicts",
    },
  ].filter((g) => g.count > 0);
}

export default function SetupProgress({
  dogs,
  recurring,
  compact = false,
}: {
  dogs: Dog[];
  recurring: RecurringAttendance[];
  compact?: boolean;
}) {
  const active = dogs.filter((d) => d.active);
  const gaps = computeGaps(dogs, recurring);

  const ready = active.filter(
    (d) =>
      d.behaviorColor !== null &&
      d.conflictsReviewed &&
      !(d.defaultPickup === null && d.defaultDropoff === null)
  ).length;
  const pct = active.length ? Math.round((ready / active.length) * 100) : 100;

  if (!gaps.length) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-signal-green/30 bg-signal-greenSoft px-3 py-2 text-[12.5px] font-semibold text-signal-green">
        <CheckCircle2 size={15} />
        Every active dog is fully set up. Nothing is being held out of planning.
      </div>
    );
  }

  return (
    <section className="card flex flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-bold tracking-tight">Records still to set up</h2>
          <p className="text-[12px] text-ink-500">
            These are why dogs appear under “needs review” in the planners.
          </p>
        </div>
        <span className="font-mono text-[13px] font-bold text-ink-800">
          {ready}/{active.length} ready
        </span>
      </div>

      <div className="h-2 overflow-hidden rounded-full border border-ink-200 bg-ink-100">
        <div
          className="h-full bg-brand-500 transition-[width] duration-500"
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Records fully set up"
        />
      </div>

      <ul className={clsx("grid gap-2", compact ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-4")}>
        {gaps.map((g) => (
          <li key={g.key}>
            <Link
              to={g.href.replace("#", "")}
              className="flex h-full flex-col gap-1 rounded-md border border-ink-200 bg-ink-50 p-2.5 hover:border-brand-400"
            >
              <span className="font-mono text-[20px] font-bold leading-none text-signal-amber">
                {g.count}
              </span>
              <span className="text-[12.5px] font-semibold text-ink-800">{g.label}</span>
              <span className="text-[11px] leading-snug text-ink-500">{g.consequence}</span>
              <span className="mt-auto flex items-center gap-1 pt-1 text-[11.5px] font-semibold text-brand-600">
                Fix these <ArrowRight size={11} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
