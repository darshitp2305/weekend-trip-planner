"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import AccountPanel, { type AccountPanelUser } from "../components/AccountPanel";
import BrandLogo, { BrandMark } from "../components/BrandLogo";
import TripCard from "../components/TripCard";
import TripForm from "../components/TripForm";
import rawDestinations from "../lib/destinationCatalog";
import { trackProductEvent } from "../lib/productAnalytics";
import { normalizeTripImageSet } from "../lib/tripImages";
import { ProviderOutcome, RankedDestination, RawDestination, TripInput } from "../lib/types";
import { displayNameFromEmail } from "../lib/viewerIdentity";

type PlannerErrorCode = "invalid_trip_prompt" | "invalid_builder_prompt";
type PlannerValidationReason =
  | "empty"
  | "unreadable"
  | "low_signal"
  | "unsupported_destination";

type RankTripsResponse = {
  success?: boolean;
  error?: string;
  errorCode?: PlannerErrorCode | string;
  validationReason?: PlannerValidationReason | string;
  results?: RankedDestination[];
  usedLiveData?: boolean;
  normalizedInput?: TripInput;
  promptParseStatus?: ProviderOutcome;
  noMatchDiagnostics?: {
    headline?: string;
    reasons?: string[];
  } | null;
};

type GenerateTripResponse = {
  success?: boolean;
  error?: string;
  errorCode?: PlannerErrorCode | string;
  validationReason?: PlannerValidationReason | string;
  source?: "live-openai" | "fallback-template";
  results?: RankedDestination[];
  trips?: RankedDestination[];
  destinations?: RankedDestination[];
  rankings?: RankedDestination[];
  normalizedInput?: TripInput;
  promptParseStatus?: ProviderOutcome;
};

type EnrichTripResponse = {
  success?: boolean;
  trip?: RankedDestination | null;
  source?: "live-google-places" | "static-fallback" | "static-ranking";
};

type StoredPageState = {
  currentTrip?: RankedDestination | null;
  shownDestinationNames?: string[];
  lastInput?: TripInput | null;
  aiStatusMessage?: string;
};

type FeaturedHero = {
  name: string;
  imageUrl: string;
  imageUrlLight: string;
  imageUrlDark: string;
  eyebrow: string;
  caption: string;
  detail: string;
};

type PromptSuggestion = {
  text: string;
  token: number;
};

type HomePromptCard = {
  id: string;
  title: string;
  eyebrow: string;
  caption: string;
  chips: string[];
  prompt: string;
  imageUrl: string;
  imageUrlLight: string;
  imageUrlDark: string;
  imagePosition?: string;
};

type HomePromptCollections = {
  season: "Spring" | "Summer" | "Fall" | "Winter";
  inSeason: HomePromptCard[];
  mustSee: HomePromptCard[];
};

const LAST_INPUT_STORAGE_KEY = "weekend-trip-last-input";
const PAGE_STATE_STORAGE_KEY = "weekend-trip-page-state";
const DESTINATION_SOURCE = rawDestinations as RawDestination[];

function ensureTripImage(trip: RankedDestination): RankedDestination {
  const imageSet = normalizeTripImageSet(
    {
      imageUrl: trip.imageUrl,
      imageUrlLight: trip.imageUrlLight,
      imageUrlDark: trip.imageUrlDark,
    },
    trip.name
  );

  return {
    ...trip,
    imageUrl: imageSet.defaultUrl,
    imageUrlLight: imageSet.lightUrl,
    imageUrlDark: imageSet.darkUrl,
  };
}

function dedupeDestinationNames(names: string[]) {
  return Array.from(new Set(names.map((name) => name.trim()).filter(Boolean)));
}

function extractResults(
  payload: GenerateTripResponse | null | undefined
): RankedDestination[] | null {
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.trips)) return payload.trips;
  if (Array.isArray(payload?.destinations)) return payload.destinations;
  if (Array.isArray(payload?.rankings)) return payload.rankings;
  return null;
}

