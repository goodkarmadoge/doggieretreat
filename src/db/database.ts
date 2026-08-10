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
  VanOverride,
  WalkLock,
  Walker,
} from "@/models/types";
import { FACILITY, LEGACY_FACILITY_ADDRESSES } from "@/config/facility";

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
  vanOverrides!: Table<VanOverride, string>;

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

    // v2 — per-dog van assignment, and the facility move to East Coast Road.
    this.version(2)
      .stores({
        vanOverrides: "id, date, type, dogId",
      })
      .upgrade(async (tx) => {
        const settings = await tx.table("settings").get("singleton");
        if (!settings) return;

        // Only migrate installs still sitting on a previous default. If staff
        // set their own address, leave it alone.
        if (LEGACY_FACILITY_ADDRESSES.includes(settings.facilityAddress)) {
          await tx.table("settings").put({
            ...settings,
            facilityName: FACILITY.name,
            facilityAddress: FACILITY.address,
            facilityLat: FACILITY.lat,
            facilityLng: FACILITY.lng,
          });
        }
      });
  }
}

export const db = new DoggieRetreatDB();
