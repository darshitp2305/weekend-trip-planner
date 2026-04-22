/**
 * Builds trip-aware must-have and recommendation lists for the trip builder.
 * Rules live here so destination/activity packing guidance stays consistent
 * across builder surfaces.
 */

import { TripPlan } from "./types";

export type TripMustHavePriority = "required" | "recommended";

export type TripMustHaveCategory =
  | "Safety"
  | "Weather"
  | "Route"
  | "Activity"
  | "Comfort"
  | "Admin";

export type TripMustHaveItem = {
  id: string;
  title: string;
  detail: string;
  category: TripMustHaveCategory;
  priority: TripMustHavePriority;
  reason: string;
};

export type TripMustHaves = {
  required: TripMustHaveItem[];
  recommended: TripMustHaveItem[];
  signals: string[];
};

function compactText(parts: Array<string | undefined | null>) {
  return parts
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" ")
    .toLowerCase();
}

function tripSignalText(trip: TripPlan) {
  const itineraryText = (trip.itineraryDays ?? [])
    .flatMap((day) => [
      day.title,
      day.summary,
      ...(day.stops ?? []).flatMap((stop) => [
        stop.title,
        stop.description,
        stop.kind,
      ]),
    ])
    .join(" ");

  return compactText([
    trip.destinationName,
    trip.destination,
    trip.name,
    trip.title,
    trip.homeBaseCity,
    trip.province,
    trip.region,
    trip.summary,
    trip.aiSummary,
    trip.tripPrompt,
    trip.driveTimeText,
    itineraryText,
    ...(trip.tags ?? []),
    ...(trip.rawVibes ?? []),
    ...(trip.topActivities ?? []).flatMap((activity) => [
      activity.name,
      activity.type,
      activity.shortDescription,
    ]),
  ]);
}

function hasAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

function monthFromIsoDate(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const month = Number.parseInt(value.slice(5, 7), 10);
  return Number.isFinite(month) ? month : null;
}

