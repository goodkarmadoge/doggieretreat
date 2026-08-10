import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, Printer, RotateCcw, Ruler, Waypoints } from "lucide-react";
import clsx from "clsx";
import L from "leaflet";
import { MapContainer, Marker, Polyline, Popup, TileLayer } from "react-leaflet";
import { PageShell, useOperatingDate } from "@/App";
import {
  ColorBadge, CopyButton, DateNav, EmptyState, LockButton, ReasonList,
  SectionTitle, StatusPill,
} from "@/components/ui";
import { useDogMap, useSettings, useVanOverrides } from "@/hooks/useData";
import { useTransportPlan } from "@/hooks/usePlans";
import {
  clearVanAssignments, saveRouteOrder, setVanAssignmentForDogs, toggleRouteLock,
} from "@/db/repository";
import { reorderStops, validateVanMove } from "@/services/routing/generateTransportRoute";
import type { Dog, Reason } from "@/models/types";

const VAN_COLORS = ["#146A60", "#A8730A", "#7A4FA3", "#2E7D4F"];

/** Vans roll at these times; kept in step with usePlans. */
const DEPART_HOUR = { pickup: 8, dropoff: 18 } as const;

function fmtMins(total: number): string {
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Wall-clock estimate for a stop, given the van leaves base on the hour. */
function clockAt(mode: "pickup" | "dropoff", minutesFromBase: number): string {
  const d = new Date();
  d.setHours(DEPART_HOUR[mode], 0, 0, 0);
  d.setMinutes(d.getMinutes() + minutesFromBase);
  return d.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit", hour12: false });
}

const numberIcon = (n: number, color: string) =>
  L.divIcon({
    className: "",
    html: `<div style="background:${color};color:#fff;width:24px;height:24px;border-radius:50%;
      display:flex;align-items:center;justify-content:center;font:700 12px/1 ui-monospace,monospace;
      box-shadow:0 1px 4px rgba(0,0,0,.4)">${n}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });

const depotIcon = L.divIcon({
  className: "",
  html: `<div style="background:#0E1614;color:#fff;padding:3px 7px;border-radius:4px;
    font:700 11px/1.2 system-ui;box-shadow:0 1px 4px rgba(0,0,0,.4);white-space:nowrap">Retreat</div>`,
  iconSize: [64, 20],
  iconAnchor: [32, 10],
});

export default function Transportation() {
  const { date, setDate } = useOperatingDate();
  const [mode, setMode] = useState<"pickup" | "dropoff">("pickup");
  const settings = useSettings();
  const dogMap = useDogMap();
  const vanOverrides = useVanOverrides();
  const { plan, travelSource, travelNote, loading } = useTransportPlan(date, mode);

  const [blocked, setBlocked] = useState<
    { dogIds: string[]; label: string; target: number; reasons: Reason[] } | null
  >(null);

  const depot: [number, number] = [settings.facilityLat, settings.facilityLng];
  const dogsOf = (ids: string[]) => ids.map((id) => dogMap.get(id)).filter((d): d is Dog => !!d);

  const staffAssigned = vanOverrides.filter(
    (o) => o.date === date && o.type === mode
  ).length;

  /**
   * Staff are never blocked from moving a dog, but a move that puts two
   * incompatible dogs in the same vehicle has to be acknowledged first.
   */
  const attemptMove = (
    dogIds: string[],
    target: number,
    label: string,
    force = false
  ) => {
    const onTarget = dogsOf(
      (plan.vans[target]?.stops ?? []).flatMap((s) => s.dogIds)
    );
    const seen = new Set<string>();
    const reasons = dogsOf(dogIds)
      .flatMap((dog) => validateVanMove(dog, target, onTarget, settings))
      .filter((r) => {
        if (seen.has(r.message)) return false;
        seen.add(r.message);
        return true;
      });

    if (reasons.length && !force) {
      setBlocked({ dogIds, label, target, reasons });
      return;
    }
    void setVanAssignmentForDogs(date, mode, dogIds, target);
    setBlocked(null);
  };

  const allStops = plan.vans.flatMap((v) => v.stops);
  const center = useMemo<[number, number]>(() => {
    if (!allStops.length) return depot;
    const lat = allStops.reduce((s, x) => s + x.lat, 0) / allStops.length;
    const lng = allStops.reduce((s, x) => s + x.lng, 0) / allStops.length;
    return [lat, lng];
  }, [allStops, settings.facilityLat, settings.facilityLng]);

  const move = async (vanIndex: number, from: number, to: number) => {
    const van = plan.vans[vanIndex];
    if (!van || to < 0 || to >= van.stops.length) return;
    const next = reorderStops(van.stops, from, to);
    await saveRouteOrder(date, mode, vanIndex, next.map((s) => s.householdKey));
  };

  const summary = [
    `${date} ${mode === "pickup" ? "morning pickup" : "evening drop-off"}`,
    ...plan.vans.flatMap((v) =>
      v.stops.length
        ? [
            `Van ${v.vanIndex + 1} (${v.distanceKm.toFixed(1)} km):`,
            ...v.stops.map(
              (s, i) => `  ${i + 1}. ${dogsOf(s.dogIds).map((d) => d.name).join(" + ")} — ${s.address}`
            ),
          ]
        : []
    ),
    ...(plan.needsReview.length
      ? [`NEEDS REVIEW: ${plan.needsReview.map((r) => dogMap.get(r.dogId)?.name).join(", ")}`]
      : []),
  ].join("\n");

  const totalStops = allStops.length;
  const totalDogs = allStops.reduce((n, s) => n + s.dogIds.length, 0);

  return (
    <PageShell
      title="Transportation"
      description="Stops are grouped by address — several dogs at one home are a single stop."
      actions={<DateNav date={date} onChange={setDate} />}
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-0.5 rounded bg-ink-100 p-0.5">
          {(["pickup", "dropoff"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={clsx(
                "rounded px-3 py-1.5 text-[13px] font-semibold",
                mode === m ? "bg-white text-ink-900 shadow-sm" : "text-ink-500"
              )}
            >
              {m === "pickup" ? "Morning pickup" : "Evening drop-off"}
            </button>
          ))}
        </div>
        <CopyButton text={summary} label="Copy for WhatsApp" />
        <button className="btn" onClick={() => window.print()}>
          <Printer size={13} /> Print run sheet
        </button>
        {staffAssigned > 0 && (
          <button className="btn" onClick={() => clearVanAssignments(date, mode)}>
            <RotateCcw size={13} /> Reset {staffAssigned} staff assignment
            {staffAssigned === 1 ? "" : "s"}
          </button>
        )}
        <span className="text-[12px] text-ink-500">
          {totalStops} stops · {totalDogs} dogs · {settings.vanCount} vans
        </span>
      </div>

      <p
        className={clsx(
          "flex flex-wrap items-center gap-1.5 rounded px-3 py-1.5 text-[11.5px]",
          travelSource === "google"
            ? "bg-signal-greenSoft text-signal-green"
            : "bg-ink-100 text-ink-500"
        )}
      >
        {travelSource === "google" ? <Waypoints size={13} /> : <Ruler size={13} />}
        <span>
          All runs start and end at <b>{settings.facilityName}, {settings.facilityAddress}</b>.{" "}
          {travelSource === "google" ? (
            <>
              Ordered by <b>live road distance and traffic-aware drive time</b> from the Google
              Routes API, for a {mode === "pickup" ? "08:00" : "18:00"} departure.
            </>
          ) : (
            <>
              Distances are <b>straight-line estimates</b>.{" "}
              {travelNote ?? "Live routing is not active."}
            </>
          )}
          {loading && <span className="ml-1 opacity-70">Updating with live traffic…</span>}
        </span>
      </p>

      {blocked && (
        <div className="rounded border border-signal-red bg-signal-redSoft p-3">
          <p className="text-[13px] font-bold text-signal-red">
            Conflict — moving {blocked.label} to Van {blocked.target + 1} breaks a hard rule
          </p>
          <div className="mt-2"><ReasonList reasons={blocked.reasons} /></div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button className="btn" onClick={() => setBlocked(null)}>Cancel</button>
            <button
              className="btn border-signal-red bg-signal-red text-white"
              onClick={() =>
                attemptMove(blocked.dogIds, blocked.target, blocked.label, true)
              }
            >
              Move anyway and accept the conflict
            </button>
          </div>
        </div>
      )}

      {totalStops === 0 ? (
        <div className="card">
          <EmptyState
            title={`No ${mode === "pickup" ? "pickup" : "drop-off"} requests for this date`}
            hint="No attending dog has this transport requirement. Set defaults on a dog profile, or add a one-off from the command bar on Today."
          />
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
          <div className="card overflow-hidden" style={{ minHeight: 460 }}>
            <MapContainer center={center} zoom={11} style={{ height: 460, width: "100%" }} scrollWheelZoom>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <Marker position={depot} icon={depotIcon}>
                <Popup>{settings.facilityName}<br />{settings.facilityAddress}</Popup>
              </Marker>

              {plan.vans.map((van) => {
                const color = VAN_COLORS[van.vanIndex % VAN_COLORS.length];
                if (!van.stops.length) return null;
                const line: [number, number][] = [
                  depot,
                  ...van.stops.map((s) => [s.lat, s.lng] as [number, number]),
                  depot,
                ];
                return (
                  <div key={van.vanIndex}>
                    <Polyline positions={line} pathOptions={{ color, weight: 3, opacity: 0.75 }} />
                    {van.stops.map((stop, i) => (
                      <Marker
                        key={stop.householdKey}
                        position={[stop.lat, stop.lng]}
                        icon={numberIcon(i + 1, color)}
                      >
                        <Popup>
                          <b>Stop {i + 1} · Van {van.vanIndex + 1}</b>
                          <br />
                          {dogsOf(stop.dogIds).map((d) => d.name).join(", ")}
                          <br />
                          {stop.address}
                        </Popup>
                      </Marker>
                    ))}
                  </div>
                );
              })}
            </MapContainer>
          </div>

          <div className="flex flex-col gap-3">
            {plan.vans.map((van) => {
              const color = VAN_COLORS[van.vanIndex % VAN_COLORS.length];
              if (!van.stops.length) return null;
              return (
                <section key={van.vanIndex} className="card flex flex-col gap-2 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="flex items-center gap-2 text-[15px] font-bold tracking-tight">
                      <span className="inline-block h-3 w-3 rounded-sm" style={{ background: color }} />
                      Van {van.vanIndex + 1}
                      <span className="font-mono text-[12px] font-normal text-ink-500">
                        {van.distanceKm.toFixed(1)} km
                        {van.durationMinutes ? ` · ${fmtMins(van.durationMinutes)}` : ""} ·{" "}
                        {van.stops.length} {van.stops.length === 1 ? "stop" : "stops"}
                      </span>
                    </h3>
                    <div className="flex items-center gap-1.5">
                      <StatusPill status={van.status} />
                      <LockButton
                        locked={van.locked}
                        onToggle={() =>
                          toggleRouteLock(
                            date, mode, van.vanIndex,
                            van.stops.map((s) => s.householdKey), !van.locked
                          )
                        }
                      />
                    </div>
                  </div>

                  <ol className="flex flex-col gap-1">
                    {van.stops.map((stop, i) => (
                      <li key={stop.householdKey} className="flex items-start gap-2 rounded bg-ink-50 px-2 py-1.5">
                        <span
                          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-bold text-white"
                          style={{ background: color }}
                        >
                          {i + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-col gap-1">
                            {dogsOf(stop.dogIds).map((d) => (
                              <div key={d.id} className="flex flex-wrap items-center gap-1.5">
                                <Link
                                  to={`/dogs/${d.id}`}
                                  className="flex items-center gap-1 text-[13px] font-semibold hover:text-brand-700"
                                >
                                  {d.name}
                                  <ColorBadge color={d.behaviorColor} size="sm" />
                                </Link>
                                {/* Per-dog move only matters when the stop has
                                    several dogs — otherwise it duplicates the
                                    whole-stop control below. */}
                                {settings.vanCount > 1 && stop.dogIds.length > 1 && (
                                  <select
                                    className="rounded border border-ink-300 bg-white px-1 py-0.5 text-[11px]"
                                    value=""
                                    onChange={(e) =>
                                      e.target.value !== "" &&
                                      attemptMove([d.id], Number(e.target.value), d.name)
                                    }
                                    aria-label={`Move ${d.name} to another van`}
                                  >
                                    <option value="">Move {d.name}…</option>
                                    {Array.from({ length: settings.vanCount })
                                      .map((_, vi) => vi)
                                      .filter((vi) => vi !== van.vanIndex)
                                      .map((vi) => (
                                        <option key={vi} value={vi}>Van {vi + 1}</option>
                                      ))}
                                  </select>
                                )}
                              </div>
                            ))}
                          </div>

                          <p className="mt-0.5 font-mono text-[11px] leading-snug text-ink-500">
                            {stop.address}
                          </p>
                          {stop.etaMinutes !== undefined && (
                            <p className="font-mono text-[11px] text-ink-400">
                              {mode === "pickup" ? "Arrive" : "Drop"} ~{clockAt(mode, stop.etaMinutes)}
                              <span className="opacity-70">
                                {" "}· {fmtMins(stop.etaMinutes)} from base
                                {stop.legMinutes ? ` · ${fmtMins(stop.legMinutes)} leg` : ""}
                              </span>
                            </p>
                          )}
                          {stop.ownerNames.length > 0 && (
                            <p className="text-[11px] text-ink-400">{stop.ownerNames.join(", ")}</p>
                          )}

                          {settings.vanCount > 1 && (
                            <select
                              className="mt-1 rounded border border-ink-300 bg-white px-1.5 py-0.5 text-[11px]"
                              value=""
                              onChange={(e) =>
                                e.target.value !== "" &&
                                attemptMove(
                                  stop.dogIds,
                                  Number(e.target.value),
                                  stop.dogIds.length > 1
                                    ? `all ${stop.dogIds.length} dogs at this address`
                                    : dogMap.get(stop.dogIds[0])?.name ?? "this dog"
                                )
                              }
                              aria-label="Move this whole stop to another van"
                            >
                              <option value="">
                                {stop.dogIds.length > 1 ? "Move whole stop…" : "Move to…"}
                              </option>
                              {Array.from({ length: settings.vanCount })
                                .map((_, vi) => vi)
                                .filter((vi) => vi !== van.vanIndex)
                                .map((vi) => (
                                  <option key={vi} value={vi}>Van {vi + 1}</option>
                                ))}
                            </select>
                          )}

                          {stop.reasons.length > 0 && (
                            <div className="mt-1"><ReasonList reasons={stop.reasons} /></div>
                          )}
                        </div>
                        <span className="flex shrink-0 flex-col gap-0.5">
                          <button
                            className="rounded border border-ink-300 bg-white px-1 py-0.5 text-ink-500 hover:text-ink-900 disabled:opacity-30"
                            disabled={i === 0}
                            onClick={() => move(van.vanIndex, i, i - 1)}
                            aria-label={`Move stop ${i + 1} earlier`}
                          >
                            <ArrowUp size={11} />
                          </button>
                          <button
                            className="rounded border border-ink-300 bg-white px-1 py-0.5 text-ink-500 hover:text-ink-900 disabled:opacity-30"
                            disabled={i === van.stops.length - 1}
                            onClick={() => move(van.vanIndex, i, i + 1)}
                            aria-label={`Move stop ${i + 1} later`}
                          >
                            <ArrowDown size={11} />
                          </button>
                        </span>
                      </li>
                    ))}
                  </ol>
                </section>
              );
            })}
          </div>
        </div>
      )}

      {plan.needsReview.length > 0 && (
        <section className="card border-signal-amber/40 p-3">
          <SectionTitle right={<StatusPill status="warning" />}>Needs staff review</SectionTitle>
          <ul className="mt-2 grid gap-2 md:grid-cols-2">
            {plan.needsReview.map((r) => (
              <li key={r.dogId} className="flex flex-col gap-1 rounded bg-ink-50 p-2">
                <span className="flex items-center gap-2">
                  <ColorBadge color={dogMap.get(r.dogId)?.behaviorColor ?? null} size="sm" />
                  <Link to={`/dogs/${r.dogId}`} className="text-[13px] font-semibold hover:text-brand-700">
                    {dogMap.get(r.dogId)?.name}
                  </Link>
                </span>
                <ReasonList reasons={r.reasons} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageShell>
  );
}
