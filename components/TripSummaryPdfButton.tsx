"use client";

/**
 * Print/PDF export for a trip plan.
 * The export is intentionally static HTML so browser "Save as PDF" captures the
 * itinerary, selected stops, and map overview without depending on live map tiles.
 */

import { useMemo, useState } from "react";
import {
  getAddedStopsForDay,
  getCustomStopForKey,
  pickDefaultActivityForStop,
} from "../lib/tripSelections";
import { buildTripMustHaves } from "../lib/tripMustHaves";
import {
  Activity,
  BudgetBreakdown,
  FoodSpot,
  HotelOption,
  ItineraryDayData,
  ItineraryStop,
  TripCustomStop,
  TripPlan,
  TripSelectionState,
} from "../lib/types";

type TripSummaryMapPin = {
  id: string;
  label: string;
  day: number;
  type: "stay" | "food" | "activity";
  latitude: number;
  longitude: number;
  subtitle?: string;
  mapsUrl?: string;
  rating?: number;
};

type TripSummaryRoutePath = {
  day: number;
  points: Array<{
    latitude: number;
    longitude: number;
  }>;
};

type Props = {
  trip: TripPlan;
  selection: TripSelectionState;
  mapData: {
    pins: TripSummaryMapPin[];
    routePaths: TripSummaryRoutePath[];
    missingLocationCount?: number;
  };
  tripDateRange?: string | null;
  routeSummary?: string | null;
  estimatedTotalCost?: number;
  targetTotalBudget?: number;
  selectedBudget?: BudgetBreakdown | null;
  className?: string;
};

type ResolvedStop = ItineraryStop & {
  dayNumber: number;
  sourceKind: NonNullable<ItineraryStop["kind"]>;
  rating?: number;
};

const DAY_COLORS = [
  "#0f766e",
  "#2563eb",
  "#db2777",
  "#d97706",
  "#7c3aed",
  "#059669",
  "#dc2626",
];

function stopKey(dayIndex: number, stopIndex: number) {
  return `day-${dayIndex}-stop-${stopIndex}`;
}

function normalized(value?: string) {
  return (value ?? "").trim().toLowerCase();
}

function optionSortScore(name: string, preferredTitle?: string) {
  const optionName = normalized(name);
  const title = normalized(preferredTitle);

  if (!title) return 0;
  if (optionName === title) return 100;
  if (optionName.includes(title) || title.includes(optionName)) return 80;
  return 0;
}

function pickMatchedHotel(hotels: HotelOption[], stopTitle?: string) {
  return [...hotels]
    .sort((a, b) => {
      const scoreDiff =
        optionSortScore(a.name, stopTitle?.replace(/^Check in at\s+/i, "")) -
        optionSortScore(b.name, stopTitle?.replace(/^Check in at\s+/i, ""));

      if (scoreDiff !== 0) return -scoreDiff;
      return (b.rating ?? 0) - (a.rating ?? 0);
    })
    .at(0);
}

function pickMatchedFood(foodSpots: FoodSpot[], stopTitle?: string) {
  return [...foodSpots]
    .sort((a, b) => {
      const scoreDiff =
        optionSortScore(a.name, stopTitle) - optionSortScore(b.name, stopTitle);
      if (scoreDiff !== 0) return -scoreDiff;
      return (b.rating ?? 0) - (a.rating ?? 0);
    })
    .at(0);
}

function html(value?: string | number | null) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function money(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "Not estimated";
  }

  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(value);
}

function dayColor(day: number) {
  return DAY_COLORS[(day - 1) % DAY_COLORS.length];
}

