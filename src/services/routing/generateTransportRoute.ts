import type {
  AppSettings,
  Dog,
  Reason,
  RouteLock,
  RouteStop,
  TransportPlan,
  VanOverride,
  VanRoute,
} from "@/models/types";
import { areIncompatible } from "@/services/compatibility/compatibility";
import { groupIntoHouseholds, householdKey, type Household } from "@/utils/household";
import { type Point } from "@/utils/geo";
import { haversineMatrix, type TravelMatrix } from "./travel";
import { statusOf } from "@/services/walkPlanner/generateWalkPlan";

/**
 * Transport planning. Every route is a closed loop from the facility:
 * facility → stops → facility, for both morning pickup and evening drop-off.
 *
 * Three rules that are not in the original spec, all agreed with staff:
 *
 *  1. STOPS ARE HOUSEHOLDS. An owner is just a name, so a household is a
 *     normalized address. Several dogs at one home are one stop.
 *
 *  2. COMPATIBILITY APPLIES IN THE VAN. Incompatible dogs are confined
 *     together for the length of a run with the driver driving, so a van
 *     manifest is validated exactly like a walk group or a floor.
 *
 *  3. VAN ASSIGNMENT IS PER DOG. The packer proposes, staff dispose. Moving
 *     every dog at an address moves the whole stop; moving one dog splits the
 *     household across two vans, which is the only way to separate
 *     incompatible dogs that share a home.
 *
 * Red dogs follow the configured redVanPolicy — default "review", because no
 * van rule for Red dogs has been defined and the system will not invent one.
 */
export function generateTransportRoute(
  date: string,
  type: "pickup" | "dropoff",
  dogsNeedingTransport: Dog[],
  settings: AppSettings,
  locks: RouteLock[],
  overrides: VanOverride[] = [],
  /**
   * Travel costs. Supply the Google matrix to optimise on real drive time;
   * omit it and the builder falls back to straight-line, which keeps the app
   * working with no API key and no network.
   */
  travel: TravelMatrix = haversineMatrix()
): TransportPlan {
  const depot: Point = { lat: settings.facilityLat, lng: settings.facilityLng };
  const needsReview: TransportPlan["needsReview"] = [];

  /* 1 — policy gates before any routing happens. */
  let routable = dogsNeedingTransport;

  if (settings.redVanPolicy === "review") {
    for (const dog of routable.filter((d) => d.behaviorColor === "red")) {
      needsReview.push({
        dogId: dog.id,
        reasons: [{
          code: "RED_VAN_RULE_UNDEFINED",
          severity: "warning",
          message: `${dog.name} is Red. No van rule for Red dogs has been set, so this run needs a person. Change the policy in Settings to automate it.`,
        }],
      });
    }
    routable = routable.filter((d) => d.behaviorColor !== "red");
  }

  for (const dog of routable) {
    if (dog.behaviorColor === null) {
      needsReview.push({
        dogId: dog.id,
        reasons: [{
          code: "COLOUR_NOT_ASSESSED",
          severity: "warning",
          message: `${dog.name} has no behaviour colour recorded, so van sharing cannot be judged safe.`,
        }],
      });
    }
  }
  const reviewIds = new Set(needsReview.map((r) => r.dogId));
  routable = routable.filter((d) => !reviewIds.has(d.id));

  const vanCount = Math.max(1, settings.vanCount);

  /* 2 — pack households, which yields a proposed van per dog. */
  const households = groupIntoHouseholds(routable).filter((h) => h.lat && h.lng);
  const assignment = new Map<string, number>();
  const loadOf = (van: number) =>
    [...assignment.values()].filter((v) => v === van).length;

  const dogsOnVan = (van: number) =>
    routable.filter((d) => assignment.get(d.id) === van);

  const pressure = (h: Household) =>
    h.dogs.reduce((n, d) => n + d.incompatibleDogIds.length, 0);

  for (const h of [...households].sort((a, b) => pressure(b) - pressure(a))) {
    const eligible: number[] = [];
    for (let i = 0; i < vanCount; i++) {
      const manifest = dogsOnVan(i);
      if (manifest.some((m) => h.dogs.some((d) => areIncompatible(m, d)))) continue;
      if (settings.vanCapacity !== null &&
          manifest.length + h.dogs.length > settings.vanCapacity) continue;
      eligible.push(i);
    }

    // Conflict-free vans first, then the least loaded, so runs split evenly
    // instead of piling everything onto van 1.
    eligible.sort((a, b) => {
      const la = loadOf(a);
      const lb = loadOf(b);
      return la !== lb ? la - lb : a - b;
    });

    if (!eligible.length) {
      for (const dog of h.dogs) {
        needsReview.push({
          dogId: dog.id,
          reasons: [{
            code: "NO_COMPATIBLE_VAN",
            severity: "conflict",
            message: `${dog.name} conflicts with a dog already on every available van. Add a van in Settings or split the run.`,
          }],
        });
      }
      continue;
    }
    for (const dog of h.dogs) assignment.set(dog.id, eligible[0]);
  }

  /* 3 — staff overrides win over the packer, including ones that create a
         conflict. The conflict is reported loudly rather than prevented. */
  const dayOverrides = overrides.filter((o) => o.date === date && o.type === type);
  for (const o of dayOverrides) {
    if (!assignment.has(o.dogId)) continue;
    assignment.set(o.dogId, Math.min(Math.max(0, o.vanIndex), vanCount - 1));
  }

  const overriddenDogIds = new Set(dayOverrides.map((o) => o.dogId));

  /* 4 — rebuild stops per van. A household split across vans correctly
         produces a stop on each, at the same address. */
  const vans: VanRoute[] = Array.from({ length: vanCount }, (_, vanIndex) => {
    const manifest = routable.filter((d) => assignment.get(d.id) === vanIndex);
    const vanHouseholds = groupIntoHouseholds(manifest).filter((h) => h.lat && h.lng);

    const lock = locks.find(
      (l) => l.date === date && l.type === type && l.vanIndex === vanIndex
    );

    let sequence: Household[];
    if (lock) {
      const map = new Map(vanHouseholds.map((h) => [h.key, h]));
      sequence = lock.stopOrder
        .map((k) => map.get(k))
        .filter((h): h is Household => !!h);
      for (const h of vanHouseholds) if (!sequence.includes(h)) sequence.push(h);
    } else {
      sequence = twoOpt(nearestNeighbour(vanHouseholds, depot, travel), depot, travel);
    }

    // Cumulative drive time from leaving the facility.
    let running = 0;
    let cursor: Point = depot;
    const stops: RouteStop[] = sequence.map((h) => {
      const leg = travel.leg(cursor, h);
      running += leg.seconds;
      cursor = h;
      return {
        householdKey: h.key,
        address: h.address,
        lat: h.lat,
        lng: h.lng,
        dogIds: h.dogs.map((d) => d.id),
        ownerNames: h.ownerNames,
        reasons: stopReasons(h, routable, assignment, vanIndex, overriddenDogIds),
        legMinutes: Math.round(leg.seconds / 60),
        etaMinutes: Math.round(running / 60),
      };
    });

    const returnLeg = sequence.length ? travel.leg(cursor, depot) : { km: 0, seconds: 0 };
    const reasons = manifestReasons(manifest, settings);

    return {
      vanIndex,
      stops,
      distanceKm: routeLength(sequence, depot, travel),
      durationMinutes: sequence.length
        ? Math.round((running + returnLeg.seconds) / 60)
        : 0,
      status: statusOf(reasons.length ? reasons : stops.flatMap((s) => s.reasons)),
      locked: !!lock,
    };
  });

  return { date, type, vans, needsReview };
}

