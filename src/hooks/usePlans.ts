import { useEffect, useMemo, useState } from "react";
import type { Dog, FloorPlan, TransportPlan, WalkPlan } from "@/models/types";
import {
  fetchTravelMatrix, haversineMatrix, type TravelMatrix, type TravelSource,
} from "@/services/routing/travel";
import { fromISODate } from "@/utils/dates";
import {
  attendingOn,
  needsDropoff,
  needsPickup,
} from "@/services/scheduling/attendance";
import { generateWalkPlan } from "@/services/walkPlanner/generateWalkPlan";
import { generateFloorPlan } from "@/services/floorPlanner/generateFloorPlan";
import { generateTransportRoute } from "@/services/routing/generateTransportRoute";
import {
  useDogs,
  useExceptions,
  useFloorLocks,
  useFloors,
  useRecurring,
  useRouteLocks,
  useSettings,
  useTransportOverrides,
  useVanOverrides,
  useWalkLocks,
  useWalkers,
} from "./useData";

/**
 * All four workflows derive from the same attendance resolution. Nothing here
 * caches a copy of who is attending, so a schedule or compatibility change
 * flows into walks, floors and transport in the same render.
 */

export function useAttending(date: string): Dog[] {
  const dogs = useDogs();
  const recurring = useRecurring();
  const exceptions = useExceptions();
  return useMemo(
    () => attendingOn(date, dogs, recurring, exceptions),
    [date, dogs, recurring, exceptions]
  );
}

export function useWalkPlan(date: string): WalkPlan {
  const attending = useAttending(date);
  const walkers = useWalkers();
  const locks = useWalkLocks();
  const settings = useSettings();
  return useMemo(
    () => generateWalkPlan(date, attending, walkers, locks, settings.maxDogsPerWalker),
    [date, attending, walkers, locks, settings.maxDogsPerWalker]
  );
}

export function useFloorPlan(date: string): FloorPlan {
  const attending = useAttending(date);
  const floors = useFloors();
  const locks = useFloorLocks();
  return useMemo(
    () => generateFloorPlan(date, attending, floors, locks),
    [date, attending, floors, locks]
  );
}

export interface TransportPlanResult {
  plan: TransportPlan;
  travelSource: TravelSource;
  travelNote?: string;
  /** True while the Google matrix for the current point set is in flight. */
  loading: boolean;
}

/** Vans roll around these times; used to ask Google for the right traffic. */
const DEPARTURE_HOUR = { pickup: 8, dropoff: 18 } as const;

function departureISO(date: string, type: "pickup" | "dropoff"): string {
  const d = fromISODate(date);
  d.setHours(DEPARTURE_HOUR[type], 0, 0, 0);
  return d.toISOString();
}

export function useTransportPlan(
  date: string,
  type: "pickup" | "dropoff"
): TransportPlanResult {
  const attending = useAttending(date);
  const overrides = useTransportOverrides();
  const vanOverrides = useVanOverrides();
  const settings = useSettings();
  const locks = useRouteLocks();

  const needing = useMemo(
    () =>
      attending.filter((d) =>
        type === "pickup" ? needsPickup(d, date, overrides) : needsDropoff(d, date, overrides)
      ),
    [attending, date, type, overrides]
  );

  const [matrix, setMatrix] = useState<TravelMatrix>(() => haversineMatrix());
  const [loading, setLoading] = useState(false);

  /**
   * Pass 1 — straight-line. Renders immediately and establishes which stops
   * actually exist after the policy filters, which is exactly the point set
   * the matrix needs. Nothing waits on the network to show a usable plan.
   */
  const basePlan = useMemo(
    () =>
      generateTransportRoute(
        date, type, needing, settings, locks, vanOverrides, haversineMatrix()
      ),
    [date, type, needing, settings, locks, vanOverrides]
  );

  const points = useMemo(() => {
    const depot = { lat: settings.facilityLat, lng: settings.facilityLng };
    const seen = new Set<string>();
    const out = [depot];
    for (const stop of basePlan.vans.flatMap((v) => v.stops)) {
      const k = `${stop.lat.toFixed(5)},${stop.lng.toFixed(5)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ lat: stop.lat, lng: stop.lng });
    }
    return out;
  }, [basePlan, settings.facilityLat, settings.facilityLng]);

  const pointsKey = points.map((p) => `${p.lat},${p.lng}`).join(";");
  const depart = departureISO(date, type);

  useEffect(() => {
    if (points.length < 2) {
      setMatrix(haversineMatrix());
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchTravelMatrix(points, depart)
      .then((m) => !cancelled && setMatrix(m))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // pointsKey covers the contents of `points`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointsKey, depart]);

  /** Pass 2 — re-solve with real drive times once the matrix lands. */
  const plan = useMemo(
    () =>
      matrix.source === "haversine"
        ? basePlan
        : generateTransportRoute(
            date, type, needing, settings, locks, vanOverrides, matrix
          ),
    [matrix, basePlan, date, type, needing, settings, locks, vanOverrides]
  );

  return { plan, travelSource: matrix.source, travelNote: matrix.note, loading };
}

export function useTransportCounts(date: string) {
  const attending = useAttending(date);
  const overrides = useTransportOverrides();
  return useMemo(
    () => ({
      pickups: attending.filter((d) => needsPickup(d, date, overrides)).length,
      dropoffs: attending.filter((d) => needsDropoff(d, date, overrides)).length,
    }),
    [attending, date, overrides]
  );
}