function resolveStop(
  trip: TripPlan,
  selection: TripSelectionState,
  day: ItineraryDayData,
  dayIndex: number,
  stop: ItineraryStop,
  stopIndex: number
): ResolvedStop {
  const key = stopKey(dayIndex, stopIndex);
  const customStop = getCustomStopForKey(selection, key);
  const dayNumber = dayIndex + 1;

  if (customStop) {
    return normalizeCustomStop(customStop, dayNumber);
  }

  if (stop.kind === "stay") {
    const hotel =
      trip.hotelOptions.find((option) => option.name === selection.hotelName) ??
      pickMatchedHotel(trip.hotelOptions ?? [], stop.title);

    if (hotel) {
      return {
        ...stop,
        dayNumber,
        sourceKind: "stay",
        title: hotel.name,
        description: hotel.shortDescription ?? stop.description,
        mapsUrl: hotel.mapsUrl || hotel.bookingLink,
        websiteUrl: hotel.websiteUrl,
        rating: hotel.rating,
        estimatedCost: hotel.totalStayPrice ?? hotel.estimatedCost ?? stop.estimatedCost,
      };
    }
  }

  if (stop.kind === "food") {
    const selectedName =
      selection.foods[key] ?? pickMatchedFood(trip.foodSpots ?? [], stop.title)?.name;
    const food = (trip.foodSpots ?? []).find((spot) => spot.name === selectedName);

    if (food) {
      return {
        ...stop,
        dayNumber,
        sourceKind: "food",
        title: food.name,
        description: food.shortDescription ?? stop.description,
        mapsUrl: food.mapsUrl || food.websiteUrl || food.link,
        websiteUrl: food.websiteUrl,
        rating: food.rating,
        estimatedCost: food.estimatedCost ?? stop.estimatedCost,
      };
    }
  }

  if (stop.kind === "activity") {
    const selectedName =
      selection.activities[key] ??
      pickDefaultActivityForStop(stop, trip.topActivities ?? [], {
        day,
        tripPrompt: trip.tripPrompt,
        hotelName: selection.hotelName,
        hotels: trip.hotelOptions,
        fallbackCenter: {
          latitude: trip.latitude,
          longitude: trip.longitude,
        },
      })?.name;
    const activity = (trip.topActivities ?? []).find(
      (candidate: Activity) => candidate.name === selectedName
    );

    if (activity) {
      return {
        ...stop,
        dayNumber,
        sourceKind: "activity",
        title: activity.name,
        description: activity.shortDescription ?? stop.description,
        mapsUrl: activity.mapsUrl || activity.websiteUrl || activity.bookingLink,
        websiteUrl: activity.websiteUrl,
        allTrailsUrl: activity.allTrailsUrl,
        rating: activity.rating,
        estimatedCost:
          activity.costEstimate ?? activity.estimatedCost ?? stop.estimatedCost,
      };
    }
  }

  return {
    ...stop,
    dayNumber,
    sourceKind: stop.kind ?? "activity",
  };
}

function normalizeCustomStop(stop: TripCustomStop, dayNumber: number): ResolvedStop {
  return {
    ...stop,
    dayNumber,
    sourceKind: stop.kind === "stay" ? "stay" : stop.kind,
  };
}

function resolvedDays(trip: TripPlan, selection: TripSelectionState) {
  return (trip.itineraryDays ?? []).map((day, dayIndex) => {
    const stops: ResolvedStop[] = [];
    const addedStops = getAddedStopsForDay(selection, dayIndex);

    (day.stops ?? []).forEach((stop, stopIndex) => {
      stops.push(resolveStop(trip, selection, day, dayIndex, stop, stopIndex));

      addedStops
        .filter((addedStop) => addedStop.insertAfterStopIndex === stopIndex)
        .forEach((addedStop) => stops.push(normalizeCustomStop(addedStop, dayIndex + 1)));
    });

    addedStops
      .filter((addedStop) => typeof addedStop.insertAfterStopIndex !== "number")
      .forEach((addedStop) => stops.push(normalizeCustomStop(addedStop, dayIndex + 1)));

    return {
      ...day,
      dayNumber: dayIndex + 1,
      stops,
    };
  });
}

