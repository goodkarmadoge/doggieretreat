import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, Printer } from "lucide-react";
import clsx from "clsx";
import L from "leaflet";
import { MapContainer, Marker, Polyline, Popup, TileLayer } from "react-leaflet";
import { PageShell, useOperatingDate } from "@/App";
import {
  ColorBadge, CopyButton, DateNav, EmptyState, LockButton, ReasonList,
  SectionTitle, StatusPill,
} from "@/components/ui";
import { useDogMap, useRouteLocks, useSettings } from "@/hooks/useData";
import { useTransportPlan } from "@/hooks/usePlans";
import { saveRouteOrder, toggleRouteLock } from "@/db/repository";
import { reorderStops } from "@/services/routing/generateTransportRoute";
import type { Dog } from "@/models/types";

const VAN_COLORS = ["#146A60", "#A8730A", "#7A4FA3", "#2E7D4F"];

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
  const locks = useRouteLocks();
  const plan = useTransportPlan(date, mode);

  const depot: [number, number] = [settings.facilityLat, settings.facilityLng];
  const dogsOf = (ids: string[]) => ids.map((id) => dogMap.get(id)).filter((d): d is Dog => !!d);

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
        <span className="text-[12px] text-ink-500">
          {totalStops} stops · {totalDogs} dogs · {settings.vanCount} vans
        </span>
      </div>

      <p className="rounded bg-ink-100 px-3 py-1.5 text-[11.5px] text-ink-500">
        Distances are straight-line estimates between coordinates. There is no live traffic or
        road-network routing in this prototype.
      </p>

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
                        {van.distanceKm.toFixed(1)} km · {van.stops.length}{" "}
                        {van.stops.length === 1 ? "stop" : "stops"}
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
                          <div className="flex flex-wrap items-center gap-1.5">
                            {dogsOf(stop.dogIds).map((d) => (
                              <Link
                                key={d.id}
                                to={`/dogs/${d.id}`}
                                className="flex items-center gap-1 text-[13px] font-semibold hover:text-brand-700"
                              >
                                {d.name}
                                <ColorBadge color={d.behaviorColor} size="sm" />
                              </Link>
                            ))}
                          </div>
                          <p className="font-mono text-[11px] leading-snug text-ink-500">{stop.address}</p>
                          {stop.ownerNames.length > 0 && (
                            <p className="text-[11px] text-ink-400">{stop.ownerNames.join(", ")}</p>
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
