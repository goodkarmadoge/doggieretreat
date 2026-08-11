import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Save, Undo2, X } from "lucide-react";
import clsx from "clsx";
import { PageShell } from "@/App";
import { ColorBadge, EmptyState, SectionTitle } from "@/components/ui";
import { useDogs, useRecurring } from "@/hooks/useData";
import {
  addRecurringDay, linkIncompatible, removeRecurringDay, setBehaviorColor,
  unlinkIncompatible, updateDog,
} from "@/db/repository";
import { recurringDaysFor } from "@/services/scheduling/attendance";
import { todayISO } from "@/utils/dates";
import { WEEKDAYS, type BehaviorColor, type Dog, type Weekday } from "@/models/types";

type ColorFilter = "all" | BehaviorColor | "unassessed";
type TransportFilter = "all" | "pickup" | "dropoff" | "none";

/** Staged edits for one dog. Absent keys mean "unchanged". */
interface Draft {
  behaviorColor?: BehaviorColor | null;
  days?: Weekday[];
  defaultPickup?: boolean | null;
  defaultDropoff?: boolean | null;
  incompatibleDogIds?: string[];
}

const DAY_LABEL: Record<Weekday, string> = {
  Mon: "Mo", Tue: "Tu", Wed: "We", Thu: "Th", Fri: "Fr", Sat: "Sa", Sun: "Su",
};

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