function buildMapSvg(mapData: Props["mapData"]) {
  const coordinates = [
    ...mapData.pins.map((pin) => ({
      latitude: pin.latitude,
      longitude: pin.longitude,
    })),
    ...mapData.routePaths.flatMap((routePath) => routePath.points),
  ].filter(
    (point) =>
      Number.isFinite(point.latitude) && Number.isFinite(point.longitude)
  );

  if (coordinates.length === 0) {
    return `<div class="empty-map">No saved coordinates yet for the route map.</div>`;
  }

  const width = 920;
  const height = 420;
  const padding = 46;
  const minLat = Math.min(...coordinates.map((point) => point.latitude));
  const maxLat = Math.max(...coordinates.map((point) => point.latitude));
  const minLng = Math.min(...coordinates.map((point) => point.longitude));
  const maxLng = Math.max(...coordinates.map((point) => point.longitude));
  const latRange = Math.max(0.001, maxLat - minLat);
  const lngRange = Math.max(0.001, maxLng - minLng);
  const project = (point: { latitude: number; longitude: number }) => {
    const x = padding + ((point.longitude - minLng) / lngRange) * (width - padding * 2);
    const y = padding + ((maxLat - point.latitude) / latRange) * (height - padding * 2);

    return { x, y };
  };

  const routes = mapData.routePaths
    .map((routePath) => {
      const d = routePath.points
        .map((point, index) => {
          const projected = project(point);
          return `${index === 0 ? "M" : "L"} ${projected.x.toFixed(1)} ${projected.y.toFixed(1)}`;
        })
        .join(" ");

      if (!d) return "";

      return `<path d="${html(d)}" fill="none" stroke="${dayColor(routePath.day)}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="10 8" opacity="0.88" />`;
    })
    .join("");

  const pins = mapData.pins
    .map((pin, index) => {
      const projected = project(pin);
      const color = dayColor(pin.day);
      const label = pin.type === "stay" ? "S" : pin.type === "food" ? "F" : "A";

      return `
        <g>
          <circle cx="${projected.x.toFixed(1)}" cy="${projected.y.toFixed(1)}" r="15" fill="${color}" stroke="#ffffff" stroke-width="3" />
          <text x="${projected.x.toFixed(1)}" y="${(projected.y + 5).toFixed(1)}" text-anchor="middle" font-family="Arial" font-size="12" font-weight="700" fill="#ffffff">${label}${pin.day}</text>
          <text x="${projected.x.toFixed(1)}" y="${(projected.y + 30).toFixed(1)}" text-anchor="middle" font-family="Arial" font-size="10" font-weight="700" fill="#1f2937">${index + 1}</text>
        </g>
      `;
    })
    .join("");
  const areaLabel = `${minLat.toFixed(3)}, ${minLng.toFixed(3)} to ${maxLat.toFixed(3)}, ${maxLng.toFixed(3)}`;

  return `
    <svg class="route-map" viewBox="0 0 ${width} ${height}" role="img" aria-label="Trip route overview">
      <rect x="0" y="0" width="${width}" height="${height}" rx="18" fill="#eef4ed" />
      <defs>
        <pattern id="grid" width="64" height="64" patternUnits="userSpaceOnUse">
          <path d="M 64 0 L 0 0 0 64" fill="none" stroke="#d9e3d6" stroke-width="1" opacity="0.7" />
        </pattern>
      </defs>
      <rect x="0" y="0" width="${width}" height="${height}" rx="18" fill="url(#grid)" opacity="0.65" />
      <path d="M 48 286 C 206 250 362 286 520 244 S 722 232 878 264" fill="none" stroke="#d9edf5" stroke-width="30" opacity="0.92" />
      <path d="M 70 102 C 222 72 354 132 512 84 S 728 78 858 132" fill="none" stroke="#d7e7d3" stroke-width="34" opacity="0.72" />
      <text x="28" y="34" font-family="Arial" font-size="12" font-weight="700" fill="#475569">Static coordinate overview</text>
      <text x="28" y="54" font-family="Arial" font-size="10" fill="#64748b">${html(areaLabel)}</text>
      <g>${routes}</g>
      <g>${pins}</g>
    </svg>
  `;
}

function linkHtml(stop: ResolvedStop) {
  const links = [
    stop.mapsUrl ? `<a href="${html(stop.mapsUrl)}">Map</a>` : "",
    stop.websiteUrl ? `<a href="${html(stop.websiteUrl)}">Website</a>` : "",
    stop.allTrailsUrl ? `<a href="${html(stop.allTrailsUrl)}">Trail</a>` : "",
  ].filter(Boolean);

  return links.length > 0 ? `<div class="links">${links.join(" / ")}</div>` : "";
}

