/**
 * Shared operational data model.
 *
 * Design notes tied to the build spec:
 *  - There is no Owner entity. Per staff direction, an owner is just a name, and
 *    a HOUSEHOLD is identified by normalized address. Transport groups stops by
 *    household so three dogs at one condo produce one van stop, not three.
 *  - RecurringAttendance carries activeUntil so a "going forward" schedule change
 *    can close the old weekday without deleting attendance history.
 *  - AttendanceException.status is an explicit union; a "move" is two exceptions.
 *  - behaviorColor is nullable. null means NOT YET ASSESSED, which is different
 *    from any assessed colour and must never be treated as safe.
 */

export type Weekday = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";

export const WEEKDAYS: Weekday[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export type BehaviorColor = "green" | "yellow" | "red";

export type ConstraintSeverity = "hard" | "soft";

/**
 * Constraint types are data, not hardcoded policy. The spec is explicit that
 * Doggie Retreat's real yellow/red rules are not yet defined, so the engines
 * read constraints rather than branching on colour beyond the two rules that
 * ARE known (red walks 1:1; green may mix unless explicitly incompatible).
 */
export type ConstraintType =
  | "must_walk_alone"
  | "max_group_size"
  | "floor_restriction"
  | "requires_experienced_walker"
  | "excused_from_walk"
  | "crate_required"
  | "other";

export interface DogConstraint {
  id: string;
  type: ConstraintType;
  description: string;
  severity: ConstraintSeverity;
  /** max_group_size -> number; floor_restriction -> floor id; else unused. */
  value?: string | number;
}

export interface Dog {
  id: string;
  collarId?: string;
  /**
   * Collar's owner identifier. Not an entity reference — there is no Owner
   * table. Kept purely as a stable matching key for reimport, because owner
   * NAMES change (marriage, transliteration) while the id does not.
   */
  collarOwnerId?: string;

  name: string;
  ownerName?: string;
  breed?: string;
  age?: number;
  weightKg?: number;

  /** Household key. Same normalized address == same household. */
  address?: string;
  lat?: number;
  lng?: number;

  /** null = not yet assessed by staff. Never assume safe. */
  behaviorColor: BehaviorColor | null;

  personalityNotes?: string;
  operationalNotes?: string;
  vaccinationStatus?: string;

  incompatibleDogIds: string[];
  /** Distinguishes "checked, gets on with everyone" from "nobody has looked". */
  conflictsReviewed: boolean;

  constraints: DogConstraint[];

  defaultPickup: boolean | null;
  defaultDropoff: boolean | null;

  active: boolean;
  isDemo: boolean;
}

export interface RecurringAttendance {
  id: string;
  dogId: string;
  weekday: Weekday;
  /** ISO yyyy-mm-dd, inclusive. */
  activeFrom: string;
  /** ISO yyyy-mm-dd, exclusive. Undefined = still active. */
  activeUntil?: string;
}

export interface AttendanceException {
  id: string;
  dogId: string;
  /** ISO yyyy-mm-dd. */
  date: string;
  status: "added" | "removed";
  note?: string;
}

export interface TransportOverride {
  id: string;
  dogId: string;
  date: string;
  type: "pickup" | "dropoff";
  required: boolean;
}

export interface Walker {
  id: string;
  name: string;
  available: boolean;
  experienced: boolean;
  experienceNotes?: string;
  isDemo: boolean;
}

export interface Floor {
  id: string;
  name: string;
  capacity: number;
  order: number;
  restrictions?: string;
  isDemo: boolean;
}

export type RedVanPolicy = "review" | "solo" | "crated" | "normal";

export interface AppSettings {
  id: "singleton";
  maxDogsPerWalker: number;
  facilityName: string;
  facilityAddress: string;
  facilityLat: number;
  facilityLng: number;
  vanCount: number;
  /** null = unlimited, the agreed starting position. */
  vanCapacity: number | null;
  redVanPolicy: RedVanPolicy;
  demoDataLoaded: boolean;
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  dogId?: string;
  dogName?: string;
  previousValue?: string;
  newValue?: string;
}

/** Locks survive regeneration but never suppress validation. */
export interface WalkLock {
  id: string;
  date: string;
  walkerId: string;
  dogIds: string[];
}

export interface FloorLock {
  id: string;
  date: string;
  floorId: string;
  dogIds: string[];
}

export interface RouteLock {
  id: string;
  date: string;
  type: "pickup" | "dropoff";
  vanIndex: number;
  /** Ordered household keys. */
  stopOrder: string[];
}

/**
 * A staff decision to put a specific dog on a specific van, overriding the
 * packer.
 *
 * Assignment is held per DOG rather than per stop on purpose. Moving every dog
 * at an address moves the whole stop, which is the common case; moving one dog
 * out splits the household across two vans, which is the only way to separate
 * incompatible dogs that live together.
 */
export interface VanOverride {
  id: string;
  date: string;
  type: "pickup" | "dropoff";
  dogId: string;
  vanIndex: number;
}

/* ------------------------------------------------------------------ */
/* Computed plan shapes — derived, never persisted as duplicated state */
/* ------------------------------------------------------------------ */

export type Severity = "info" | "warning" | "conflict";

/**
 * Explanations are generated from structured codes rather than concatenated
 * prose, so they stay testable and the wording can change without touching
 * the engines.
 */
export interface Reason {
  code: string;
  severity: Severity;
  message: string;
}

export type PlanStatus = "valid" | "warning" | "conflict";

export interface WalkGroup {
  key: string;
  walkerId: string | null;
  dogIds: string[];
  reasons: Reason[];
  status: PlanStatus;
  locked: boolean;
}

export interface UnplacedDog {
  dogId: string;
  reasons: Reason[];
}

export interface WalkPlan {
  date: string;
  groups: WalkGroup[];
  /** Could not be placed within the hard rules. */
  unassigned: UnplacedDog[];
  /** Deliberately not walking (medical / staff constraint) — not a failure. */
  excused: UnplacedDog[];
  capacityNote?: string;
}

export interface FloorAssignment {
  floorId: string;
  dogIds: string[];
  reasons: Reason[];
  status: PlanStatus;
  locked: boolean;
}

export interface FloorPlan {
  date: string;
  floors: FloorAssignment[];
  needsReview: UnplacedDog[];
}

export interface RouteStop {
  /** Household key (normalized address). */
  householdKey: string;
  address: string;
  lat: number;
  lng: number;
  dogIds: string[];
  ownerNames: string[];
  reasons: Reason[];
  /** Minutes from leaving the facility until arriving at this stop. */
  etaMinutes?: number;
  /** Drive minutes on the leg into this stop. */
  legMinutes?: number;
}

export interface VanRoute {
  vanIndex: number;
  stops: RouteStop[];
  distanceKm: number;
  /** Total round-trip drive time including the return leg. */
  durationMinutes?: number;
  status: PlanStatus;
  locked: boolean;
}

export interface TransportPlan {
  date: string;
  type: "pickup" | "dropoff";
  vans: VanRoute[];
  needsReview: UnplacedDog[];
}

/* ------------------------------------------------------------------ */
/* Command parser                                                      */
/* ------------------------------------------------------------------ */

export type ProposedChangeKind =
  | "schedule_onetime"
  | "schedule_recurring"
  | "transport"
  | "compatibility"
  | "behavior";

export interface ProposedChange {
  kind: ProposedChangeKind;
  summary: string;
  detail: string[];
  dogIds: string[];
  effectiveDate?: string;
  recurring: boolean;
  apply: () => Promise<void>;
}

export interface ParseResult {
  ok: boolean;
  change?: ProposedChange;
  /** Set when a name matched more than one active dog. */
  ambiguous?: { token: string; candidates: Dog[] };
  error?: string;
}