function dedupeItems(items: TripMustHaveItem[]) {
  const seen = new Set<string>();
  const result: TripMustHaveItem[] = [];

  for (const item of items) {
    if (seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    result.push(item);
  }

  return result;
}

function item(input: TripMustHaveItem) {
  return input;
}

export function buildTripMustHaves(trip: TripPlan): TripMustHaves {
  const text = tripSignalText(trip);
  const startMonth = monthFromIsoDate(trip.tripStartDate);
  const isWinter =
    hasAny(text, ["winter", "snow", "ski", "skiing", "ice", "frozen"]) ||
    (startMonth !== null && (startMonth <= 3 || startMonth >= 11));
  const isWarmSeason =
    hasAny(text, ["summer", "beach", "lake", "hot spring", "patio"]) ||
    (startMonth !== null && startMonth >= 6 && startMonth <= 8);
  const isHiking = hasAny(text, ["hike", "hiking", "trail", "summit", "lookout"]);
  const isCamping = hasAny(text, ["camp", "camping", "campground"]);
  const isSkiing = hasAny(text, ["ski", "skiing", "snowboard", "snowshoe"]);
  const isCoastal = hasAny(text, ["tofino", "ucluelet", "pacific", "coast", "ocean", "beach"]);
  const isNationalPark = hasAny(text, [
    "banff",
    "jasper",
    "yoho",
    "waterton",
    "lake louise",
    "pacific rim",
    "fundy",
    "gros morne",
  ]);
  const isBearCountry = hasAny(text, [
    "banff",
    "jasper",
    "canmore",
    "kananaskis",
    "lake louise",
    "yoho",
    "waterton",
    "glacier",
    "revelstoke",
    "rockies",
    "rocky mountain",
  ]);
  const isRoadTrip = !trip.isStaycation && !/^0\s*hours?/i.test(trip.driveTimeText ?? "");
  const hasHotWaterMoment = hasAny(text, [
    "hot spring",
    "hot-pool",
    "pool",
    "spa",
    "beach",
    "lake",
    "swim",
  ]);

  const required: TripMustHaveItem[] = [
    item({
      id: "id-wallet",
      title: "Photo ID, payment card, and health card",
      detail: "Keep the basics together so check-in, deposits, and emergency care are not a scramble.",
      category: "Admin",
      priority: "required",
      reason: "Every trip needs core travel admin.",
    }),
    item({
      id: "booking-confirmations",
      title: "Booking confirmations and trip link",
      detail: "Save hotel, activity, and route details somewhere available offline.",
      category: "Admin",
      priority: "required",
      reason: "The builder already has the plan, but the road may not have signal.",
    }),
    item({
      id: "phone-power",
      title: "Charged phone, cable, and car charger",
      detail: "Navigation, check-ins, messages, and emergency calls all depend on it.",
      category: "Route",
      priority: "required",
      reason: "This trip has route and coordination details tied to your phone.",
    }),
    item({
      id: "water",
      title: "Water bottle for each traveler",
      detail: "Bring enough water for the drive and the first stop before you find a refill.",
      category: "Comfort",
      priority: "required",
      reason: "A simple baseline that prevents the first day from starting rough.",
    }),
  ];

  const recommended: TripMustHaveItem[] = [
    item({
      id: "first-aid",
      title: "Small first-aid kit",
      detail: "Bandages, blister care, pain relief, and any personal medication cover most small trip problems.",
      category: "Safety",
      priority: "recommended",
      reason: "Useful for road trips, hikes, and long days away from the hotel.",
    }),
    item({
      id: "snacks",
      title: "Road snacks and electrolytes",
      detail: "Pack enough for delays, late check-in, or a stop that closes earlier than expected.",
      category: "Comfort",
      priority: "recommended",
      reason: "Weekend trips are better when nobody is negotiating hungry.",
    }),
    item({
      id: "offline-maps",
      title: "Downloaded offline maps",
      detail: "Save the destination area and the drive route before leaving home.",
      category: "Route",
      priority: "recommended",
      reason: "Coverage can fade outside major corridors.",
    }),
  ];

  if (isBearCountry) {
    required.push(
      item({
        id: "bear-spray",
        title: "Bear spray",
        detail: "Carry it accessible on trails, not buried in a backpack, and make sure someone knows how to use it.",
        category: "Safety",
        priority: "required",
        reason: isNationalPark
          ? "This destination is in bear country; Banff-style mountain trips need wildlife safety gear."
          : "Mountain and backcountry plans need wildlife safety gear.",
      })
    );
  }

  if (isNationalPark) {
    required.push(
      item({
        id: "park-pass",
        title: "Park pass or day-use entry plan",
        detail: "Check entry, parking, and timed-access requirements before the drive.",
        category: "Admin",
        priority: "required",
        reason: "National park trips can need passes or access planning.",
      })
    );
  }

  if (isRoadTrip) {
    required.push(
      item({
        id: "vehicle-basics",
        title: "Full tank, insurance, and roadside kit",
        detail: "Fuel up before the highway stretch and keep registration, insurance, jumper cables, and a tire plan handy.",
        category: "Route",
        priority: "required",
        reason: "This is planned as a drive-to destination.",
      })
    );
  }

  if (isWinter) {
    required.push(
      item({
        id: "winter-road-kit",
        title: "Winter road kit",
        detail: "Bring warm layers, gloves, scraper, blanket, traction-aware footwear, and extra washer fluid.",
        category: "Weather",
        priority: "required",
        reason: "Snow, ice, or cold-weather signals are part of this trip.",
      })
    );
  }

  if (isHiking) {
    required.push(
      item({
        id: "trail-footwear",
        title: "Trail footwear",
        detail: "Choose shoes with real grip, plus wool socks or blister protection for longer walks.",
        category: "Activity",
        priority: "required",
        reason: "The plan includes hiking or trail time.",
      })
    );
    recommended.push(
      item({
        id: "daypack",
        title: "Daypack with layers",
        detail: "Carry a shell, warm layer, snacks, water, sunscreen, and a small trash bag.",
        category: "Activity",
        priority: "recommended",
        reason: "Trail days go smoother when essentials stay with you.",
      })
    );
  }

  if (isCamping) {
    required.push(
      item({
        id: "camping-sleep-system",
        title: "Sleep system and headlamp",
        detail: "Pack tent/shelter, sleeping bag, sleeping pad, headlamp, and backup batteries.",
        category: "Activity",
        priority: "required",
        reason: "The trip includes camping.",
      })
    );
    recommended.push(
      item({
        id: "food-storage",
        title: "Wildlife-safe food storage",
        detail: "Use approved storage where required and never leave scented items loose around camp.",
        category: "Safety",
        priority: "recommended",
        reason: "Camping plans need extra food and scent management.",
      })
    );
  }

  if (isSkiing) {
    required.push(
      item({
        id: "ski-gear",
        title: "Ski gear or rental reservation",
        detail: "Confirm boots, helmet, goggles, gloves, pass or rental pickup, and warm base layers.",
        category: "Activity",
        priority: "required",
        reason: "The plan includes skiing or snow activity.",
      })
    );
  }

  if (isWarmSeason) {
    recommended.push(
      item({
        id: "sun-protection",
        title: "Sunscreen, hat, and sunglasses",
        detail: "Even mountain and shoulder-season days can burn fast in open viewpoints or on water.",
        category: "Weather",
        priority: "recommended",
        reason: "Warm-season and outdoor signals are present.",
      })
    );
  }

  if (isCoastal) {
    recommended.push(
      item({
        id: "rain-shell",
        title: "Rain shell and dry bag",
        detail: "Coastal weather can shift quickly, and a dry bag keeps phones and layers usable.",
        category: "Weather",
        priority: "recommended",
        reason: "The destination has coastal or beach signals.",
      })
    );
  }

  if (hasHotWaterMoment) {
    recommended.push(
      item({
        id: "swim-kit",
        title: "Swimwear and quick-dry towel",
        detail: "Useful for hot springs, hotel pools, lake stops, spa plans, or a beach detour.",
        category: "Comfort",
        priority: "recommended",
        reason: "The itinerary mentions water, pools, beaches, or hot springs.",
      })
    );
  }

  const packingNote = trip.departurePlan?.packingNote?.trim();
  if (packingNote) {
    required.push(
      item({
        id: "saved-packing-note",
        title: "Saved packing note",
        detail: packingNote,
        category: "Admin",
        priority: "required",
        reason: "Added by the trip organizer.",
      })
    );
  }

  const signals = [
    isBearCountry ? "Bear country" : null,
    isNationalPark ? "National park" : null,
    isRoadTrip ? "Road trip" : null,
    isWinter ? "Winter conditions" : null,
    isHiking ? "Hiking" : null,
    isCamping ? "Camping" : null,
    isSkiing ? "Skiing" : null,
    isCoastal ? "Coastal weather" : null,
  ].filter((signal): signal is string => Boolean(signal));

  return {
    required: dedupeItems(required),
    recommended: dedupeItems(recommended),
    signals,
  };
}
