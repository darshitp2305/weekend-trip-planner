"use client";

import { useCallback, useEffect, useState } from "react";
import AccountPanel from "../components/AccountPanel";
import BrandLogo from "../components/BrandLogo";
import TripCard from "../components/TripCard";
import TripForm from "../components/TripForm";
import { trackProductEvent } from "../lib/productAnalytics";
import { normalizeTripImageUrl } from "../lib/tripImages";
import { RankedDestination, TripInput } from "../lib/types";

type RankTripsResponse = {
  success?: boolean;
  results?: RankedDestination[];
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
  trips?: RankedDestination[];
  destinations?: RankedDestination[];
  rankings?: RankedDestination[];
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

const LAST_INPUT_STORAGE_KEY = "weekend-trip-last-input";
const PAGE_STATE_STORAGE_KEY = "weekend-trip-page-state";

function ensureTripImage(trip: RankedDestination): RankedDestination {
  return {
    ...trip,
    imageUrl: normalizeTripImageUrl(trip.imageUrl, trip.name),
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
    <div className="animate-pulse overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="h-72 w-full bg-slate-100 dark:bg-slate-800" />
      <div className="space-y-4 p-6">
        <div className="h-8 w-72 rounded bg-slate-200 dark:bg-slate-700" />
        <div className="h-5 w-48 rounded bg-slate-200 dark:bg-slate-700" />
        <div className="space-y-2">
          <div className="h-4 w-full rounded bg-slate-200 dark:bg-slate-700" />
          <div className="h-4 w-11/12 rounded bg-slate-200 dark:bg-slate-700" />
          <div className="h-4 w-8/12 rounded bg-slate-200 dark:bg-slate-700" />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="h-20 rounded-2xl bg-slate-100 dark:bg-slate-800" />
          <div className="h-20 rounded-2xl bg-slate-100 dark:bg-slate-800" />
          <div className="h-20 rounded-2xl bg-slate-100 dark:bg-slate-800" />
        </div>
      </div>
    </div>
  );
}

function StepCard({
  step,
  title,
  detail,
}: {
  step: string;
  title: string;
  detail: string;
}) {
  return (
    <div className="group rounded-[1.5rem] bg-white/90 px-6 py-4 shadow-[0_18px_40px_rgba(15,23,42,0.12)] transition-colors dark:bg-slate-900/72">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-700 dark:text-emerald-300">
          {step}
        </div>
        <div className="mt-2 text-lg font-semibold tracking-tight text-slate-950 dark:text-slate-100">
          {title}
        </div>
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
        {detail}
      </p>
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
      return "Best available recommendation";
    default:
      return "Trip recommendation";
  }
}

function recommendationDescription(confidence?: RankedDestination["confidence"]) {
  switch (confidence) {
    case "high":
      return "This is the single trip Trippify thinks best fits the brief. If it is close but not perfect, build it and adjust the days instead of starting over.";
    case "medium":
      return "This is the single trip that best fits the brief right now. Some details may still need builder edits or live verification before you lock it in.";
    case "low":
      return "This is the closest trip shape available right now. Expect to swap stops, adjust pacing, or tighten the plan in the builder before you finalize it.";
    default:
      return "This is the single trip Trippify thinks best fits the brief. If it is close but not perfect, build it and adjust the days instead of starting over.";
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

      if (!rankData?.results || rankData.results.length === 0) {
        if (excludedDestinationNames.length > 0) {
          await handleGenerate(input, { resetShownDestinationNames: true });
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

        if (input.preferredDestination) {
          const destinationLabel = input.preferredDestination.trim();
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
          lastInput: input,
          aiStatusMessage: input.preferredDestination ? "" : noMatchMessage,
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
        lastInput: input,
        aiStatusMessage: "",
      });

      try {
        const response = await fetch("/api/generate-trip", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            input,
            results: [rankedTrip],
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
            lastInput: input,
            aiStatusMessage: fallbackMessage,
          });
          return;
        }

        const aiTrips = extractResults(data);
        const selectedTrip =
          aiTrips && aiTrips.length > 0
            ? ensureTripImage(aiTrips[0])
            : rankedTrip;
        const enrichedSelectedTrip = await enrichSelectedTrip(selectedTrip, input);

        trackProductEvent("trip_generated", {
          metadata: {
            resultCount: 1,
            rankedCount: 1,
            usedLiveData: Boolean(rankData.usedLiveData),
            source: data?.source ?? "fallback-template",
            destinationNames: [enrichedSelectedTrip.name],
            preferredDestination: input.preferredDestination ?? null,
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
        setAiStatusMessage(statusMessage);
        persistPageState({
          currentTrip: enrichedSelectedTrip,
          shownDestinationNames: nextShownDestinationNames,
          lastInput: input,
          aiStatusMessage: statusMessage,
        });
      } catch (error) {
        console.error("AI generation failed, using ranked result:", error);
        const fallbackMessage = rankData.usedLiveData
          ? "Built from live place data with fallback trip copy."
          : "Built from ranked trip data with fallback trip copy.";
        setCurrentTrip(rankedTrip);
        setAiStatusMessage(fallbackMessage);
        persistPageState({
          currentTrip: rankedTrip,
          shownDestinationNames: nextShownDestinationNames,
          lastInput: input,
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
    <main className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#f7fafc_28%,#ffffff_72%)] text-slate-900 dark:bg-[linear-gradient(180deg,#020617_0%,#0f172a_42%,#111827_100%)] dark:text-slate-100">
      <AccountPanel open={savedTripsOpen} onClose={() => setSavedTripsOpen(false)} />

      {destinationConstraintModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <button
            type="button"
            aria-label="Close destination constraint dialog"
            onClick={() => setDestinationConstraintModal(null)}
            className="absolute inset-0 bg-slate-950/45 backdrop-blur-[2px]"
          />
          <div className="relative z-10 w-full max-w-lg rounded-[2rem] border border-emerald-200 bg-white p-6 shadow-2xl dark:border-emerald-500/30 dark:bg-slate-900">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">
              Destination blocked
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">
              {destinationConstraintModal.title}
            </h2>
            <div className="mt-4 space-y-2">
              {destinationConstraintModal.reasons.map((reason) => (
                <div
                  key={reason}
                  className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  {reason}
                </div>
              ))}
            </div>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setDestinationConstraintModal(null)}
                className="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mx-auto max-w-6xl px-6 py-8 sm:px-8 lg:px-10">
        <section className="relative mb-8">
          <div className="relative">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <BrandLogo
                variant="horizontal"
                href="/"
                priority
                className="h-12 w-auto sm:h-14"
              />

              <button
                type="button"
                onClick={() => setSavedTripsOpen(true)}
                className="inline-flex h-11 items-center justify-center rounded-full border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                Saved trips
              </button>
            </div>

            <div className="mt-8">
              <div className="max-w-4xl">
                <h1 className="max-w-4xl text-[2.4rem] font-semibold tracking-[-0.035em] text-slate-950 dark:text-white sm:text-[3rem] sm:leading-[1.04] xl:text-[3.45rem] xl:max-w-5xl">
                  Find a trip that actually fits.
                </h1>
              </div>
            </div>
          </div>

          <div className="relative mt-8 grid gap-4 md:grid-cols-3">
            <StepCard
              step="Step 1"
              title="Set the basics"
              detail="Choose the date range and how many people are actually going."
            />
            <StepCard
              step="Step 2"
              title="Describe the trip"
              detail="Write the brief in plain language instead of filling out a bunch of filters."
            />
            <StepCard
              step="Step 3"
              title="Edit the days"
              detail="Open the trip builder to swap a day, fit in an activity, or change the stay."
            />
          </div>
        </section>

        <section className="relative overflow-hidden rounded-[2.2rem] border border-slate-200/80 bg-white p-[1px] shadow-[0_16px_42px_rgba(15,23,42,0.05)] dark:border-slate-700/80 dark:bg-slate-900/90">
          <div className="relative rounded-[calc(2.2rem-1px)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.96))] p-5 dark:bg-[linear-gradient(180deg,rgba(2,6,23,0.95),rgba(15,23,42,0.92))] sm:p-7">
            <TripForm
              key={lastInput ? JSON.stringify(lastInput) : "new-trip"}
              onGenerate={handleGenerate}
              loading={loading}
              initialInput={lastInput ?? undefined}
            />
          </div>
        </section>

        {aiStatusMessage ? (
          <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-100">
            {aiStatusMessage}
          </div>
        ) : null}

        {(waitingForTripText || currentTrip) ? (
          <section className="mt-10">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="max-w-3xl">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">
                  Your trip
                </div>
                <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">
                  {recommendationHeading(currentTrip?.confidence)}
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  {recommendationDescription(currentTrip?.confidence)}
                </p>
              </div>

              {!waitingForTripText && !lastInput?.preferredDestination ? (
                <button
                  type="button"
                  onClick={handleRegenerate}
                  disabled={loading}
                  className="inline-flex h-11 items-center justify-center rounded-full border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                >
                  Try a different trip
                </button>
              ) : null}
            </div>

            <div className="mt-6">
              {waitingForTripText ? (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-600 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                    Trippify is building your trip recommendation and actable
                    day plan...
                  </div>
                  <SkeletonTripCard />
                </div>
              ) : currentTrip ? (
                <TripCard trip={currentTrip} input={lastInput ?? undefined} />
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
