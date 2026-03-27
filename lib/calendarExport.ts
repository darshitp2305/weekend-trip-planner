import {
  addDaysToIsoDate,
  formatDateRange,
  getTodayIsoDate,
  isIsoDate,
} from "./tripDates";
import { preferredHotelBookingUrl } from "./expediaLinks";
import { TripPlan, TripSelectionState } from "./types";
import {
  getAddedStopsForDay,
  getCustomStopForKey,
  normalizeSelectionState,
} from "./tripSelections";

const TRACKING_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "gbraid",
  "wbraid",
  "fbclid",
  "msclkid",
  "dclid",
  "mc_cid",
  "mc_eid",
];

function escapeIcsText(value?: string) {
  return (value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function formatIcsDateTime(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}T${hours}${minutes}${seconds}`;
}

function formatIcsDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function buildEventDateTime(dateIso: string, hours: number, minutes = 0) {
  const date = new Date(`${dateIso}T00:00:00`);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

function resolveSelectionState(trip: TripPlan): TripSelectionState {
  return normalizeSelectionState(
    trip.savedSelectionState ?? {
      hotelName: trip.hotelOptions?.[0]?.name,
      foods: {},
      activities: {},
    }
  );
}

function stopKey(dayIndex: number, stopIndex: number) {
  return `day-${dayIndex}-stop-${stopIndex}`;
}

function selectedHotel(trip: TripPlan, selection: TripSelectionState) {
  return (
    trip.hotelOptions.find((hotel) => hotel.name === selection.hotelName) ??
    trip.hotelOptions[0]
  );
}

function selectedFood(
  trip: TripPlan,
  selection: TripSelectionState,
  dayIndex: number,
  stopIndex: number
) {
  const name = selection.foods[stopKey(dayIndex, stopIndex)];
  return trip.foodSpots.find((spot) => spot.name === name);
}

function selectedActivity(
  trip: TripPlan,
  selection: TripSelectionState,
  dayIndex: number,
  stopIndex: number
) {
  const name = selection.activities[stopKey(dayIndex, stopIndex)];
  return trip.topActivities.find((activity) => activity.name === name);
}

function cleanShareUrl(value?: string) {
  if (!value) return undefined;

  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();

    if ((host === "www.google.com" || host === "google.com") && path === "/aclk") {
      return undefined;
    }

    for (const param of TRACKING_PARAMS) {
      url.searchParams.delete(param);
    }

    const serialized = url.toString();
    return serialized.length > 0 ? serialized : undefined;
  } catch {
    return value;
  }
}

function preferredHotelShareUrl(trip: TripPlan, selection: TripSelectionState) {
  return preferredHotelBookingUrl({
    hotel: selectedHotel(trip, selection),
    destination: trip.destinationName || trip.name,
    tripStartDate: trip.tripStartDate,
    tripEndDate: trip.tripEndDate,
    travelerCount: trip.travelerCount,
  });
}

function formatMoney(value?: number) {
  return typeof value === "number" && Number.isFinite(value) ? `$${Math.round(value)}` : undefined;
}

function stopTiming(time?: string, kind?: string) {
  switch ((time ?? "").trim().toLowerCase()) {
    case "morning":
      return { startHour: 9, startMinute: 0, durationMinutes: kind === "travel" ? 150 : 90 };
    case "late morning":
      return { startHour: 11, startMinute: 0, durationMinutes: kind === "travel" ? 120 : 90 };
    case "afternoon":
      return { startHour: 14, startMinute: 0, durationMinutes: kind === "travel" ? 150 : 120 };
    case "late afternoon":
      return { startHour: 16, startMinute: 30, durationMinutes: kind === "travel" ? 120 : 90 };
    case "evening":
      return { startHour: 18, startMinute: 30, durationMinutes: 120 };
    case "night":
      return { startHour: 21, startMinute: 0, durationMinutes: 60 };
    case "anytime":
      return { startHour: 12, startMinute: 0, durationMinutes: 120 };
    default:
      return { startHour: 12, startMinute: 0, durationMinutes: kind === "travel" ? 150 : 90 };
  }
}

function selectedStopDescription(
  stopKind: string | undefined,
  venueName: string,
  originalDescription?: string
) {
  const original = (originalDescription ?? "").trim();

  if (stopKind === "stay") {
    return `Use ${venueName} as your base, then start light.`;
  }

  if (stopKind === "food") {
    if (/dinner|end of day|food-forward/i.test(original)) {
      return `Finish with dinner at ${venueName}.`;
    }

    return `Start the day at ${venueName}.`;
  }

  if (stopKind === "activity") {
    if (/still have energy/i.test(original)) {
      return `Add ${venueName} if you still have energy.`;
    }

    if (/main daytime anchor|main anchor/i.test(original)) {
      return `Use ${venueName} as the main daytime anchor.`;
    }

    return `Use ${venueName} as a key stop for the day.`;
  }

  return original || venueName;
}

function stopDetails(
  trip: TripPlan,
  selection: TripSelectionState,
  dayIndex: number,
  stopIndex: number
) {
  const stop = trip.itineraryDays[dayIndex]?.stops?.[stopIndex];
  if (!stop) return null;
  const key = stopKey(dayIndex, stopIndex);
  const customStop = getCustomStopForKey(selection, key);
  const customReplacement = customStop?.kind === stop.kind ? customStop : undefined;

  const hotel = stop.kind === "stay" ? selectedHotel(trip, selection) : undefined;
  const food = stop.kind === "food" ? selectedFood(trip, selection, dayIndex, stopIndex) : undefined;
  const activity =
    stop.kind === "activity"
      ? selectedActivity(trip, selection, dayIndex, stopIndex)
      : undefined;

  const venueName =
    customReplacement?.title ??
    hotel?.name ??
    food?.name ??
    activity?.name ??
    stop.title;
  const title =
    stop.kind === "stay"
      ? `Check in at ${venueName}`
      : venueName;

  const link =
    cleanShareUrl(
      customReplacement ? customReplacement.mapsUrl || customReplacement.websiteUrl : undefined
    ) ||
    cleanShareUrl(hotel?.mapsUrl) ||
    cleanShareUrl(hotel?.websiteUrl) ||
    cleanShareUrl(hotel?.bookingLink) ||
    cleanShareUrl(food?.mapsUrl) ||
    cleanShareUrl(food?.websiteUrl) ||
    cleanShareUrl(food?.link) ||
    cleanShareUrl(activity?.mapsUrl) ||
    cleanShareUrl(activity?.websiteUrl) ||
    cleanShareUrl(activity?.bookingLink) ||
    cleanShareUrl(stop.mapsUrl) ||
    cleanShareUrl(stop.websiteUrl);

  const location =
    customReplacement?.description ??
    hotel?.shortDescription ??
    food?.shortDescription ??
    activity?.shortDescription;

  const descriptionParts = [
    customReplacement
      ? customReplacement.description ??
        selectedStopDescription(stop.kind, venueName, stop.description)
      : selectedStopDescription(stop.kind, venueName, stop.description),
    location,
    link ? `Link: ${link}` : undefined,
  ].filter(Boolean);

  return {
    title,
    description: descriptionParts.join("\n\n"),
    location,
    link,
    timing: stopTiming(
      customReplacement ? customReplacement.time : stop.time,
      stop.kind
    ),
    kind: stop.kind,
  };
}

export function buildTripCalendarIcs(trip: TripPlan) {
  const selection = resolveSelectionState(trip);
  const startDate =
    trip.tripStartDate && isIsoDate(trip.tripStartDate)
      ? trip.tripStartDate
      : getTodayIsoDate();
  const created = new Date();
  const createdStamp = created.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const calendarName = `${trip.destinationName || trip.name || "Weekend trip"} itinerary`;
  const events: string[] = [];

  trip.itineraryDays.forEach((day, dayIndex) => {
    const dateIso = addDaysToIsoDate(startDate, dayIndex) ?? startDate;
    const selectedStay = selectedHotel(trip, selection);

    if (selectedStay && day.stops.some((stop) => stop.kind === "stay")) {
      const stayStart = new Date(`${dateIso}T00:00:00`);
      const stayEnd = new Date(stayStart);
      stayEnd.setDate(stayEnd.getDate() + 1);

      events.push([
        "BEGIN:VEVENT",
        `UID:${trip.id}-stay-${dayIndex}@weekend-trip-planner`,
        `DTSTAMP:${createdStamp}`,
        `DTSTART;VALUE=DATE:${formatIcsDate(stayStart)}`,
        `DTEND;VALUE=DATE:${formatIcsDate(stayEnd)}`,
        `SUMMARY:${escapeIcsText(`Stay at ${selectedStay.name}`)}`,
        `DESCRIPTION:${escapeIcsText(
          [
            selectedStay.shortDescription,
            selectedStay.websiteUrl || selectedStay.bookingLink
              ? `Booking: ${selectedStay.websiteUrl || selectedStay.bookingLink}`
              : undefined,
          ]
            .filter(Boolean)
            .join("\n\n")
        )}`,
        "END:VEVENT",
      ].join("\r\n"));
    }

    day.stops.forEach((_, stopIndex) => {
      const details = stopDetails(trip, selection, dayIndex, stopIndex);
      if (!details || details.kind === "stay") return;

      const start = buildEventDateTime(
        dateIso,
        details.timing.startHour,
        details.timing.startMinute
      );
      const end = new Date(start);
      end.setMinutes(end.getMinutes() + details.timing.durationMinutes);

      events.push([
        "BEGIN:VEVENT",
        `UID:${trip.id}-${dayIndex}-${stopIndex}@weekend-trip-planner`,
        `DTSTAMP:${createdStamp}`,
        `DTSTART:${formatIcsDateTime(start)}`,
        `DTEND:${formatIcsDateTime(end)}`,
        `SUMMARY:${escapeIcsText(details.title)}`,
        `DESCRIPTION:${escapeIcsText(details.description)}`,
        details.location ? `LOCATION:${escapeIcsText(details.location)}` : undefined,
        "END:VEVENT",
      ]
        .filter(Boolean)
        .join("\r\n"));
    });

    getAddedStopsForDay(selection, dayIndex).forEach((addedStop, addedIndex) => {
      const timing = stopTiming(addedStop.time, addedStop.kind);
      const start = buildEventDateTime(dateIso, timing.startHour, timing.startMinute);
      const end = new Date(start);
      end.setMinutes(end.getMinutes() + timing.durationMinutes);

      events.push([
        "BEGIN:VEVENT",
        `UID:${trip.id}-${dayIndex}-added-${addedIndex}@weekend-trip-planner`,
        `DTSTAMP:${createdStamp}`,
        `DTSTART:${formatIcsDateTime(start)}`,
        `DTEND:${formatIcsDateTime(end)}`,
        `SUMMARY:${escapeIcsText(addedStop.title)}`,
        `DESCRIPTION:${escapeIcsText(addedStop.description ?? "Added from builder prompt.")}`,
        addedStop.mapsUrl || addedStop.websiteUrl
          ? `LOCATION:${escapeIcsText(addedStop.mapsUrl || addedStop.websiteUrl)}`
          : undefined,
        "END:VEVENT",
      ]
        .filter(Boolean)
        .join("\r\n"));
    });
  });

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Weekend Trip Planner//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
    ...events,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

export function suggestedCalendarFileName(trip: TripPlan) {
  const base = (trip.destinationName || trip.name || "weekend-trip")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${base || "weekend-trip"}-itinerary.ics`;
}

export function buildTripSummaryText(trip: TripPlan) {
  const selection = resolveSelectionState(trip);
  const dateRange = formatDateRange(trip.tripStartDate, trip.tripEndDate);
  const chosenHotel = selectedHotel(trip, selection);
  const totalBudget =
    trip.budgetBreakdown?.totalExpected ??
    trip.budgetBreakdown?.total ??
    undefined;

  const lines: string[] = [];
  lines.push(`${trip.destinationName || trip.name || "Weekend Trip"}`);

  if (dateRange) {
    lines.push(dateRange);
  }

  lines.push(
    `${trip.summary}${totalBudget ? ` Estimated total: ${formatMoney(totalBudget)}.` : ""}`
  );

  if (chosenHotel?.name) {
    lines.push("");
    lines.push(`Stay: ${chosenHotel.name}`);
    const lodgingLink = preferredHotelShareUrl(trip, selection);
    if (lodgingLink) {
      lines.push(`Lodging link: ${lodgingLink}`);
    }
  }

  trip.itineraryDays.forEach((day, dayIndex) => {
    lines.push("");
    lines.push(`Day ${dayIndex + 1}${day.title ? ` - ${day.title}` : ""}`);
    if (day.summary) {
      lines.push(day.summary);
    }

    day.stops.forEach((stop, stopIndex) => {
      const details = stopDetails(trip, selection, dayIndex, stopIndex);
      if (!details) return;

      const prefix = stop.time ? `${stop.time}: ` : "";
      lines.push(`- ${prefix}${details.title}`);

      if (details.description) {
        details.description.split("\n").forEach((line) => {
          if (line.trim()) {
            lines.push(`  ${line}`);
          }
        });
      }
    });

    getAddedStopsForDay(selection, dayIndex).forEach((addedStop) => {
      const prefix = addedStop.time ? `${addedStop.time}: ` : "";
      lines.push(`- ${prefix}${addedStop.title}`);

      if (addedStop.description) {
        addedStop.description.split("\n").forEach((line) => {
          if (line.trim()) {
            lines.push(`  ${line}`);
          }
        });
      }
    });
  });

  return lines.join("\n");
}