export default function Dogs() {
  const dogs = useDogs();
  const recurring = useRecurring();
  const today = todayISO();

  const [query, setQuery] = useState("");
  const [color, setColor] = useState<ColorFilter>("all");
  const [transport, setTransport] = useState<TransportFilter>("all");
  const [showInactive, setShowInactive] = useState(false);

  /**
   * Edits are staged rather than written on each click, because this screen
   * now has an explicit Save. Everything below reads through `effective()`,
   * so a row renders its pending value without touching the database.
   */
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [conflictEditor, setConflictEditor] = useState<string | null>(null);
  const [conflictQuery, setConflictQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  const dogMap = useMemo(() => new Map(dogs.map((d) => [d.id, d])), [dogs]);
  const daysOf = (id: string) => recurringDaysFor(id, recurring, today) as Weekday[];

  /** Stored value overlaid with any pending edit. */
  const effective = (dog: Dog) => {
    const d = drafts[dog.id] ?? {};
    return {
      behaviorColor: d.behaviorColor !== undefined ? d.behaviorColor : dog.behaviorColor,
      days: d.days ?? daysOf(dog.id),
      defaultPickup: d.defaultPickup !== undefined ? d.defaultPickup : dog.defaultPickup,
      defaultDropoff: d.defaultDropoff !== undefined ? d.defaultDropoff : dog.defaultDropoff,
      incompatibleDogIds: d.incompatibleDogIds ?? dog.incompatibleDogIds,
    };
  };

  const patch = (dogId: string, change: Draft) =>
    setDrafts((prev) => ({ ...prev, [dogId]: { ...prev[dogId], ...change } }));

  /**
   * Toggles must derive from the LATEST staged state, not a render-time
   * snapshot. Reading `effective()` in a handler loses the earlier change when
   * two toggles land in one React batch.
   */
  const patchWith = (dog: Dog, fn: (current: ReturnType<typeof effective>) => Draft) =>
    setDrafts((prev) => {
      const d = prev[dog.id] ?? {};
      const current = {
        behaviorColor: d.behaviorColor !== undefined ? d.behaviorColor : dog.behaviorColor,
        days: d.days ?? daysOf(dog.id),
        defaultPickup: d.defaultPickup !== undefined ? d.defaultPickup : dog.defaultPickup,
        defaultDropoff: d.defaultDropoff !== undefined ? d.defaultDropoff : dog.defaultDropoff,
        incompatibleDogIds: d.incompatibleDogIds ?? dog.incompatibleDogIds,
      };
      return { ...prev, [dog.id]: { ...d, ...fn(current) } };
    });

  const dirtyIds = Object.keys(drafts);
  const dirtyCount = dirtyIds.length;

  // Browser-level guard. In-app navigation is covered by the sticky bar below.
  useEffect(() => {
    if (!dirtyCount) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirtyCount]);

  /**
   * Conflicts are reciprocal, so staging one side stages the mirror too —
   * otherwise the other dog's row would still look clear until save.
   */
  const stageConflict = (aId: string, bId: string, add: boolean) => {
    setDrafts((prev) => {
      const next = { ...prev };
      const listFor = (id: string) =>
        next[id]?.incompatibleDogIds ?? dogMap.get(id)?.incompatibleDogIds ?? [];

      const aList = listFor(aId);
      const bList = listFor(bId);

      next[aId] = {
        ...next[aId],
        incompatibleDogIds: add
          ? Array.from(new Set([...aList, bId]))
          : aList.filter((x) => x !== bId),
      };
      next[bId] = {
        ...next[bId],
        incompatibleDogIds: add
          ? Array.from(new Set([...bList, aId]))
          : bList.filter((x) => x !== aId),
      };
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      for (const dogId of dirtyIds) {
        const dog = dogMap.get(dogId);
        const draft = drafts[dogId];
        if (!dog || !draft) continue;

        if (draft.behaviorColor !== undefined && draft.behaviorColor !== dog.behaviorColor) {
          await setBehaviorColor(dogId, draft.behaviorColor);
        }

        const patchDog: Partial<Dog> = {};
        if (draft.defaultPickup !== undefined && draft.defaultPickup !== dog.defaultPickup) {
          patchDog.defaultPickup = draft.defaultPickup;
        }
        if (draft.defaultDropoff !== undefined && draft.defaultDropoff !== dog.defaultDropoff) {
          patchDog.defaultDropoff = draft.defaultDropoff;
        }
        if (Object.keys(patchDog).length) await updateDog(dogId, patchDog);

        if (draft.days) {
          const current = daysOf(dogId);
          for (const day of draft.days) {
            if (!current.includes(day)) await addRecurringDay(dogId, day);
          }
          for (const day of current) {
            if (!draft.days.includes(day)) await removeRecurringDay(dogId, day);
          }
        }

        if (draft.incompatibleDogIds) {
          const current = dog.incompatibleDogIds;
          // linkIncompatible / unlinkIncompatible write both directions and
          // are idempotent, so the mirrored draft applying them twice is safe.
          for (const other of draft.incompatibleDogIds) {
            if (!current.includes(other)) await linkIncompatible(dogId, other);
          }
          for (const other of current) {
            if (!draft.incompatibleDogIds.includes(other)) {
              await unlinkIncompatible(dogId, other);
            }
          }
          // Recording that a person looked is separate from finding nothing.
          if (!dog.conflictsReviewed) await updateDog(dogId, { conflictsReviewed: true });
        }
      }
      setSavedNote(`Saved ${dirtyCount} ${dirtyCount === 1 ? "dog" : "dogs"}.`);
      setDrafts({});
      setTimeout(() => setSavedNote(null), 3000);
    } finally {
      setSaving(false);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return dogs
      .filter((d) => (showInactive ? true : d.active))
      .filter((d) => {
        const c = drafts[d.id]?.behaviorColor !== undefined
          ? drafts[d.id].behaviorColor
          : d.behaviorColor;
        if (color === "all") return true;
        if (color === "unassessed") return c === null;
        return c === color;
      })
      .filter((d) => {
        if (transport === "all") return true;
        const e = effective(d);
        if (transport === "pickup") return e.defaultPickup === true;
        if (transport === "dropoff") return e.defaultDropoff === true;
        return !e.defaultPickup && !e.defaultDropoff;
      })
      .filter((d) =>
        !q ? true : `${d.name} ${d.ownerName ?? ""} ${d.breed ?? ""} ${d.id}`.toLowerCase().includes(q)
      )
      .sort((a, b) => a.name.localeCompare(b.name));
    // effective() reads drafts; listing it would need a stable ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dogs, query, color, transport, showInactive, drafts, recurring]);

  const counts = {
    green: dogs.filter((d) => d.active && d.behaviorColor === "green").length,
    yellow: dogs.filter((d) => d.active && d.behaviorColor === "yellow").length,
    red: dogs.filter((d) => d.active && d.behaviorColor === "red").length,
    unassessed: dogs.filter((d) => d.active && d.behaviorColor === null).length,
  };

  const conflictCandidates = (dog: Dog) => {
    const q = conflictQuery.trim().toLowerCase();
    const already = effective(dog).incompatibleDogIds;
    return dogs
      .filter((d) => d.active && d.id !== dog.id && !already.includes(d.id))
      .filter((d) => (!q ? true : `${d.name} ${d.breed ?? ""}`.toLowerCase().includes(q)))
      .slice(0, 6);
  };

  return (
    <PageShell
      title="Dog Database"
      description={`${dogs.filter((d) => d.active).length} active records · edit inline, then save`}
    >
      <div className="card flex flex-wrap items-center gap-2 p-3">
        <input
          className="input max-w-[260px]"
          placeholder="Search dog, owner, breed or Pet ID…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search dogs"
        />

        <div className="flex gap-0.5 rounded bg-ink-100 p-0.5">
          {([
            ["all", "All"], ["green", `Green ${counts.green}`],
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

      {savedNote && (
        <p className="rounded bg-signal-greenSoft px-3 py-2 text-[12.5px] font-semibold text-signal-green">
          {savedNote}
        </p>
      )}

      <section className="card overflow-visible">
        <div className="border-b border-ink-200 bg-ink-50 px-3 py-2">
          <SectionTitle
            right={
              <span className="text-[12px] text-ink-500">
                Colour, days, transport and conflicts are editable here.
              </span>
            }
          >
            {filtered.length} shown
          </SectionTitle>
        </div>

        {filtered.length === 0 ? (
          <EmptyState title="No dogs match these filters" hint="Clear the search or widen the filters." />
        ) : (
          <div className="overflow-x-auto overflow-y-visible">
            <table className="w-full min-w-[1040px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-ink-200 text-ink-500">
                  <th className="px-3 py-2 font-semibold">Dog</th>
                  <th className="px-3 py-2 font-semibold">Owner</th>
                  <th className="px-3 py-2 font-semibold">Colour</th>
                  <th className="px-3 py-2 font-semibold">Daycare days</th>
                  <th className="px-3 py-2 font-semibold">Transport</th>
                  <th className="px-3 py-2 font-semibold">Does not get along with</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((dog) => {
                  const e = effective(dog);
                  const isDirty = !!drafts[dog.id];

                  return (
                    <tr
                      key={dog.id}
                      className={clsx(
                        "border-b border-ink-100 last:border-0",
                        isDirty ? "bg-brand-50/60" : "hover:bg-ink-50"
                      )}
                    >
                      <td className="px-3 py-2 align-top">
                        <Link to={`/dogs/${dog.id}`} className="font-semibold hover:text-brand-700">
                          {dog.name}
                        </Link>
                        <div className="text-[11px] text-ink-400">
                          {dog.breed} · <span className="font-mono">{dog.id}</span>
                          {!dog.active && <span className="ml-1 text-signal-red">inactive</span>}
                          {isDirty && (
                            <span className="ml-1 font-semibold text-brand-700">· unsaved</span>
                          )}
                        </div>
                      </td>

                      <td className="px-3 py-2 align-top text-[12.5px] text-ink-600">
                        {dog.ownerName}
                      </td>

                      {/* Colour — always offers all three, so "not assessed" is
                          one click from resolved. */}
                      <td className="px-3 py-2 align-top">
                        <div className="flex gap-0.5" role="group" aria-label={`Behaviour colour for ${dog.name}`}>
                          {(["green", "yellow", "red"] as BehaviorColor[]).map((c) => {
                            const on = e.behaviorColor === c;
                            return (
                              <button
                                key={c}
                                aria-pressed={on}
                                title={c[0].toUpperCase() + c.slice(1)}
                                onClick={() =>
                                  patchWith(dog, (curr) => ({
                                    behaviorColor: curr.behaviorColor === c ? null : c,
                                  }))
                                }
                                className={clsx(
                                  "h-6 w-6 rounded border font-mono text-[11px] font-bold",
                                  on && c === "green" && "border-signal-green bg-signal-green text-white",
                                  on && c === "yellow" && "border-signal-amber bg-signal-amber text-white",
                                  on && c === "red" && "border-signal-red bg-signal-red text-white",
                                  !on && "border-ink-300 bg-white text-ink-400 hover:border-ink-500"
                                )}
                              >
                                {c[0].toUpperCase()}
                              </button>
                            );
                          })}
                        </div>
                        {e.behaviorColor === null && (
                          <span className="mt-0.5 block text-[10px] text-signal-amber">
                            Not assessed
                          </span>
                        )}
                      </td>

                      <td className="px-3 py-2 align-top">
                        <div className="flex gap-0.5" role="group" aria-label={`Daycare days for ${dog.name}`}>
                          {WEEKDAYS.map((day) => {
                            const on = e.days.includes(day);
                            return (
                              <button
                                key={day}
                                aria-pressed={on}
                                title={day}
                                onClick={() =>
                                  patchWith(dog, (curr) => ({
                                    days: curr.days.includes(day)
                                      ? curr.days.filter((x) => x !== day)
                                      : [...curr.days, day].sort(
                                          (a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b)
                                        ),
                                  }))
                                }
                                className={clsx(
                                  "h-6 w-7 rounded border font-mono text-[10px] font-semibold",
                                  on
                                    ? "border-brand-600 bg-brand-600 text-white"
                                    : "border-ink-300 bg-white text-ink-400 hover:border-brand-400"
                                )}
                              >
                                {DAY_LABEL[day]}
                              </button>
                            );
                          })}
                        </div>
                      </td>

                      <td className="px-3 py-2 align-top">
                        <div className="flex gap-1">
                          {([
                            ["defaultPickup", "Pick", e.defaultPickup],
                            ["defaultDropoff", "Drop", e.defaultDropoff],
                          ] as const).map(([field, label, val]) => (
                            <button
                              key={field}
                              aria-pressed={val === true}
                              onClick={() =>
                                patchWith(dog, (curr) => ({
                                  [field]: curr[field] === true ? false : true,
                                }))
                              }
                              className={clsx(
                                "rounded border px-1.5 py-0.5 text-[11px] font-semibold",
                                val === true
                                  ? "border-brand-600 bg-brand-600 text-white"
                                  : val === false
                                    ? "border-ink-300 bg-white text-ink-400"
                                    : "border-dashed border-signal-amber bg-white text-signal-amber"
                              )}
                              title={
                                val === null
                                  ? `${label} not set — this dog is excluded from transport planning`
                                  : undefined
                              }
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </td>

                      {/* Names, not counts. */}
                      <td className="relative px-3 py-2 align-top">
                        <div className="flex flex-wrap items-center gap-1">
                          {e.incompatibleDogIds.length === 0 && (
                            <span className="text-[12px] text-ink-400">
                              {dog.conflictsReviewed ? "None" : (
                                <span className="text-signal-amber">Not checked</span>
                              )}
                            </span>
                          )}

                          {e.incompatibleDogIds.map((oid) => (
                            <span
                              key={oid}
                              className="inline-flex items-center gap-1 rounded bg-signal-redSoft px-1.5 py-0.5 text-[11.5px] font-semibold text-signal-red"
                            >
                              {dogMap.get(oid)?.name ?? oid}
                              <button
                                onClick={() => stageConflict(dog.id, oid, false)}
                                aria-label={`Remove ${dogMap.get(oid)?.name ?? oid}`}
                                className="opacity-70 hover:opacity-100"
                              >
                                <X size={11} />
                              </button>
                            </span>
                          ))}

                          <button
                            className="rounded border border-dashed border-ink-300 px-1.5 py-0.5 text-[11px] text-ink-500 hover:border-brand-500 hover:text-brand-700"
                            onClick={() => {
                              setConflictQuery("");
                              setConflictEditor(conflictEditor === dog.id ? null : dog.id);
                            }}
                            aria-expanded={conflictEditor === dog.id}
                          >
                            <Plus size={11} className="inline" /> Add
                          </button>
                        </div>

                        {conflictEditor === dog.id && (
                          <div className="absolute right-2 z-20 mt-1 w-[248px] rounded border border-ink-300 bg-white p-2 shadow-lg">
                            <input
                              autoFocus
                              className="input mb-1"
                              placeholder={`Dog that ${dog.name} avoids…`}
                              value={conflictQuery}
                              onChange={(ev) => setConflictQuery(ev.target.value)}
                              aria-label={`Search a dog incompatible with ${dog.name}`}
                            />
                            <ul className="max-h-[180px] overflow-y-auto">
                              {conflictCandidates(dog).map((c) => (
                                <li key={c.id}>
                                  <button
                                    className="flex w-full items-center justify-between gap-2 rounded px-1.5 py-1 text-left text-[12.5px] hover:bg-brand-50"
                                    onClick={() => {
                                      stageConflict(dog.id, c.id, true);
                                      setConflictEditor(null);
                                    }}
                                  >
                                    <span className="flex items-center gap-1.5">
                                      <ColorBadge color={c.behaviorColor} size="sm" />
                                      {c.name}
                                    </span>
                                    <span className="text-[10px] text-ink-400">{c.breed}</span>
                                  </button>
                                </li>
                              ))}
                              {conflictCandidates(dog).length === 0 && (
                                <li className="px-1.5 py-2 text-[12px] text-ink-400">No match.</li>
                              )}
                            </ul>
                            <button
                              className="mt-1 w-full rounded border border-ink-200 py-0.5 text-[11px] text-ink-500"
                              onClick={() => setConflictEditor(null)}
                            >
                              Close
                            </button>
                          </div>
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

      {/* Sticky save bar — the only place unsaved work is visible, so it stays
          on screen until resolved. */}
      {dirtyCount > 0 && (
        <div className="sticky bottom-4 z-30 flex flex-wrap items-center justify-between gap-3 rounded-md border border-brand-500 bg-white px-4 py-3 shadow-lg">
          <span className="text-[13px] font-semibold text-ink-800">
            {dirtyCount} {dirtyCount === 1 ? "dog has" : "dogs have"} unsaved changes
            <span className="ml-1 font-normal text-ink-500">
              — nothing is written until you save.
            </span>
          </span>
          <span className="flex gap-2">
            <button className="btn" onClick={() => setDrafts({})} disabled={saving}>
              <Undo2 size={13} /> Discard
            </button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              <Save size={13} /> {saving ? "Saving…" : "Save changes"}
            </button>
          </span>
        </div>
      )}
    </PageShell>
  );
}
