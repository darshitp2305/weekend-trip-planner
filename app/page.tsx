"use client";

import { useCallback, useEffect, useState } from "react";
import AccountPanel, { type AccountPanelUser } from "../components/AccountPanel";
import BrandLogo, { BrandMark } from "../components/BrandLogo";
import TripCard from "../components/TripCard";
import TripForm from "../components/TripForm";
import rawDestinations from "../data/destinations.json";
import { trackProductEvent } from "../lib/productAnalytics";
import { normalizeTripImageSet } from "../lib/tripImages";
import { ProviderOutcome, RankedDestination, RawDestination, TripInput } from "../lib/types";
import { displayNameFromEmail } from "../lib/viewerIdentity";

type RankTripsResponse = {
  success?: boolean;
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

const LAST_INPUT_STORAGE_KEY = "weekend-trip-last-input";
const PAGE_STATE_STORAGE_KEY = "weekend-trip-page-state";

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

function buildHeroCandidates() {
  return (rawDestinations as RawDestination[])
    .filter(
      (destination) =>
        Boolean(
          destination.image_url ||
            destination.image_url_light ||
            destination.image_url_dark
        ) &&
        !destination.is_staycation &&
        destination.vibes.some((vibe) =>
          ["nature", "adventure", "relax", "winter_fun"].includes(vibe)
        )
    )
    .map((destination) => {
      const imageSet = normalizeTripImageSet(
        {
          imageUrl: destination.image_url_light ?? destination.image_url,
          imageUrlLight: destination.image_url_light ?? destination.image_url,
          imageUrlDark:
            destination.image_url_dark ??
            destination.image_url_light ??
            destination.image_url,
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
const DEFAULT_HERO_IMAGE_SET = normalizeTripImageSet({}, "Alberta");
const DEFAULT_HERO: FeaturedHero = HERO_CANDIDATES[0] ?? {
  name: "Alberta",
  imageUrl: DEFAULT_HERO_IMAGE_SET.defaultUrl,
  imageUrlLight: DEFAULT_HERO_IMAGE_SET.lightUrl,
  imageUrlDark: DEFAULT_HERO_IMAGE_SET.darkUrl,
  eyebrow: "Daily Alberta feature",
  caption: "A cinematic Alberta escape, refreshed each day.",
  detail: "Curated for the planner",
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
  const accountTriggerLabel = accountUser
    ? displayNameFromEmail(accountUser.email)
    : "Log in";

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
        console.error("/api/rank-trips failed:", rankResponse.status, rankData);
        setCurrentTrip(null);
        if (shouldResetShownDestinationNames) {
          setShownDestinationNames([]);
        }
        persistPageState({
          currentTrip: null,
          shownDestinationNames: shouldResetShownDestinationNames
            ? []
            : shownDestinationNames,
          lastInput: input,
          aiStatusMessage: "",
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
          setDestinationConstraintModal({
            title: destinationLabel
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
      setCurrentTrip(null);
      if (shouldResetShownDestinationNames) {
        setShownDestinationNames([]);
      }
      setAiStatusMessage("");
      persistPageState({
        currentTrip: null,
        shownDestinationNames: shouldResetShownDestinationNames
          ? []
          : shownDestinationNames,
        lastInput: input,
        aiStatusMessage: "",
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
        className="fixed right-4 top-[4.8rem] z-40 inline-flex items-center gap-2.5 rounded-full border border-slate-300/70 bg-white/88 px-3 py-2 text-left shadow-[0_16px_40px_rgba(15,23,42,0.16)] backdrop-blur-md transition hover:border-[#d9b57c]/35 hover:bg-white dark:border-white/12 dark:bg-[linear-gradient(180deg,rgba(11,18,30,0.92),rgba(8,14,24,0.96))] dark:shadow-[0_18px_46px_rgba(0,0,0,0.28)] dark:hover:bg-[linear-gradient(180deg,rgba(15,23,38,0.96),rgba(10,16,28,0.98))] sm:right-6 sm:top-[5.1rem]"
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

          <div className="flex flex-1 items-center py-10 lg:py-14">
            <div className="grid w-full gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-end">
              <div className="max-w-3xl">
                <div className="relative max-w-4xl overflow-hidden rounded-[2.5rem] px-5 py-6 sm:px-6">
                  <div className="pointer-events-none absolute inset-0 rounded-[2.5rem] bg-[radial-gradient(circle_at_top_left,rgba(248,245,239,0.84),rgba(248,245,239,0.28)_42%,transparent_74%),linear-gradient(90deg,rgba(246,242,236,0.56)_0%,rgba(240,244,248,0.16)_58%,transparent_100%)] shadow-[0_18px_55px_rgba(148,163,184,0.08)] backdrop-blur-[4px] dark:hidden" />
                  <div className="relative">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.26em] text-[#9b6219] dark:text-[#e7c99c]">
                      Alberta trip planner
                    </div>
                    <h1 className="mt-5 max-w-4xl font-serif text-[3rem] leading-[0.98] tracking-[-0.045em] text-slate-950 sm:text-[4rem] lg:text-[4.7rem] dark:text-white">
                      Describe the trip you want.
                      <span className="block text-slate-800 dark:text-white/84">
                        I&apos;ll fill in the gaps.
                      </span>
                    </h1>
                    <p className="mt-5 max-w-2xl text-base font-medium leading-8 text-slate-800/95 sm:text-lg dark:text-white/76">
                      One good prompt is enough to start. Describe the Alberta
                      weekend you want, and if anything essential is missing, the
                      planner will ask one focused follow-up before building the plan.
                    </p>
                  </div>
                </div>

                <div className="mt-7 max-w-xl rounded-[1.8rem] border border-slate-200/70 bg-[#f6f1e8]/48 p-5 shadow-[0_24px_70px_rgba(148,163,184,0.12)] backdrop-blur-lg dark:border-white/12 dark:bg-white/10 dark:shadow-[0_28px_80px_rgba(0,0,0,0.24)]">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-white/56">
                    Daily feature
                  </div>
                  <div className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">
                    {featuredHero.name}
                  </div>
                  <p className="mt-3 text-sm font-medium leading-7 text-slate-800/90 dark:text-white/74">
                    {featuredHero.caption}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <span className="inline-flex items-center rounded-full border border-slate-200/70 bg-[#fbf7ef]/72 px-3 py-1.5 text-xs font-medium text-slate-800 dark:border-white/12 dark:bg-white/8 dark:text-white/82">
                      {featuredHero.eyebrow}
                    </span>
                    <span className="inline-flex items-center rounded-full border border-slate-200/70 bg-[#fbf7ef]/72 px-3 py-1.5 text-xs font-medium text-slate-800 dark:border-white/12 dark:bg-white/8 dark:text-white/82">
                      {featuredHero.detail}
                    </span>
                  </div>
                </div>
              </div>

              <TripForm
                key={lastInput ? JSON.stringify(lastInput) : "new-trip"}
                onGenerate={handleGenerate}
                loading={loading}
                initialInput={lastInput ?? undefined}
              />
            </div>
          </div>
        </div>
      </section>

      {(aiStatusMessage || waitingForTripText || currentTrip) ? (
        <section className="relative z-20 -mt-12 px-5 pb-20 sm:px-8 lg:px-10">
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
                        Alberta fit for the brief.
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