function stopReasons(
  h: Household,
  allRoutable: Dog[],
  assignment: Map<string, number>,
  vanIndex: number,
  overridden: Set<string>
): Reason[] {
  const out: Reason[] = [];

  // Incompatible pairs that live together and are still on the same van.
  for (let i = 0; i < h.dogs.length; i++) {
    for (let j = i + 1; j < h.dogs.length; j++) {
      if (areIncompatible(h.dogs[i], h.dogs[j])) {
        out.push({
          code: "SAME_HOUSEHOLD_CONFLICT",
          severity: "warning",
          message: `${h.dogs[i].name} and ${h.dogs[j].name} are flagged incompatible but share an address. Separate them in the van, or move one to the other van.`,
        });
      }
    }
  }

  // Was this household split across vans by a staff override?
  const key = h.key;
  const elsewhere = allRoutable.filter(
    (d) => householdKey(d.address) === key && assignment.get(d.id) !== vanIndex
  );
  if (elsewhere.length) {
    out.push({
      code: "HOUSEHOLD_SPLIT",
      severity: "info",
      message: `${elsewhere.map((d) => d.name).join(", ")} from this address ${elsewhere.length === 1 ? "is" : "are"} on another van, so this address is visited twice.`,
    });
  }

  if (h.dogs.some((d) => overridden.has(d.id))) {
    out.push({
      code: "STAFF_ASSIGNED",
      severity: "info",
      message: "Van chosen by staff, not by the planner.",
    });
  }

  if (h.dogs.length > 1 && !out.length) {
    out.push({
      code: "MULTI_DOG_HOUSEHOLD",
      severity: "info",
      message: `${h.dogs.length} dogs collected at this stop.`,
    });
  }
  return out;
}

