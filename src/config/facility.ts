/**
 * The Doggie Retreat facility. Every route starts and ends here — morning
 * pickups run facility → stops → facility, evening drop-offs the same.
 *
 * COORDINATE PRECISION: lat/lng below are hand-set from the address, accurate
 * to roughly a block. That is fine for stop ORDERING at Singapore scale (the
 * nearest-neighbour comparison is between stops kilometres apart), but it is
 * not survey-grade. Replace with a real geocode when the Google Geocoding API
 * is wired up — see routing notes. Staff can also correct it in Settings.
 */
export const FACILITY = {
  name: "Doggie Retreat",
  address: "12 E Coast Rd, Singapore 428723",
  lat: 1.3056,
  lng: 103.9027,
} as const;

/**
 * Facility addresses used by earlier builds. Anyone who already has settings
 * saved in IndexedDB is still pointing at one of these, so the schema upgrade
 * migrates them forward — but only if they never customised it themselves.
 */
export const LEGACY_FACILITY_ADDRESSES = [
  "8 Jalan Kilang Barat, Singapore 159351",
];
