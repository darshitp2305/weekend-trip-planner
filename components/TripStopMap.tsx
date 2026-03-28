"use client";

import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import { sanitizeExternalNavigationUrl } from "../lib/urlSafety";

type TripStopPin = {
  id: string;
  label: string;
  day: number;
  type: "stay" | "food" | "activity";
  latitude: number;
  longitude: number;
  subtitle?: string;
  mapsUrl?: string;
};

type TripStopRoutePath = {
  day: number;
  points: Array<{
    latitude: number;
    longitude: number;
  }>;
};

type Props = {
  pins: TripStopPin[];
  routePaths?: TripStopRoutePath[];
  missingLocationCount?: number;
};

const LEAFLET_CSS_ID = "leaflet-stylesheet";
const DAY_COLORS = [
  "#0f766e",
  "#2563eb",
  "#db2777",
  "#d97706",
  "#7c3aed",
  "#059669",
  "#dc2626",
];

const TYPE_LABELS: Record<TripStopPin["type"], string> = {
  stay: "Stay",
  food: "Food",
  activity: "Activity",
};

function iconMarkup(type: TripStopPin["type"]) {
  if (type === "food") {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" class="trip-stop-marker__icon-svg">
        <path fill="currentColor" d="M7 2a1 1 0 0 1 1 1v6a3 3 0 0 1-2 2.82V22H4V11.82A3 3 0 0 1 2 9V3a1 1 0 1 1 2 0v6h1V3a1 1 0 1 1 2 0v6h1V3a1 1 0 0 1 1-1Zm10 0c1.66 0 3 1.79 3 4v7h-2v9h-2v-9h-2V6c0-2.21 1.34-4 3-4Z"/>
      </svg>
    `;
  }

  if (type === "stay") {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" class="trip-stop-marker__icon-svg">
        <path fill="currentColor" d="M12 3.1 4 9v11h5v-5h6v5h5V9l-8-5.9Zm0 2.48 5.5 4.06V18H17v-5H7v5H6.5V9.64L12 5.58Z"/>
      </svg>
    `;
  }

  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" class="trip-stop-marker__icon-svg">
      <path fill="currentColor" d="M19 4a1 1 0 0 1 1 1c0 2.54-1.77 4.66-4.15 5.2l-1.44 2.88 2.16 2.17a1 1 0 0 1 .24 1.05l-1.5 4a1 1 0 0 1-.93.65H10a1 1 0 0 1-.93-.65l-1.5-4a1 1 0 0 1 .24-1.05l2.16-2.17-1.44-2.88A5.34 5.34 0 0 1 4.38 5a1 1 0 1 1 2 0c0 1.84 1.36 3.36 3.13 3.6L12 8l2.49.6A3.66 3.66 0 0 0 17.62 5a1 1 0 0 1 1-1H19Zm-7 6.06-1.48.36 1.16 2.31c.19.39.12.86-.18 1.17l-1.68 1.68.92 2.42h2.52l.92-2.42-1.68-1.68a1 1 0 0 1-.18-1.17l1.16-2.31-1.48-.36Z"/>
    </svg>
  `;
}

function ensureLeafletStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById(LEAFLET_CSS_ID)) return;

  const link = document.createElement("link");
  link.id = LEAFLET_CSS_ID;
  link.rel = "stylesheet";
  link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
  link.integrity = "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=";
  link.crossOrigin = "";
  document.head.appendChild(link);
}

function colorForDay(day: number) {
  return DAY_COLORS[(day - 1) % DAY_COLORS.length];
}

function uniqueDays(pins: TripStopPin[]) {
  return Array.from(new Set(pins.map((pin) => pin.day))).sort((a, b) => a - b);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function jitterDuplicatePins(pins: TripStopPin[]) {
  const counts = new Map<string, number>();

  return pins.map((pin) => {
    const key = `${pin.latitude.toFixed(5)}:${pin.longitude.toFixed(5)}`;
    const duplicateIndex = counts.get(key) ?? 0;
    counts.set(key, duplicateIndex + 1);

    if (duplicateIndex === 0) {
      return pin;
    }

    const angle = duplicateIndex * (Math.PI / 3);
    const radius = 0.0012 + Math.floor(duplicateIndex / 6) * 0.0005;

    return {
      ...pin,
      latitude: pin.latitude + Math.sin(angle) * radius,
      longitude: pin.longitude + Math.cos(angle) * radius,
    };
  });
}

function buildMarkerIcon(pin: TripStopPin) {
  const color = colorForDay(pin.day);
  const shapeClass =
    pin.type === "stay"
      ? "trip-stop-marker--stay"
      : pin.type === "food"
        ? "trip-stop-marker--food"
        : "trip-stop-marker--activity";

  return L.divIcon({
    className: "trip-stop-marker-wrapper",
    html: `
      <div class="trip-stop-marker ${shapeClass}" style="--marker-color:${color}">
        <span class="trip-stop-marker__day">${pin.day}</span>
        <span class="trip-stop-marker__type">${iconMarkup(pin.type)}</span>
      </div>
    `,
    iconSize: [42, 54],
    iconAnchor: [21, 47],
    popupAnchor: [0, -42],
  });
}

function popupMarkup(pin: TripStopPin) {
  const title = escapeHtml(pin.label);
  const subtitle = pin.subtitle ? escapeHtml(pin.subtitle) : "";
  const type = TYPE_LABELS[pin.type];
  const action = pin.mapsUrl
    ? `<a href="${escapeHtml(pin.mapsUrl)}" target="_blank" rel="noreferrer" class="trip-stop-popup__link">Open in maps</a>`
    : "";

  return `
    <div class="trip-stop-popup">
      <div class="trip-stop-popup__eyebrow">Day ${pin.day} &middot; ${type}</div>
      <div class="trip-stop-popup__title">${title}</div>
      ${subtitle ? `<div class="trip-stop-popup__subtitle">${subtitle}</div>` : ""}
      ${action}
    </div>
  `;
}

export default function TripStopMap({
  pins,
  routePaths = [],
  missingLocationCount = 0,
}: Props) {
  const mapRef = useRef<L.Map | null>(null);
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const routesLayerRef = useRef<L.LayerGroup | null>(null);

  const mappedPins = useMemo(
    () =>
      jitterDuplicatePins(
        pins
          .filter(
            (pin) =>
              Number.isFinite(pin.latitude) && Number.isFinite(pin.longitude)
          )
          .map((pin) => ({
            ...pin,
            mapsUrl: sanitizeExternalNavigationUrl(pin.mapsUrl),
          }))
      ),
    [pins]
  );

  const dayList = useMemo(() => uniqueDays(mappedPins), [mappedPins]);

  useEffect(() => {
    ensureLeafletStyles();

    if (!mapElementRef.current || mapRef.current || mappedPins.length === 0) {
      return;
    }

    const map = L.map(mapElementRef.current, {
      zoomControl: false,
      attributionControl: false,
      scrollWheelZoom: false,
    });

    L.control
      .zoom({
        position: "bottomright",
      })
      .addTo(map);

    L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
      maxZoom: 17,
      subdomains: ["a", "b", "c"],
      attribution:
        'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
    }).addTo(map);

    mapRef.current = map;
    markersLayerRef.current = L.layerGroup().addTo(map);
    routesLayerRef.current = L.layerGroup().addTo(map);

    return () => {
      markersLayerRef.current?.clearLayers();
      routesLayerRef.current?.clearLayers();
      map.remove();
      mapRef.current = null;
      markersLayerRef.current = null;
      routesLayerRef.current = null;
    };
  }, [mappedPins.length]);

  useEffect(() => {
    const map = mapRef.current;
    const markersLayer = markersLayerRef.current;
    const routesLayer = routesLayerRef.current;

    if (!map || !markersLayer || !routesLayer) {
      return;
    }

    markersLayer.clearLayers();
    routesLayer.clearLayers();

    if (mappedPins.length === 0) {
      return;
    }

    const bounds = L.latLngBounds(
      mappedPins.map((pin) => [pin.latitude, pin.longitude] as L.LatLngTuple)
    );

    routePaths.forEach((routePath) => {
      const validPoints = routePath.points.filter(
        (point) =>
          Number.isFinite(point.latitude) && Number.isFinite(point.longitude)
      );

      if (validPoints.length < 2) return;

      const latLngs = validPoints.map(
        (point) => [point.latitude, point.longitude] as L.LatLngTuple
      );

      L.polyline(latLngs, {
        color: "rgba(255,255,255,0.96)",
        weight: 14,
        opacity: 0.95,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(routesLayer);

      L.polyline(latLngs, {
        color: colorForDay(routePath.day),
        weight: 8,
        opacity: 0.98,
        dashArray: validPoints.length > 2 ? "18 12" : undefined,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(routesLayer);
    });

    mappedPins.forEach((pin) => {
      const marker = L.marker([pin.latitude, pin.longitude], {
        icon: buildMarkerIcon(pin),
        keyboard: true,
      });

      marker.bindPopup(popupMarkup(pin), {
        maxWidth: 280,
        className: "trip-stop-popup-shell",
      });

      markersLayer.addLayer(marker);
    });

    if (mappedPins.length === 1) {
      map.setView([mappedPins[0].latitude, mappedPins[0].longitude], 14, {
        animate: false,
      });
      return;
    }

    map.fitBounds(bounds, {
      padding: [56, 56],
      maxZoom: 15,
      animate: false,
    });
  }, [mappedPins, routePaths]);

  if (mappedPins.length === 0) {
    return (
      <section className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold text-slate-950 dark:text-slate-100">Trip map</h2>
          <p className="text-sm leading-5 text-slate-600 dark:text-slate-300">
            This trip does not have enough location coordinates yet to render a
            map for the selected stays, food stops, and activities.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <style jsx>{`
        .trip-stop-map-shell :global(.leaflet-container) {
          height: 100%;
          width: 100%;
          border-radius: 1.2rem;
          font-family: inherit;
        }

        .trip-stop-map-shell :global(.leaflet-control-zoom) {
          overflow: hidden;
          border: 1px solid rgba(148, 163, 184, 0.28);
          border-radius: 9999px;
          box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
        }

        .trip-stop-map-shell :global(.leaflet-control-zoom a) {
          width: 38px;
          height: 38px;
          line-height: 38px;
          color: #0f172a;
        }

        .trip-stop-map-shell :global(.trip-stop-marker-wrapper) {
          background: transparent;
          border: 0;
        }

        .trip-stop-map-shell :global(.trip-stop-marker) {
          position: relative;
          display: flex;
          height: 42px;
          width: 42px;
          align-items: center;
          justify-content: center;
          background: var(--marker-color);
          color: white;
          border: 4px solid white;
          box-shadow: 0 12px 28px rgba(15, 23, 42, 0.28);
        }

        .trip-stop-map-shell :global(.trip-stop-marker--stay) {
          border-radius: 22px 22px 22px 7px;
          transform: rotate(-45deg);
        }

        .trip-stop-map-shell :global(.trip-stop-marker--food) {
          border-radius: 12px;
          transform: rotate(45deg);
        }

        .trip-stop-map-shell :global(.trip-stop-marker--activity) {
          border-radius: 9999px;
        }

        .trip-stop-map-shell :global(.trip-stop-marker__day),
        .trip-stop-map-shell :global(.trip-stop-marker__type) {
          position: absolute;
          font-weight: 700;
          line-height: 1;
          transform: rotate(0deg);
        }

        .trip-stop-map-shell :global(.trip-stop-marker--stay .trip-stop-marker__day),
        .trip-stop-map-shell :global(.trip-stop-marker--stay .trip-stop-marker__type) {
          transform: rotate(45deg);
        }

        .trip-stop-map-shell :global(.trip-stop-marker--food .trip-stop-marker__day),
        .trip-stop-map-shell :global(.trip-stop-marker--food .trip-stop-marker__type) {
          transform: rotate(-45deg);
        }

        .trip-stop-map-shell :global(.trip-stop-marker__day) {
          top: 8px;
          font-size: 13px;
        }

        .trip-stop-map-shell :global(.trip-stop-marker__type) {
          bottom: -18px;
          display: inline-flex;
          height: 22px;
          width: 22px;
          align-items: center;
          justify-content: center;
          border-radius: 9999px;
          background: rgba(255, 255, 255, 0.96);
          color: #0f172a;
          box-shadow: 0 6px 14px rgba(15, 23, 42, 0.18);
          text-shadow: 0 1px 0 rgba(255, 255, 255, 0.85);
        }

        .trip-stop-map-shell :global(.trip-stop-marker__icon-svg) {
          height: 12px;
          width: 12px;
        }

        .trip-stop-map-shell :global(.trip-stop-popup-shell .leaflet-popup-content-wrapper) {
          border-radius: 1rem;
          box-shadow: 0 18px 42px rgba(15, 23, 42, 0.18);
        }

        .trip-stop-map-shell :global(.trip-stop-popup-shell .leaflet-popup-content) {
          margin: 0;
        }

        .trip-stop-map-shell :global(.trip-stop-popup) {
          padding: 0.9rem 1rem;
        }

        .trip-stop-map-shell :global(.trip-stop-popup__eyebrow) {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.14em;
          color: #64748b;
        }

        .trip-stop-map-shell :global(.trip-stop-popup__title) {
          margin-top: 0.35rem;
          font-size: 15px;
          font-weight: 700;
          color: #020617;
        }

        .trip-stop-map-shell :global(.trip-stop-popup__subtitle) {
          margin-top: 0.35rem;
          font-size: 13px;
          line-height: 1.5;
          color: #475569;
        }

        .trip-stop-map-shell :global(.trip-stop-popup__link) {
          display: inline-flex;
          margin-top: 0.7rem;
          align-items: center;
          border-radius: 9999px;
          border: 1px solid rgba(148, 163, 184, 0.28);
          background: #f8fafc;
          padding: 0.4rem 0.75rem;
          font-size: 12px;
          font-weight: 600;
          color: #0f172a;
          text-decoration: none;
        }
      `}</style>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-600 dark:text-violet-300">
            Trip map
          </div>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">
            Selected stays, meals, and activities on a real map
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
            The map updates from your itinerary builder selections. Day colors stay
            consistent, marker shapes identify the stop type, and each day gets its
            own route line to make the trip easier to read.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
            {mappedPins.length} mapped stop{mappedPins.length === 1 ? "" : "s"}
          </span>
          {missingLocationCount > 0 ? (
            <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
              {missingLocationCount} without coordinates
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-5 grid items-start gap-4 xl:grid-cols-[minmax(0,1.45fr)_340px]">
        <div className="trip-stop-map-shell h-[520px] self-start overflow-hidden rounded-[1.4rem] border border-slate-200 bg-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.4)] dark:border-slate-700 dark:bg-slate-800">
          <div ref={mapElementRef} className="h-full w-full" />
        </div>

        <div className="flex h-[520px] flex-col gap-4">
          <div className="rounded-[1.2rem] border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/80">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
              Legend
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {(["stay", "food", "activity"] as const).map((type) => (
                <span
                  key={type}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-white">
                    <span
                      className="inline-flex h-3 w-3 items-center justify-center"
                      dangerouslySetInnerHTML={{ __html: iconMarkup(type) }}
                    />
                  </span>
                  {TYPE_LABELS[type]}
                </span>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {dayList.map((day) => (
                <span
                  key={day}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  <span
                    className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white"
                    style={{ backgroundColor: colorForDay(day) }}
                  >
                    {day}
                  </span>
                  Day {day}
                </span>
              ))}
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col rounded-[1.2rem] border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
              Selected stops
            </div>

            <div className="mt-3 min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-1">
              {mappedPins.map((pin) => {
                const cardContent = (
                  <>
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white"
                        style={{ backgroundColor: colorForDay(pin.day) }}
                      >
                        {pin.day}
                      </span>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                        {TYPE_LABELS[pin.type]}
                      </div>
                    </div>

                    <div className="mt-2 text-sm font-semibold text-slate-950 dark:text-slate-100">
                      {pin.label}
                    </div>

                    {pin.subtitle ? (
                      <div className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
                        {pin.subtitle}
                      </div>
                    ) : null}
                  </>
                );

                return pin.mapsUrl ? (
                  <a
                    key={pin.id}
                    href={pin.mapsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-[1rem] border border-slate-200 bg-slate-50 p-3 transition hover:-translate-y-0.5 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/80 dark:hover:bg-slate-800"
                  >
                    {cardContent}
                  </a>
                ) : (
                  <div
                    key={pin.id}
                    className="rounded-[1rem] border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/80"
                  >
                    {cardContent}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
