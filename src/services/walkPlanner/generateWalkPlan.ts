import type {
  Dog,
  Reason,
  WalkGroup,
  WalkLock,
  WalkPlan,
  Walker,
} from "@/models/types";
import {
  areIncompatible,
  byConstraintPressure,
  canJoin,
  conflictReasons,
  isExcusedFromWalk,
  maxGroupSizeFor,
  mustWalkAlone,
  requiresExperiencedWalker,
} from "@/services/compatibility/compatibility";

/**
 * Deterministic walk assignment. One wave per day: each available walker takes
 * at most one group.
 *
 * Hard rules enforced:
 *   1. Max dogs per walker (configurable, demo default 4)
 *   2. Red dogs walk 1:1 — the one red rule that is actually defined
 *   3. Flagged-incompatible dogs are never grouped
 *   4. Explicit hard constraints override optimisation
 *   5. A dog with an unassessed colour is never silently grouped
 *
 * Not an optimiser. It respects hard constraints, produces sensible groups,
 * explains itself, and surfaces what it could not place.
 */
export function generateWalkPlan(
  date: string,
  attending: Dog[],
  walkers: Walker[],
  locks: WalkLock[],
  maxPerWalker: number
): WalkPlan {
  const available = walkers.filter((w) => w.available);
  const byId = new Map(attending.map((d) => [d.id, d]));

  const groups: WalkGroup[] = [];
  const unassigned: WalkPlan["unassigned"] = [];
  const excused: WalkPlan["excused"] = [];

  const placed = new Set<string>();
  const usedWalkers = new Set<string>();

  /* 0 — dogs deliberately not walking. Not a planner failure. */
  for (const dog of attending) {
    if (isExcusedFromWalk(dog)) {
      const c = dog.constraints.find((x) => x.type === "excused_from_walk");
      excused.push({
        dogId: dog.id,
        reasons: [{
          code: "EXCUSED_FROM_WALK",
          severity: "info",
          message: c?.description ?? "Excused from group walks by staff constraint.",
        }],
      });
      placed.add(dog.id);
    }
  }

  /* 1 — locked groups are preserved, then re-validated. A lock keeps the
         placement; it never suppresses a conflict. */
  for (const lock of locks.filter((l) => l.date === date)) {
    const dogs = lock.dogIds.map((id) => byId.get(id)).filter((d): d is Dog => !!d);
    if (!dogs.length) continue;

    const reasons = validateGroup(dogs, available.find((w) => w.id === lock.walkerId), maxPerWalker);
    groups.push({
      key: `lock:${lock.walkerId}`,
      walkerId: lock.walkerId,
      dogIds: dogs.map((d) => d.id),
      reasons,
      status: statusOf(reasons),
      locked: true,
    });
    dogs.forEach((d) => placed.add(d.id));
    usedWalkers.add(lock.walkerId);
  }

  const remaining = () => attending.filter((d) => !placed.has(d.id));
  const freeWalkers = () => available.filter((w) => !usedWalkers.has(w.id));

  /* 2 — red dogs take a walker each, 1:1. Experienced handler preferred. */
  for (const dog of byConstraintPressure(remaining()).filter(mustWalkAlone)) {
    const pool = freeWalkers();
    if (!pool.length) {
      unassigned.push({
        dogId: dog.id,
        reasons: [{
          code: "NO_WALKER_AVAILABLE",
          severity: "conflict",
          message: `${dog.name} needs a 1:1 walker and every walker is already assigned.`,
        }],
      });
      placed.add(dog.id);
      continue;
    }
    const walker = pool.find((w) => w.experienced) ?? pool[0];
    const reasons: Reason[] = [{
      code: "RED_SOLO",
      severity: "info",
      message: dog.behaviorColor === "red"
        ? `${dog.name} is Red and walks 1:1, which is the defined rule.`
        : `${dog.name} has a must-walk-alone constraint.`,
    }];
    if (requiresExperiencedWalker(dog) && !walker.experienced) {
      reasons.push({
        code: "WALKER_EXPERIENCE",
        severity: "warning",
        message: `${dog.name} is marked as needing an experienced handler; ${walker.name} is not flagged as experienced.`,
      });
    }
    groups.push({
      key: `solo:${dog.id}`,
      walkerId: walker.id,
      dogIds: [dog.id],
      reasons,
      status: statusOf(reasons),
      locked: false,
    });
    placed.add(dog.id);
    usedWalkers.add(walker.id);
  }

  /* 3 — dogs with no assessed colour are never silently grouped. */
  for (const dog of remaining().filter((d) => d.behaviorColor === null)) {
    unassigned.push({
      dogId: dog.id,
      reasons: [{
        code: "COLOUR_NOT_ASSESSED",
        severity: "warning",
        message: `${dog.name} has no behaviour colour recorded, so grouping cannot be judged safe.`,
      }],
    });
    placed.add(dog.id);
  }

  /* 4 — group the rest, most-constrained first, into compatible sets. */
  const buckets: Dog[][] = [];
  for (const dog of byConstraintPressure(remaining())) {
    const cap = Math.min(maxPerWalker, maxGroupSizeFor(dog) ?? maxPerWalker);

    const target = buckets.find((b) => {
      if (b.length >= cap) return false;
      const bucketCap = Math.min(
        maxPerWalker,
        ...b.map((x) => maxGroupSizeFor(x) ?? maxPerWalker)
      );
      if (b.length + 1 > bucketCap) return false;
      return canJoin(dog, b);
    });

    if (target) target.push(dog);
    else buckets.push([dog]);
    placed.add(dog.id);
  }

  /* 5 — hand buckets to walkers; anything past capacity is surfaced, not hidden. */
  for (const bucket of buckets) {
    const pool = freeWalkers();
    if (!pool.length) {
      const why: Reason = {
        code: "WALKER_CAPACITY",
        severity: "conflict",
        message: `No walker left for this group. One wave of ${available.length} walkers × ${maxPerWalker} dogs cannot cover today's attendance.`,
      };
      bucket.forEach((d) => unassigned.push({ dogId: d.id, reasons: [why] }));
      continue;
    }
    const needsExperienced = bucket.some(requiresExperiencedWalker);
    const walker =
      (needsExperienced ? pool.find((w) => w.experienced) : undefined) ?? pool[0];

    const reasons = validateGroup(bucket, walker, maxPerWalker);
    groups.push({
      key: `grp:${walker.id}`,
      walkerId: walker.id,
      dogIds: bucket.map((d) => d.id),
      reasons,
      status: statusOf(reasons),
      locked: false,
    });
    usedWalkers.add(walker.id);
  }

  const walkableCount = attending.length - excused.length;
  const soloCount = groups.filter((g) => g.dogIds.length === 1 && !g.locked).length;
  const theoretical = available.length * maxPerWalker;

  let capacityNote: string | undefined;
  if (unassigned.some((u) => u.reasons.some((r) => r.code === "WALKER_CAPACITY"))) {
    capacityNote =
      `${walkableCount} dogs need walks. ${available.length} walkers × ${maxPerWalker} = ${theoretical} slots, ` +
      `but ${soloCount} ${soloCount === 1 ? "walker is" : "walkers are"} consumed by 1:1 dogs. Add a walker in Settings to clear this.`;
  }

  return { date, groups, unassigned, excused, capacityNote };
}

