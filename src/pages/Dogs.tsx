import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import { PageShell } from "@/App";
import { ColorBadge, EmptyState, SectionTitle } from "@/components/ui";
import { useDogs, useRecurring } from "@/hooks/useData";
import { recurringDaysFor } from "@/services/scheduling/attendance";
import { todayISO } from "@/utils/dates";
import type { BehaviorColor } from "@/models/types";

type ColorFilter = "all" | BehaviorColor | "unassessed";
type TransportFilter = "all" | "pickup" | "dropoff" | "none";

export default function Dogs() {
  const dogs = useDogs();
  const recurring = useRecurring();
  const today = todayISO();

  const [query, setQuery] = useState("");
  const [color, setColor] = useState<ColorFilter>("all");
  const [transport, setTransport] = useState<TransportFilter>("all");
  const [showInactive, setShowInactive] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return dogs
      .filter((d) => (showInactive ? true : d.active))
      .filter((d) => {
        if (color === "all") return true;
        if (color === "unassessed") return d.behaviorColor === null;
        return d.behaviorColor === color;
      })
      .filter((d) => {
        if (transport === "all") return true;
        if (transport === "pickup") return d.defaultPickup === true;
        if (transport === "dropoff") return d.defaultDropoff === true;
        return !d.defaultPickup && !d.defaultDropoff;
      })
      .filter((d) =>
        !q
          ? true
          : `${d.name} ${d.ownerName ?? ""} ${d.breed ?? ""} ${d.id}`.toLowerCase().includes(q)
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [dogs, query, color, transport, showInactive]);

  const counts = {
    green: dogs.filter((d) => d.active && d.behaviorColor === "green").length,
    yellow: dogs.filter((d) => d.active && d.behaviorColor === "yellow").length,
    red: dogs.filter((d) => d.active && d.behaviorColor === "red").length,
    unassessed: dogs.filter((d) => d.active && d.behaviorColor === null).length,
  };

  return (
    <PageShell
      title="Dogs"
      description={`${dogs.filter((d) => d.active).length} active records`}
    >
      <div className="card flex flex-wrap items-center gap-2 p-3">
        <input
          className="input max-w-[280px]"
          placeholder="Search dog, owner, breed or Pet ID…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search dogs"
        />

        <div className="flex gap-0.5 rounded bg-ink-100 p-0.5">
          {([
            ["all", `All`], ["green", `Green ${counts.green}`],
            ["yellow", `Yellow ${counts.yellow}`], ["red", `Red ${counts.red}`],
            ["unassessed", `Not assessed ${counts.unassessed}`],
          ] as [ColorFilter, string][]).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setColor(v)}
              className={clsx(
                "rounded px-2.5 py-1 text-[12px] font-semibold",
                color === v ? "bg-white text-ink-900 shadow-sm" : "text-ink-500"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <select
          className="rounded border border-ink-300 bg-white px-2 py-1.5 text-[12.5px]"
          value={transport}
          onChange={(e) => setTransport(e.target.value as TransportFilter)}
          aria-label="Filter by transport"
        >
          <option value="all">Any transport</option>
          <option value="pickup">Needs pickup</option>
          <option value="dropoff">Needs drop-off</option>
          <option value="none">Owner handles both</option>
        </select>

        <label className="flex items-center gap-1.5 text-[12.5px] text-ink-600">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Show inactive
        </label>
      </div>

      <section className="card overflow-hidden">
        <div className="border-b border-ink-200 bg-ink-50 px-3 py-2">
          <SectionTitle>{filtered.length} shown</SectionTitle>
        </div>
        {filtered.length === 0 ? (
          <EmptyState title="No dogs match these filters" hint="Clear the search or widen the filters." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-ink-200 text-ink-500">
                  <th className="px-3 py-2 font-semibold">Dog</th>
                  <th className="px-3 py-2 font-semibold">Owner</th>
                  <th className="px-3 py-2 font-semibold">Colour</th>
                  <th className="px-3 py-2 font-semibold">Daycare days</th>
                  <th className="px-3 py-2 font-semibold">Transport</th>
                  <th className="px-3 py-2 font-semibold">Conflicts</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((dog) => {
                  const days = recurringDaysFor(dog.id, recurring, today);
                  return (
                    <tr key={dog.id} className="border-b border-ink-100 last:border-0 hover:bg-ink-50">
                      <td className="px-3 py-2">
                        <Link to={`/dogs/${dog.id}`} className="font-semibold hover:text-brand-700">
                          {dog.name}
                        </Link>
                        <div className="text-[11px] text-ink-400">
                          {dog.breed} · <span className="font-mono">{dog.id}</span>
                          {!dog.active && <span className="ml-1 text-signal-red">inactive</span>}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-[12.5px] text-ink-600">{dog.ownerName}</td>
                      <td className="px-3 py-2"><ColorBadge color={dog.behaviorColor} size="sm" /></td>
                      <td className="px-3 py-2 font-mono text-[11.5px] text-ink-600">
                        {days.length ? days.join(" ") : <span className="text-ink-400">none</span>}
                      </td>
                      <td className="px-3 py-2 text-[12px] text-ink-600">
                        {[dog.defaultPickup ? "Pickup" : null, dog.defaultDropoff ? "Drop-off" : null]
                          .filter(Boolean).join(" + ") || <span className="text-ink-400">Owner</span>}
                      </td>
                      <td className="px-3 py-2 text-[12px]">
                        {dog.incompatibleDogIds.length ? (
                          <span className="text-signal-red">{dog.incompatibleDogIds.length}</span>
                        ) : dog.conflictsReviewed ? (
                          <span className="text-ink-400">None</span>
                        ) : (
                          <span className="text-signal-amber">Not checked</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </PageShell>
  );
}
