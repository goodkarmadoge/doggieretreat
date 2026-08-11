import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Plus, Save, Undo2, X } from "lucide-react";
import clsx from "clsx";
import { PageShell } from "@/App";
import { ColorBadge, EmptyState, SectionTitle } from "@/components/ui";
import {
  useAuditForDog, useDog, useDogs, useExceptions, useRecurring,
} from "@/hooks/useData";
import {
  addRecurringDay, clearException, linkIncompatible, removeRecurringDay,
  setBehaviorColor, setDogActive, unlinkIncompatible, updateDog,
} from "@/db/repository";
import { recurringDaysFor } from "@/services/scheduling/attendance";
import { todayISO } from "@/utils/dates";
import {
  WEEKDAYS,
  type BehaviorColor, type ConstraintType, type Dog, type DogConstraint, type Weekday,
} from "@/models/types";

const COLOR_HELP: Record<BehaviorColor, string> = {
  green: "Plays freely in open group. Compatibility flags still take precedence.",
  yellow: "Conditional. Behaviour is driven by the constraints configured below.",
  red: "Walks 1:1 with a handler. Floor placement routes to staff review until a floor rule is configured.",
};

const CONSTRAINT_TYPES: { value: ConstraintType; label: string }[] = [
  { value: "must_walk_alone", label: "Must walk alone" },
  { value: "max_group_size", label: "Maximum group size" },
  { value: "floor_restriction", label: "Floor restriction" },
  { value: "requires_experienced_walker", label: "Requires experienced walker" },
  { value: "excused_from_walk", label: "Excused from walks" },
  { value: "crate_required", label: "Crate required in van" },
  { value: "other", label: "Other" },
];

/** Staged edits. Absent keys mean "unchanged". */
interface Draft {
  behaviorColor?: BehaviorColor | null;
  personalityNotes?: string;
  operationalNotes?: string;
  defaultPickup?: boolean | null;
  defaultDropoff?: boolean | null;
  incompatibleDogIds?: string[];
  conflictsReviewed?: boolean;
  constraints?: DogConstraint[];
  days?: Weekday[];
  removedExceptionIds?: string[];
}

