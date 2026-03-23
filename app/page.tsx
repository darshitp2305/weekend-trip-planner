"use client";

import { useCallback, useEffect, useState } from "react";
import AccountPanel from "../components/AccountPanel";
import TripCard from "../components/TripCard";
import TripForm from "../components/TripForm";
import { trackProductEvent } from "../lib/productAnalytics";
import { RankedDestination, TripInput } from "../lib/types";

type RankTripsResponse = {
  success?: boolean;
  results?: RankedDestination[];
  initialCandidates?: RankedDestination[];
  usedLiveData?: boolean;
  noMatchDiagnostics?: {
    headline?: string;
    reasons?: string[];
  } | null;
};

type GenerateTripResponse = {
  success?: boolean;
  source?: "live-openai" | "fallback-template";
  results?: RankedDestination[];
};

const LAST_INPUT_STORAGE_KEY = "weekend-trip-last-input";
const PAGE_STATE_STORAGE_KEY = "weekend-trip-page-state";

function getFallbackImageUrl(name?: string) {
  const seed = encodeURIComponent((name ?? "trippify").trim().toLowerCase());
  return `https://picsum.photos/seed/${seed}/1400/900`;
}

function withUniqueTripImages(results: RankedDestination[]) {
  const seenImages = new Set<string>();

  return results.map((trip) => {
    const rawImage = typeof trip.imageUrl === "string" ? trip.imageUrl.trim() : "";

    if (!rawImage) {
      return {
        ...trip,
        imageUrl: getFallbackImageUrl(trip.name),
      };
    }

    if (seenImages.has(rawImage)) {
      return {
        ...trip,
        imageUrl: getFallbackImageUrl(trip.name),
      };
    }

    seenImages.add(rawImage);
    return trip;
  });
}

type ResultsPayload = {
  results?: RankedDestination[];
  trips?: RankedDestination[];
  destinations?: RankedDestination[];
  rankings?: RankedDestination[];
};

function extractResults(
  payload: ResultsPayload | null | undefined
): RankedDestination[] | null {
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.trips)) return payload.trips;
  if (Array.isArray(payload?.destinations)) return payload.destinations;
  if (Array.isArray(payload?.rankings)) return payload.rankings;
  return null;
}

function SkeletonTripCard() {
  return (
    <div className="animate-pulse overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="h-56 w-full bg-slate-100 dark:bg-slate-800" />

      <div className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex-1">
            <div className="h-8 w-56 rounded bg-slate-200 dark:bg-slate-700" />
            <div className="mt-3 h-4 w-64 rounded bg-slate-200 dark:bg-slate-700" />
            <div className="mt-2 h-3 w-24 rounded bg-slate-200 dark:bg-slate-700" />
          </div>

          <div className="flex gap-2">
            <div className="h-7 w-28 rounded-full bg-slate-200 dark:bg-slate-700" />
            <div className="h-7 w-24 rounded-full bg-slate-200 dark:bg-slate-700" />
          </div>
        </div>

        <div className="mt-5 space-y-2">
          <div className="h-4 w-full rounded bg-slate-200 dark:bg-slate-700" />
          <div className="h-4 w-11/12 rounded bg-slate-200 dark:bg-slate-700" />
          <div className="h-4 w-8/12 rounded bg-slate-200 dark:bg-slate-700" />
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800/80">
            <div className="h-3 w-24 rounded bg-slate-200 dark:bg-slate-700" />
            <div className="mt-3 h-7 w-20 rounded bg-slate-200 dark:bg-slate-700" />
          </div>
          <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800/80">
            <div className="h-3 w-24 rounded bg-slate-200 dark:bg-slate-700" />
            <div className="mt-3 h-7 w-20 rounded bg-slate-200 dark:bg-slate-700" />
          </div>
          <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800/80">
            <div className="h-3 w-24 rounded bg-slate-200 dark:bg-slate-700" />
            <div className="mt-3 h-7 w-36 rounded bg-slate-200 dark:bg-slate-700" />
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/80">
      <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className="mt-2 text-xl font-semibold text-slate-900 dark:text-slate-100">{value}</div>
    </div>
  );
}

function RailFeature({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/80 p-4 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/70">
      <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</div>
      <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">{detail}</p>
    </div>
  );
}