function manifestReasons(manifest: Dog[], settings: AppSettings): Reason[] {
  const out: Reason[] = [];
  for (let i = 0; i < manifest.length; i++) {
    for (let j = i + 1; j < manifest.length; j++) {
      const a = manifest[i];
      const b = manifest[j];
      if (!areIncompatible(a, b)) continue;
      const sameHome = a.address && b.address && a.address === b.address;
      if (sameHome) continue; // reported at household level instead
      out.push({
        code: "VAN_INCOMPATIBLE",
        severity: "conflict",
        message: `${a.name} and ${b.name} are flagged incompatible and are on the same van.`,
      });
    }
  }
  if (settings.vanCapacity !== null && manifest.length > settings.vanCapacity) {
    out.push({
      code: "VAN_OVER_CAPACITY",
      severity: "conflict",
      message: `${manifest.length} dogs exceeds the van capacity of ${settings.vanCapacity}.`,
    });
  }
  return out;
}

/** Checks a proposed staff move before it is written. */
export function validateVanMove(
  dog: Dog,
  targetVanIndex: number,
  dogsAlreadyOnTarget: Dog[],
  settings: AppSettings
): Reason[] {
  const out: Reason[] = [];
  const others = dogsAlreadyOnTarget.filter((d) => d.id !== dog.id);

  for (const other of others) {
    if (areIncompatible(dog, other)) {
      out.push({
        code: "VAN_INCOMPATIBLE",
        severity: "conflict",
        message: `${dog.name} and ${other.name} are flagged incompatible. Putting them on Van ${targetVanIndex + 1} confines them together for the whole run.`,
      });
    }
  }
  if (settings.vanCapacity !== null && others.length + 1 > settings.vanCapacity) {
    out.push({
      code: "VAN_OVER_CAPACITY",
      severity: "conflict",
      message: `Van ${targetVanIndex + 1} is at its capacity of ${settings.vanCapacity}.`,
    });
  }
  return out;
}

/* ---------------- route construction ---------------- */

/**
 * Ordering optimises on TIME, not distance. With a real traffic-aware matrix
 * those differ: the shortest route through Singapore at 8am is often not the
 * quickest one, and the driver cares about the clock.
 */
function tourSeconds(stops: Household[], depot: Point, travel: TravelMatrix): number {
  if (!stops.length) return 0;
  let total = 0;
  let cursor: Point = depot;
  for (const s of stops) {
    total += travel.leg(cursor, s).seconds;
    cursor = s;
  }
  return total + travel.leg(cursor, depot).seconds;
}

function nearestNeighbour(
  stops: Household[],
  depot: Point,
  travel: TravelMatrix
): Household[] {
  const pool = [...stops];
  const out: Household[] = [];
  let cursor: Point = depot;

  while (pool.length) {
    let best = 0;
    let bestCost = Infinity;
    for (let i = 0; i < pool.length; i++) {
      const cost = travel.leg(cursor, pool[i]).seconds;
      if (cost < bestCost) {
        bestCost = cost;
        best = i;
      }
    }
    const [next] = pool.splice(best, 1);
    out.push(next);
    cursor = next;
  }
  return out;
}

function routeLength(stops: Household[], depot: Point, travel: TravelMatrix): number {
  if (!stops.length) return 0;
  let total = 0;
  let cursor: Point = depot;
  for (const s of stops) {
    total += travel.leg(cursor, s).km;
    cursor = s;
  }
  return total + travel.leg(cursor, depot).km;
}

/** 2-opt improvement over the closed depot→stops→depot tour. */
function twoOpt(stops: Household[], depot: Point, travel: TravelMatrix): Household[] {
  if (stops.length < 4) return stops;

  let best = [...stops];
  let bestCost = tourSeconds(best, depot, travel);
  let improved = true;
  let guard = 0;

  while (improved && guard < 60) {
    improved = false;
    guard++;
    for (let i = 0; i < best.length - 1; i++) {
      for (let k = i + 1; k < best.length; k++) {
        const candidate = [
          ...best.slice(0, i),
          ...best.slice(i, k + 1).reverse(),
          ...best.slice(k + 1),
        ];
        const cost = tourSeconds(candidate, depot, travel);
        if (cost < bestCost - 1e-9) {
          best = candidate;
          bestCost = cost;
          improved = true;
        }
      }
    }
  }
  return best;
}

export function reorderStops(
  stops: RouteStop[],
  from: number,
  to: number
): RouteStop[] {
  const out = [...stops];
  const [moved] = out.splice(from, 1);
  out.splice(to, 0, moved);
  return out;
}
