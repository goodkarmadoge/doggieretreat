import { db } from "./database";
import {
  DEFAULT_SETTINGS,
  DEMO_EPOCH,
  buildDemoAttendance,
  buildDemoDogs,
  buildDemoExceptions,
  buildDemoFloors,
  buildDemoWalkers,
} from "@/demo/demoData";
import type {
  AppSettings,
  AttendanceException,
  AuditEntry,
  BehaviorColor,
  Dog,
  Floor,
  RecurringAttendance,
  TransportOverride,
  Walker,
  Weekday,
} from "@/models/types";
import { todayISO } from "@/utils/dates";

const ACTOR = "Staff User";

const uid = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export async function getSettings(): Promise<AppSettings> {
  const s = await db.settings.get("singleton");
  if (s) return s;
  await db.settings.put(DEFAULT_SETTINGS);
  return DEFAULT_SETTINGS;
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<void> {
  const current = await getSettings();
  await db.settings.put({ ...current, ...patch, id: "singleton" });
}

/* ------------------------------------------------------------------ */
/* Audit                                                               */
/* ------------------------------------------------------------------ */

export async function recordAudit(
  entry: Omit<AuditEntry, "id" | "timestamp" | "actor">
): Promise<void> {
  await db.audit.add({
    ...entry,
    id: uid(),
    timestamp: new Date().toISOString(),
    actor: ACTOR,
  });
}

/* ------------------------------------------------------------------ */
/* Demo data                                                           */
/* ------------------------------------------------------------------ */

export async function loadDemoData(): Promise<void> {
  await db.transaction(
    "rw",
    [db.dogs, db.attendance, db.exceptions, db.walkers, db.floors, db.settings, db.audit,
     db.walkLocks, db.floorLocks, db.routeLocks, db.transportOverrides],
    async () => {
      await Promise.all([
        db.dogs.clear(), db.attendance.clear(), db.exceptions.clear(),
        db.walkers.clear(), db.floors.clear(), db.audit.clear(),
        db.walkLocks.clear(), db.floorLocks.clear(), db.routeLocks.clear(),
        db.transportOverrides.clear(),
      ]);
      await db.dogs.bulkPut(buildDemoDogs());
      await db.attendance.bulkPut(buildDemoAttendance());
      await db.exceptions.bulkPut(buildDemoExceptions());
      await db.walkers.bulkPut(buildDemoWalkers());
      await db.floors.bulkPut(buildDemoFloors());
      await db.settings.put({ ...DEFAULT_SETTINGS, demoDataLoaded: true });
    }
  );
  await recordAudit({ action: "Loaded demo dataset (50 dogs)" });
}

export async function clearAllData(): Promise<void> {
  await db.transaction(
    "rw",
    [db.dogs, db.attendance, db.exceptions, db.walkers, db.floors, db.settings, db.audit,
     db.walkLocks, db.floorLocks, db.routeLocks, db.transportOverrides],
    async () => {
      await Promise.all([
        db.dogs.clear(), db.attendance.clear(), db.exceptions.clear(),
        db.walkers.clear(), db.floors.clear(), db.audit.clear(),
        db.walkLocks.clear(), db.floorLocks.clear(), db.routeLocks.clear(),
        db.transportOverrides.clear(),
      ]);
      await db.settings.put({ ...DEFAULT_SETTINGS, demoDataLoaded: false });
    }
  );
}

export async function ensureSeeded(): Promise<void> {
  const count = await db.dogs.count();
  if (count === 0) {
    const walkers = await db.walkers.count();
    if (walkers === 0) await db.walkers.bulkPut(buildDemoWalkers());
    const floors = await db.floors.count();
    if (floors === 0) await db.floors.bulkPut(buildDemoFloors());
  }
  await getSettings();
}

/* ------------------------------------------------------------------ */
/* Dogs                                                                */
/* ------------------------------------------------------------------ */

export async function updateDog(id: string, patch: Partial<Dog>): Promise<void> {
  await db.dogs.update(id, patch);
}

export async function setBehaviorColor(
  dogId: string,
  color: BehaviorColor | null
): Promise<void> {
  const dog = await db.dogs.get(dogId);
  if (!dog) return;
  await db.dogs.update(dogId, { behaviorColor: color });
  await recordAudit({
    action: "Behaviour colour changed",
    dogId,
    dogName: dog.name,
    previousValue: dog.behaviorColor ?? "not assessed",
    newValue: color ?? "not assessed",
  });
}

/**
 * Incompatibility is a property of a PAIR. Writing one direction only would
 * mean whichever record staff opened second looked clear — a safety bug, so
 * both directions are always written together.
 */
export async function linkIncompatible(aId: string, bId: string): Promise<void> {
  if (aId === bId) return;
  const [a, b] = await Promise.all([db.dogs.get(aId), db.dogs.get(bId)]);
  if (!a || !b) return;

  await db.transaction("rw", db.dogs, async () => {
    if (!a.incompatibleDogIds.includes(bId)) {
      await db.dogs.update(aId, {
        incompatibleDogIds: [...a.incompatibleDogIds, bId],
        conflictsReviewed: true,
      });
    }
    if (!b.incompatibleDogIds.includes(aId)) {
      await db.dogs.update(bId, {
        incompatibleDogIds: [...b.incompatibleDogIds, aId],
        conflictsReviewed: true,
      });
    }
  });

  await recordAudit({
    action: "Incompatibility added (both directions)",
    dogId: aId,
    dogName: a.name,
    newValue: `${a.name} ↔ ${b.name}`,
  });
}

export async function unlinkIncompatible(aId: string, bId: string): Promise<void> {
  const [a, b] = await Promise.all([db.dogs.get(aId), db.dogs.get(bId)]);
  if (!a || !b) return;

  await db.transaction("rw", db.dogs, async () => {
    await db.dogs.update(aId, {
      incompatibleDogIds: a.incompatibleDogIds.filter((x) => x !== bId),
    });
    await db.dogs.update(bId, {
      incompatibleDogIds: b.incompatibleDogIds.filter((x) => x !== aId),
    });
  });

  await recordAudit({
    action: "Incompatibility removed (both directions)",
    dogId: aId,
    dogName: a.name,
    previousValue: `${a.name} ↔ ${b.name}`,
  });
}

/**
 * Deactivating a dog strips it from every other dog's incompatibility list, so
 * no record is left pointing at a dog that is no longer resolvable.
 */
export async function setDogActive(dogId: string, active: boolean): Promise<void> {
  const dog = await db.dogs.get(dogId);
  if (!dog) return;

  await db.transaction("rw", db.dogs, async () => {
    await db.dogs.update(dogId, { active });
    if (!active) {
      const referrers = await db.dogs
        .filter((d) => d.incompatibleDogIds.includes(dogId))
        .toArray();
      for (const r of referrers) {
        await db.dogs.update(r.id, {
          incompatibleDogIds: r.incompatibleDogIds.filter((x) => x !== dogId),
        });
      }
    }
  });

  await recordAudit({
    action: active ? "Dog reactivated" : "Dog deactivated (incompatibility links cleaned)",
    dogId,
    dogName: dog.name,
  });
}

/* ------------------------------------------------------------------ */
/* Attendance                                                          */
/* ------------------------------------------------------------------ */

export async function getRecurringForDog(dogId: string): Promise<RecurringAttendance[]> {
  return db.attendance.where("dogId").equals(dogId).toArray();
}

/**
 * "Going forward" change. The old weekday is CLOSED with activeUntil rather
 * than deleted, so historical attendance stays answerable.
 */
export async function moveRecurringDay(
  dogId: string,
  from: Weekday,
  to: Weekday,
  effectiveFrom: string
): Promise<void> {
  const dog = await db.dogs.get(dogId);
  const rows = await getRecurringForDog(dogId);
  const open = rows.filter((r) => r.weekday === from && !r.activeUntil);

  await db.transaction("rw", db.attendance, async () => {
    for (const row of open) {
      await db.attendance.update(row.id, { activeUntil: effectiveFrom });
    }
    await db.attendance.add({
      id: uid(),
      dogId,
      weekday: to,
      activeFrom: effectiveFrom,
    });
  });

  await recordAudit({
    action: "Recurring daycare day changed",
    dogId,
    dogName: dog?.name,
    previousValue: from,
    newValue: `${to} (from ${effectiveFrom})`,
  });
}

export async function addRecurringDay(dogId: string, weekday: Weekday): Promise<void> {
  const rows = await getRecurringForDog(dogId);
  if (rows.some((r) => r.weekday === weekday && !r.activeUntil)) return;
  const dog = await db.dogs.get(dogId);
  await db.attendance.add({ id: uid(), dogId, weekday, activeFrom: DEMO_EPOCH });
  await recordAudit({
    action: "Recurring daycare day added",
    dogId, dogName: dog?.name, newValue: weekday,
  });
}

export async function removeRecurringDay(dogId: string, weekday: Weekday): Promise<void> {
  const rows = await getRecurringForDog(dogId);
  const open = rows.filter((r) => r.weekday === weekday && !r.activeUntil);
  const dog = await db.dogs.get(dogId);
  for (const row of open) {
    await db.attendance.update(row.id, { activeUntil: todayISO() });
  }
  await recordAudit({
    action: "Recurring daycare day removed",
    dogId, dogName: dog?.name, previousValue: weekday,
  });
}

/** One-time change. A "move" is a removed exception plus an added exception. */
export async function addException(
  dogId: string,
  date: string,
  status: "added" | "removed",
  note?: string
): Promise<void> {
  const existing = await db.exceptions
    .where("dogId").equals(dogId)
    .filter((e) => e.date === date)
    .toArray();
  for (const e of existing) await db.exceptions.delete(e.id);
  await db.exceptions.add({ id: uid(), dogId, date, status, note });
}

export async function moveOneTime(
  dogId: string,
  fromDate: string,
  toDate: string
): Promise<void> {
  const dog = await db.dogs.get(dogId);
  await addException(dogId, fromDate, "removed", "One-time move");
  await addException(dogId, toDate, "added", "One-time move");
  await recordAudit({
    action: "One-time daycare move",
    dogId, dogName: dog?.name,
    previousValue: fromDate, newValue: toDate,
  });
}

export async function clearException(id: string): Promise<void> {
  await db.exceptions.delete(id);
}

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

export async function setTransportOverride(
  dogId: string,
  date: string,
  type: "pickup" | "dropoff",
  required: boolean
): Promise<void> {
  const dog = await db.dogs.get(dogId);
  const existing = await db.transportOverrides
    .where("dogId").equals(dogId)
    .filter((o) => o.date === date && o.type === type)
    .toArray();
  for (const o of existing) await db.transportOverrides.delete(o.id);
  await db.transportOverrides.add({ id: uid(), dogId, date, type, required });
  await recordAudit({
    action: `${type === "pickup" ? "Pickup" : "Drop-off"} override`,
    dogId, dogName: dog?.name,
    newValue: `${required ? "required" : "not required"} on ${date}`,
  });
}

/* ------------------------------------------------------------------ */
/* Walkers & floors                                                    */
/* ------------------------------------------------------------------ */

export async function upsertWalker(w: Walker): Promise<void> {
  await db.walkers.put(w);
}

export async function deleteWalker(id: string): Promise<void> {
  await db.walkers.delete(id);
}

export async function upsertFloor(f: Floor): Promise<void> {
  await db.floors.put(f);
}

/* ------------------------------------------------------------------ */
/* Locks                                                               */
/* ------------------------------------------------------------------ */

export async function toggleWalkLock(
  date: string, walkerId: string, dogIds: string[], locked: boolean
): Promise<void> {
  const id = `${date}:${walkerId}`;
  if (locked) await db.walkLocks.put({ id, date, walkerId, dogIds });
  else await db.walkLocks.delete(id);
}

export async function toggleFloorLock(
  date: string, floorId: string, dogIds: string[], locked: boolean
): Promise<void> {
  const id = `${date}:${floorId}`;
  if (locked) await db.floorLocks.put({ id, date, floorId, dogIds });
  else await db.floorLocks.delete(id);
}

export async function toggleRouteLock(
  date: string, type: "pickup" | "dropoff", vanIndex: number,
  stopOrder: string[], locked: boolean
): Promise<void> {
  const id = `${date}:${type}:${vanIndex}`;
  if (locked) await db.routeLocks.put({ id, date, type, vanIndex, stopOrder });
  else await db.routeLocks.delete(id);
}

export async function saveRouteOrder(
  date: string, type: "pickup" | "dropoff", vanIndex: number, stopOrder: string[]
): Promise<void> {
  const id = `${date}:${type}:${vanIndex}`;
  const existing = await db.routeLocks.get(id);
  await db.routeLocks.put({
    id, date, type, vanIndex, stopOrder,
    ...(existing ? {} : {}),
  });
}

/* ------------------------------------------------------------------ */
/* Bulk import                                                         */
/* ------------------------------------------------------------------ */

export async function bulkUpsertDogs(dogs: Dog[]): Promise<void> {
  await db.dogs.bulkPut(dogs);
}

export async function bulkAddAttendance(rows: RecurringAttendance[]): Promise<void> {
  await db.attendance.bulkPut(rows);
}

export type { AttendanceException, TransportOverride };
