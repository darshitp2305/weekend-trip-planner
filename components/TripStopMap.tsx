"use client";

/**
 * Reusable UI component for the trip stop map section of the planner.
 * Keeping this logic in its own component makes the page-level containers easier to scan and keeps related rendering and state updates together.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import Image from "next/image";
import { sanitizeExternalNavigationUrl } from "../lib/urlSafety";

type TripStopPin = {
  id: string;
  label: string;
  day: number;
  type: "stay" | "food" | "activity";
  isDayStart?: boolean;
  isSyntheticStart?: boolean;
  latitude: number;
  longitude: number;
  subtitle?: string;
  mapsUrl?: string;
  rating?: number;
  photoUrl?: string;
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
  variant?: "full" | "compact";
  emptyStateDescription?: string;
  highlightedPinId?: string | null;
  fallbackCenter?: {
    latitude: number;
    longitude: number;
  };
  fallbackZoom?: number;
};

type PopupLayout = {
  left: number;
  top: number;
  placement: "above" | "below" | "left" | "right";
  anchorLeft?: number;
  anchorTop?: number;
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

function displayStopCount(pins: TripStopPin[]) {
  return pins.filter((pin) => !pin.isSyntheticStart).length;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function distanceBetweenPinsInKm(a: TripStopPin, b: TripStopPin) {
  const averageLatitudeRadians = ((a.latitude + b.latitude) / 2) * (Math.PI / 180);
  const latDistanceKm = (a.latitude - b.latitude) * 111;
  const lonDistanceKm =
    (a.longitude - b.longitude) * 111 * Math.cos(averageLatitudeRadians);

  return Math.sqrt(latDistanceKm ** 2 + lonDistanceKm ** 2);
}

function spreadNearbyPins(pins: TripStopPin[]) {
  const groups: Array<{
    centroidLatitude: number;
    centroidLongitude: number;
    pins: Array<{ pin: TripStopPin; originalIndex: number }>;
  }> = [];

  pins.forEach((pin, originalIndex) => {
    const group = groups.find(
      (candidate) =>
        distanceBetweenPinsInKm(pin, {
          ...pin,
          latitude: candidate.centroidLatitude,
          longitude: candidate.centroidLongitude,
        }) <= 0.35
    );

    if (!group) {
      groups.push({
        centroidLatitude: pin.latitude,
        centroidLongitude: pin.longitude,
        pins: [{ pin, originalIndex }],
      });
      return;
    }

    group.pins.push({ pin, originalIndex });
    const latitudeSum = group.pins.reduce((sum, entry) => sum + entry.pin.latitude, 0);
    const longitudeSum = group.pins.reduce(
      (sum, entry) => sum + entry.pin.longitude,
      0
    );
    group.centroidLatitude = latitudeSum / group.pins.length;
    group.centroidLongitude = longitudeSum / group.pins.length;
  });

  const spreadPins = new Array<TripStopPin>(pins.length);

  groups.forEach((group) => {
    if (group.pins.length === 1) {
      const entry = group.pins[0];
      spreadPins[entry.originalIndex] = entry.pin;
      return;
    }

    const sortedGroup = [...group.pins].sort((left, right) => {
      if (left.pin.isDayStart && !right.pin.isDayStart) return -1;
      if (!left.pin.isDayStart && right.pin.isDayStart) return 1;
      if (left.pin.type === "stay" && right.pin.type !== "stay") return -1;
      if (left.pin.type !== "stay" && right.pin.type === "stay") return 1;
      return left.originalIndex - right.originalIndex;
    });

    sortedGroup.forEach((entry, groupIndex) => {
      const ringIndex = Math.floor(groupIndex / 6);
      const angle = (groupIndex / sortedGroup.length) * Math.PI * 2 - Math.PI / 2;
      const radiusKm = 0.08 + ringIndex * 0.045;
      const latitudeOffset = (Math.sin(angle) * radiusKm) / 111;
      const longitudeOffset =
        (Math.cos(angle) * radiusKm) /
        (111 * Math.cos(group.centroidLatitude * (Math.PI / 180)));

      spreadPins[entry.originalIndex] = {
        ...entry.pin,
        latitude: entry.pin.latitude + latitudeOffset,
        longitude: entry.pin.longitude + longitudeOffset,
      };
    });
  });

  return spreadPins;
}

function computePopupLayout(map: L.Map, pin: TripStopPin): PopupLayout {
  const mapSize = map.getSize();
  const point = map.latLngToContainerPoint([pin.latitude, pin.longitude]);
  const popupWidth = 244;
  const popupHeight = pin.photoUrl ? 284 : 132;
  const margin = 16;
  const gap = 44;
  const sideGap = 72;

  const spaceAbove = point.y - margin - gap;
  const spaceBelow = mapSize.y - point.y - margin - gap;
  const spaceLeft = point.x - margin - sideGap;
  const spaceRight = mapSize.x - point.x - margin - sideGap;

  if (spaceRight >= popupWidth) {
    const top = clamp(
      point.y - popupHeight / 2,
      margin,
      mapSize.y - popupHeight - margin
    );
    return {
      left: point.x + sideGap,
      top,
      placement: "right",
      anchorTop: clamp(point.y - top, 28, popupHeight - 28),
    };
  }

  if (spaceLeft >= popupWidth) {
    const top = clamp(
      point.y - popupHeight / 2,
      margin,
      mapSize.y - popupHeight - margin
    );
    return {
      left: point.x - popupWidth - sideGap,
      top,
      placement: "left",
      anchorTop: clamp(point.y - top, 28, popupHeight - 28),
    };
  }

  if (spaceBelow >= popupHeight || spaceBelow >= spaceAbove) {
    const left = clamp(point.x - popupWidth / 2, margin, mapSize.x - popupWidth - margin);
    return {
      left,
      top: clamp(point.y + gap, margin, mapSize.y - popupHeight - margin),
      placement: "below",
      anchorLeft: clamp(point.x - left, 28, popupWidth - 28),
    };
  }

  const left = clamp(point.x - popupWidth / 2, margin, mapSize.x - popupWidth - margin);
  return {
    left,
    top: clamp(point.y - popupHeight - gap, margin, mapSize.y - popupHeight - margin),
    placement: "above",
    anchorLeft: clamp(point.x - left, 28, popupWidth - 28),
  };
}

function buildMarkerIcon(pin: TripStopPin, highlighted = false) {
  const color = colorForDay(pin.day);

  return L.divIcon({
    className: "trip-stop-marker-wrapper",
    html: `
      <div class="trip-stop-marker ${pin.isDayStart ? "trip-stop-marker--start" : ""} ${highlighted ? "trip-stop-marker--highlighted" : ""}" style="--marker-color:${color}">
        <span class="trip-stop-marker__day">${pin.day}</span>
        <span class="trip-stop-marker__type">${iconMarkup(pin.type)}</span>
      </div>
    `,
    iconSize: [56, 68],
    iconAnchor: [28, 56],
    popupAnchor: [0, -48],
  });
}

export default function TripStopMap({
  pins,
  routePaths = [],
  missingLocationCount = 0,
  variant = "full",
  emptyStateDescription,
  highlightedPinId,
  fallbackCenter,
  fallbackZoom = 11,
}: Props) {
  const mapRef = useRef<L.Map | null>(null);
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const routesLayerRef = useRef<L.LayerGroup | null>(null);
  const popupCloseTimerRef = useRef<number | null>(null);
  const [interactivePopupPinId, setInteractivePopupPinId] = useState<string | null>(
    null
  );
  const [popupLayout, setPopupLayout] = useState<PopupLayout | null>(null);

  const mappedPins = useMemo(
    () =>
      spreadNearbyPins(
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
  const visibleStopCount = useMemo(() => displayStopCount(mappedPins), [mappedPins]);
  const activePopupPinId = highlightedPinId ?? interactivePopupPinId;
  const activePopupPin = useMemo(
    () => mappedPins.find((pin) => pin.id === activePopupPinId) ?? null,
    [activePopupPinId, mappedPins]
  );
  const activePopupRating =
    typeof activePopupPin?.rating === "number" && Number.isFinite(activePopupPin.rating)
      ? activePopupPin.rating.toFixed(1)
      : null;

  const clearPopupCloseTimer = useCallback(() => {
    if (popupCloseTimerRef.current !== null) {
      window.clearTimeout(popupCloseTimerRef.current);
      popupCloseTimerRef.current = null;
    }
  }, []);

  const schedulePopupClose = useCallback((pinId: string) => {
    clearPopupCloseTimer();
    popupCloseTimerRef.current = window.setTimeout(() => {
      if (highlightedPinId !== pinId) {
        setInteractivePopupPinId((current) => (current === pinId ? null : current));
      }
      popupCloseTimerRef.current = null;
    }, 280);
  }, [clearPopupCloseTimer, highlightedPinId]);

  useEffect(() => {
    ensureLeafletStyles();

    if (
      !mapElementRef.current ||
      mapRef.current ||
      (mappedPins.length === 0 && !fallbackCenter)
    ) {
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

    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      maxZoom: 20,
      subdomains: ["a", "b", "c", "d"],
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(map);

    mapRef.current = map;
    markersLayerRef.current = L.layerGroup().addTo(map);
    routesLayerRef.current = L.layerGroup().addTo(map);

    if (mappedPins.length === 0 && fallbackCenter) {
      map.setView([fallbackCenter.latitude, fallbackCenter.longitude], fallbackZoom, {
        animate: false,
      });
    }

    return () => {
      clearPopupCloseTimer();
      markersLayerRef.current?.clearLayers();
      routesLayerRef.current?.clearLayers();
      map.remove();
      mapRef.current = null;
      markersLayerRef.current = null;
      routesLayerRef.current = null;
    };
  }, [clearPopupCloseTimer, fallbackCenter, fallbackZoom, mappedPins.length]);

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
      if (fallbackCenter) {
        map.setView([fallbackCenter.latitude, fallbackCenter.longitude], fallbackZoom, {
          animate: false,
        });
      }
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
        weight: variant === "compact" ? 10 : 14,
        opacity: variant === "compact" ? 0.92 : 0.95,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(routesLayer);

      L.polyline(latLngs, {
        color: colorForDay(routePath.day),
        weight: variant === "compact" ? 6 : 8,
        opacity: 0.98,
        dashArray: validPoints.length > 2 ? "16 10" : undefined,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(routesLayer);
    });

    mappedPins.forEach((pin) => {
      const isHighlighted = highlightedPinId === pin.id;
      const marker = L.marker([pin.latitude, pin.longitude], {
        icon: buildMarkerIcon(pin, isHighlighted),
        keyboard: true,
        zIndexOffset: isHighlighted ? 1000 : 0,
      });

      marker.on("mouseover", () => {
        clearPopupCloseTimer();
        setInteractivePopupPinId(pin.id);
      });

      marker.on("mouseout", () => {
        schedulePopupClose(pin.id);
      });

      marker.on("click", () => {
        clearPopupCloseTimer();
        setInteractivePopupPinId(pin.id);
      });

      markersLayer.addLayer(marker);
    });

    if (mappedPins.length === 1) {
      map.setView([mappedPins[0].latitude, mappedPins[0].longitude], 15, {
        animate: false,
      });
      return;
    }

    map.fitBounds(bounds, {
      padding: [56, 56],
      maxZoom: 15,
      animate: false,
    });
  }, [
    clearPopupCloseTimer,
    fallbackCenter,
    fallbackZoom,
    highlightedPinId,
    mappedPins,
    routePaths,
    schedulePopupClose,
    variant,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const updatePopupPosition = () => {
      if (!activePopupPin) {
        setPopupLayout(null);
        return;
      }

      setPopupLayout(computePopupLayout(map, activePopupPin));
    };
    const frameId = window.requestAnimationFrame(updatePopupPosition);
    map.on("move zoom resize", updatePopupPosition);

    return () => {
      window.cancelAnimationFrame(frameId);
      map.off("move zoom resize", updatePopupPosition);
    };
  }, [activePopupPin]);

  if (mappedPins.length === 0 && variant !== "compact") {
    return (
      <section
        className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold text-slate-950 dark:text-slate-100">Trip map</h2>
          <p className="text-sm leading-5 text-slate-600 dark:text-slate-300">
            {emptyStateDescription ??
              "This trip does not have enough location coordinates yet to render a map for the selected stays, food stops, and activities."}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section
      className={
        variant === "compact"
          ? "rounded-[1.75rem] border border-white/10 bg-[linear-gradient(180deg,rgba(14,22,37,0.92),rgba(11,18,31,0.88))] p-5 shadow-[0_24px_70px_rgba(2,6,23,0.28)]"
          : "rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      }
    >
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
          background: rgba(255, 255, 255, 0.96);
        }

        .trip-stop-map-shell :global(.leaflet-control-zoom a) {
          width: 38px;
          height: 38px;
          line-height: 38px;
          background: rgba(255, 255, 255, 0.96);
          color: #0f172a;
        }

        .trip-stop-map-shell :global(.leaflet-control-zoom a:hover) {
          background: #ffffff;
          color: #020617;
        }

        .trip-stop-map-shell :global(.trip-stop-marker-wrapper) {
          background: transparent;
          border: 0;
        }

        .trip-stop-map-shell :global(.trip-stop-marker) {
          position: relative;
          display: flex;
          height: 50px;
          width: 50px;
          align-items: center;
          justify-content: center;
          border-radius: 16px;
          background:
            radial-gradient(circle at 30% 25%, rgba(255, 255, 255, 0.26), transparent 34%),
            var(--marker-color);
          color: white;
          border: 2px solid rgba(255, 255, 255, 0.98);
          box-shadow:
            0 16px 32px rgba(15, 23, 42, 0.24),
            0 3px 0 rgba(15, 23, 42, 0.08),
            inset 0 1px 0 rgba(255, 255, 255, 0.2);
          transform: scale(1);
          transform-origin: center bottom;
          transition:
            transform 160ms ease,
            box-shadow 160ms ease,
            border-color 160ms ease;
        }

        .trip-stop-map-shell :global(.trip-stop-marker--start) {
          box-shadow:
            0 0 0 6px rgba(255, 255, 255, 0.16),
            0 18px 38px rgba(15, 23, 42, 0.28),
            0 3px 0 rgba(15, 23, 42, 0.08),
            inset 0 1px 0 rgba(255, 255, 255, 0.22);
        }

        .trip-stop-map-shell :global(.trip-stop-marker--highlighted) {
          border-color: rgba(255, 255, 255, 1);
          transform: scale(1.18);
          box-shadow:
            0 0 0 8px rgba(255, 255, 255, 0.14),
            0 22px 40px rgba(15, 23, 42, 0.34),
            0 4px 0 rgba(15, 23, 42, 0.08),
            inset 0 1px 0 rgba(255, 255, 255, 0.24);
        }

        .trip-stop-map-shell :global(.trip-stop-marker::after) {
          content: "";
          position: absolute;
          left: 50%;
          bottom: -6px;
          height: 14px;
          width: 14px;
          transform: translateX(-50%) rotate(45deg);
          border-radius: 0 0 5px 0;
          background: var(--marker-color);
          border-right: 2px solid rgba(255, 255, 255, 0.98);
          border-bottom: 2px solid rgba(255, 255, 255, 0.98);
          box-shadow: 0 10px 18px rgba(15, 23, 42, 0.14);
        }

        .trip-stop-map-shell :global(.trip-stop-marker__day) {
          position: relative;
          z-index: 1;
          font-size: 18px;
          font-weight: 800;
          line-height: 1;
        }

        .trip-stop-map-shell :global(.trip-stop-marker__type) {
          position: absolute;
          right: -8px;
          top: -8px;
          z-index: 2;
          display: inline-flex;
          height: 28px;
          width: 28px;
          align-items: center;
          justify-content: center;
          border-radius: 9999px;
          background: rgba(255, 255, 255, 0.98);
          color: #0f172a;
          border: 1px solid rgba(255, 255, 255, 0.8);
          box-shadow: 0 12px 18px rgba(15, 23, 42, 0.2);
          transition: transform 160ms ease, box-shadow 160ms ease;
        }

        .trip-stop-map-shell :global(.trip-stop-marker__icon-svg) {
          height: 15px;
          width: 15px;
        }

        .trip-stop-map-shell :global(.trip-stop-marker--highlighted .trip-stop-marker__type) {
          transform: scale(1.08);
          box-shadow: 0 14px 22px rgba(15, 23, 42, 0.24);
        }

        .trip-stop-map-shell {
          position: relative;
        }

        .trip-stop-map-shell__popup {
          position: absolute;
          z-index: 500;
          width: 244px;
          overflow: hidden;
          border-radius: 1.2rem;
          background: #ffffff;
          border: 1px solid rgba(148, 163, 184, 0.18);
          box-shadow: 0 22px 50px rgba(15, 23, 42, 0.2);
          pointer-events: auto;
        }

        .trip-stop-map-shell__popup::after {
          content: "";
          position: absolute;
          height: 12px;
          width: 12px;
          border-radius: 0 0 5px 0;
          background: #ffffff;
          transform: rotate(45deg);
          border: 1px solid rgba(148, 163, 184, 0.16);
        }

        .trip-stop-map-shell__popup--above::after {
          left: var(--popup-anchor-left, 50%);
          bottom: -6px;
          transform: translateX(-50%) rotate(45deg);
        }

        .trip-stop-map-shell__popup--below::after {
          left: var(--popup-anchor-left, 50%);
          top: -6px;
          transform: translateX(-50%) rotate(45deg);
        }

        .trip-stop-map-shell__popup--left::after {
          right: -6px;
          top: var(--popup-anchor-top, 50%);
          transform: translateY(-50%) rotate(45deg);
        }

        .trip-stop-map-shell__popup--right::after {
          left: -6px;
          top: var(--popup-anchor-top, 50%);
          transform: translateY(-50%) rotate(45deg);
        }

        .trip-stop-popup__media {
          position: relative;
          height: 144px;
          overflow: hidden;
          flex-shrink: 0;
          background: linear-gradient(180deg, #bfdbfe 0%, #dbeafe 100%);
        }

        .trip-stop-popup__image {
          display: block;
          height: 100%;
          width: 100%;
          object-fit: cover;
        }

        .trip-stop-popup__body {
          position: relative;
          z-index: 1;
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
          background: #ffffff;
          border-top: 1px solid rgba(226, 232, 240, 0.9);
          padding: 0.82rem 0.88rem 0.9rem;
        }

        .trip-stop-popup__eyebrow {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          color: #64748b;
        }

        .trip-stop-popup__header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 0.55rem;
        }

        .trip-stop-popup__title {
          min-width: 0;
          flex: 1 1 auto;
          font-size: 15px;
          font-weight: 700;
          line-height: 1.3;
          color: #020617;
        }

        .trip-stop-popup__rating {
          flex-shrink: 0;
          font-size: 12px;
          font-weight: 700;
          color: #334155;
        }

        .trip-stop-popup__subtitle {
          font-size: 12px;
          line-height: 1.45;
          color: #475569;
          display: -webkit-box;
          overflow: hidden;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
        }

        .trip-stop-popup__link {
          display: inline-flex;
          margin-top: 0.1rem;
          align-items: center;
          border-radius: 9999px;
          border: 1px solid rgba(148, 163, 184, 0.28);
          background: #f8fafc;
          padding: 0.36rem 0.72rem;
          font-size: 11px;
          font-weight: 600;
          color: #0f172a;
          text-decoration: none;
        }

        .trip-stop-popup__link:hover {
          background: #eff6ff;
        }

        .trip-stop-map-shell__empty {
          display: flex;
          height: 100%;
          width: 100%;
          align-items: center;
          justify-content: center;
          padding: 1.5rem;
        }

        .trip-stop-map-shell__empty-card {
          max-width: 24rem;
          border-radius: 1.35rem;
          border: 1px dashed rgba(255, 255, 255, 0.14);
          background: rgba(255, 255, 255, 0.04);
          padding: 1.1rem 1.15rem;
          text-align: center;
        }

        .trip-stop-map-shell__empty-title {
          font-size: 0.95rem;
          font-weight: 700;
          color: rgba(255, 255, 255, 0.96);
        }

        .trip-stop-map-shell__empty-copy {
          margin-top: 0.45rem;
          font-size: 0.875rem;
          line-height: 1.55;
          color: rgba(226, 232, 240, 0.82);
        }
      `}</style>

      {variant === "compact" ? (
        <div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200/75">
                Live route map
              </div>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-white">
                See the trip as you read it
              </h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-200">
                {visibleStopCount} stop{visibleStopCount === 1 ? "" : "s"}
              </span>
              {missingLocationCount > 0 ? (
                <span className="inline-flex items-center rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-xs font-medium text-amber-200">
                  {missingLocationCount} without coordinates
                </span>
              ) : null}
            </div>
          </div>

          <div className="trip-stop-map-shell mt-4 h-[34rem] overflow-hidden rounded-[1.4rem] border border-white/10 bg-slate-900/70 lg:h-[42rem] xl:h-[48rem]">
            <div ref={mapElementRef} className="h-full w-full" />
            {activePopupPin && popupLayout ? (
              <div
                className={`trip-stop-map-shell__popup trip-stop-map-shell__popup--${popupLayout.placement}`}
                style={{
                  left: `${popupLayout.left}px`,
                  top: `${popupLayout.top}px`,
                  ...(typeof popupLayout.anchorLeft === "number"
                    ? { ["--popup-anchor-left" as string]: `${popupLayout.anchorLeft}px` }
                    : {}),
                  ...(typeof popupLayout.anchorTop === "number"
                    ? { ["--popup-anchor-top" as string]: `${popupLayout.anchorTop}px` }
                    : {}),
                }}
                onMouseEnter={clearPopupCloseTimer}
                onMouseLeave={() => schedulePopupClose(activePopupPin.id)}
              >
                {activePopupPin.photoUrl ? (
                  <div className="trip-stop-popup__media">
                    <Image
                      src={activePopupPin.photoUrl}
                      alt={activePopupPin.label}
                      fill
                      sizes="244px"
                      unoptimized
                      className="trip-stop-popup__image"
                    />
                  </div>
                ) : null}
                <div className="trip-stop-popup__body">
                  <div className="trip-stop-popup__eyebrow">
                    Day {activePopupPin.day} {" / "} {TYPE_LABELS[activePopupPin.type]}
                    {activePopupPin.isDayStart ? " / Start" : ""}
                  </div>
                  <div className="trip-stop-popup__header">
                    <div className="trip-stop-popup__title">{activePopupPin.label}</div>
                    {activePopupRating ? (
                      <div className="trip-stop-popup__rating">
                        {activePopupRating}/5
                      </div>
                    ) : null}
                  </div>
                  {activePopupPin.subtitle ? (
                    <div className="trip-stop-popup__subtitle">
                      {activePopupPin.subtitle}
                    </div>
                  ) : null}
                  {activePopupPin.mapsUrl ? (
                    <a
                      href={activePopupPin.mapsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="trip-stop-popup__link"
                    >
                      Open in maps
                    </a>
                  ) : null}
                </div>
              </div>
            ) : null}
            {mappedPins.length === 0 ? (
              <div className="trip-stop-map-shell__empty">
                <div className="trip-stop-map-shell__empty-card">
                  <div className="trip-stop-map-shell__empty-title">Map ready</div>
                  <div className="trip-stop-map-shell__empty-copy">
                    {emptyStateDescription ??
                      "Expand a day to focus the map on just that day's stay, meals, and activities."}
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="mt-4 space-y-3 rounded-[1.2rem] border border-white/10 bg-white/5 p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
              Legend
            </div>
            <div className="flex flex-wrap gap-2">
              {(["stay", "food", "activity"] as const).map((type) => (
                <span
                  key={type}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-200"
                >
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/90 text-slate-950">
                    <span
                      className="inline-flex h-3 w-3 items-center justify-center"
                      dangerouslySetInnerHTML={{ __html: iconMarkup(type) }}
                    />
                  </span>
                  {TYPE_LABELS[type]}
                </span>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {dayList.map((day) => (
                <span
                  key={day}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-200"
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
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#04b887] dark:text-[#7decc7]">
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
                {visibleStopCount} mapped stop{visibleStopCount === 1 ? "" : "s"}
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
              {activePopupPin && popupLayout ? (
                <div
                  className={`trip-stop-map-shell__popup trip-stop-map-shell__popup--${popupLayout.placement}`}
                  style={{
                    left: `${popupLayout.left}px`,
                    top: `${popupLayout.top}px`,
                    ...(typeof popupLayout.anchorLeft === "number"
                      ? { ["--popup-anchor-left" as string]: `${popupLayout.anchorLeft}px` }
                      : {}),
                    ...(typeof popupLayout.anchorTop === "number"
                      ? { ["--popup-anchor-top" as string]: `${popupLayout.anchorTop}px` }
                      : {}),
                  }}
                  onMouseEnter={clearPopupCloseTimer}
                  onMouseLeave={() => schedulePopupClose(activePopupPin.id)}
                >
                  {activePopupPin.photoUrl ? (
                    <div className="trip-stop-popup__media">
                      <Image
                        src={activePopupPin.photoUrl}
                        alt={activePopupPin.label}
                        fill
                        sizes="244px"
                        unoptimized
                        className="trip-stop-popup__image"
                      />
                    </div>
                  ) : null}
                  <div className="trip-stop-popup__body">
                    <div className="trip-stop-popup__eyebrow">
                      Day {activePopupPin.day} {" / "} {TYPE_LABELS[activePopupPin.type]}
                      {activePopupPin.isDayStart ? " / Start" : ""}
                    </div>
                    <div className="trip-stop-popup__header">
                      <div className="trip-stop-popup__title">{activePopupPin.label}</div>
                      {activePopupRating ? (
                        <div className="trip-stop-popup__rating">
                          {activePopupRating}/5
                        </div>
                      ) : null}
                    </div>
                    {activePopupPin.subtitle ? (
                      <div className="trip-stop-popup__subtitle">
                        {activePopupPin.subtitle}
                      </div>
                    ) : null}
                    {activePopupPin.mapsUrl ? (
                      <a
                        href={activePopupPin.mapsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="trip-stop-popup__link"
                      >
                        Open in maps
                      </a>
                    ) : null}
                  </div>
                </div>
              ) : null}
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
        </>
      )}
    </section>
  );
}