function joinLabels(labels: string[]) {
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

function isFeaturedPhotoUrl(value?: string) {
  const url = value?.trim();
  if (!url) return false;

  return (
    /^https?:\/\//i.test(url) &&
    !url.toLowerCase().includes("/destinations/theme/") &&
    !url.toLowerCase().includes("data:image/svg+xml")
  );
}

function plannerErrorMessage(
  payload: { error?: string } | null | undefined,
  fallback: string
) {
  if (typeof payload?.error === "string" && payload.error.trim()) {
    return payload.error.trim();
  }

  return fallback;
}

function buildHeroCandidates() {
  return DESTINATION_SOURCE
    .filter(
      (destination) =>
        isFeaturedPhotoUrl(destination.image_url) &&
        !destination.is_staycation &&
        destination.vibes.some((vibe) =>
          ["nature", "adventure", "relax", "winter_fun"].includes(vibe)
        )
    )
    .map((destination) => {
      const imageSet = normalizeTripImageSet(
        {
          imageUrl: destination.image_url,
          imageUrlLight: destination.image_url,
          imageUrlDark: destination.image_url,
        },
        destination.name
      );
      const caption =
        destination.anchor_experiences[0]?.description?.trim() ||
        `Built around ${joinLabels(destination.vibes.slice(0, 3))} energy in ${destination.name}.`;

      const detail = destination.anchor_experiences
        .slice(0, 2)
        .map((experience) => experience.title)
        .filter(Boolean)
        .join(" · ");

      return {
        name: destination.name,
        imageUrl: imageSet.defaultUrl,
        imageUrlLight: imageSet.lightUrl,
        imageUrlDark: imageSet.darkUrl,
        eyebrow: destination.region,
        caption,
        detail: detail || destination.home_base_city,
      };
    });
}

const HERO_CANDIDATES = buildHeroCandidates();
const DEFAULT_HERO_IMAGE_SET = normalizeTripImageSet(
  {
    imageUrl:
      "https://commons.wikimedia.org/wiki/Special:Redirect/file/Lake_Louise%2C_Canada%2C_Banff.jpg",
    imageUrlLight:
      "https://commons.wikimedia.org/wiki/Special:Redirect/file/Lake_Louise%2C_Canada%2C_Banff.jpg",
    imageUrlDark:
      "https://commons.wikimedia.org/wiki/Special:Redirect/file/Lake_Louise%2C_Canada%2C_Banff.jpg",
  },
  "Banff"
);
const DEFAULT_HERO: FeaturedHero = HERO_CANDIDATES[0] ?? {
  name: "Banff",
  imageUrl: DEFAULT_HERO_IMAGE_SET.defaultUrl,
  imageUrlLight: DEFAULT_HERO_IMAGE_SET.lightUrl,
  imageUrlDark: DEFAULT_HERO_IMAGE_SET.darkUrl,
  eyebrow: "Alberta",
  caption: "A cinematic Canadian mountain escape, refreshed into the planner as a reliable featured pick.",
  detail: "Lake views and mountain town base",
};

function getDestinationById(destinationId: string) {
  return DESTINATION_SOURCE.find((destination) => destination.id === destinationId);
}

function buildHomePromptCard(config: {
  id: string;
  destinationId: string;
  title: string;
  eyebrow: string;
  caption: string;
  chips: string[];
  prompt: string;
  imageUrl?: string;
  imageUrlLight?: string;
  imageUrlDark?: string;
  imagePosition?: string;
}): HomePromptCard | null {
  const destination = getDestinationById(config.destinationId);
  if (!destination) {
    return null;
  }

  const imageSet = normalizeTripImageSet(
    {
      imageUrl:
        config.imageUrl ??
        config.imageUrlLight ??
        destination.image_url_light ??
        destination.image_url,
      imageUrlLight:
        config.imageUrlLight ??
        config.imageUrl ??
        destination.image_url_light ??
        destination.image_url,
      imageUrlDark:
        config.imageUrlDark ??
        config.imageUrlLight ??
        config.imageUrl ??
        destination.image_url_dark ??
        destination.image_url_light ??
        destination.image_url,
    },
    destination.name
  );

  return {
    id: config.id,
    title: config.title,
    eyebrow: config.eyebrow,
    caption: config.caption,
    chips: config.chips,
    prompt: config.prompt,
    imageUrl: imageSet.defaultUrl,
    imageUrlLight: imageSet.lightUrl,
    imageUrlDark: imageSet.darkUrl,
    imagePosition: config.imagePosition,
  };
}

function compactCards(cards: Array<HomePromptCard | null>) {
  return cards.filter((card): card is HomePromptCard => Boolean(card));
}

const HOME_PROMPT_LIBRARY: Record<
  "Spring" | "Summer" | "Fall" | "Winter",
  Omit<HomePromptCollections, "season">
> = {
  Spring: {
    inSeason: compactCards([
      buildHomePromptCard({
        id: "spring-vancouver-blossoms",
        destinationId: "vancouver_staycation_bc",
        title: "Cherry blossom season in Vancouver",
        eyebrow: "In season now",
        caption:
          "Soft pink streets, coffee stops, and long seawall walks make spring weekends feel easy to say yes to.",
        chips: ["Spring", "Coffee", "City walks"],
        prompt:
          "Plan a spring Vancouver staycation around cherry blossoms, great coffee, long park walks, and one memorable dinner for 2 travelers.",
        imageUrl: "/home-prompts/vancouver-cherry-blossom.jpg",
        imagePosition: "center 82%",
      }),
      buildHomePromptCard({
        id: "spring-victoria-gardens",
        destinationId: "victoria_staycation_bc",
        title: "Garden season in Victoria",
        eyebrow: "In season now",
        caption:
          "Harbour light, blooming gardens, and a polished downtown make this feel like a clean spring reset.",
        chips: ["Spring", "Gardens", "Harbour"],
        prompt:
          "Plan a spring Victoria weekend from Vancouver around gardens in bloom, harbour walks, good coffee, and a low-stress overnight stay for 2 travelers.",
        imageUrl: "/home-prompts/victoria-garden-season.jpg",
        imagePosition: "center 58%",
      }),
    ]),
    mustSee: compactCards([
      buildHomePromptCard({
        id: "spring-tofino-shoulder",
        destinationId: "tofino_ucluelet_bc",
        title: "Tofino shoulder-season ocean weekend",
        eyebrow: "Must see right now",
        caption:
          "Cool air, dramatic beaches, and cozy cafes make spring feel cinematic without peak-summer crowds.",
        chips: ["Ocean", "Spring", "Cozy"],
        prompt:
          "Plan a spring road trip to Tofino / Ucluelet from Vancouver with dramatic beach walks, cozy cafes, ocean views, and a relaxed overnight pace for 2 travelers.",
        imageUrl: "/home-prompts/tofino-ocean-weekend.jpg",
        imagePosition: "center 68%",
      }),
      buildHomePromptCard({
        id: "spring-squamish-hikes",
        destinationId: "squamish_bc",
        title: "Early hiking weekends in Squamish",
        eyebrow: "Must see right now",
        caption:
          "This is the fast-payoff mountain answer when you want one scenic hike and a strong coffee stop without overcommitting.",
        chips: ["Hiking", "Mountains", "Easy from Vancouver"],
        prompt:
          "Plan a spring Squamish getaway from Vancouver with one scenic hike, good coffee, mountain viewpoints, and a budget-friendly overnight for 2 travelers.",
        imageUrl: "/home-prompts/squamish-hiking-weekend.jpg",
        imagePosition: "center 18%",
      }),
    ]),
  },
  Summer: {
    inSeason: compactCards([
      buildHomePromptCard({
        id: "summer-whistler-alpine",
        destinationId: "whistler_bc",
        title: "Alpine lake season in Whistler",
        eyebrow: "In season now",
        caption:
          "Summer is when the lakes, gondola views, and patio energy all line up at once.",
        chips: ["Summer", "Alpine", "Lakes"],
        prompt:
          "Plan a summer Whistler trip from Vancouver with an alpine lake feel, one scenic hike, good coffee, and enough wow factor for 2 travelers.",
      }),
      buildHomePromptCard({
        id: "summer-niagara-patio",
        destinationId: "niagara_on_the_lake_on",
        title: "Patio and wine season in Niagara-on-the-Lake",
        eyebrow: "In season now",
        caption:
          "This is the polished summer answer when you want gardens, wine, and walkable old-town energy.",
        chips: ["Summer", "Wine", "Patios"],
        prompt:
          "Plan a summer Niagara-on-the-Lake getaway with patio meals, winery stops, garden streets, and a romantic overnight for 2 travelers.",
      }),
    ]),
    mustSee: compactCards([
      buildHomePromptCard({
        id: "summer-tofino-beaches",
        destinationId: "tofino_ucluelet_bc",
        title: "Sunset beach weekends in Tofino",
        eyebrow: "Must see right now",
        caption:
          "When the days stretch out, this is one of the highest-payoff coastal weekends in the planner.",
        chips: ["Summer", "Beach", "Sunset"],
        prompt:
          "Plan a summer Tofino / Ucluelet trip from Vancouver with beach time, one scenic coastal walk, good coffee, and a laid-back overnight for 2 travelers.",
      }),
      buildHomePromptCard({
        id: "summer-quebec-city-festival",
        destinationId: "quebec_city_qc",
        title: "Festival nights in Quebec City",
        eyebrow: "Must see right now",
        caption:
          "Historic streets plus summer-night energy make this feel bigger than a normal city weekend.",
        chips: ["Summer", "Old city", "Festivals"],
        prompt:
          "Plan a summer Quebec City weekend from Montreal with old-city wandering, great food, one standout view, and evening festival energy for 2 travelers.",
      }),
    ]),
  },
  Fall: {
    inSeason: compactCards([
      buildHomePromptCard({
        id: "fall-charlevoix-colours",
        destinationId: "charlevoix_qc",
        title: "Fall colour season in Charlevoix",
        eyebrow: "In season now",
        caption:
          "This is the classic drive-for-the-leaves answer when you want scenery to do most of the work.",
        chips: ["Fall", "Scenic drive", "Colour"],
        prompt:
          "Plan a fall Charlevoix road trip from Montreal with peak colours, scenic pull-offs, cozy food stops, and one memorable overnight for 2 travelers.",
      }),
      buildHomePromptCard({
        id: "fall-eastern-townships-harvest",
        destinationId: "eastern_townships_qc",
        title: "Harvest weekends in the Eastern Townships",
        eyebrow: "In season now",
        caption:
          "Apple orchards, rolling roads, and cafe stops make this feel easy and high-reward.",
        chips: ["Fall", "Harvest", "Cafe stops"],
        prompt:
          "Plan a fall Eastern Townships getaway from Montreal with harvest-season stops, cozy cafes, scenic roads, and a relaxed overnight for 2 travelers.",
      }),
    ]),
    mustSee: compactCards([
      buildHomePromptCard({
        id: "fall-niagara-harvest",
        destinationId: "niagara_on_the_lake_on",
        title: "Wine harvest in Niagara-on-the-Lake",
        eyebrow: "Must see right now",
        caption:
          "This is the soft-luxury fall weekend when you want vineyards, good food, and zero rough edges.",
        chips: ["Fall", "Wine", "Romantic"],
        prompt:
          "Plan a fall Niagara-on-the-Lake weekend with winery stops, small-town streets, standout meals, and an easy romantic overnight for 2 travelers.",
      }),
      buildHomePromptCard({
        id: "fall-quebec-city-crisp",
        destinationId: "quebec_city_qc",
        title: "Crisp cafe weekends in Quebec City",
        eyebrow: "Must see right now",
        caption:
          "If you want atmosphere over distance, old stone streets and cool weather do the work here.",
        chips: ["Fall", "Cafe", "City break"],
        prompt:
          "Plan a fall Quebec City weekend from Montreal with crisp-weather walks, great coffee, historic streets, and one standout meal for 2 travelers.",
      }),
    ]),
  },
  Winter: {
    inSeason: compactCards([
      buildHomePromptCard({
        id: "winter-whistler-ski",
        destinationId: "whistler_bc",
        title: "Ski season in Whistler",
        eyebrow: "In season now",
        caption:
          "When winter is the point, this is the easy high-confidence pick for snow payoff.",
        chips: ["Winter", "Skiing", "Village"],
        prompt:
          "Plan a winter Whistler trip from Vancouver around skiing, village coffee stops, one scenic viewpoint, and a polished overnight for 2 travelers.",
      }),
      buildHomePromptCard({
        id: "winter-yellowknife-aurora",
        destinationId: "yellowknife_staycation_nt",
        title: "Aurora season in Yellowknife",
        eyebrow: "In season now",
        caption:
          "This is the dramatic winter move when you want the trip to feel unforgettable from the start.",
        chips: ["Winter", "Aurora", "Bucket list"],
        prompt:
          "Plan a winter Yellowknife staycation around aurora viewing, warm coffee stops, and one memorable local experience for 2 travelers.",
      }),
    ]),
    mustSee: compactCards([
      buildHomePromptCard({
        id: "winter-quebec-city-magic",
        destinationId: "quebec_city_qc",
        title: "Winter magic in Quebec City",
        eyebrow: "Must see right now",
        caption:
          "Snowy old streets and cozy hotels make this one of the best atmosphere-first winter weekends.",
        chips: ["Winter", "Old city", "Cozy"],
        prompt:
          "Plan a winter Quebec City weekend from Montreal with snowy old-city streets, cozy cafes, festive lights, and one memorable dinner for 2 travelers.",
      }),
      buildHomePromptCard({
        id: "winter-banff-snow",
        destinationId: "banff_ab",
        title: "Snowy mountain weekends in Banff",
        eyebrow: "Must see right now",
        caption:
          "For a winter mountain hit without guesswork, this is still one of the strongest visual payoffs in the planner.",
        chips: ["Winter", "Mountains", "Scenic"],
        prompt:
          "Plan a winter Banff weekend from Calgary with snowy mountain views, a relaxing hot-pool moment, good coffee, and one easy scenic walk for 2 travelers.",
      }),
    ]),
  },
};

function getFeaturedHeroForDate(referenceDate = new Date()) {
  if (HERO_CANDIDATES.length === 0) {
    return DEFAULT_HERO;
  }

  const key = Number(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Edmonton",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .format(referenceDate)
      .replaceAll("-", "")
  );

  return HERO_CANDIDATES[key % HERO_CANDIDATES.length] ?? DEFAULT_HERO;
}

function getCurrentSeason(referenceDate = new Date()) {
  const month = Number(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Edmonton",
      month: "2-digit",
    }).format(referenceDate)
  );

  if (month >= 3 && month <= 5) {
    return "Spring";
  }
  if (month >= 6 && month <= 8) {
    return "Summer";
  }
  if (month >= 9 && month <= 11) {
    return "Fall";
  }
  return "Winter";
}

