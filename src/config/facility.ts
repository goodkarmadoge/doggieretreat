/**
 * The Doggie Retreat facility. Every route starts and ends here — morning
 * pickups run facility → stops → facility, evening drop-offs the same.
 *
 * Coordinates are the Google Geocoding API result for this address
 * ("12 E Coast Rd, Singapore 428723", ROOFTOP match), not a hand estimate.
 * Staff can still correct them in Settings.
 */
export const FACILITY = {
  name: "Doggie Retreat",
  address: "12 E Coast Rd, Singapore 428723",
  lat: 1.3040364,
  lng: 103.9023636,
} as const;

/**
 * Facility positions used by earlier builds. Anyone with settings already in
 * IndexedDB is still pointing at one of these, so the schema upgrade migrates
 * them forward — but only when they never customised it themselves.
 *
 * Matched on address OR on a stale coordinate, because the East Coast Road
 * address shipped once with hand-set coordinates before it was geocoded.
 */
export const LEGACY_FACILITY_ADDRESSES = [
  "8 Jalan Kilang Barat, Singapore 159351",
];

/** [lat, lng] pairs that previously shipped as defaults. */
export const LEGACY_FACILITY_COORDS: Array<[number, number]> = [
  [1.288, 103.806],
  [1.3056, 103.9027],
];