function RailStep({
  number,
  title,
  detail,
}: {
  number: string;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-950 text-xs font-semibold text-white">
        {number}
      </div>
      <div>
        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</div>
        <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">{detail}</p>
      </div>
    </div>
  );
}

export default function HomePage() {
  const [loading, setLoading] = useState(false);
  const [rankedResults, setRankedResults] = useState<RankedDestination[]>([]);
  const [displayResults, setDisplayResults] = useState<RankedDestination[]>([]);
  const [shownDestinationNames, setShownDestinationNames] = useState<string[]>([]);
  const [lastInput, setLastInput] = useState<TripInput | null>(null);
  const [aiStatusMessage, setAiStatusMessage] = useState("");
  const [waitingForTripText, setWaitingForTripText] = useState(false);
  const [restored, setRestored] = useState(false);
  const [savedTripsOpen, setSavedTripsOpen] = useState(false);

  const persistPageState = useCallback((nextState: {
    rankedResults?: RankedDestination[];
    displayResults?: RankedDestination[];
    shownDestinationNames?: string[];
    lastInput?: TripInput | null;
    aiStatusMessage?: string;
  }) => {
    if (typeof window === "undefined") return;

    try {
      sessionStorage.setItem(
        PAGE_STATE_STORAGE_KEY,
        JSON.stringify({
          rankedResults: nextState.rankedResults ?? rankedResults,
          displayResults: nextState.displayResults ?? displayResults,
          shownDestinationNames:
            nextState.shownDestinationNames ?? shownDestinationNames,
          lastInput: nextState.lastInput ?? lastInput,
          aiStatusMessage: nextState.aiStatusMessage ?? aiStatusMessage,
        })
      );
    } catch (error) {
      console.error("Failed to persist planner page state:", error);
    }
  }, [aiStatusMessage, displayResults, lastInput, rankedResults, shownDestinationNames]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const raw = sessionStorage.getItem(PAGE_STATE_STORAGE_KEY);
      if (!raw) return;

      const saved = JSON.parse(raw) as {
        rankedResults?: RankedDestination[];
        displayResults?: RankedDestination[];
        shownDestinationNames?: string[];
        lastInput?: TripInput | null;
        aiStatusMessage?: string;
      };

      if (Array.isArray(saved.rankedResults)) {
        setRankedResults(saved.rankedResults);
      }

      if (Array.isArray(saved.displayResults)) {
        setDisplayResults(saved.displayResults);
      }

      if (Array.isArray(saved.shownDestinationNames)) {
        setShownDestinationNames(
          saved.shownDestinationNames.filter(
            (name): name is string => typeof name === "string" && name.trim().length > 0
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

  function dedupeDestinationNames(names: string[]) {
    return Array.from(
      new Set(names.map((name) => name.trim()).filter(Boolean))
    );
  }

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
      lastInput: input,
      rankedResults: [],
      displayResults: [],
      shownDestinationNames: shouldResetShownDestinationNames ? [] : shownDestinationNames,
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
        setRankedResults([]);
        setDisplayResults([]);
        if (shouldResetShownDestinationNames) {
          setShownDestinationNames([]);
        }
        setAiStatusMessage("");
        persistPageState({
          rankedResults: [],
          displayResults: [],
          shownDestinationNames: shouldResetShownDestinationNames ? [] : shownDestinationNames,
          lastInput: input,
          aiStatusMessage: "",
        });
        return;
      }

      if (!rankData?.results || rankData.results.length === 0) {
        if (excludedDestinationNames.length > 0) {
          await handleGenerate(input, { resetShownDestinationNames: true });
          return;
        }

        setRankedResults([]);
        setDisplayResults([]);
        setShownDestinationNames([]);
        const diagnosticHeadline =
          typeof rankData?.noMatchDiagnostics?.headline === "string"
            ? rankData.noMatchDiagnostics.headline.trim()
            : "";
        const diagnosticReasons = Array.isArray(rankData?.noMatchDiagnostics?.reasons)
          ? rankData.noMatchDiagnostics.reasons
              .filter((reason): reason is string => typeof reason === "string" && reason.trim().length > 0)
              .map((reason) => reason.trim())
          : [];
        const noMatchMessage = [diagnosticHeadline, ...diagnosticReasons].filter(Boolean).join(" ");
        setAiStatusMessage(noMatchMessage);
        persistPageState({
          rankedResults: [],
          displayResults: [],
          shownDestinationNames: [],
          lastInput: input,
          aiStatusMessage: noMatchMessage,
        });
        return;
      }

      const nextShownDestinationNames = dedupeDestinationNames([
        ...(shouldResetShownDestinationNames ? [] : shownDestinationNames),
        ...rankData.results.map((trip) => trip.name),
      ]);

      setRankedResults(rankData.results);
      setDisplayResults([]);
      setShownDestinationNames(nextShownDestinationNames);
      persistPageState({
        rankedResults: rankData.results,
        displayResults: [],
        shownDestinationNames: nextShownDestinationNames,
        lastInput: input,
        aiStatusMessage: "",
      });

      const rankedTrips = rankData.results;
      const usedLiveData = Boolean(rankData.usedLiveData);

      try {
        const response = await fetch("/api/generate-trip", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            input,
            results: rankedTrips,
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
          setDisplayResults(rankedTrips);
          const fallbackMessage =
            usedLiveData
              ? "Trippify used live Places data for ranking and fallback template text."
              : "Trippify used fallback template text.";
          setAiStatusMessage(fallbackMessage);
          persistPageState({
            rankedResults: rankedTrips,
            displayResults: rankedTrips,
            shownDestinationNames: nextShownDestinationNames,
            lastInput: input,
            aiStatusMessage: fallbackMessage,
          });
          return;
        }

        const aiTrips = extractResults(data);

        if (aiTrips && aiTrips.length > 0) {
          trackProductEvent("trip_generated", {
            metadata: {
              resultCount: aiTrips.length,
              rankedCount: rankedTrips.length,
              usedLiveData,
              source: data?.source ?? "fallback-template",
              destinationNames: aiTrips.map((trip) => trip.name),
              preferredDestination: input.preferredDestination ?? null,
            },
          });

          setDisplayResults(aiTrips);

          const aiMessage =
            data?.source === "live-openai"
              ? usedLiveData
                ? "Trippify used live Places data and live OpenAI trip text."
                : "Trippify used live OpenAI trip text."
              : usedLiveData
                ? "Trippify used live Places data for ranking and fallback template text."
                : "Trippify used fallback template text.";

          if (data?.source === "live-openai") {
            setAiStatusMessage(aiMessage);
          } else {
            setAiStatusMessage(aiMessage);
          }

          persistPageState({
            rankedResults: rankedTrips,
            displayResults: aiTrips,
            shownDestinationNames: nextShownDestinationNames,
            lastInput: input,
            aiStatusMessage: aiMessage,
          });
        } else {
          trackProductEvent("trip_generated", {
            metadata: {
              resultCount: rankedTrips.length,
              rankedCount: rankedTrips.length,
              usedLiveData,
              source: "fallback-template",
              destinationNames: rankedTrips.map((trip) => trip.name),
              preferredDestination: input.preferredDestination ?? null,
            },
          });

          console.error("/api/generate-trip returned no usable results:", data);
          setDisplayResults(rankedTrips);
          const fallbackMessage =
            usedLiveData
              ? "Trippify used live Places data for ranking and fallback template text."
              : "Trippify used fallback template text.";
          setAiStatusMessage(fallbackMessage);
          persistPageState({
            rankedResults: rankedTrips,
            displayResults: rankedTrips,
            shownDestinationNames: nextShownDestinationNames,
            lastInput: input,
            aiStatusMessage: fallbackMessage,
          });
        }
      } catch (error) {
        trackProductEvent("trip_generated", {
          metadata: {
            resultCount: rankedTrips.length,
            rankedCount: rankedTrips.length,
            usedLiveData,
            source: "fallback-template",
            destinationNames: rankedTrips.map((trip) => trip.name),
            preferredDestination: input.preferredDestination ?? null,
          },
        });

        console.error("AI generation failed, using ranked results:", error);
        setDisplayResults(rankedTrips);
        const fallbackMessage =
          usedLiveData
            ? "Trippify used live Places data for ranking and fallback template text."
            : "Trippify used fallback template text.";
        setAiStatusMessage(fallbackMessage);
        persistPageState({
          rankedResults: rankedTrips,
          displayResults: rankedTrips,
          shownDestinationNames: nextShownDestinationNames,
          lastInput: input,
          aiStatusMessage: fallbackMessage,
        });
      }
    } catch (error) {
      console.error("Trip generation failed:", error);
      setRankedResults([]);
      setDisplayResults([]);
      if (shouldResetShownDestinationNames) {
        setShownDestinationNames([]);
      }
      setAiStatusMessage("");
      persistPageState({
        rankedResults: [],
        displayResults: [],
        shownDestinationNames: shouldResetShownDestinationNames ? [] : shownDestinationNames,
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

  const compareTrips = withUniqueTripImages(
    displayResults.length > 0 ? displayResults : rankedResults
  );
  const isDirectDestinationFlow = Boolean(lastInput?.preferredDestination);
  const tripFormKey = lastInput ? JSON.stringify(lastInput) : "new-trip";

  return (
    <main className="relative min-h-screen overflow-hidden bg-[linear-gradient(180deg,#f5f1e8_0%,#f8fafc_18%,#f8fbff_100%)] text-slate-900 dark:bg-[linear-gradient(180deg,#020617_0%,#0f172a_38%,#111827_100%)] dark:text-slate-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(251,146,60,0.10),transparent_24%),radial-gradient(circle_at_top_right,rgba(96,165,250,0.10),transparent_24%),radial-gradient(circle_at_bottom_right,rgba(139,92,246,0.08),transparent_22%)] dark:bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,0.16),transparent_24%),radial-gradient(circle_at_top_right,rgba(59,130,246,0.18),transparent_24%),radial-gradient(circle_at_bottom_right,rgba(34,197,94,0.12),transparent_22%)]" />

      <AccountPanel open={savedTripsOpen} onClose={() => setSavedTripsOpen(false)} />

      <div className="relative mx-auto max-w-7xl px-6 py-8 sm:px-8 lg:px-10">
        <section className="mb-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/75 px-2 py-2 shadow-sm backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/70">
              <div className="inline-flex rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-medium text-violet-700 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-200">
                Trippify for Alberta
              </div>
              <div className="hidden h-5 w-px bg-slate-200 dark:bg-slate-700 sm:block" />
              <div className="hidden text-xs font-medium text-slate-500 dark:text-slate-400 sm:block">
                Weekend planning without guesswork
              </div>
            </div>

            <button
              type="button"
              onClick={() => setSavedTripsOpen(true)}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-slate-300 bg-white/85 px-5 pr-14 text-sm font-semibold text-slate-800 shadow-sm backdrop-blur-sm transition hover:-translate-y-0.5 hover:bg-white dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-100 dark:hover:bg-slate-900"
            >
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-950 text-[11px] font-semibold text-white dark:bg-slate-100 dark:text-slate-950">
                {Math.max(1, compareTrips.length || 3)}
              </span>
              Saved trips
            </button>
          </div>

          <div className="mt-5 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <h1 className="text-4xl font-semibold tracking-tight text-slate-950 dark:text-white sm:text-5xl">
                Find a trip that actually fits.
              </h1>
              <p className="mt-3 text-base leading-7 text-slate-600 dark:text-slate-300 sm:text-lg">
                Trippify ranks Alberta getaways and staycations by budget, drive
                time, and travel style, so you can stop guessing and pick faster.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3 lg:min-w-[360px]">
              <MiniStat label="Brand" value="Trippify" />
              <MiniStat label="Output" value="3 trips" />
              <MiniStat label="Data" value="Live + AI" />
            </div>
          </div>
        </section>

        <section className="grid items-start gap-6 xl:grid-cols-[1.45fr_0.75fr]">
          <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/90 sm:p-7">
            <TripForm
              key={tripFormKey}
              onGenerate={handleGenerate}
              loading={loading}
              results={compareTrips}
              initialInput={lastInput ?? undefined}
            />
          </div>

          <aside className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
            <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.96))] p-6 shadow-sm dark:border-slate-800 dark:bg-[linear-gradient(180deg,rgba(15,23,42,0.96),rgba(15,23,42,0.82))]">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-600 dark:text-violet-300">
                Why Trippify
              </div>
              <div className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">
                Faster short-trip decisions.
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                The planner narrows Alberta options using the constraints that
                usually kill trip momentum: budget, drive time, timing, and style.
              </p>

              <div className="mt-5 space-y-3">
                <RailFeature
                  title="Ranked around your limits"
                  detail="Trips are filtered around your real drive hours, traveler count, and budget instead of generic inspiration."
                />
                <RailFeature
                  title="Useful fallback and live data"
                  detail="You still get strong recommendations when live providers are thin, but the planner upgrades results when current data exists."
                />
                <RailFeature
                  title="Built to compare, save, and refine"
                  detail="Generate three options, regenerate fresh sets, then save the one worth turning into a real itinerary."
                />
              </div>
            </div>

            <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/90">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-600 dark:text-violet-300">
                  How It Works
                </div>
                <button
                  type="button"
                  onClick={() => setSavedTripsOpen(true)}
                  className="inline-flex h-9 items-center justify-center rounded-full border border-slate-300 bg-slate-50 px-4 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  Open saved
                </button>
              </div>

              <div className="mt-4 space-y-4">
                <RailStep
                  number="1"
                  title="Set your trip constraints"
                  detail="Choose your city, style, dates, group size, and budget to shape the shortlist."
                />
                <RailStep
                  number="2"
                  title="Compare your three strongest fits"
                  detail="If none feel right, regenerate to get another set of destinations without restarting the form."
                />
                <RailStep
                  number="3"
                  title="Build the one worth booking"
                  detail="Lock in a destination, refine the hotel and stops, then use saved trips to revisit better options later."
                />
              </div>

              <div className="mt-5 rounded-[1.5rem] border border-amber-200 bg-[linear-gradient(135deg,#fff7ed,#fffbeb)] p-5 dark:border-amber-500/30 dark:bg-[linear-gradient(135deg,rgba(120,53,15,0.35),rgba(68,64,60,0.3))]">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-700 dark:text-amber-300">
                  Example fit
                </div>
                <div className="mt-2 text-xl font-semibold text-slate-900 dark:text-slate-100">
                  Jasper foodie weekend
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  Strong when you want mountain payoff, manageable drive value,
                  and enough food density to make a short trip feel worth it.
                </p>
              </div>
            </div>
          </aside>
        </section>

        {aiStatusMessage ? (
          <div className="mt-6 rounded-2xl border border-violet-200 bg-violet-50 px-5 py-4 text-sm text-violet-900 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-100">
            {aiStatusMessage}
          </div>
        ) : null}

        {compareTrips.length > 0 ? (
          <section className="mt-10">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-600 dark:text-violet-300">
                  {isDirectDestinationFlow ? "Your trip" : "Your Trippify matches"}
                </div>
                <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">
                  {isDirectDestinationFlow ? "Destination build" : "Your best options"}
                </h2>
              </div>

              <p className="max-w-xl text-sm leading-6 text-slate-600 dark:text-slate-300">
                {isDirectDestinationFlow
                  ? "Trippify found the destination you asked for and built the trip directly."
                  : "Review the strongest fits side by side, then build the one worth turning into a full trip plan."}
              </p>
            </div>

            {!isDirectDestinationFlow && !waitingForTripText ? (
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={handleRegenerate}
                  disabled={loading}
                  className="inline-flex h-11 items-center justify-center rounded-full border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-800 shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                >
                  {loading ? "Regenerating..." : "Regenerate 3 new trips"}
                </button>
              </div>
            ) : null}

            {waitingForTripText ? (
              <div className="mt-8 space-y-6">
                <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-slate-600 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                  Trippify is building your trip summaries and itinerary text...
                </div>

                <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                  <SkeletonTripCard />
                  <SkeletonTripCard />
                  <SkeletonTripCard />
                </div>
              </div>
            ) : (
              <div className="mt-8 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                {displayResults.map((trip) => (
                  <TripCard
                    key={trip.name}
                    trip={trip}
                    input={lastInput ?? undefined}
                  />
                ))}
              </div>
            )}
          </section>
        ) : null}
      </div>
    </main>
  );
}
