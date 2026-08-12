import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import clsx from "clsx";
import { PageShell, useOperatingDate } from "@/App";
import MessageComposer from "@/components/MessageComposer";
import { buildFloorMessage } from "@/services/messaging/floorMessage";
import {
  ColorBadge, DateNav, EmptyState, LockButton, ReasonList,
  SectionTitle, StatusPill,
} from "@/components/ui";
import { useDogMap, useFloorLocks, useFloors, useSettings } from "@/hooks/useData";
import { useFloorPlan } from "@/hooks/usePlans";
import { toggleFloorLock } from "@/db/repository";
import { db } from "@/db/database";
import { validateFloorMove } from "@/services/floorPlanner/generateFloorPlan";
import type { Dog, Reason } from "@/models/types";

export default function FloorPlanner() {
  const { date, setDate } = useOperatingDate();
  const plan = useFloorPlan(date);
  const floors = useFloors();
  const dogMap = useDogMap();
  const locks = useFloorLocks();
  const settings = useSettings();

  const [dragging, setDragging] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<{ dog: Dog; reasons: Reason[] } | null>(null);

  const dogsOf = (ids: string[]) => ids.map((id) => dogMap.get(id)).filter((d): d is Dog => !!d);

  /**
   * Staff are never prevented from interacting, but a move that creates a hard
   * conflict must be acknowledged before it is written.
   */
  const attemptMove = (dogId: string, floorId: string, force = false) => {
    const dog = dogMap.get(dogId);
    const floor = floors.find((f) => f.id === floorId);
    if (!dog || !floor) return;

    const current = plan.floors.find((f) => f.floorId === floorId);
    const occupants = dogsOf(current?.dogIds ?? []);
    const reasons = validateFloorMove(dog, floor, occupants);

    if (reasons.length && !force) {
      setBlocked({ dog, reasons });
      return;
    }
    void commitMove(dogId, floorId);
    setBlocked(null);
  };

  const commitMove = async (dogId: string, floorId: string) => {
    const source = plan.floors.find((f) => f.dogIds.includes(dogId));
    if (source && source.floorId !== floorId) {
      await toggleFloorLock(date, source.floorId, source.dogIds.filter((d) => d !== dogId), true);
    }
    const target = plan.floors.find((f) => f.floorId === floorId);
    const next = [...(target?.dogIds ?? []).filter((d) => d !== dogId), dogId];
    await toggleFloorLock(date, floorId, next, true);
  };

  const clearLocks = async () => {
    await db.floorLocks.filter((l) => l.date === date).delete();
  };


  const floorMessage = useMemo(
    () =>
      buildFloorMessage({
        date,
        plan,
        floors,
        dogs: dogMap,
        facilityName: settings.facilityName,
      }),
    [date, plan, floors, dogMap, settings.facilityName]
  );

  const total = plan.floors.reduce((n, f) => n + f.dogIds.length, 0);

  return (
    <PageShell
      title="Floor Planner"
      description="Three-floor placement. Capacities are demo values configurable in Settings."
      actions={<DateNav date={date} onChange={setDate} />}
    >
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn" onClick={clearLocks}>
          <RefreshCw size={13} /> Regenerate (clears locks)
        </button>
        <span className="text-[12px] text-ink-500">
          {total} placed · {plan.needsReview.length} awaiting review
        </span>
      </div>

      {blocked && (
        <div className="rounded border border-signal-red bg-signal-redSoft p-3">
          <p className="text-[13px] font-bold text-signal-red">
            Conflict — moving {blocked.dog.name} breaks a hard rule
          </p>
          <div className="mt-2"><ReasonList reasons={blocked.reasons} /></div>
          <div className="mt-2 flex gap-2">
            <button className="btn" onClick={() => setBlocked(null)}>Cancel</button>
            <button
              className="btn border-signal-red bg-signal-red text-white"
              onClick={() => {
                const floorId = plan.floors.find((f) =>
                  f.dogIds.includes(blocked.dog.id)
                )?.floorId;
                const target = dragging ?? floorId;
                if (target) attemptMove(blocked.dog.id, target, true);
                setBlocked(null);
              }}
            >
              Move anyway and accept the conflict
            </button>
          </div>
        </div>
      )}

      <MessageComposer
        generated={floorMessage}
        storageKey={`floor:${date}`}
        ready={floors.length > 0}
        title="Floor board for WhatsApp"
        hint="The room roster as staff will read it on their phones."
      />

      {total === 0 && plan.needsReview.length === 0 ? (
        <div className="card">
          <EmptyState title="No dogs to place on this date" hint="Nobody is attending, so there is no floor plan to build." />
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-3">
          {plan.floors.map((assignment) => {
            const floor = floors.find((f) => f.id === assignment.floorId);
            if (!floor) return null;
            const dogs = dogsOf(assignment.dogIds);

            return (
              <article
                key={floor.id}
                onDragOver={(e) => { e.preventDefault(); setDragging(floor.id); }}
                onDrop={(e) => {
                  e.preventDefault();
                  const dogId = e.dataTransfer.getData("text/plain");
                  if (dogId) attemptMove(dogId, floor.id);
                  setDragging(null);
                }}
                className={clsx(
                  "card flex flex-col gap-2 p-3 transition-colors",
                  dragging === floor.id && "border-brand-500 bg-brand-50"
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-[15px] font-bold tracking-tight">{floor.name}</h3>
                    <span className="font-mono text-[12px] text-ink-500">
                      {dogs.length} / {floor.capacity} dogs
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <StatusPill status={assignment.status} />
                    <LockButton
                      locked={assignment.locked}
                      onToggle={() =>
                        toggleFloorLock(date, floor.id, assignment.dogIds, !assignment.locked)
                      }
                    />
                  </div>
                </div>

                {floor.restrictions && (
                  <p className="text-[11px] text-ink-400">{floor.restrictions}</p>
                )}

                <ul className="flex min-h-[80px] flex-col gap-1">
                  {dogs.length === 0 && (
                    <li className="rounded border border-dashed border-ink-200 px-2 py-4 text-center text-[12px] text-ink-400">
                      Empty — drop a dog here
                    </li>
                  )}
                  {dogs.map((dog) => (
                    <li
                      key={dog.id}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData("text/plain", dog.id)}
                      className="flex flex-wrap items-center justify-between gap-1.5 rounded bg-ink-50 px-2 py-1.5"
                    >
                      <span className="flex items-center gap-1.5">
                        <ColorBadge color={dog.behaviorColor} size="sm" />
                        <Link to={`/dogs/${dog.id}`} className="text-[13px] font-semibold hover:text-brand-700">
                          {dog.name}
                        </Link>
                      </span>
                      <select
                        className="rounded border border-ink-300 bg-white px-1 py-0.5 text-[11px]"
                        value=""
                        onChange={(e) => e.target.value && attemptMove(dog.id, e.target.value)}
                        aria-label={`Move ${dog.name} to another floor`}
                      >
                        <option value="">Move…</option>
                        {floors.filter((f) => f.id !== floor.id).map((f) => (
                          <option key={f.id} value={f.id}>{f.name}</option>
                        ))}
                      </select>
                    </li>
                  ))}
                </ul>

                <ReasonList reasons={assignment.reasons} />
              </article>
            );
          })}
        </div>
      )}

      {plan.needsReview.length > 0 && (
        <section className="card border-signal-amber/40 p-3">
          <SectionTitle right={<StatusPill status="warning" />}>Needs staff review</SectionTitle>
          <p className="mt-1 text-[12px] text-ink-500">
            The system has not been told enough to place these dogs safely, so it has not guessed.
          </p>
          <ul className="mt-2 grid gap-2 md:grid-cols-2">
            {plan.needsReview.map((r) => {
              const dog = dogMap.get(r.dogId);
              return (
                <li key={r.dogId} className="flex flex-col gap-1 rounded bg-ink-50 p-2">
                  <span className="flex items-center gap-2">
                    <ColorBadge color={dog?.behaviorColor ?? null} size="sm" />
                    <Link to={`/dogs/${r.dogId}`} className="text-[13px] font-semibold hover:text-brand-700">
                      {dog?.name}
                    </Link>
                  </span>
                  <ReasonList reasons={r.reasons} />
                  <div className="flex flex-wrap gap-1">
                    {floors.map((f) => (
                      <button
                        key={f.id}
                        className="btn btn-sm"
                        onClick={() => attemptMove(r.dogId, f.id)}
                      >
                        Place on {f.name}
                      </button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </PageShell>
  );
}