export default function DogProfile() {
  const { id } = useParams();
  const dog = useDog(id);
  const allDogs = useDogs();
  const recurring = useRecurring();
  const exceptions = useExceptions();
  const history = useAuditForDog(id);
  const today = todayISO();

  const [draft, setDraft] = useState<Draft>({});
  const [conflictQuery, setConflictQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState(false);
  const [newConstraint, setNewConstraint] = useState<{
    type: ConstraintType; description: string; value: string;
  }>({ type: "max_group_size", description: "", value: "" });

  // Switching dogs must not carry another dog's pending edits across.
  useEffect(() => {
    setDraft({});
    setConflictQuery("");
  }, [id]);

  const storedDays = useMemo(
    () => (dog ? (recurringDaysFor(dog.id, recurring, today) as Weekday[]) : []),
    [dog, recurring, today]
  );

  const dogExceptions = useMemo(
    () => exceptions.filter((e) => e.dogId === id).sort((a, b) => a.date.localeCompare(b.date)),
    [exceptions, id]
  );

  const dirtyKeys = Object.keys(draft) as (keyof Draft)[];
  const isDirty = dirtyKeys.length > 0;

  useEffect(() => {
    if (!isDirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty]);

  if (!dog) {
    return (
      <PageShell title="Dog not found">
        <div className="card">
          <EmptyState
            title="That record no longer exists"
            hint="It may have been removed by a reimport."
            action={<Link to="/dogs" className="btn mt-2">Back to all dogs</Link>}
          />
        </div>
      </PageShell>
    );
  }

  const e = {
    behaviorColor: draft.behaviorColor !== undefined ? draft.behaviorColor : dog.behaviorColor,
    personalityNotes: draft.personalityNotes ?? dog.personalityNotes ?? "",
    operationalNotes: draft.operationalNotes ?? dog.operationalNotes ?? "",
    defaultPickup: draft.defaultPickup !== undefined ? draft.defaultPickup : dog.defaultPickup,
    defaultDropoff: draft.defaultDropoff !== undefined ? draft.defaultDropoff : dog.defaultDropoff,
    incompatibleDogIds: draft.incompatibleDogIds ?? dog.incompatibleDogIds,
    conflictsReviewed: draft.conflictsReviewed ?? dog.conflictsReviewed,
    constraints: draft.constraints ?? dog.constraints,
    days: draft.days ?? storedDays,
    removedExceptionIds: draft.removedExceptionIds ?? [],
  };

  const patch = (change: Draft) => setDraft((prev) => ({ ...prev, ...change }));

  /**
   * Toggles derive from the LATEST staged state rather than a render-time
   * snapshot, so two rapid clicks in one React batch cannot drop the first.
   */
  const patchWith = (fn: (current: typeof e) => Draft) =>
    setDraft((prev) => {
      const current = {
        ...e,
        behaviorColor: prev.behaviorColor !== undefined ? prev.behaviorColor : dog.behaviorColor,
        days: prev.days ?? storedDays,
        incompatibleDogIds: prev.incompatibleDogIds ?? dog.incompatibleDogIds,
        constraints: prev.constraints ?? dog.constraints,
        removedExceptionIds: prev.removedExceptionIds ?? [],
      };
      return { ...prev, ...fn(current) };
    });

  const candidates = (() => {
    const q = conflictQuery.trim().toLowerCase();
    if (!q) return [] as Dog[];
    return allDogs
      .filter((d) => d.active && d.id !== dog.id && !e.incompatibleDogIds.includes(d.id))
      .filter((d) => `${d.name} ${d.breed ?? ""} ${d.id}`.toLowerCase().includes(q))
      .slice(0, 6);
  })();

  const addConstraint = () => {
    if (!newConstraint.description.trim()) return;
    const c: DogConstraint = {
      id: `c-${Date.now().toString(36)}`,
      type: newConstraint.type,
      description: newConstraint.description.trim(),
      severity: "hard",
      ...(newConstraint.value
        ? {
            value: Number.isNaN(Number(newConstraint.value))
              ? newConstraint.value
              : Number(newConstraint.value),
          }
        : {}),
    };
    patchWith((curr) => ({ constraints: [...curr.constraints, c] }));
    setNewConstraint({ type: "max_group_size", description: "", value: "" });
  };

  const save = async () => {
    setSaving(true);
    try {
      if (draft.behaviorColor !== undefined && draft.behaviorColor !== dog.behaviorColor) {
        await setBehaviorColor(dog.id, draft.behaviorColor);
      }

      const patchDog: Partial<Dog> = {};
      if (draft.personalityNotes !== undefined) patchDog.personalityNotes = draft.personalityNotes;
      if (draft.operationalNotes !== undefined) patchDog.operationalNotes = draft.operationalNotes;
      if (draft.defaultPickup !== undefined) patchDog.defaultPickup = draft.defaultPickup;
      if (draft.defaultDropoff !== undefined) patchDog.defaultDropoff = draft.defaultDropoff;
      if (draft.conflictsReviewed !== undefined) patchDog.conflictsReviewed = draft.conflictsReviewed;
      if (draft.constraints !== undefined) patchDog.constraints = draft.constraints;
      if (Object.keys(patchDog).length) await updateDog(dog.id, patchDog);

      if (draft.days) {
        for (const day of draft.days) {
          if (!storedDays.includes(day)) await addRecurringDay(dog.id, day);
        }
        for (const day of storedDays) {
          if (!draft.days.includes(day)) await removeRecurringDay(dog.id, day);
        }
      }

      if (draft.incompatibleDogIds) {
        for (const other of draft.incompatibleDogIds) {
          if (!dog.incompatibleDogIds.includes(other)) await linkIncompatible(dog.id, other);
        }
        for (const other of dog.incompatibleDogIds) {
          if (!draft.incompatibleDogIds.includes(other)) await unlinkIncompatible(dog.id, other);
        }
      }

      for (const exId of e.removedExceptionIds) await clearException(exId);

      setDraft({});
      setSavedNote(true);
      setTimeout(() => setSavedNote(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageShell
      title={dog.name}
      description={`${dog.breed ?? "Breed not recorded"} · ${dog.ownerName ?? "Owner not recorded"}`}
      actions={
        <div className="flex items-center gap-2">
          <Link to="/dogs" className="btn"><ArrowLeft size={13} /> All dogs</Link>
          <button className="btn" onClick={() => setDogActive(dog.id, !dog.active)}>
            {dog.active ? "Deactivate" : "Reactivate"}
          </button>
        </div>
      }
    >
      {savedNote && (
        <p className="rounded bg-signal-greenSoft px-3 py-2 text-[12.5px] font-semibold text-signal-green">
          Changes saved.
        </p>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {/* basic — Collar owned */}
        <section className="card flex flex-col gap-2 p-3">
          <SectionTitle>Basic information</SectionTitle>
          <p className="text-[11.5px] text-ink-400">
            Owned by Collar. A reimport refreshes these, so they are not edited here.
          </p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
            <Field k="Collar Pet ID" v={dog.collarId ?? "—"} mono />
            <Field k="Collar Owner ID" v={dog.collarOwnerId ?? "—"} mono />
            <Field k="Age" v={dog.age ? `${dog.age} years` : "—"} />
            <Field k="Weight" v={dog.weightKg ? `${dog.weightKg} kg` : "—"} />
            <Field k="Vaccination" v={dog.vaccinationStatus ?? "—"} />
            <div className="col-span-2">
              <dt className="label-xs">Address</dt>
              <dd className="font-mono text-[11.5px] text-ink-600">{dog.address ?? "—"}</dd>
            </div>
          </dl>
        </section>

        {/* schedule */}
        <section className="card flex flex-col gap-2 p-3">
          <SectionTitle>Daycare schedule</SectionTitle>
          <p className="text-[11.5px] text-ink-400">
            Recurring weekly pattern. Saving applies changes going forward and preserves history.
          </p>
          <div className="flex flex-wrap gap-1">
            {WEEKDAYS.map((d) => {
              const on = e.days.includes(d);
              return (
                <button
                  key={d}
                  aria-pressed={on}
                  onClick={() =>
                    patchWith((curr) => ({
                      days: curr.days.includes(d)
                        ? curr.days.filter((x) => x !== d)
                        : [...curr.days, d].sort(
                            (a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b)
                          ),
                    }))
                  }
                  className={clsx(
                    "min-w-[46px] rounded border px-2 py-1.5 font-mono text-[12px] font-semibold",
                    on
                      ? "border-brand-600 bg-brand-600 text-white"
                      : "border-ink-300 bg-white text-ink-500 hover:border-brand-400"
                  )}
                >
                  {d}
                </button>
              );
            })}
          </div>

          <div>
            <span className="label-xs">One-time exceptions</span>
            {dogExceptions.filter((x) => !e.removedExceptionIds.includes(x.id)).length === 0 ? (
              <p className="text-[12px] text-ink-400">None. Add one from the command bar on Today.</p>
            ) : (
              <ul className="mt-1 flex flex-col gap-1">
                {dogExceptions
                  .filter((x) => !e.removedExceptionIds.includes(x.id))
                  .map((ex) => (
                    <li
                      key={ex.id}
                      className="flex items-center justify-between gap-2 rounded bg-ink-50 px-2 py-1 text-[12px]"
                    >
                      <span>
                        <span className="font-mono">{ex.date}</span>{" "}
                        <span className={ex.status === "added" ? "text-signal-green" : "text-signal-red"}>
                          {ex.status === "added" ? "attending" : "not attending"}
                        </span>
                        {ex.note && <span className="text-ink-400"> · {ex.note}</span>}
                      </span>
                      <button
                        onClick={() =>
                          patchWith((curr) => ({
                            removedExceptionIds: [...curr.removedExceptionIds, ex.id],
                          }))
                        }
                        aria-label="Remove exception"
                      >
                        <X size={13} className="text-ink-400 hover:text-ink-900" />
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        </section>

        {/* behaviour */}
        <section className="card flex flex-col gap-2 p-3">
          <SectionTitle right={<ColorBadge color={e.behaviorColor} />}>Behaviour</SectionTitle>
          <div className="grid gap-2 sm:grid-cols-3">
            {(["green", "yellow", "red"] as BehaviorColor[]).map((c) => (
              <button
                key={c}
                aria-pressed={e.behaviorColor === c}
                onClick={() =>
                  patchWith((curr) => ({
                    behaviorColor: curr.behaviorColor === c ? null : c,
                  }))
                }
                className={clsx(
                  "flex flex-col gap-1 rounded border p-2 text-left",
                  e.behaviorColor === c
                    ? "border-brand-500 bg-brand-50"
                    : "border-ink-300 hover:border-ink-400"
                )}
              >
                <ColorBadge color={c} size="sm" />
                <span className="text-[11.5px] leading-snug text-ink-500">{COLOR_HELP[c]}</span>
              </button>
            ))}
          </div>
          <div>
            <span className="label-xs">Personality notes</span>
            <textarea
              className="input mt-1 min-h-[62px]"
              value={e.personalityNotes}
              onChange={(ev) => patch({ personalityNotes: ev.target.value })}
            />
          </div>
          <div>
            <span className="label-xs">Operational notes</span>
            <textarea
              className="input mt-1 min-h-[48px]"
              placeholder="Handling instructions for staff…"
              value={e.operationalNotes}
              onChange={(ev) => patch({ operationalNotes: ev.target.value })}
            />
          </div>
        </section>

        {/* transport */}
        <section className="card flex flex-col gap-2 p-3">
          <SectionTitle>Transportation</SectionTitle>
          <p className="text-[11.5px] text-ink-400">
            Standing preference. Override a single date from the command bar.
          </p>
          {([
            ["defaultPickup", "Morning pickup", e.defaultPickup],
            ["defaultDropoff", "Evening drop-off", e.defaultDropoff],
          ] as const).map(([key, label, val]) => (
            <div key={key} className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-semibold">{label}</span>
              <div className="flex gap-0.5 rounded bg-ink-100 p-0.5">
                {([["Yes", true], ["No", false]] as [string, boolean][]).map(([t, v]) => (
                  <button
                    key={t}
                    onClick={() => patch({ [key]: v })}
                    className={clsx(
                      "rounded px-3 py-1 text-[12.5px] font-semibold",
                      val === v ? "bg-white text-ink-900 shadow-sm" : "text-ink-500"
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {e.defaultPickup === null && e.defaultDropoff === null && (
            <p className="rounded bg-signal-amberSoft px-2 py-1 text-[11.5px] text-signal-amber">
              Not set. This dog will not appear in transport planning until a preference is recorded.
            </p>
          )}
        </section>

        {/* compatibility */}
        <section className="card flex flex-col gap-2 p-3">
          <SectionTitle>Does not get along with</SectionTitle>
          <p className="text-[11.5px] text-ink-400">
            Flags are written both ways on save, and apply to walks, floors and van manifests.
          </p>

          {e.incompatibleDogIds.length === 0 ? (
            <p className="rounded bg-ink-50 px-2 py-1.5 text-[12px] text-ink-500">
              {e.conflictsReviewed ? "Checked — no incompatible dogs." : "Nobody has checked this dog yet."}
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {e.incompatibleDogIds.map((oid) => {
                const other = allDogs.find((d) => d.id === oid);
                return (
                  <span
                    key={oid}
                    className="inline-flex items-center gap-1.5 rounded bg-signal-redSoft px-2 py-1 text-[12.5px] font-semibold text-signal-red"
                  >
                    {other?.name ?? oid}
                    <button
                      onClick={() =>
                        patchWith((curr) => ({
                          incompatibleDogIds: curr.incompatibleDogIds.filter((x) => x !== oid),
                        }))
                      }
                      aria-label={`Remove ${other?.name ?? oid}`}
                    >
                      <X size={12} />
                    </button>
                  </span>
                );
              })}
            </div>
          )}

          <input
            className="input"
            placeholder="Search a dog to flag…"
            value={conflictQuery}
            onChange={(ev) => setConflictQuery(ev.target.value)}
            aria-label="Search dogs to flag as incompatible"
          />
          {candidates.length > 0 && (
            <ul className="rounded border border-ink-200">
              {candidates.map((c) => (
                <li key={c.id} className="border-b border-ink-100 last:border-0">
                  <button
                    className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-[13px] hover:bg-brand-50"
                    onClick={() => {
                      patchWith((curr) => ({
                        incompatibleDogIds: Array.from(
                          new Set([...curr.incompatibleDogIds, c.id])
                        ),
                        conflictsReviewed: true,
                      }));
                      setConflictQuery("");
                    }}
                  >
                    <span className="flex items-center gap-2">
                      <ColorBadge color={c.behaviorColor} size="sm" />
                      {c.name}
                    </span>
                    <span className="font-mono text-[11px] text-ink-400">{c.breed}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <label className="flex items-start gap-2 text-[12.5px] text-ink-600">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={e.conflictsReviewed}
              onChange={(ev) => patch({ conflictsReviewed: ev.target.checked })}
            />
            Conflicts checked for {dog.name}. Ticking this records that a person has looked,
            which is different from nobody having checked.
          </label>
        </section>

        {/* constraints */}
        <section className="card flex flex-col gap-2 p-3">
          <SectionTitle>Constraints</SectionTitle>
          <p className="text-[11.5px] text-ink-400">
            Behavioural rules live here as data, so real Doggie Retreat policy can be entered
            without changing the application.
          </p>

          {e.constraints.length === 0 ? (
            <p className="rounded bg-ink-50 px-2 py-1.5 text-[12px] text-ink-500">
              No constraints recorded.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {e.constraints.map((c) => (
                <li
                  key={c.id}
                  className="flex items-start justify-between gap-2 rounded bg-ink-50 px-2 py-1.5"
                >
                  <span className="text-[12.5px]">
                    <b>{CONSTRAINT_TYPES.find((t) => t.value === c.type)?.label ?? c.type}</b>
                    {c.value !== undefined && (
                      <span className="font-mono text-ink-500"> · {String(c.value)}</span>
                    )}
                    <br />
                    <span className="text-ink-500">{c.description}</span>
                  </span>
                  <button
                    aria-label="Remove constraint"
                    onClick={() =>
                      patchWith((curr) => ({
                        constraints: curr.constraints.filter((x) => x.id !== c.id),
                      }))
                    }
                  >
                    <X size={13} className="text-ink-400 hover:text-ink-900" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-end gap-2 border-t border-ink-200 pt-2">
            <label className="flex flex-col gap-1">
              <span className="label-xs">Type</span>
              <select
                className="rounded border border-ink-300 bg-white px-2 py-1.5 text-[12.5px]"
                value={newConstraint.type}
                onChange={(ev) =>
                  setNewConstraint({ ...newConstraint, type: ev.target.value as ConstraintType })
                }
              >
                {CONSTRAINT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className="label-xs">Description</span>
              <input
                className="input"
                value={newConstraint.description}
                onChange={(ev) =>
                  setNewConstraint({ ...newConstraint, description: ev.target.value })
                }
                placeholder="What staff need to know"
              />
            </label>
            <label className="flex w-[92px] flex-col gap-1">
              <span className="label-xs">Value</span>
              <input
                className="input"
                value={newConstraint.value}
                onChange={(ev) => setNewConstraint({ ...newConstraint, value: ev.target.value })}
                placeholder="e.g. 2"
              />
            </label>
            <button className="btn" onClick={addConstraint}>
              <Plus size={13} /> Add
            </button>
          </div>
        </section>
      </div>

      <section className="card p-3">
        <SectionTitle>Change history</SectionTitle>
        {history.length === 0 ? (
          <p className="mt-1 text-[12px] text-ink-400">No changes recorded for this dog yet.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {history.map((h) => (
              <li
                key={h.id}
                className="flex flex-wrap items-baseline gap-2 border-b border-ink-100 pb-1 text-[12.5px] last:border-0"
              >
                <span className="font-mono text-[11px] text-ink-400">
                  {new Date(h.timestamp).toLocaleString("en-SG")}
                </span>
                <span className="font-semibold">{h.action}</span>
                {(h.previousValue || h.newValue) && (
                  <span className="text-ink-500">
                    {h.previousValue ?? "—"} → {h.newValue ?? "—"}
                  </span>
                )}
                <span className="text-ink-400">· {h.actor}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {isDirty && (
        <div className="sticky bottom-4 z-30 flex flex-wrap items-center justify-between gap-3 rounded-md border border-brand-500 bg-white px-4 py-3 shadow-lg">
          <span className="text-[13px] font-semibold text-ink-800">
            Unsaved changes to {dog.name}
            <span className="ml-1 font-normal text-ink-500">
              — nothing is written until you save.
            </span>
          </span>
          <span className="flex gap-2">
            <button className="btn" onClick={() => setDraft({})} disabled={saving}>
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

function Field({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div>
      <dt className="label-xs">{k}</dt>
      <dd className={clsx("text-ink-700", mono && "font-mono text-[12px]")}>{v}</dd>
    </div>
  );
}
