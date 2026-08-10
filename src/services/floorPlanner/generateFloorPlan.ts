import type {
  Dog,
  Floor,
  FloorAssignment,
  FloorLock,
  FloorPlan,
  Reason,
} from "@/models/types";
import {
  areIncompatible,
  byConstraintPressure,
  canJoin,
  conflictReasons,
  floorRestrictionFor,
} from "@/services/compatibility/compatibility";
import { statusOf } from "@/services/walkPlanner/generateWalkPlan";

/**
 * Three-floor placement.
 *
 * Deliberately conservative about what it does NOT know. The spec states that
 * Doggie Retreat's floor rules for red dogs have not been defined, so a red dog
 * without an explicit floor_restriction constraint is routed to Needs Staff
 * Review rather than guessed at. Same for any dog whose colour is unassessed.
 *
 * Hard constraints enforced: floor capacity, dog-to-dog incompatibility,
 * explicit floor restrictions.
 */
export function generateFloorPlan(
  date: string,
  attending: Dog[],
  floors: Floor[],
  locks: FloorLock[]
): FloorPlan {
  const ordered = [...floors].sort((a, b) => a.order - b.order);
  const byId = new Map(attending.map((d) => [d.id, d]));

  const assignments: FloorAssignment[] = ordered.map((f) => ({
    floorId: f.id,
    dogIds: [],
    reasons: [],
    status: "valid" as const,
    locked: false,
  }));
  const slot = new Map(assignments.map((a) => [a.floorId, a]));
  const needsReview: FloorPlan["needsReview"] = [];
  const placed = new Set<string>();

  /* 1 — locks preserved first, validated after. */
  for (const lock of locks.filter((l) => l.date === date)) {
    const a = slot.get(lock.floorId);
    if (!a) continue;
    const dogs = lock.dogIds.map((id) => byId.get(id)).filter((d): d is Dog => !!d);
    a.dogIds = dogs.map((d) => d.id);
    a.locked = true;
    dogs.forEach((d) => placed.add(d.id));
  }

  const dogsOn = (floorId: string) =>
    (slot.get(floorId)?.dogIds ?? [])
      .map((id) => byId.get(id))
      .filter((d): d is Dog => !!d);

  /* 2 — anything the system cannot judge safely goes to review, never to a floor. */
  for (const dog of attending) {
    if (placed.has(dog.id)) continue;

    if (dog.behaviorColor === null) {
      needsReview.push({
        dogId: dog.id,
        reasons: [{
          code: "COLOUR_NOT_ASSESSED",
          severity: "warning",
          message: `${dog.name} has no behaviour colour recorded. Placement cannot be judged safe.`,
        }],
      });
      placed.add(dog.id);
      continue;
    }

    if (dog.behaviorColor === "red" && !floorRestrictionFor(dog)) {
      needsReview.push({
        dogId: dog.id,
        reasons: [{
          code: "RED_FLOOR_RULE_UNDEFINED",
          severity: "warning",
          message: `${dog.name} is Red. Doggie Retreat's floor rules for Red dogs are not yet configured, so this placement needs a person. Add a floor restriction constraint to automate it.`,
        }],
        });
      placed.add(dog.id);
      continue;
    }
  }

  /* 3 — explicit floor restrictions are honoured before anything else. */
  const rest = () => byConstraintPressure(attending.filter((d) => !placed.has(d.id)));

  for (const dog of rest()) {
    const restriction = floorRestrictionFor(dog);
    if (!restriction) continue;
    const a = slot.get(restriction);
    const floor = ordered.find((f) => f.id === restriction);
    if (!a || !floor) continue;

    if (a.dogIds.length >= floor.capacity) {
      needsReview.push({
        dogId: dog.id,
        reasons: [{
          code: "RESTRICTED_FLOOR_FULL",
          severity: "conflict",
          message: `${dog.name} is restricted to ${floor.name}, which is at capacity (${floor.capacity}).`,
        }],
      });
    } else if (!canJoin(dog, dogsOn(floor.id))) {
      const clash = dogsOn(floor.id).find((o) => areIncompatible(dog, o));
      needsReview.push({
        dogId: dog.id,
        reasons: [{
          code: "RESTRICTED_FLOOR_CONFLICT",
          severity: "conflict",
          message: `${dog.name} is restricted to ${floor.name} but ${clash?.name} is assigned there.`,
        }],
      });
    } else {
      a.dogIds.push(dog.id);
    }
    placed.add(dog.id);
  }

  /* 4 — everything else goes to the floor with the most headroom, so the
         plan spreads across the building instead of packing Floor 1 solid.
         Ties break by floor order for determinism. */
  for (const dog of rest()) {
    const eligible = ordered
      .filter((floor) => {
        const a = slot.get(floor.id);
        if (!a || a.locked) return false;
        if (a.dogIds.length >= floor.capacity) return false;
        return canJoin(dog, dogsOn(floor.id));
      })
      .sort((x, y) => {
        const ux = (slot.get(x.id)!.dogIds.length) / Math.max(1, x.capacity);
        const uy = (slot.get(y.id)!.dogIds.length) / Math.max(1, y.capacity);
        if (ux !== uy) return ux - uy;
        return x.order - y.order;
      });

    const target = eligible.length ? slot.get(eligible[0].id) : undefined;

    if (target) {
      target.dogIds.push(dog.id);
    } else {
      const blocked = ordered
        .map((f) => {
          const a = slot.get(f.id);
          if (!a) return null;
          if (a.dogIds.length >= f.capacity) return `${f.name} is full`;
          const clash = dogsOn(f.id).find((o) => areIncompatible(dog, o));
          if (clash) return `${clash.name} is on ${f.name}`;
          return null;
        })
        .filter(Boolean)
        .join("; ");

      needsReview.push({
        dogId: dog.id,
        reasons: [{
          code: "NO_FLOOR_AVAILABLE",
          severity: "conflict",
          message: `Nowhere to place ${dog.name}. ${blocked || "All floors are unavailable."}`,
        }],
      });
    }
    placed.add(dog.id);
  }

  /* 5 — validate every floor, locked ones included. */
  for (const a of assignments) {
    const floor = ordered.find((f) => f.id === a.floorId)!;
    const dogs = dogsOn(a.floorId);
    const reasons: Reason[] = [...conflictReasons(dogs)];

    if (dogs.length > floor.capacity) {
      reasons.push({
        code: "OVER_CAPACITY",
        severity: "conflict",
        message: `${floor.name} holds ${dogs.length} dogs against a capacity of ${floor.capacity}.`,
      });
    }
    if (!reasons.length && dogs.length) {
      reasons.push({
        code: "FLOOR_OK",
        severity: "info",
        message: `${dogs.length} of ${floor.capacity} places used. No known incompatibilities on this floor.`,
      });
    }
    a.reasons = reasons;
    a.status = statusOf(reasons);
  }

  return { date, floors: assignments, needsReview };
}

/** Used when staff drag or move a dog manually. */
export function validateFloorMove(
  dog: Dog,
  floor: Floor,
  currentOccupants: Dog[]
): Reason[] {
  const reasons: Reason[] = [];
  const clash = currentOccupants.find((o) => o.id !== dog.id && areIncompatible(dog, o));
  if (clash) {
    reasons.push({
      code: "HARD_INCOMPATIBLE",
      severity: "conflict",
      message: `${dog.name} cannot be placed on ${floor.name} because ${clash.name} is currently assigned there.`,
    });
  }
  const occupants = currentOccupants.filter((o) => o.id !== dog.id).length;
  if (occupants + 1 > floor.capacity) {
    reasons.push({
      code: "OVER_CAPACITY",
      severity: "conflict",
      message: `${floor.name} is at capacity (${floor.capacity}).`,
    });
  }
  const restriction = floorRestrictionFor(dog);
  if (restriction && restriction !== floor.id) {
    reasons.push({
      code: "FLOOR_RESTRICTION",
      severity: "conflict",
      message: `${dog.name} has a hard floor restriction to a different floor.`,
    });
  }
  return reasons;
}