function buildTripSummaryHtml({
  trip,
  selection,
  mapData,
  tripDateRange,
  routeSummary,
  estimatedTotalCost,
  targetTotalBudget,
  selectedBudget,
}: Omit<Props, "className">) {
  const days = resolvedDays(trip, selection);
  const mustHaves = buildTripMustHaves(trip);
  const destination = trip.homeBaseCity || trip.destinationName || trip.name || "Trip";
  const generatedAt = new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date());
  const budget = selectedBudget ?? trip.budgetBreakdown;

  const daySections = days
    .map(
      (day) => `
        <section class="day">
          <div class="day-header">
            <div>
              <div class="eyebrow">Day ${day.dayNumber}</div>
              <h2>${html(day.title ?? `Day ${day.dayNumber}`)}</h2>
            </div>
            <div class="day-count">${day.stops.length} events</div>
          </div>
          ${day.summary ? `<p class="day-summary">${html(day.summary)}</p>` : ""}
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Event</th>
                <th>Type</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              ${day.stops
                .map(
                  (stop) => `
                    <tr>
                      <td>${html(stop.time ?? "")}</td>
                      <td>
                        <strong>${html(stop.title)}</strong>
                        ${stop.rating ? `<div class="muted">Rating ${html(stop.rating)}/5</div>` : ""}
                        ${linkHtml(stop)}
                      </td>
                      <td>${html(stop.sourceKind)}</td>
                      <td>
                        ${stop.description ? html(stop.description) : ""}
                        ${typeof stop.estimatedCost === "number" && stop.estimatedCost > 0 ? `<div class="muted">Est. ${money(stop.estimatedCost)}</div>` : ""}
                      </td>
                    </tr>
                  `
                )
                .join("")}
            </tbody>
          </table>
        </section>
      `
    )
    .join("");

  const mustHaveList = [...mustHaves.required, ...mustHaves.recommended]
    .map(
      (item) => `
        <li>
          <strong>${html(item.title)}</strong>
          <span>${html(item.priority === "required" ? "Required" : "Recommended")} / ${html(item.category)}</span>
          <p>${html(item.detail)}</p>
        </li>
      `
    )
    .join("");

  const mapLegend = mapData.pins
    .map(
      (pin, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>Day ${pin.day}</td>
          <td>${html(pin.type)}</td>
          <td>
            <strong>${html(pin.label)}</strong>
            ${pin.subtitle ? `<div class="muted">${html(pin.subtitle)}</div>` : ""}
          </td>
        </tr>
      `
    )
    .join("");

  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${html(destination)} trip summary</title>
        <style>
          @page { margin: 0.55in; }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            color: #111827;
            background: #ffffff;
            font-family: Arial, Helvetica, sans-serif;
            line-height: 1.45;
          }
          a { color: #0f766e; text-decoration: none; }
          .page { max-width: 980px; margin: 0 auto; }
          .cover {
            border: 1px solid #d8dee8;
            border-radius: 20px;
            padding: 28px;
            background: #f7fafc;
          }
          .eyebrow {
            color: #0f766e;
            font-size: 11px;
            font-weight: 800;
            letter-spacing: 0.16em;
            text-transform: uppercase;
          }
          h1 { margin: 10px 0 8px; font-size: 40px; line-height: 1.05; }
          h2 { margin: 4px 0 0; font-size: 22px; }
          h3 { margin: 0 0 10px; font-size: 16px; }
          p { margin: 0; }
          .summary { max-width: 760px; color: #4b5563; font-size: 15px; }
          .meta-grid {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 10px;
            margin-top: 22px;
          }
          .meta {
            border: 1px solid #d8dee8;
            border-radius: 14px;
            padding: 12px;
            background: #ffffff;
          }
          .meta span {
            display: block;
            color: #6b7280;
            font-size: 10px;
            font-weight: 800;
            letter-spacing: 0.12em;
            text-transform: uppercase;
          }
          .meta strong { display: block; margin-top: 5px; font-size: 15px; }
          .prompt {
            margin-top: 18px;
            border: 1px solid #d8dee8;
            border-radius: 14px;
            padding: 13px;
            color: #374151;
            background: #ffffff;
            font-size: 13px;
          }
          .section {
            margin-top: 22px;
            break-inside: avoid;
          }
          .map-wrap {
            border: 1px solid #d8dee8;
            border-radius: 18px;
            padding: 14px;
            background: #ffffff;
            break-inside: avoid;
          }
          .route-map {
            width: 100%;
            height: auto;
            display: block;
            margin-top: 10px;
            border: 1px solid #d8dee8;
            border-radius: 18px;
          }
          .empty-map {
            border: 1px dashed #cbd5e1;
            border-radius: 16px;
            padding: 34px;
            color: #64748b;
            text-align: center;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 12px;
            font-size: 12px;
          }
          th {
            color: #64748b;
            font-size: 10px;
            letter-spacing: 0.12em;
            text-align: left;
            text-transform: uppercase;
          }
          th, td {
            border-bottom: 1px solid #e5e7eb;
            padding: 9px 8px;
            vertical-align: top;
          }
          .day {
            margin-top: 22px;
            padding-top: 4px;
            break-inside: avoid;
          }
          .day-header {
            display: flex;
            align-items: start;
            justify-content: space-between;
            gap: 16px;
          }
          .day-count {
            border: 1px solid #d8dee8;
            border-radius: 999px;
            padding: 5px 10px;
            color: #475569;
            font-size: 12px;
            font-weight: 700;
            white-space: nowrap;
          }
          .day-summary {
            margin-top: 8px;
            color: #4b5563;
            font-size: 13px;
          }
          .links, .muted {
            margin-top: 4px;
            color: #6b7280;
            font-size: 11px;
          }
          .legend-note {
            margin-top: 8px;
            color: #64748b;
            font-size: 11px;
          }
          .must-haves {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
            padding: 0;
            list-style: none;
          }
          .must-haves li {
            border: 1px solid #d8dee8;
            border-radius: 14px;
            padding: 12px;
            break-inside: avoid;
          }
          .must-haves span {
            display: block;
            margin-top: 3px;
            color: #0f766e;
            font-size: 10px;
            font-weight: 800;
            letter-spacing: 0.1em;
            text-transform: uppercase;
          }
          .must-haves p {
            margin-top: 7px;
            color: #4b5563;
            font-size: 12px;
          }
          .footer {
            margin-top: 28px;
            color: #64748b;
            font-size: 11px;
          }
          @media print {
            .no-print { display: none; }
            .page { max-width: none; }
          }
        </style>
      </head>
      <body>
        <main class="page">
          <section class="cover">
            <div class="eyebrow">Trip summary</div>
            <h1>${html(destination)}</h1>
            <p class="summary">${html(trip.summary)}</p>
            <div class="meta-grid">
              <div class="meta"><span>Dates</span><strong>${html(tripDateRange ?? "Dates flexible")}</strong></div>
              <div class="meta"><span>Travelers</span><strong>${html(trip.travelerCount ?? 1)}</strong></div>
              <div class="meta"><span>Route</span><strong>${html(routeSummary ?? trip.driveTimeText)}</strong></div>
              <div class="meta"><span>Estimate</span><strong>${html(money(estimatedTotalCost ?? budget?.totalExpected ?? budget?.total))}</strong></div>
            </div>
            <div class="meta-grid">
              <div class="meta"><span>Budget target</span><strong>${html(targetTotalBudget && targetTotalBudget > 0 ? money(targetTotalBudget) : "Not set")}</strong></div>
              <div class="meta"><span>Stay</span><strong>${html(selection.hotelName ?? trip.hotelOptions?.[0]?.name ?? "Not selected")}</strong></div>
              <div class="meta"><span>Status</span><strong>${html(trip.status ?? "draft")}</strong></div>
              <div class="meta"><span>Generated</span><strong>${html(generatedAt)}</strong></div>
            </div>
            ${trip.tripPrompt ? `<div class="prompt">${html(trip.tripPrompt)}</div>` : ""}
          </section>

          <section class="section map-wrap">
            <div class="eyebrow">Route map</div>
            <p class="legend-note">The export uses saved stop coordinates and straight-line route segments so the PDF is stable. Use the interactive app map for live roads and map tiles.</p>
            ${buildMapSvg(mapData)}
            ${
              mapData.missingLocationCount
                ? `<p class="links">${html(mapData.missingLocationCount)} stop${mapData.missingLocationCount === 1 ? "" : "s"} without saved coordinates are not drawn.</p>`
                : ""
            }
            ${
              mapLegend
                ? `<table><thead><tr><th>#</th><th>Day</th><th>Type</th><th>Stop</th></tr></thead><tbody>${mapLegend}</tbody></table>`
                : ""
            }
          </section>

          ${daySections}

          <section class="section">
            <div class="eyebrow">Must-haves and recommendations</div>
            <h2>What to bring</h2>
            <ul class="must-haves">${mustHaveList}</ul>
          </section>

          <section class="section">
            <div class="eyebrow">Budget</div>
            <table>
              <tbody>
                <tr><td>Stay</td><td>${html(money(budget?.hotel))}</td></tr>
                <tr><td>Food</td><td>${html(money(budget?.food))}</td></tr>
                <tr><td>Gas / transport</td><td>${html(money(budget?.gas))}</td></tr>
                <tr><td>Activities</td><td>${html(money(budget?.activities))}</td></tr>
                <tr><td>Misc</td><td>${html(money(budget?.misc))}</td></tr>
                <tr><td><strong>Total expected</strong></td><td><strong>${html(money(budget?.totalExpected ?? budget?.total))}</strong></td></tr>
              </tbody>
            </table>
          </section>

          <p class="footer">Generated from Trippify. Verify live hours, bookings, route conditions, park rules, and safety requirements before departure.</p>
        </main>
        <script>
          window.setTimeout(function () {
            window.focus();
            window.print();
          }, 350);
        </script>
      </body>
    </html>`;
}

function suggestedPdfFileName(trip: TripPlan) {
  const base = (trip.homeBaseCity || trip.destinationName || trip.name || "trip")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${base || "trip"}-summary`;
}

