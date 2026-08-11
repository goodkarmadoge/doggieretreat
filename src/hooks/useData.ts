import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/database";
import { DEFAULT_SETTINGS } from "@/demo/demoData";
import type {
  AppSettings,
  AttendanceException,
  AuditEntry,
  Dog,
  Floor,
  FloorLock,
  RecurringAttendance,
  RouteLock,
  TransportOverride,
  VanOverride,
  WalkLock,
  Walker,
} from "@/models/types";
import type { ReviewItem } from "@/services/harness/intents";

/**
 * Every screen reads through these hooks, so a write to IndexedDB re-renders
 * every view that depends on it. Cross-system reactivity is structural rather
 * than something each feature has to remember to do.
 */

export function useDogs(): Dog[] {
  return useLiveQuery(() => db.dogs.toArray(), [], [] as Dog[]) ?? [];
}

export function useActiveDogs(): Dog[] {
  const dogs = useDogs();
  return dogs.filter((d) => d.active);
}

export function useDog(id: string | undefined): Dog | undefined {
  return useLiveQuery(
    async (): Promise<Dog | undefined> => (id ? await db.dogs.get(id) : undefined),
    [id]
  );
}

export function useRecurring(): RecurringAttendance[] {
  return useLiveQuery(() => db.attendance.toArray(), [], [] as RecurringAttendance[]) ?? [];
}

export function useExceptions(): AttendanceException[] {
  return useLiveQuery(() => db.exceptions.toArray(), [], [] as AttendanceException[]) ?? [];
}

export function useTransportOverrides(): TransportOverride[] {
  return useLiveQuery(() => db.transportOverrides.toArray(), [], [] as TransportOverride[]) ?? [];
}

export function useWalkers(): Walker[] {
  return useLiveQuery(
    () => db.walkers.toArray().then((w) => w.sort((a, b) => a.name.localeCompare(b.name))),
    [],
    [] as Walker[]
  ) ?? [];
}

export function useFloors(): Floor[] {
  return useLiveQuery(
    () => db.floors.toArray().then((f) => f.sort((a, b) => a.order - b.order)),
    [],
    [] as Floor[]
  ) ?? [];
}

export function useSettings(): AppSettings {
  return useLiveQuery(() => db.settings.get("singleton"), [], undefined) ?? DEFAULT_SETTINGS;
}

export function useAudit(limit = 60): AuditEntry[] {
  return useLiveQuery(
    () =>
      db.audit
        .toArray()
        .then((a) => a.sort((x, y) => y.timestamp.localeCompare(x.timestamp)).slice(0, limit)),
    [limit],
    [] as AuditEntry[]
  ) ?? [];
}

export function useAuditForDog(dogId: string | undefined, limit = 20): AuditEntry[] {
  return useLiveQuery(
    () =>
      dogId
        ? db.audit
            .where("dogId")
            .equals(dogId)
            .toArray()
            .then((a) => a.sort((x, y) => y.timestamp.localeCompare(x.timestamp)).slice(0, limit))
        : Promise.resolve([] as AuditEntry[]),
    [dogId, limit],
    [] as AuditEntry[]
  ) ?? [];
}

export function useWalkLocks(): WalkLock[] {
  return useLiveQuery(() => db.walkLocks.toArray(), [], [] as WalkLock[]) ?? [];
}

export function useFloorLocks(): FloorLock[] {
  return useLiveQuery(() => db.floorLocks.toArray(), [], [] as FloorLock[]) ?? [];
}

export function useRouteLocks(): RouteLock[] {
  return useLiveQuery(() => db.routeLocks.toArray(), [], [] as RouteLock[]) ?? [];
}

export function useVanOverrides(): VanOverride[] {
  return useLiveQuery(() => db.vanOverrides.toArray(), [], [] as VanOverride[]) ?? [];
}

/** NEEDS_HUMAN_REVIEW queue — AI Harness §5 Stage 5. */
export function useReviewQueue(includeResolved = false): ReviewItem[] {
  return useLiveQuery(
    () =>
      db.reviewQueue.toArray().then((rows) =>
        rows
          .filter((r) => (includeResolved ? true : !r.resolved))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      ),
    [includeResolved],
    [] as ReviewItem[]
  ) ?? [];
}

export function useDogMap(): Map<string, Dog> {
  const dogs = useDogs();
  return new Map(dogs.map((d) => [d.id, d]));
}
