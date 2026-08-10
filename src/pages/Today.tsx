import { Link } from "react-router-dom";
import { PageShell, useOperatingDate } from "@/App";
import CommandBar from "@/components/CommandBar";
import {
  ColorBadge, DateNav, DemoBanner, EmptyState, SectionTitle, StatCard,
} from "@/components/ui";
import { useDogs, useFloors, useSettings } from "@/hooks/useData";
import {
  useAttending, useFloorPlan, useTransportCounts, useWalkPlan,
} from "@/hooks/usePlans";
import { loadDemoData } from "@/db/repository";
import { formatLong } from "@/utils/dates";

export default function Today() {
  const { date, setDate } = useOperatingDate();
  const settings = useSettings();
  const allDogs = useDogs();

  const attending = useAttending(date);
  const walk = useWalkPlan(date);
  const floor = useFloorPlan(date);
  const floors = useFloors();
  const transport = useTransportCounts(date);

  const greens = attending.filter((d) => d.behaviorColor === "green").length;
  const yellows = attending.filter((d) => d.behaviorColor === "yellow").length;
  const reds = attending.filter((d) => d.behaviorColor === "red").length;
  const unassessed = attending.filter((d) => d.behaviorColor === null).length;

  if (!allDogs.length) {
    return (
      <PageShell title="Today" description="Operational overview">
        <div className="card">
          <EmptyState
            title="No dogs in the database yet"
            hint="Load the demo dataset to explore all four planners immediately, or import a Collar CSV from Data Import."
            action={
              <div className="mt-2 flex gap-2">
                <button className="btn btn-primary" onClick={() => loadDemoData()}>
                  Load Demo Doggie Retreat Data
                </button>
                <Link to="/import" className="btn">Go to Data Import</Link>
              </div>
            }
          />
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      title={formatLong(date)}
      description={`${attending.length} dogs attending`}
      actions={<DateNav date={date} onChange={setDate} />}
    >
      {settings.demoDataLoaded && <DemoBanner />}

      <CommandBar />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <StatCard label="Attending" value={attending.length} tone="brand" />
        <StatCard label="Green" value={greens} tone="green" />
        <StatCard label="Yellow" value={yellows} tone="amber" />
        <StatCard label="Red" value={reds} tone="red" />
        <StatCard label="Pickups" value={transport.pickups} />
        <StatCard label="Drop-offs" value={transport.dropoffs} />
        <StatCard
          label="Unassigned walks"
          value={walk.unassigned.length}
          tone={walk.unassigned.length ? "red" : "neutral"}
        />
        <StatCard
          label="Floor review"
          value={floor.needsReview.length}
          tone={floor.needsReview.length ? "amber" : "neutral"}
        />
      </div>

      {unassessed > 0 && (
        <p className="rounded border border-signal-amber/40 bg-signal-amberSoft px-3 py-2 text-[12.5px] text-signal-amber">
          <b>{unassessed}</b> attending {unassessed === 1 ? "dog has" : "dogs have"} no behaviour
          colour recorded. They are held out of automatic grouping until a person assesses them.
        </p>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        <div className="card flex flex-col gap-2 p-3">
          <SectionTitle>Transportation</SectionTitle>
          <p className="text-[13px] text-ink-600">
            {transport.pickups} morning pickups · {transport.dropoffs} evening drop-offs
          </p>
          <Link to="/transportation" className="btn btn-primary w-fit">Plan pickups</Link>
        </div>

        <div className="card flex flex-col gap-2 p-3">
          <SectionTitle>Walks</SectionTitle>
          <p className="text-[13px] text-ink-600">
            {walk.groups.length} groups · {walk.excused.length} excused ·{" "}
            <span className={walk.unassigned.length ? "font-semibold text-signal-red" : ""}>
              {walk.unassigned.length} need review
            </span>
          </p>
          <Link to="/walks" className="btn btn-primary w-fit">Generate walks</Link>
        </div>

        <div className="card flex flex-col gap-2 p-3">
          <SectionTitle>Floors</SectionTitle>
          <p className="text-[13px] text-ink-600">
            {floor.floors
              .map((f) => {
                const meta = floors.find((x) => x.id === f.floorId);
                return `${meta?.name ?? f.floorId}: ${f.dogIds.length}`;
              })
              .join(" · ")}
            {floor.needsReview.length > 0 && (
              <>
                {" · "}
                <span className="font-semibold text-signal-amber">
                  {floor.needsReview.length} need review
                </span>
              </>
            )}
          </p>
          <Link to="/floors" className="btn btn-primary w-fit">Generate floor plan</Link>
        </div>
      </div>

      <section className="card overflow-hidden">
        <div className="border-b border-ink-200 bg-ink-50 px-3 py-2">
          <SectionTitle>Attending today</SectionTitle>
        </div>
        {attending.length === 0 ? (
          <EmptyState
            title="No dogs scheduled for this date"
            hint="Try another date, or add a one-time booking from the command bar above."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-ink-200 text-ink-500">
                  <th className="px-3 py-2 font-semibold">Dog</th>
                  <th className="px-3 py-2 font-semibold">Colour</th>
                  <th className="px-3 py-2 font-semibold">Transport</th>
                  <th className="px-3 py-2 font-semibold">Walk</th>
                  <th className="px-3 py-2 font-semibold">Floor</th>
                  <th className="px-3 py-2 font-semibold">Conflicts</th>
                </tr>
              </thead>
              <tbody>
                {attending.map((dog) => {
                  const group = walk.groups.find((g) => g.dogIds.includes(dog.id));
                  const excused = walk.excused.some((e) => e.dogId === dog.id);
                  const floorAt = floor.floors.find((f) => f.dogIds.includes(dog.id));
                  const floorMeta = floors.find((f) => f.id === floorAt?.floorId);
                  const reviewFloor = floor.needsReview.some((r) => r.dogId === dog.id);

                  return (
                    <tr key={dog.id} className="border-b border-ink-100 last:border-0 hover:bg-ink-50">
                      <td className="px-3 py-2">
                        <Link to={`/dogs/${dog.id}`} className="font-semibold text-ink-900 hover:text-brand-700">
                          {dog.name}
                        </Link>
                        <div className="text-[11px] text-ink-400">{dog.breed}</div>
                      </td>
                      <td className="px-3 py-2"><ColorBadge color={dog.behaviorColor} size="sm" /></td>
                      <td className="px-3 py-2 text-[12px] text-ink-600">
                        {[dog.defaultPickup ? "Pickup" : null, dog.defaultDropoff ? "Drop-off" : null]
                          .filter(Boolean)
                          .join(" + ") || <span className="text-ink-400">Owner</span>}
                      </td>
                      <td className="px-3 py-2 text-[12px]">
                        {excused ? (
                          <span className="text-ink-500">Excused</span>
                        ) : group ? (
                          <span className="text-ink-700">Assigned</span>
                        ) : (
                          <span className="font-semibold text-signal-red">Unassigned</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-[12px]">
                        {floorMeta ? (
                          <span className="text-ink-700">{floorMeta.name}</span>
                        ) : reviewFloor ? (
                          <span className="font-semibold text-signal-amber">Review</span>
                        ) : (
                          <span className="text-ink-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-[12px]">
                        {dog.incompatibleDogIds.length ? (
                          <span className="text-signal-red">{dog.incompatibleDogIds.length} flagged</span>
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