export default function TripSummaryPdfButton({
  trip,
  selection,
  mapData,
  tripDateRange,
  routeSummary,
  estimatedTotalCost,
  targetTotalBudget,
  selectedBudget,
  className = "",
}: Props) {
  const [status, setStatus] = useState("");
  const htmlDocument = useMemo(
    () =>
      buildTripSummaryHtml({
        trip,
        selection,
        mapData,
        tripDateRange,
        routeSummary,
        estimatedTotalCost,
        targetTotalBudget,
        selectedBudget,
      }),
    [
      estimatedTotalCost,
      mapData,
      routeSummary,
      selectedBudget,
      selection,
      targetTotalBudget,
      trip,
      tripDateRange,
    ]
  );

  function handleExport() {
    const printWindow = window.open("", "_blank", "width=980,height=760");

    if (!printWindow) {
      setStatus("Popup blocked. Allow popups and try again.");
      return;
    }

    printWindow.document.open();
    printWindow.document.write(htmlDocument);
    printWindow.document.close();
    setStatus("PDF print dialog opened.");

    const suggestedName = suggestedPdfFileName(trip);
    printWindow.document.title = suggestedName;
    window.setTimeout(() => setStatus(""), 2200);
  }

  return (
    <div className={`flex flex-col items-start gap-1 ${className}`}>
      <button
        type="button"
        onClick={handleExport}
        className="inline-flex h-11 items-center justify-center rounded-full border border-[#0f766e]/35 bg-[#eafff7] px-4 text-sm font-semibold text-[#075f50] transition hover:border-[#0f766e]/55 hover:bg-[#d7fff0] dark:border-[#3be0ab]/30 dark:bg-[#06d8a0]/12 dark:text-[#d7fcef] dark:hover:bg-[#06d8a0]/18"
      >
        Trip summary PDF
      </button>
      {status ? (
        <span className="text-xs text-slate-500 dark:text-slate-400">{status}</span>
      ) : null}
    </div>
  );
}
