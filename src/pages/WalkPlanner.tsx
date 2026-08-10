import { useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { PageShell, useOperatingDate } from "@/App";
import {
  ColorBadge, CopyButton, DateNav, EmptyState, LockButton, ReasonList,
  SectionTitle, StatusPill,
} from "@/components/ui";
import { useDogMap, useSettings, useWalkers } from "@/hooks/useData";
import { useAttending, useWalkPlan } from "@/hooks/usePlans";
import { toggleWalkLock } from "@/db/repository";
import { db } from "@/db/database";
import type { Dog } from "@/models/types";

export default function WalkPlanner() {
  const { date, setDate } = useOperatingDate();
  const plan = useWalkPlan(date);
  const walkers = useWalkers();
  const dogMap = useDogMap();
  const settings = useSettings();
  const attending = useAttending(date);

  const [pendingMove, setPendingMove] = useState<{ dogId: string; walkerId: string } | null>(null);

  const dogsOf = (ids: string[]) => ids.map((id) => dogMap.get(id)).filter((d): d is Dog => !!d);
  const walkerName = (id: string | null) =>
    walkers.find((w) => w.id === id)?.name ?? "Unassigned";

  /**
   * Manual edits are expressed as locks. Moving a dog pins both the source and
   * the destination group, so a later Regenerate preserves the staff decision
   * instead of undoing it.
   */
  const moveDog = async (dogId: string, toWalkerId: string) => {
    const source = plan.groups.find((g) => g.dogIds.includes(dogId));
    const target = plan.groups.find((g) => g.walkerId === toWalkerId);

    if (source?.walkerId) {
      await toggleWalkLock(date, source.walkerId, source.dogIds.filter((d) => d !== dogId), true);
    }
    const nextIds = target ? [...target.dogIds.filter((d) => d !== dogId), dogId] : [dogId];
    await toggleWalkLock(date, toWalkerId, nextIds, true);
    setPendingMove(null);
  };

  /**
   * Unlocked groups are derived state — they already recompute on every data
   * change, so there is nothing to "re-run". What this clears is the empty lock
   * rows a manual move leaves behind, which is what frees those walkers to be
   * reused by the generator.
   */
  const regenerate = async () => {
    await db.walkLocks.filter((l) => l.date === date && l.dogIds.length === 0).delete();
  };

  const clearAllLocks = async () => {
    await db.walkLocks.filter((l) => l.date === date).delete();
  };

  const summary = [
    `${date} walk plan`,
    ...plan.groups.map(
      (g) => `${walkerName(g.walkerId)}: ${dogsOf(g.dogIds).map((d) => d.name).join(", ")}`
    ),
    ...(plan.excused.length
      ? [`Excused: ${plan.excused.map((e) => dogMap.get(e.dogId)?.name).join(", ")}`]
      : []),
    ...(plan.unassigned.length
      ? [`NEEDS REVIEW: ${plan.unassigned.map((u) => dogMap.get(u.dogId)?.name).join(", ")}`]
      : []),
  ].join("\n");

  return (
    <PageShell
      title="Walk Planner"
      description={`One wave per day · max ${settings.maxDogsPerWalker} dogs per walker · Red dogs walk 1:1`}
      actions={<DateNav date={date} onChange={setDate} />}
    >
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn" onClick={regenerate}>
          <RefreshCw size={13} /> Regenerate unlocked
        </button>
        <button className="btn" onClick={clearAllLocks}>Clear all locks</button>
        <CopyButton text={summary} label="Copy for WhatsApp" />
        <span className="text-[12px] text-ink-500">
          {attending.length} attending · {walkers.filter((w) => w.available).length} walkers available
        </span>
      </div>

      {plan.capacityNote && (
        <p className="rounded border border-signal-red/40 bg-signal-redSoft px-3 py-2 text-[12.5px] text-signal-red">
          <b>Capacity shortfall.</b> {plan.capacityNote}
        </p>
      )}

      {plan.groups.length === 0 && plan.unassigned.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No walks to plan for this date"
            hint="No dogs are attending, so there is nothing to group."
          />
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {plan.groups.map((group) => (
            <article key={group.key} className="card flex flex-col gap-2.5 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-[15px] font-bold tracking-tight">
                    {walkerName(group.walkerId)}
                  </h3>
                  <span className="font-mono text-[11px] text-ink-400">
                    {group.dogIds.length}/{settings.maxDogsPerWalker}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill status={group.status} />
                  <LockButton
                    locked={group.locked}
                    onToggle={() =>
                      toggleWalkLock(date, group.walkerId!, group.dogIds, !group.locked)
                    }
                  />
                </div>
              </div>

              <ul className="flex flex-col gap-1">
                {dogsOf(group.dogIds).map((dog) => (
                  <li
                    key={dog.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded bg-ink-50 px-2 py-1.5"
                  >
                    <span className="flex items-center gap-2">
                      <Link to={`/dogs/${dog.id}`} className="text-[13px] font-semibold hover:text-brand-700">
                        {dog.name}
                      </Link>
                      <ColorBadge color={dog.behaviorColor} size="sm" />
                      <span className="text-[11px] text-ink-400">{dog.breed}</span>
                    </span>

                    {/* Keyboard-accessible alternative to dragging. */}
                    <select
                      className="rounded border border-ink-300 bg-white px-1.5 py-0.5 text-[11.5px]"
                      value=""
                      onChange={(e) => e.target.value && moveDog(dog.id, e.target.value)}
                      aria-label={`Move ${dog.name} to another walker`}
                    >
                      <option value="">Move to…</option>
                      {walkers
                        .filter((w) => w.available && w.id !== group.walkerId)
                        .map((w) => (
                          <option key={w.id} value={w.id}>{w.name}</option>
                        ))}
                    </select>
                  </li>
                ))}
              </ul>

              <div>
                <span className="label-xs">Why this works</span>
                <div className="mt-1"><ReasonList reasons={group.reasons} /></div>
              </div>
            </article>
          ))}
        </div>
      )}

      {plan.unassigned.length > 0 && (
        <section className="card border-signal-red/40 p-3">
          <SectionTitle right={<StatusPill status="conflict" />}>Attention required</SectionTitle>
          <ul className="mt-2 flex flex-col gap-2">
            {plan.unassigned.map((u) => (
              <li key={u.dogId} className="flex flex-col gap-1 rounded bg-ink-50 p-2">
                <span className="flex items-center gap-2">
                  <Link to={`/dogs/${u.dogId}`} className="text-[13px] font-semibold hover:text-brand-700">
                    {dogMap.get(u.dogId)?.name}
                  </Link>
                  <ColorBadge color={dogMap.get(u.dogId)?.behaviorColor ?? null} size="sm" />
                </span>
                <ReasonList reasons={u.reasons} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {plan.excused.length > 0 && (
        <section className="card p-3">
          <SectionTitle>Not walking today</SectionTitle>
          <p className="mt-1 text-[12px] text-ink-500">
            Deliberately excused by a staff constraint. This is not a planner failure.
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {plan.excused.map((e) => (
              <li key={e.dogId} className="flex flex-col gap-1 rounded bg-ink-50 p-2">
                <Link to={`/dogs/${e.dogId}`} className="text-[13px] font-semibold hover:text-brand-700">
                  {dogMap.get(e.dogId)?.name}
                </Link>
                <ReasonList reasons={e.reasons} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageShell>
  );
}
