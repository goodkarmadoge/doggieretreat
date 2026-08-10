import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Plus, X } from "lucide-react";
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
import { db } from "@/db/database";
import { recurringDaysFor } from "@/services/scheduling/attendance";
import { todayISO } from "@/utils/dates";
import { WEEKDAYS, type BehaviorColor, type ConstraintType, type Dog, type Weekday } from "@/models/types";

const COLOR_HELP: Record<BehaviorColor, string> = {
  green: "Plays freely in open group. Compatibility flags still take precedence.",
  yellow: "Conditional. Behaviour is driven by the constraints configured below.",
  red: "Walks 1:1 with a handler. Floor rules are not yet defined, so placement routes to staff review.",
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

export default function DogProfile() {
  const { id } = useParams();
  const dog = useDog(id);
  const allDogs = useDogs();
  const recurring = useRecurring();
  const exceptions = useExceptions();
  const history = useAuditForDog(id);
  const today = todayISO();

  const [conflictQuery, setConflictQuery] = useState("");
  const [newConstraint, setNewConstraint] = useState<{ type: ConstraintType; description: string; value: string }>({
    type: "max_group_size", description: "", value: "",
  });

  const days = useMemo(
    () => (dog ? (recurringDaysFor(dog.id, recurring, today) as Weekday[]) : []),
    [dog, recurring, today]
  );

  const dogExceptions = useMemo(
    () => exceptions.filter((e) => e.dogId === id).sort((a, b) => a.date.localeCompare(b.date)),
    [exceptions, id]
  );

  const candidates = useMemo(() => {
    if (!dog) return [] as Dog[];
    const q = conflictQuery.trim().toLowerCase();
    if (!q) return [];
    return allDogs
      .filter((d) => d.active && d.id !== dog.id && !dog.incompatibleDogIds.includes(d.id))
      .filter((d) => `${d.name} ${d.breed ?? ""} ${d.id}`.toLowerCase().includes(q))
      .slice(0, 6);
  }, [allDogs, conflictQuery, dog]);

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

  const addConstraint = async () => {
    if (!newConstraint.description.trim()) return;
    const c = {
      id: `c-${Date.now().toString(36)}`,
      type: newConstraint.type,
      description: newConstraint.description.trim(),
      severity: "hard" as const,
      ...(newConstraint.value ? { value: Number.isNaN(Number(newConstraint.value)) ? newConstraint.value : Number(newConstraint.value) } : {}),
    };
    await updateDog(dog.id, { constraints: [...dog.constraints, c] });
    setNewConstraint({ type: "max_group_size", description: "", value: "" });
  };

  return (
    <PageShell
      title={dog.name}
      description={`${dog.breed ?? "Breed not recorded"} · ${dog.ownerName ?? "Owner not recorded"}`}
      actions={
        <div className="flex items-center gap-2">
          <Link to="/dogs" className="btn"><ArrowLeft size={13} /> All dogs</Link>
          <button
            className="btn"
            onClick={() => setDogActive(dog.id, !dog.active)}
          >
            {dog.active ? "Deactivate" : "Reactivate"}
          </button>
        </div>
      }
    >
      <div className="grid gap-3 lg:grid-cols-2">
        {/* basic */}
        <section className="card flex flex-col gap-2 p-3">
          <SectionTitle>Basic information</SectionTitle>
          <p className="text-[11.5px] text-ink-400">Owned by Collar. A reimport refreshes these fields.</p>
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
            Recurring weekly pattern. Changes here apply going forward and preserve history.
          </p>
          <div className="flex flex-wrap gap-1">
            {WEEKDAYS.map((d) => {
              const on = days.includes(d);
              return (
                <button
                  key={d}
                  onClick={() => (on ? removeRecurringDay(dog.id, d) : addRecurringDay(dog.id, d))}
                  aria-pressed={on}
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
            {dogExceptions.length === 0 ? (
              <p className="text-[12px] text-ink-400">None. Add one from the command bar on Today.</p>
            ) : (
              <ul className="mt-1 flex flex-col gap-1">
                {dogExceptions.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2 rounded bg-ink-50 px-2 py-1 text-[12px]">
                    <span>
                      <span className="font-mono">{e.date}</span>{" "}
                      <span className={e.status === "added" ? "text-signal-green" : "text-signal-red"}>
                        {e.status === "added" ? "attending" : "not attending"}
                      </span>
                      {e.note && <span className="text-ink-400"> · {e.note}</span>}
                    </span>
                    <button onClick={() => clearException(e.id)} aria-label="Remove exception">
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
          <SectionTitle right={<ColorBadge color={dog.behaviorColor} />}>Behaviour</SectionTitle>
          <div className="grid gap-2 sm:grid-cols-3">
            {(["green", "yellow", "red"] as BehaviorColor[]).map((c) => (
              <button
                key={c}
                onClick={() => setBehaviorColor(dog.id, dog.behaviorColor === c ? null : c)}
                aria-pressed={dog.behaviorColor === c}
                className={clsx(
                  "flex flex-col gap-1 rounded border p-2 text-left",
                  dog.behaviorColor === c ? "border-brand-500 bg-brand-50" : "border-ink-300 hover:border-ink-400"
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
              value={dog.personalityNotes ?? ""}
              onChange={(e) => updateDog(dog.id, { personalityNotes: e.target.value })}
            />
          </div>
          <div>
            <span className="label-xs">Operational notes</span>
            <textarea
              className="input mt-1 min-h-[48px]"
              placeholder="Handling instructions for staff…"
              value={dog.operationalNotes ?? ""}
              onChange={(e) => updateDog(dog.id, { operationalNotes: e.target.value })}
            />
          </div>
        </section>

        {/* transport */}
        <section className="card flex flex-col gap-2 p-3">
          <SectionTitle>Transportation</SectionTitle>
          <p className="text-[11.5px] text-ink-400">
            Standing preference. Override a single date from the command bar.
          </p>
          {(["defaultPickup", "defaultDropoff"] as const).map((key) => (
            <div key={key} className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-semibold">
                {key === "defaultPickup" ? "Morning pickup" : "Evening drop-off"}
              </span>
              <div className="flex gap-0.5 rounded bg-ink-100 p-0.5">
                {([["Yes", true], ["No", false]] as [string, boolean][]).map(([label, val]) => (
                  <button
                    key={label}
                    onClick={() => updateDog(dog.id, { [key]: val })}
                    className={clsx(
                      "rounded px-3 py-1 text-[12.5px] font-semibold",
                      dog[key] === val ? "bg-white text-ink-900 shadow-sm" : "text-ink-500"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {dog.defaultPickup === null && dog.defaultDropoff === null && (
            <p className="rounded bg-signal-amberSoft px-2 py-1 text-[11.5px] text-signal-amber">
              Not set. This dog will not appear in transport planning until a preference is recorded.
            </p>
          )}
        </section>

        {/* compatibility */}
        <section className="card flex flex-col gap-2 p-3">
          <SectionTitle>Does not get along with</SectionTitle>
          <p className="text-[11.5px] text-ink-400">
            Flags are written both ways and apply to walks, floors and van manifests.
          </p>

          {dog.incompatibleDogIds.length === 0 ? (
            <p className="rounded bg-ink-50 px-2 py-1.5 text-[12px] text-ink-500">
              {dog.conflictsReviewed
                ? "Checked — no incompatible dogs."
                : "Nobody has checked this dog yet."}
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {dog.incompatibleDogIds.map((oid) => {
                const other = allDogs.find((d) => d.id === oid);
                return (
                  <span key={oid} className="inline-flex items-center gap-1.5 rounded bg-signal-redSoft px-2 py-1 text-[12.5px] font-semibold text-signal-red">
                    {other?.name ?? oid}
                    <button onClick={() => unlinkIncompatible(dog.id, oid)} aria-label={`Remove ${other?.name}`}>
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
            onChange={(e) => setConflictQuery(e.target.value)}
            aria-label="Search dogs to flag as incompatible"
          />
          {candidates.length > 0 && (
            <ul className="rounded border border-ink-200">
              {candidates.map((c) => (
                <li key={c.id} className="border-b border-ink-100 last:border-0">
                  <button
                    className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-[13px] hover:bg-brand-50"
                    onClick={async () => {
                      await linkIncompatible(dog.id, c.id);
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
              checked={dog.conflictsReviewed}
              onChange={(e) => updateDog(dog.id, { conflictsReviewed: e.target.checked })}
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

          {dog.constraints.length === 0 ? (
            <p className="rounded bg-ink-50 px-2 py-1.5 text-[12px] text-ink-500">No constraints recorded.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {dog.constraints.map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-2 rounded bg-ink-50 px-2 py-1.5">
                  <span className="text-[12.5px]">
                    <b>{CONSTRAINT_TYPES.find((t) => t.value === c.type)?.label ?? c.type}</b>
                    {c.value !== undefined && <span className="font-mono text-ink-500"> · {String(c.value)}</span>}
                    <br />
                    <span className="text-ink-500">{c.description}</span>
                  </span>
                  <button
                    aria-label="Remove constraint"
                    onClick={() =>
                      updateDog(dog.id, { constraints: dog.constraints.filter((x) => x.id !== c.id) })
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
                onChange={(e) => setNewConstraint({ ...newConstraint, type: e.target.value as ConstraintType })}
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
                onChange={(e) => setNewConstraint({ ...newConstraint, description: e.target.value })}
                placeholder="What staff need to know"
              />
            </label>
            <label className="flex w-[92px] flex-col gap-1">
              <span className="label-xs">Value</span>
              <input
                className="input"
                value={newConstraint.value}
                onChange={(e) => setNewConstraint({ ...newConstraint, value: e.target.value })}
                placeholder="e.g. 2"
              />
            </label>
            <button className="btn btn-primary" onClick={addConstraint}>
              <Plus size={13} /> Add
            </button>
          </div>
        </section>
      </div>

      {/* history */}
      <section className="card p-3">
        <SectionTitle>Change history</SectionTitle>
        {history.length === 0 ? (
          <p className="mt-1 text-[12px] text-ink-400">No changes recorded for this dog yet.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-baseline gap-2 border-b border-ink-100 pb-1 text-[12.5px] last:border-0">
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

export { db };
