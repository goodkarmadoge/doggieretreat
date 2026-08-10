import type {
  AppSettings,
  Dog,
  Reason,
  RouteLock,
  RouteStop,
  TransportPlan,
  VanRoute,
} from "@/models/types";
import { areIncompatible } from "@/services/compatibility/compatibility";
import { groupIntoHouseholds, type Household } from "@/utils/household";
import { distanceKm, pathLengthKm, type Point } from "@/utils/geo";
import { statusOf } from "@/services/walkPlanner/generateWalkPlan";

/**
 * Transport planning.
 *
 * Two things this does that the original spec did not ask for, both agreed
 * with staff:
 *
 *  1. STOPS ARE HOUSEHOLDS, NOT DOGS. An owner is just a name, so a household
 *     is a normalized address. Three dogs at one condo produce one stop.
 *
 *  2. COMPATIBILITY APPLIES IN THE VAN. Two dogs flagged as incompatible are
 *     confined together for the length of a route with the driver driving,
 *     so a van manifest is checked exactly like a walk group or a floor.
 *     Dogs that live at the same address are exempt — they already cohabit —
 *     but the pairing is still surfaced as a warning.
 *
 * Red dogs follow the configured redVanPolicy. The default is "review": no van
 * rule for red dogs has been defined, so the system refuses to guess.
 */
export function generateTransportRoute(
  date: string,
  type: "pickup" | "dropoff",
  dogsNeedingTransport: Dog[],
  settings: AppSettings,
  locks: RouteLock[]
): TransportPlan {
  const depot: Point = { lat: settings.facilityLat, lng: settings.facilityLng };
  const needsReview: TransportPlan["needsReview"] = [];

  /* 1 — red-dog policy is applied before routing. */
  let routable = dogsNeedingTransport;
  if (settings.redVanPolicy === "review") {
    const reds = routable.filter((d) => d.behaviorColor === "red");
    for (const dog of reds) {
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

  /* 2 — collapse dogs into household stops. */
  const households = groupIntoHouseholds(routable).filter((h) => h.lat && h.lng);

  /* 3 — pack households into vans so no van carries an incompatible pair. */
  const vanCount = Math.max(1, settings.vanCount);
  const bins: Household[][] = Array.from({ length: vanCount }, () => []);

  const pressure = (h: Household) =>
    h.dogs.reduce((n, d) => n + d.incompatibleDogIds.length, 0);
  const ordered = [...households].sort((a, b) => pressure(b) - pressure(a));

  for (const h of ordered) {
    // Conflict-free vans first, then the least loaded of those, so the run
    // splits evenly instead of piling everything onto van 1.
    const eligible: number[] = [];
    for (let i = 0; i < bins.length; i++) {
      const manifest = bins[i].flatMap((x) => x.dogs);
      const clash = manifest.some((m) =>
        h.dogs.some((d) => areIncompatible(m, d))
      );
      if (clash) continue;
      if (settings.vanCapacity !== null) {
        const load = manifest.length + h.dogs.length;
        if (load > settings.vanCapacity) continue;
      }
      eligible.push(i);
    }

    eligible.sort((a, b) => {
      const la = bins[a].reduce((n, x) => n + x.dogs.length, 0);
      const lb = bins[b].reduce((n, x) => n + x.dogs.length, 0);
      if (la !== lb) return la - lb;
      return a - b;
    });

    const target = eligible.length ? eligible[0] : -1;

    if (target === -1) {
      // Every van has a conflict or is full — put the smallest van's worth
      // in review rather than knowingly loading a conflicting pair.
      for (const dog of h.dogs) {
        needsReview.push({
          dogId: dog.id,
          reasons: [{
            code: "NO_COMPATIBLE_VAN",
            severity: "conflict",
            message: `${dog.name} conflicts with a dog already on every available van. Add a van in Settings or move the run.`,
          }],
        });
      }
      continue;
    }
    bins[target].push(h);
  }

  /* 4 — order each van's stops: nearest neighbour, then a 2-opt pass. */
  const vans: VanRoute[] = bins.map((stopsForVan, vanIndex) => {
    const lock = locks.find(
      (l) => l.date === date && l.type === type && l.vanIndex === vanIndex
    );

    let sequence: Household[];
    if (lock) {
      const map = new Map(stopsForVan.map((h) => [h.key, h]));
      sequence = lock.stopOrder
        .map((k) => map.get(k))
        .filter((h): h is Household => !!h);
      for (const h of stopsForVan) if (!sequence.includes(h)) sequence.push(h);
    } else {
      sequence = twoOpt(nearestNeighbour(stopsForVan, depot), depot);
    }

    const stops: RouteStop[] = sequence.map((h) => ({
      householdKey: h.key,
      address: h.address,
      lat: h.lat,
      lng: h.lng,
      dogIds: h.dogs.map((d) => d.id),
      ownerNames: h.ownerNames,
      reasons: householdReasons(h),
    }));

    const manifest = sequence.flatMap((h) => h.dogs);
    const reasons = manifestReasons(manifest, settings);

    return {
      vanIndex,
      stops,
      distanceKm: routeLength(sequence, depot),
      status: statusOf(reasons.length ? reasons : stops.flatMap((s) => s.reasons)),
      locked: !!lock,
    };
  });

  return { date, type, vans, needsReview };
}

function householdReasons(h: Household): Reason[] {
  const out: Reason[] = [];
  for (let i = 0; i < h.dogs.length; i++) {
    for (let j = i + 1; j < h.dogs.length; j++) {
      if (areIncompatible(h.dogs[i], h.dogs[j])) {
        out.push({
          code: "SAME_HOUSEHOLD_CONFLICT",
          severity: "warning",
          message: `${h.dogs[i].name} and ${h.dogs[j].name} are flagged incompatible but share an address. Separate them in the van.`,
        });
      }
    }
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
      if (sameHome) continue; // already reported at household level
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

/* ---------------- route construction ---------------- */

function nearestNeighbour(stops: Household[], depot: Point): Household[] {
  const pool = [...stops];
  const out: Household[] = [];
  let cursor: Point = depot;

  while (pool.length) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < pool.length; i++) {
      const d = distanceKm(cursor, pool[i]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const [next] = pool.splice(best, 1);
    out.push(next);
    cursor = next;
  }
  return out;
}

function routeLength(stops: Household[], depot: Point): number {
  if (!stops.length) return 0;
  return pathLengthKm([depot, ...stops.map((s) => ({ lat: s.lat, lng: s.lng })), depot]);
}

/** Standard 2-opt improvement over the closed depot→stops→depot tour. */
function twoOpt(stops: Household[], depot: Point): Household[] {
  if (stops.length < 4) return stops;

  let best = [...stops];
  let bestLen = routeLength(best, depot);
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
        const len = routeLength(candidate, depot);
        if (len < bestLen - 1e-9) {
          best = candidate;
          bestLen = len;
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
