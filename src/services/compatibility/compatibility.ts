import type { Dog, Reason } from "@/models/types";

/**
 * Compatibility is enforced identically across walks, floors and transport.
 * Nothing here branches on colour beyond the rules that are actually known.
 */

export function areIncompatible(a: Dog, b: Dog): boolean {
  return a.incompatibleDogIds.includes(b.id) || b.incompatibleDogIds.includes(a.id);
}

/** Every incompatible pairing inside a set of dogs. */
export function conflictsWithin(dogs: Dog[]): Array<[Dog, Dog]> {
  const out: Array<[Dog, Dog]> = [];
  for (let i = 0; i < dogs.length; i++) {
    for (let j = i + 1; j < dogs.length; j++) {
      if (areIncompatible(dogs[i], dogs[j])) out.push([dogs[i], dogs[j]]);
    }
  }
  return out;
}

export function canJoin(dog: Dog, group: Dog[]): boolean {
  return group.every((g) => !areIncompatible(dog, g));
}

export function conflictReasons(dogs: Dog[]): Reason[] {
  return conflictsWithin(dogs).map(([a, b]) => ({
    code: "HARD_INCOMPATIBLE",
    severity: "conflict" as const,
    message: `${a.name} and ${b.name} are flagged as not compatible.`,
  }));
}

/** Dogs sorted most-constrained first — the order the planners assign in. */
export function byConstraintPressure(dogs: Dog[]): Dog[] {
  return [...dogs].sort((a, b) => {
    const ha = a.constraints.filter((c) => c.severity === "hard").length;
    const hb = b.constraints.filter((c) => c.severity === "hard").length;
    const pa = a.incompatibleDogIds.length + ha * 2;
    const pb = b.incompatibleDogIds.length + hb * 2;
    if (pa !== pb) return pb - pa;
    return a.name.localeCompare(b.name);
  });
}

export function maxGroupSizeFor(dog: Dog): number | null {
  const c = dog.constraints.find(
    (x) => x.type === "max_group_size" && x.severity === "hard"
  );
  if (!c || typeof c.value !== "number") return null;
  return c.value;
}

export function isExcusedFromWalk(dog: Dog): boolean {
  return dog.constraints.some(
    (c) => c.type === "excused_from_walk" && c.severity === "hard"
  );
}

export function requiresExperiencedWalker(dog: Dog): boolean {
  return dog.constraints.some(
    (c) => c.type === "requires_experienced_walker" && c.severity === "hard"
  );
}

export function mustWalkAlone(dog: Dog): boolean {
  // The one red rule that IS defined: red dogs walk 1:1.
  if (dog.behaviorColor === "red") return true;
  return dog.constraints.some(
    (c) => c.type === "must_walk_alone" && c.severity === "hard"
  );
}

export function floorRestrictionFor(dog: Dog): string | null {
  const c = dog.constraints.find(
    (x) => x.type === "floor_restriction" && x.severity === "hard"
  );
  return c && typeof c.value === "string" ? c.value : null;
}