function getHomePromptCollectionsForDate(
  referenceDate = new Date()
): HomePromptCollections {
  const season = getCurrentSeason(referenceDate);
  const promptSet = HOME_PROMPT_LIBRARY[season];

  return {
    season,
    inSeason: promptSet.inSeason,
    mustSee: promptSet.mustSee,
  };
}

function HomePromptCardGrid({
  cards,
  onSelect,
}: {
  cards: HomePromptCard[];
  onSelect: (prompt: string) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {cards.map((card) => (
        <div
          key={card.id}
          className="group w-full"
        >
          <div className="relative overflow-hidden rounded-[1.55rem] bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))] shadow-[0_16px_40px_rgba(148,163,184,0.12)] ring-1 ring-white/8 transition duration-300 group-hover:-translate-y-1 group-hover:shadow-[0_24px_56px_rgba(148,163,184,0.2)] group-hover:ring-[#d9b57c]/35 dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.025))] dark:shadow-[0_16px_40px_rgba(0,0,0,0.22)] dark:ring-white/8 dark:group-hover:shadow-[0_24px_56px_rgba(0,0,0,0.32)] dark:group-hover:ring-[#7decc7]/24">
            <button
              type="button"
              onClick={() => onSelect(card.prompt)}
              className="block w-full appearance-none bg-transparent p-0 text-left align-top"
            >
              <div className="relative h-40 overflow-hidden">
                <Image
                  src={card.imageUrlLight}
                  alt=""
                  fill
                  sizes="(max-width: 640px) 100vw, 50vw"
                  className="absolute inset-0 object-cover transition duration-700 ease-out group-hover:scale-[1.05] dark:hidden"
                  style={{ objectPosition: card.imagePosition ?? "center" }}
                />
                <Image
                  src={card.imageUrlDark}
                  alt=""
                  fill
                  sizes="(max-width: 640px) 100vw, 50vw"
                  className="absolute inset-0 hidden object-cover transition duration-700 ease-out group-hover:scale-[1.05] dark:block"
                  style={{ objectPosition: card.imagePosition ?? "center" }}
                />
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(8,14,23,0.16),rgba(8,14,23,0.74))] transition duration-300 group-hover:bg-[linear-gradient(180deg,rgba(8,14,23,0.08),rgba(8,14,23,0.68))]" />
                <div className="absolute inset-x-0 bottom-0 p-4 transition duration-300 group-hover:translate-y-[-2px]">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/72">
                    {card.eyebrow}
                  </div>
                  <div className="mt-2 max-w-[18rem] text-[1.45rem] font-semibold leading-tight tracking-[-0.03em] text-white">
                    {card.title}
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-200/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-4 transition duration-300 group-hover:bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))] dark:border-white/8 dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] dark:group-hover:bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))]">
                <p className="text-sm leading-6 text-slate-700 transition duration-300 dark:text-white/72 dark:group-hover:text-white/82">
                  {card.caption}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {card.chips.map((chip) => (
                    <span
                      key={`${card.id}-${chip}`}
                      className="inline-flex items-center rounded-full border border-slate-200/70 bg-[#fbf7ef]/76 px-3 py-1.5 text-xs font-medium text-slate-800 transition duration-300 group-hover:border-[#d9b57c]/30 group-hover:bg-[#fff7eb]/88 dark:border-white/12 dark:bg-white/8 dark:text-white/82 dark:group-hover:border-[#7decc7]/18 dark:group-hover:bg-white/10"
                    >
                      {chip}
                    </span>
                  ))}
                </div>
              </div>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