function validateGroup(
  dogs: Dog[],
  walker: Walker | undefined,
  maxPerWalker: number
): Reason[] {
  const reasons: Reason[] = [...conflictReasons(dogs)];

  if (dogs.length > maxPerWalker) {
    reasons.push({
      code: "GROUP_TOO_LARGE",
      severity: "conflict",
      message: `${dogs.length} dogs exceeds the limit of ${maxPerWalker} per walker.`,
    });
  }

  for (const dog of dogs) {
    const cap = maxGroupSizeFor(dog);
    if (cap !== null && dogs.length > cap) {
      reasons.push({
        code: "MAX_GROUP_SIZE",
        severity: "conflict",
        message: `${dog.name} has a maximum group size of ${cap}; this group has ${dogs.length}.`,
      });
    }
    if (mustWalkAlone(dog) && dogs.length > 1) {
      reasons.push({
        code: "MUST_WALK_ALONE",
        severity: "conflict",
        message: `${dog.name} must walk 1:1 but is in a group of ${dogs.length}.`,
      });
    }
    if (dog.behaviorColor === null) {
      reasons.push({
        code: "COLOUR_NOT_ASSESSED",
        severity: "warning",
        message: `${dog.name} has no behaviour colour recorded.`,
      });
    }
    if (requiresExperiencedWalker(dog) && walker && !walker.experienced) {
      reasons.push({
        code: "WALKER_EXPERIENCE",
        severity: "warning",
        message: `${dog.name} needs an experienced handler; ${walker.name} is not flagged as experienced.`,
      });
    }
  }

  if (!reasons.length) {
    const names = dogs.map((d) => d.name).join(", ");
    reasons.push({
      code: "GROUP_OK",
      severity: "info",
      message: `No known compatibility conflicts between ${names}. Group size ${dogs.length} is within the ${maxPerWalker}-dog limit.`,
    });
  }

  return reasons;
}

export function statusOf(reasons: Reason[]): "valid" | "warning" | "conflict" {
  if (reasons.some((r) => r.severity === "conflict")) return "conflict";
  if (reasons.some((r) => r.severity === "warning")) return "warning";
  return "valid";
}

/** Used by manual edits to check a move before it is saved. */
export function validateManualGroup(
  dogs: Dog[],
  walker: Walker | undefined,
  maxPerWalker: number
): Reason[] {
  return validateGroup(dogs, walker, maxPerWalker);
}

export { areIncompatible };
