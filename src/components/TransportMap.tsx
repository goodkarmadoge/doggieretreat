import { useEffect, useState } from "react";
import {
  APIProvider,
  AdvancedMarker,
  InfoWindow,
  Map as GoogleMap,
  useMap,
} from "@vis.gl/react-google-maps";
import { useMapsConfig } from "@/hooks/useMapsConfig";

/**
 * Google Maps rendering of the day's van routes.
 *
 * Structural prop types rather than the planner's own: this draws points and
 * lines, and should not have to change when the route model gains a field.
 */

export interface MapStop {
  householdKey: string;
  lat: number;
  lng: number;
  address: string;
  dogIds: string[];
}

export interface MapVan {
  vanIndex: number;
  stops: MapStop[];
}

export interface TransportMapProps {
  center: [number, number];
  depot: [number, number];
  facilityName: string;
  facilityAddress: string;
  vans: MapVan[];
  /** Route colour per van, matching the run-sheet cards beside the map. */
  colorFor: (vanIndex: number) => string;
  /** Resolves stop dog IDs to display names for the info window. */
  namesFor: (dogIds: string[]) => string;
}

const MAP_HEIGHT = 460;

/** Zoom kept from the previous map so the default framing is unchanged. */
const DEFAULT_ZOOM = 11;

const toLatLng = ([lat, lng]: [number, number]) => ({ lat, lng });

/**
 * Polylines have no declarative component in the React wrapper, so each van's
 * line is drawn straight onto the map instance and torn down with the effect.
 */
function VanRoute({ path, color }: { path: google.maps.LatLngLiteral[]; color: string }) {
  const map = useMap();

  useEffect(() => {
    if (!map) return;
    const line = new google.maps.Polyline({
      path,
      map,
      strokeColor: color,
      strokeWeight: 3,
      strokeOpacity: 0.75,
    });
    return () => line.setMap(null);
  }, [map, path, color]);

  return null;
}

export default function TransportMap({
  center,
  depot,
  facilityName,
  facilityAddress,
  vans,
  colorFor,
  namesFor,
}: TransportMapProps) {
  const config = useMapsConfig();

  /** Which marker owns the open info window; null when none is open. */
  const [open, setOpen] = useState<string | null>(null);

  if (config === null) {
    return (
      <div
        className="flex items-center justify-center text-[12.5px] text-ink-400"
        style={{ height: MAP_HEIGHT }}
      >
        Loading map…
      </div>
    );
  }

  if (!config.configured || !config.key) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-2 p-6 text-center"
        style={{ height: MAP_HEIGHT }}
      >
        <p className="text-[13px] font-semibold">Map unavailable</p>
        <p className="max-w-[440px] text-[12.5px] text-ink-500">
          {config.message ??
            "No browser Maps key is configured, so the route map cannot load."}
        </p>
        <p className="max-w-[440px] text-[12px] text-ink-400">
          The run sheets and stop order beside this panel are unaffected — only
          the visual map needs the key.
        </p>
      </div>
    );
  }

  const depotPos = toLatLng(depot);

  return (
    <APIProvider apiKey={config.key}>
      <GoogleMap
        defaultCenter={toLatLng(center)}
        defaultZoom={DEFAULT_ZOOM}
        mapId={config.mapId}
        style={{ height: MAP_HEIGHT, width: "100%" }}
        gestureHandling="greedy"
        disableDefaultUI={false}
        streetViewControl={false}
        mapTypeControl={false}
        fullscreenControl={false}
        onClick={() => setOpen(null)}
      >
        <AdvancedMarker position={depotPos} onClick={() => setOpen("depot")}>
          <div
            style={{
              background: "#0E1614",
              color: "#fff",
              padding: "3px 7px",
              borderRadius: 4,
              font: "700 11px/1.2 system-ui",
              boxShadow: "0 1px 4px rgba(0,0,0,.4)",
              whiteSpace: "nowrap",
            }}
          >
            Retreat
          </div>
        </AdvancedMarker>

        {open === "depot" && (
          <InfoWindow position={depotPos} onCloseClick={() => setOpen(null)}>
            <b>{facilityName}</b>
            <br />
            {facilityAddress}
          </InfoWindow>
        )}

        {vans.map((van) => {
          if (!van.stops.length) return null;
          const color = colorFor(van.vanIndex);
          const path = [
            depotPos,
            ...van.stops.map((s) => ({ lat: s.lat, lng: s.lng })),
            depotPos,
          ];

          return (
            <VanRoute key={`route-${van.vanIndex}`} path={path} color={color} />
          );
        })}

        {vans.flatMap((van) => {
          const color = colorFor(van.vanIndex);
          return van.stops.map((stop, i) => {
            const pos = { lat: stop.lat, lng: stop.lng };
            const id = `${van.vanIndex}:${stop.householdKey}`;
            return (
              <AdvancedMarker key={id} position={pos} onClick={() => setOpen(id)}>
                <div
                  style={{
                    background: color,
                    color: "#fff",
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    font: "700 12px/1 ui-monospace,monospace",
                    boxShadow: "0 1px 4px rgba(0,0,0,.4)",
                  }}
                >
                  {i + 1}
                </div>
              </AdvancedMarker>
            );
          });
        })}

        {vans.flatMap((van) =>
          van.stops.map((stop, i) => {
            const id = `${van.vanIndex}:${stop.householdKey}`;
            if (open !== id) return null;
            return (
              <InfoWindow
                key={`info-${id}`}
                position={{ lat: stop.lat, lng: stop.lng }}
                onCloseClick={() => setOpen(null)}
              >
                <b>
                  Stop {i + 1} · Van {van.vanIndex + 1}
                </b>
                <br />
                {namesFor(stop.dogIds)}
                <br />
                {stop.address}
              </InfoWindow>
            );
          })
        )}
      </GoogleMap>
    </APIProvider>
  );
}