async function enrichSelectedTrip(
  trip: RankedDestination,
  input: TripInput
): Promise<RankedDestination> {
  try {
    const response = await fetch("/api/enrich-trip", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        trip,
        input,
      }),
    });

    const text = await response.text();
    let data: EnrichTripResponse | null = null;

    if (text) {
      try {
        data = JSON.parse(text);
      } catch (parseError) {
        console.error(
          "Failed to parse /api/enrich-trip response:",
          parseError,
          text
        );
      }
    }

    if (!response.ok) {
      console.error("/api/enrich-trip failed:", response.status, data);
      return trip;
    }

    return data?.trip ? ensureTripImage(data.trip) : trip;
  } catch (error) {
    console.error("Trip enrichment failed, using generated trip:", error);
    return trip;
  }
}

function SkeletonTripCard() {
  return (
    <div className="animate-pulse overflow-hidden rounded-[2rem] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(243,247,252,0.98))] shadow-[0_28px_80px_rgba(148,163,184,0.16)] dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(12,18,30,0.98),rgba(10,16,27,0.94))] dark:shadow-[0_28px_80px_rgba(0,0,0,0.3)]">
      <div className="h-72 w-full bg-slate-200/80 dark:bg-white/8" />
      <div className="space-y-4 p-6">
        <div className="h-8 w-72 rounded bg-slate-200 dark:bg-white/10" />
        <div className="h-5 w-48 rounded bg-slate-200/80 dark:bg-white/8" />
        <div className="space-y-2">
          <div className="h-4 w-full rounded bg-slate-200/80 dark:bg-white/8" />
          <div className="h-4 w-11/12 rounded bg-slate-200/80 dark:bg-white/8" />
          <div className="h-4 w-8/12 rounded bg-slate-200/80 dark:bg-white/8" />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="h-20 rounded-2xl bg-slate-200/70 dark:bg-white/6" />
          <div className="h-20 rounded-2xl bg-slate-200/70 dark:bg-white/6" />
          <div className="h-20 rounded-2xl bg-slate-200/70 dark:bg-white/6" />
        </div>
      </div>
    </div>
  );
}

function recommendationHeading(confidence?: RankedDestination["confidence"]) {
  switch (confidence) {
    case "high":
      return "High-conviction recommendation";
    case "medium":
      return "Best-fit recommendation";
    case "low":
      return "Closest strong option";
    default:
      return "Trip recommendation";
  }
}

function recommendationDescription(confidence?: RankedDestination["confidence"]) {
  switch (confidence) {
    case "high":
      return "This is the trip that best matches the brief. If it is close but not perfect, open it and tune the days instead of starting over.";
    case "medium":
      return "This is the best current fit. A few details may still need builder edits or live verification before you lock it in.";
    case "low":
      return "This is the closest trip shape available right now. Expect to swap stops, tighten the pacing, or refine the plan in the builder.";
    default:
      return "This is the trip that best fits the brief right now, with room to tune the details inside the builder.";
  }
}

