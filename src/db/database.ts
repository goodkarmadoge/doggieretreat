import Dexie, { type Table } from "dexie";
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
  WalkLock,
  Walker,
} from "@/models/types";

/**
 * IndexedDB is the prototype's persistence. Everything reaches it through
 * repository.ts, never directly from components, so the store can later be
 * swapped for Supabase/Postgres without touching the UI or the engines.
 */
export class DoggieRetreatDB extends Dexie {
  dogs!: Table<Dog, string>;
  attendance!: Table<RecurringAttendance, string>;
  exceptions!: Table<AttendanceException, string>;
  transportOverrides!: Table<TransportOverride, string>;
  walkers!: Table<Walker, string>;
  floors!: Table<Floor, string>;
  settings!: Table<AppSettings, string>;
  audit!: Table<AuditEntry, string>;
  walkLocks!: Table<WalkLock, string>;
  floorLocks!: Table<FloorLock, string>;
  routeLocks!: Table<RouteLock, string>;

  constructor() {
    super("doggie-retreat");
    this.version(1).stores({
      dogs: "id, name, collarId, behaviorColor, active, address",
      attendance: "id, dogId, weekday, activeFrom, activeUntil",
      exceptions: "id, dogId, date, status",
      transportOverrides: "id, dogId, date, type",
      walkers: "id, name, available",
      floors: "id, order",
      settings: "id",
      audit: "id, timestamp, dogId",
      walkLocks: "id, date, walkerId",
      floorLocks: "id, date, floorId",
      routeLocks: "id, date, type",
    });
  }
}

export const db = new DoggieRetreatDB();
