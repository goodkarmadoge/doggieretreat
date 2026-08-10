import { useMemo } from "react";
import type { Dog, FloorPlan, TransportPlan, WalkPlan } from "@/models/types";
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

export function useTransportPlan(date: string, type: "pickup" | "dropoff"): TransportPlan {
  const attending = useAttending(date);
  const overrides = useTransportOverrides();
  const vanOverrides = useVanOverrides();
  const settings = useSettings();
  const locks = useRouteLocks();

  return useMemo(() => {
    const needing = attending.filter((d) =>
      type === "pickup" ? needsPickup(d, date, overrides) : needsDropoff(d, date, overrides)
    );
    return generateTransportRoute(date, type, needing, settings, locks, vanOverrides);
  }, [date, type, attending, overrides, settings, locks, vanOverrides]);
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