export default function HomePage() {
  const [loading, setLoading] = useState(false);
  const [currentTrip, setCurrentTrip] = useState<RankedDestination | null>(null);
  const [shownDestinationNames, setShownDestinationNames] = useState<string[]>(
    []
  );
  const [lastInput, setLastInput] = useState<TripInput | null>(null);
  const [aiStatusMessage, setAiStatusMessage] = useState("");
  const [destinationConstraintModal, setDestinationConstraintModal] = useState<{
    title: string;
    reasons: string[];
  } | null>(null);
  const [waitingForTripText, setWaitingForTripText] = useState(false);
  const [restored, setRestored] = useState(false);
  const [savedTripsOpen, setSavedTripsOpen] = useState(false);
  const [accountUser, setAccountUser] = useState<AccountPanelUser | null>(null);
  const [featuredHero, setFeaturedHero] = useState<FeaturedHero>(DEFAULT_HERO);
  const [promptSuggestion, setPromptSuggestion] = useState<PromptSuggestion | null>(
    null
  );
  const tripFormRef = useRef<HTMLDivElement | null>(null);
  const tripResultRef = useRef<HTMLElement | null>(null);
  const shouldAutoScrollTripRef = useRef(false);
  const accountTriggerLabel = accountUser
    ? displayNameFromEmail(accountUser.email)
    : "Log in";
  const homePromptCollections = getHomePromptCollectionsForDate();

  const persistPageState = useCallback(
    (nextState: StoredPageState) => {
      if (typeof window === "undefined") return;

      try {
        sessionStorage.setItem(
          PAGE_STATE_STORAGE_KEY,
          JSON.stringify({
            currentTrip: nextState.currentTrip ?? currentTrip,
            shownDestinationNames:
              nextState.shownDestinationNames ?? shownDestinationNames,
            lastInput: nextState.lastInput ?? lastInput,
            aiStatusMessage: nextState.aiStatusMessage ?? aiStatusMessage,
          })
        );
      } catch (error) {
        console.error("Failed to persist planner page state:", error);
      }
    },
    [aiStatusMessage, currentTrip, lastInput, shownDestinationNames]
  );

  useEffect(() => {
    setFeaturedHero(getFeaturedHeroForDate());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const currentUrl = new URL(window.location.href);
    if (
      currentUrl.searchParams.get("code") &&
      window.location.pathname !== "/auth/callback"
    ) {
      window.location.replace(`/auth/callback${currentUrl.search}`);
      return;
    }

    try {
      const raw = sessionStorage.getItem(PAGE_STATE_STORAGE_KEY);
      if (!raw) return;

      const saved = JSON.parse(raw) as StoredPageState;

      if (saved.currentTrip) {
        setCurrentTrip(saved.currentTrip);
      }

      if (Array.isArray(saved.shownDestinationNames)) {
        setShownDestinationNames(
          saved.shownDestinationNames.filter(
            (name): name is string =>
              typeof name === "string" && name.trim().length > 0
          )
        );
      }

      if (saved.lastInput) {
        setLastInput(saved.lastInput);
      }

      if (typeof saved.aiStatusMessage === "string") {
        setAiStatusMessage(saved.aiStatusMessage);
      }
    } catch (error) {
      console.error("Failed to restore planner page state:", error);
    } finally {
      setRestored(true);
    }
  }, []);

  useEffect(() => {
    if (!restored) return;
    persistPageState({});
  }, [persistPageState, restored]);

  useEffect(() => {
    if (
      !shouldAutoScrollTripRef.current ||
      loading ||
      waitingForTripText ||
      !currentTrip ||
      typeof window === "undefined"
    ) {
      return;
    }

    const tripResult = tripResultRef.current;
    if (!tripResult) return;

    shouldAutoScrollTripRef.current = false;

    window.requestAnimationFrame(() => {
      const prefersReducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches;

      tripResult.scrollIntoView({
        behavior: prefersReducedMotion ? "auto" : "smooth",
        block: "start",
      });
    });
  }, [currentTrip, loading, waitingForTripText]);

  async function handleGenerate(
    input: TripInput,
    options?: {
      excludedDestinationNames?: string[];
      resetShownDestinationNames?: boolean;
    }
  ) {
    setLoading(true);
    setWaitingForTripText(true);
    setLastInput(input);
    setAiStatusMessage("");
    setDestinationConstraintModal(null);
    shouldAutoScrollTripRef.current = true;

    const excludedDestinationNames = dedupeDestinationNames(
      options?.excludedDestinationNames ?? []
    );
    const shouldResetShownDestinationNames =
      options?.resetShownDestinationNames || excludedDestinationNames.length === 0;

    if (typeof window !== "undefined") {
      try {
        sessionStorage.setItem(LAST_INPUT_STORAGE_KEY, JSON.stringify(input));
      } catch (error) {
        console.error("Failed to persist last generated input:", error);
      }
    }

    persistPageState({
      currentTrip: null,
      shownDestinationNames: shouldResetShownDestinationNames
        ? []
        : shownDestinationNames,
      lastInput: input,
      aiStatusMessage: "",
    });

    try {
      const rankResponse = await fetch("/api/rank-trips", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input,
          excludedDestinationNames,
        }),
      });

      const rankText = await rankResponse.text();
      let rankData: RankTripsResponse | null = null;

      if (rankText) {
        try {
          rankData = JSON.parse(rankText);
        } catch (parseError) {
          console.error(
            "Failed to parse /api/rank-trips response:",
            parseError,
            rankText
          );
        }
      }

      if (!rankResponse.ok) {
        const message = plannerErrorMessage(
          rankData,
          "I couldn't build that trip yet. Try rewording the request and try again."
        );
        console.error("/api/rank-trips failed:", rankResponse.status, rankData);
        shouldAutoScrollTripRef.current = false;
        setCurrentTrip(null);
        if (shouldResetShownDestinationNames) {
          setShownDestinationNames([]);
        }
        setAiStatusMessage(message);
        persistPageState({
          currentTrip: null,
          shownDestinationNames: shouldResetShownDestinationNames
            ? []
            : shownDestinationNames,
          lastInput: input,
          aiStatusMessage: message,
        });
        return;
      }

      const resolvedInput = rankData?.normalizedInput ?? input;
      setLastInput(resolvedInput);
      if (typeof window !== "undefined") {
        try {
          sessionStorage.setItem(
            LAST_INPUT_STORAGE_KEY,
            JSON.stringify(resolvedInput)
          );
        } catch (error) {
          console.error("Failed to persist resolved planner input:", error);
        }
      }

      if (!rankData?.results || rankData.results.length === 0) {
        if (excludedDestinationNames.length > 0) {
          await handleGenerate(resolvedInput, { resetShownDestinationNames: true });
          return;
        }

        shouldAutoScrollTripRef.current = false;
        setCurrentTrip(null);
        setShownDestinationNames([]);

        const diagnosticHeadline =
          typeof rankData?.noMatchDiagnostics?.headline === "string"
            ? rankData.noMatchDiagnostics.headline.trim()
            : "";
        const diagnosticReasons = Array.isArray(rankData?.noMatchDiagnostics?.reasons)
          ? rankData.noMatchDiagnostics.reasons
              .filter(
                (reason): reason is string =>
                  typeof reason === "string" && reason.trim().length > 0
              )
              .map((reason) => reason.trim())
          : [];
        const noMatchMessage = [diagnosticHeadline, ...diagnosticReasons]
          .filter(Boolean)
          .join(" ");

        if (resolvedInput.preferredDestination) {
          const destinationLabel = resolvedInput.preferredDestination.trim();
          const destinationWasNotFound =
            diagnosticHeadline.toLowerCase().includes("could not find");
          setDestinationConstraintModal({
            title:
              destinationWasNotFound && diagnosticHeadline
                ? diagnosticHeadline
                : destinationLabel
                  ? `${destinationLabel} does not fit this trip`
                  : "This destination does not fit this trip",
            reasons:
              diagnosticReasons.length > 0
                ? diagnosticReasons.slice(0, 2)
                : diagnosticHeadline
                  ? [diagnosticHeadline]
                  : ["It does not fit the current trip limits."],
          });
          setAiStatusMessage("");
        } else {
          setAiStatusMessage(noMatchMessage);
        }

        persistPageState({
          currentTrip: null,
          shownDestinationNames: [],
          lastInput: resolvedInput,
          aiStatusMessage: resolvedInput.preferredDestination ? "" : noMatchMessage,
        });
        return;
      }

      const rankedTrip = ensureTripImage(rankData.results[0]);
      const nextShownDestinationNames = dedupeDestinationNames([
        ...(shouldResetShownDestinationNames ? [] : shownDestinationNames),
        rankedTrip.name,
      ]);

      setCurrentTrip(rankedTrip);
      setShownDestinationNames(nextShownDestinationNames);
      persistPageState({
        currentTrip: rankedTrip,
        shownDestinationNames: nextShownDestinationNames,
        lastInput: resolvedInput,
        aiStatusMessage: "",
      });

      try {
        const response = await fetch("/api/generate-trip", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            input: resolvedInput,
            results: [rankedTrip],
            promptInputResolved: true,
            promptParseStatus: rankData?.promptParseStatus,
          }),
        });

        const text = await response.text();
        let data: GenerateTripResponse | null = null;

        if (text) {
          try {
            data = JSON.parse(text);
          } catch (parseError) {
            console.error(
              "Failed to parse /api/generate-trip response:",
              parseError,
              text
            );
          }
        }

        if (!response.ok) {
          console.error("/api/generate-trip failed:", response.status, data);
          const fallbackMessage = rankData.usedLiveData
            ? "Built from live place data with fallback trip copy."
            : "Built from ranked trip data with fallback trip copy.";
          setAiStatusMessage(fallbackMessage);
          persistPageState({
            currentTrip: rankedTrip,
            shownDestinationNames: nextShownDestinationNames,
            lastInput: resolvedInput,
            aiStatusMessage: fallbackMessage,
          });
          return;
        }

        const aiTrips = extractResults(data);
        const selectedTrip =
          aiTrips && aiTrips.length > 0
            ? ensureTripImage(aiTrips[0])
            : rankedTrip;
        const finalInput = data?.normalizedInput ?? resolvedInput;
        const enrichedSelectedTrip = await enrichSelectedTrip(
          selectedTrip,
          finalInput
        );

        trackProductEvent("trip_generated", {
          metadata: {
            resultCount: 1,
            rankedCount: 1,
            usedLiveData: Boolean(rankData.usedLiveData),
            source: data?.source ?? "fallback-template",
            destinationNames: [enrichedSelectedTrip.name],
            preferredDestination: finalInput.preferredDestination ?? null,
          },
        });

        const statusMessage =
          data?.source === "live-openai"
            ? rankData.usedLiveData
              ? "Built from live place data and live AI trip copy."
              : "Built from live AI trip copy."
            : rankData.usedLiveData
              ? "Built from live place data with fallback trip copy."
              : "Built from ranked trip data with fallback trip copy.";

        setCurrentTrip(enrichedSelectedTrip);
        setLastInput(finalInput);
        setAiStatusMessage(statusMessage);
        persistPageState({
          currentTrip: enrichedSelectedTrip,
          shownDestinationNames: nextShownDestinationNames,
          lastInput: finalInput,
          aiStatusMessage: statusMessage,
        });
      } catch (error) {
        console.error("AI generation failed, using ranked result:", error);
        const fallbackMessage = rankData.usedLiveData
          ? "Built from live place data with fallback trip copy."
          : "Built from ranked trip data with fallback trip copy.";
        setCurrentTrip(rankedTrip);
        setLastInput(resolvedInput);
        setAiStatusMessage(fallbackMessage);
        persistPageState({
          currentTrip: rankedTrip,
          shownDestinationNames: nextShownDestinationNames,
          lastInput: resolvedInput,
          aiStatusMessage: fallbackMessage,
        });
      }
    } catch (error) {
      console.error("Trip generation failed:", error);
      shouldAutoScrollTripRef.current = false;
      setCurrentTrip(null);
      if (shouldResetShownDestinationNames) {
        setShownDestinationNames([]);
      }
      setAiStatusMessage(
        "The planner hit an unexpected error. Try again with a slightly clearer prompt."
      );
      persistPageState({
        currentTrip: null,
        shownDestinationNames: shouldResetShownDestinationNames
          ? []
          : shownDestinationNames,
          lastInput: input,
          aiStatusMessage:
            "The planner hit an unexpected error. Try again with a slightly clearer prompt.",
      });
    } finally {
      setLoading(false);
      setWaitingForTripText(false);
    }
  }

  async function handleRegenerate() {
    if (!lastInput || lastInput.preferredDestination) {
      return;
    }

    await handleGenerate(lastInput, {
      excludedDestinationNames: shownDestinationNames,
    });
  }

  const handleHomePromptSelect = useCallback((promptText: string) => {
    setPromptSuggestion({
      text: promptText,
      token: Date.now(),
    });

    window.requestAnimationFrame(() => {
      tripFormRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }, []);

  return (
        <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(125,211,252,0.1),transparent_34%),linear-gradient(180deg,#edf2f7_0%,#e4ebf3_52%,#dbe3ee_100%)] text-slate-950 dark:bg-[radial-gradient(circle_at_top,rgba(17,94,117,0.16),transparent_28%),linear-gradient(180deg,#08111a_0%,#0b1420_55%,#101927_100%)] dark:text-white">
      <AccountPanel
        open={savedTripsOpen}
        onClose={() => setSavedTripsOpen(false)}
        onUserChange={setAccountUser}
      />

      <button
        type="button"
        onClick={() => setSavedTripsOpen(true)}
        aria-label={`Open travel desk${accountUser ? ` for ${accountTriggerLabel}` : ""}`}
        className="fixed right-4 top-4 z-40 inline-flex items-center gap-2.5 rounded-full border border-slate-300/70 bg-white/88 px-3 py-2 text-left shadow-[0_16px_40px_rgba(15,23,42,0.16)] backdrop-blur-md transition hover:border-[#d9b57c]/35 hover:bg-white dark:border-white/12 dark:bg-[linear-gradient(180deg,rgba(11,18,30,0.92),rgba(8,14,24,0.96))] dark:shadow-[0_18px_46px_rgba(0,0,0,0.28)] dark:hover:bg-[linear-gradient(180deg,rgba(15,23,38,0.96),rgba(10,16,28,0.98))] sm:right-6 sm:top-6"
      >
        <BrandMark tone="auto" className="h-9 w-9" />
        <span className="min-w-0">
          <span className="block text-sm font-semibold leading-5 text-slate-900 dark:text-white">
            {accountTriggerLabel}
          </span>
          <span className="block text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-white/52">
            Saved trips
          </span>
        </span>
      </button>

      {destinationConstraintModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <button
            type="button"
            aria-label="Close destination constraint dialog"
            onClick={() => setDestinationConstraintModal(null)}
            className="absolute inset-0 bg-slate-950/60 backdrop-blur-[4px]"
          />
          <div className="relative z-10 w-full max-w-lg rounded-[2rem] border border-slate-200/80 bg-white/95 p-6 shadow-[0_30px_90px_rgba(15,23,42,0.18)] dark:border-white/10 dark:bg-[#0f1722] dark:shadow-2xl">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#d9b57c]">
              Destination blocked
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">
              {destinationConstraintModal.title}
            </h2>
            <div className="mt-4 space-y-2">
              {destinationConstraintModal.reasons.map((reason) => (
                <div
                  key={reason}
                  className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700 dark:border-white/10 dark:bg-white/6 dark:text-white/82"
                >
                  {reason}
                </div>
              ))}
            </div>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setDestinationConstraintModal(null)}
                className="inline-flex h-11 items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 dark:border dark:border-white/12 dark:bg-white dark:text-slate-950 dark:hover:bg-[#f5efe5]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <section className="relative isolate min-h-screen overflow-hidden">
        <div className="absolute inset-0">
          <div
            className="absolute inset-0 bg-cover bg-center dark:hidden"
            style={{ backgroundImage: `url("${featuredHero.imageUrlLight}")` }}
          />
          <div
            className="absolute inset-0 hidden bg-cover bg-center dark:block"
            style={{ backgroundImage: `url("${featuredHero.imageUrlDark}")` }}
          />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.28),rgba(255,255,255,0.05)_32%,transparent_56%),linear-gradient(180deg,rgba(248,250,252,0.04)_0%,rgba(242,245,249,0.12)_36%,rgba(227,234,241,0.42)_100%)] dark:hidden" />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(246,248,251,0.12)_0%,rgba(246,248,251,0.02)_40%,rgba(252,252,252,0.1)_100%)] dark:hidden" />
          <div className="absolute inset-0 hidden bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.2),transparent_34%),linear-gradient(180deg,rgba(5,11,17,0.2)_0%,rgba(7,13,21,0.48)_42%,rgba(8,14,23,0.92)_100%)] dark:block" />
          <div className="absolute inset-0 hidden bg-[linear-gradient(90deg,rgba(5,10,16,0.72)_0%,rgba(5,10,16,0.34)_40%,rgba(5,10,16,0.64)_100%)] dark:block" />
        </div>

        <div className="relative z-10 mx-auto flex min-h-screen max-w-7xl flex-col px-5 py-6 sm:px-8 lg:px-10">
          <header className="flex items-center">
            <BrandLogo
              variant="horizontal"
              href="/"
              priority
              tone="auto"
              className="origin-left scale-[0.9] sm:scale-100"
            />
          </header>

          <div className="flex flex-1 flex-col justify-center py-10 lg:py-14">
            <div className="grid w-full gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(22rem,0.95fr)] lg:items-start">
              <div className="max-w-3xl">
                <div className="relative max-w-4xl overflow-hidden rounded-[2.5rem] px-5 py-6 sm:px-6">
                  <div className="pointer-events-none absolute inset-0 rounded-[2.5rem] bg-[radial-gradient(circle_at_top_left,rgba(248,245,239,0.84),rgba(248,245,239,0.28)_42%,transparent_74%),linear-gradient(90deg,rgba(246,242,236,0.56)_0%,rgba(240,244,248,0.16)_58%,transparent_100%)] shadow-[0_18px_55px_rgba(148,163,184,0.08)] backdrop-blur-[4px] dark:hidden" />
                  <div className="relative">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.26em] text-[#9b6219] dark:text-[#e7c99c]">
                      Canada trip planner
                    </div>
                    <h1 className="mt-5 max-w-3xl font-serif text-[3rem] leading-[0.98] tracking-[-0.045em] text-slate-950 sm:text-[4rem] lg:text-[4.75rem] dark:text-white">
                      Describe the trip you want.
                      <span className="block text-slate-800 dark:text-white/84">
                        I&apos;ll fill in the gaps.
                      </span>
                    </h1>
                    <p className="mt-5 max-w-2xl text-base font-medium leading-8 text-slate-800/95 sm:text-lg dark:text-white/76">
                      One good prompt is enough to start. Describe the Canada
                      weekend you want, and if anything essential is missing, the
                      planner will ask one focused follow-up before building the plan.
                    </p>
                  </div>
                </div>

                <div className="mt-7 max-w-2xl rounded-[1.8rem] border border-slate-200/70 bg-[#f6f1e8]/48 p-5 shadow-[0_24px_70px_rgba(148,163,184,0.12)] backdrop-blur-lg dark:border-white/12 dark:bg-white/10 dark:shadow-[0_28px_80px_rgba(0,0,0,0.24)]">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-white/56">
                        Featured place of the day
                      </div>
                      <div className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">
                        {featuredHero.name}
                      </div>
                    </div>
                    <span className="inline-flex items-center rounded-full border border-slate-200/70 bg-[#fbf7ef]/72 px-3 py-1.5 text-xs font-medium text-slate-800 dark:border-white/12 dark:bg-white/8 dark:text-white/82">
                      {featuredHero.eyebrow}
                    </span>
                  </div>
                  <p className="mt-3 max-w-xl text-sm font-medium leading-7 text-slate-800/90 dark:text-white/74">
                    {featuredHero.caption}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <span className="inline-flex items-center rounded-full border border-slate-200/70 bg-[#fbf7ef]/72 px-3 py-1.5 text-xs font-medium text-slate-800 dark:border-white/12 dark:bg-white/8 dark:text-white/82">
                      {featuredHero.detail}
                    </span>
                  </div>
                </div>
              </div>

              <div ref={tripFormRef} className="w-full max-w-xl lg:justify-self-end">
                <TripForm
                  key={lastInput ? JSON.stringify(lastInput) : "new-trip"}
                  onGenerate={handleGenerate}
                  loading={loading}
                  initialInput={lastInput ?? undefined}
                  promptSuggestion={promptSuggestion}
                />
              </div>
            </div>

            <div className="mt-12 w-full rounded-[2.2rem] border border-slate-200/70 bg-[linear-gradient(180deg,rgba(247,244,238,0.62),rgba(240,244,249,0.72))] p-6 shadow-[0_26px_70px_rgba(148,163,184,0.12)] backdrop-blur-md dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(8,14,23,0.9),rgba(10,17,28,0.96))] dark:shadow-[0_30px_80px_rgba(0,0,0,0.3)] sm:p-7">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div className="max-w-3xl">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#9b6219] dark:text-[#e7c99c]">
                    Prompt shortcuts
                  </div>
                  <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-white sm:text-[2.1rem]">
                    In season and must-see ideas that jump straight into the prompt box
                  </h2>
                  <p className="mt-3 text-sm leading-7 text-slate-700 dark:text-white/68 sm:text-[15px]">
                    Click any card to preload the prompt, then tweak it if you want before you hit plan.
                  </p>
                </div>
                <div className="inline-flex w-fit items-center rounded-full border border-slate-200/70 bg-[#fbf7ef]/78 px-4 py-2 text-xs font-medium text-slate-700 dark:border-white/12 dark:bg-white/8 dark:text-white/72">
                  {homePromptCollections.season} picks
                </div>
              </div>

              <div className="mt-8 grid gap-6 xl:grid-cols-2">
                <section className="rounded-[1.8rem] border border-slate-200/70 bg-white/46 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] dark:border-white/10 dark:bg-white/[0.03] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#0f766e] dark:text-[#7decc7]">
                        In season now
                      </div>
                      <h3 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">
                        Seasonal trips with a clear reason to go now
                      </h3>
                    </div>
                    <div className="rounded-full border border-slate-200/70 bg-[#fbf7ef]/78 px-3 py-1.5 text-xs font-medium text-slate-700 dark:border-white/12 dark:bg-white/8 dark:text-white/72">
                      Click to fill
                    </div>
                  </div>
                  <div className="mt-5">
                    <HomePromptCardGrid
                      cards={homePromptCollections.inSeason}
                      onSelect={handleHomePromptSelect}
                    />
                  </div>
                </section>

                <section className="rounded-[1.8rem] border border-slate-200/70 bg-white/46 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] dark:border-white/10 dark:bg-white/[0.03] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#9b6219] dark:text-[#e7c99c]">
                        Must see right now
                      </div>
                      <h3 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">
                        Faster-start ideas for high-interest trips
                      </h3>
                    </div>
                    <div className="rounded-full border border-slate-200/70 bg-[#fbf7ef]/78 px-3 py-1.5 text-xs font-medium text-slate-700 dark:border-white/12 dark:bg-white/8 dark:text-white/72">
                      Click to fill
                    </div>
                  </div>
                  <div className="mt-5">
                    <HomePromptCardGrid
                      cards={homePromptCollections.mustSee}
                      onSelect={handleHomePromptSelect}
                    />
                  </div>
                </section>
              </div>
            </div>
          </div>
        </div>
      </section>

      {(aiStatusMessage || waitingForTripText || currentTrip) ? (
        <section
          ref={tripResultRef}
          className="relative z-20 -mt-12 scroll-mt-6 px-5 pb-20 sm:px-8 lg:px-10"
        >
          <div className="mx-auto max-w-6xl rounded-[2.6rem] border border-slate-200/70 bg-[linear-gradient(180deg,rgba(247,244,238,0.68)_0%,rgba(240,244,249,0.76)_100%)] p-6 text-slate-950 shadow-[0_30px_80px_rgba(148,163,184,0.1)] backdrop-blur-md sm:p-8 dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(8,14,23,0.94)_0%,rgba(10,17,28,0.98)_100%)] dark:text-white dark:shadow-[0_35px_90px_rgba(0,0,0,0.32)]">
            {aiStatusMessage ? (
              <div className="rounded-2xl border border-slate-200/70 bg-[#fbf7ef]/66 px-5 py-4 text-sm text-slate-600 dark:border-white/10 dark:bg-white/6 dark:text-white/76">
                {aiStatusMessage}
              </div>
            ) : null}

            {(waitingForTripText || currentTrip) ? (
              <div className={aiStatusMessage ? "mt-8" : ""}>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                  <div className="max-w-3xl">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#d9b57c]">
                      Your trip
                    </div>
                    <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">
                      {recommendationHeading(currentTrip?.confidence)}
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-white/64">
                      {recommendationDescription(currentTrip?.confidence)}
                    </p>
                  </div>

                  {!waitingForTripText && !lastInput?.preferredDestination ? (
                    <button
                      type="button"
                      onClick={handleRegenerate}
                      disabled={loading}
                      className="inline-flex h-11 items-center justify-center rounded-full border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-900 shadow-sm backdrop-blur-sm transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/12 dark:bg-white/8 dark:text-white dark:hover:bg-white/14"
                    >
                      Try a different trip
                    </button>
                  ) : null}
                </div>

                <div className="mt-6">
                  {waitingForTripText ? (
                    <div className="space-y-4">
                      <div className="rounded-2xl border border-slate-200/70 bg-[#fbf7ef]/62 px-5 py-4 text-sm text-slate-600 shadow-sm dark:border-white/10 dark:bg-white/6 dark:text-white/72">
                        Trippify is shaping your trip and pulling the strongest
                        fit for the brief.
                      </div>
                      <SkeletonTripCard />
                    </div>
                  ) : currentTrip ? (
                    <TripCard
                      key={`${currentTrip.name}-${lastInput?.tripPrompt ?? ""}`}
                      trip={currentTrip}
                      input={lastInput ?? undefined}
                    />
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </main>
  );
}
