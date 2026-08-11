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
import type { ReviewItem } from "@/services/harness/intents";
import {
  FACILITY,
  LEGACY_FACILITY_ADDRESSES,
  LEGACY_FACILITY_COORDS,
} from "@/config/facility";

/**
 * Move a stored facility onto the current default — but only when it still
 * looks like a previous default. A staff-edited facility is never overwritten.
 */
async function migrateFacility(tx: {
  table: (name: string) => {
    get: (k: string) => Promise<AppSettings | undefined>;
    put: (v: AppSettings) => Promise<unknown>;
  };
}): Promise<void> {
  const settings = await tx.table("settings").get("singleton");
  if (!settings) return;

  const near = (a: number, b: number) => Math.abs(a - b) < 1e-4;
  const staleAddress = LEGACY_FACILITY_ADDRESSES.includes(settings.facilityAddress);
  const staleCoords = LEGACY_FACILITY_COORDS.some(
    ([lat, lng]) => near(settings.facilityLat, lat) && near(settings.facilityLng, lng)
  );
  if (!staleAddress && !staleCoords) return;

  await tx.table("settings").put({
    ...settings,
    facilityName: FACILITY.name,
    facilityAddress: FACILITY.address,
    facilityLat: FACILITY.lat,
    facilityLng: FACILITY.lng,
  });
}

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
  /** AI Harness §5 Stage 5 — nothing is silently discarded. */
  reviewQueue!: Table<ReviewItem, string>;

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
      .upgrade(async (tx) => migrateFacility(tx));

    // v3 — facility coordinates replaced with a real geocode. Installs that
    // took v2 have the correct address but hand-set coordinates, so they get
    // corrected here.
    this.version(3).upgrade(async (tx) => migrateFacility(tx));

    // v4 — AI harness: the NEEDS_HUMAN_REVIEW queue, plus the staff role that
    // the permission model is enforced against.
    this.version(4)
      .stores({ reviewQueue: "id, createdAt, reason, resolved" })
      .upgrade(async (tx) => {
        const settings = await tx.table("settings").get("singleton");
        if (settings && !settings.staffRole) {
          await tx.table("settings").put({ ...settings, staffRole: "shift_lead" });
        }
      });
  }
}

export const db = new DoggieRetreatDB();
