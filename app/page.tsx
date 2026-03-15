"use client";

import { useState } from "react";
import CompareTrips from "../components/CompareTrips";
import TripCard from "../components/TripCard";
import TripForm from "../components/TripForm";
import { RankedDestination, TripInput } from "../lib/types";

type RankTripsResponse = {
  success?: boolean;
  results?: RankedDestination[];
  initialCandidates?: RankedDestination[];
  usedLiveData?: boolean;
};

type GenerateTripResponse = {
  success?: boolean;
  source?: "live-openai" | "fallback-template";
  results?: RankedDestination[];
};

const LAST_INPUT_STORAGE_KEY = "weekend-trip-last-input";

function extractResults(payload: any): RankedDestination[] | null {
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.trips)) return payload.trips;
  if (Array.isArray(payload?.destinations)) return payload.destinations;
  if (Array.isArray(payload?.rankings)) return payload.rankings;
  return null;
}

function SkeletonTripCard() {
  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm animate-pulse">
      <div className="h-56 w-full bg-slate-100" />

      <div className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex-1">
            <div className="h-8 w-56 rounded bg-slate-200" />
            <div className="mt-3 h-4 w-64 rounded bg-slate-200" />
            <div className="mt-2 h-3 w-24 rounded bg-slate-200" />
          </div>

          <div className="flex gap-2">
            <div className="h-7 w-28 rounded-full bg-slate-200" />
            <div className="h-7 w-24 rounded-full bg-slate-200" />
          </div>
        </div>

        <div className="mt-5 space-y-2">
          <div className="h-4 w-full rounded bg-slate-200" />
          <div className="h-4 w-11/12 rounded bg-slate-200" />
          <div className="h-4 w-8/12 rounded bg-slate-200" />
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl bg-slate-50 p-4">
            <div className="h-3 w-24 rounded bg-slate-200" />
            <div className="mt-3 h-7 w-20 rounded bg-slate-200" />
          </div>
          <div className="rounded-2xl bg-slate-50 p-4">
            <div className="h-3 w-24 rounded bg-slate-200" />
            <div className="mt-3 h-7 w-20 rounded bg-slate-200" />
          </div>
          <div className="rounded-2xl bg-slate-50 p-4">
            <div className="h-3 w-24 rounded bg-slate-200" />
            <div className="mt-3 h-7 w-36 rounded bg-slate-200" />
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
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
        {label}
      </div>
      <div className="mt-2 text-xl font-semibold text-slate-900">{value}</div>
    </div>
  );
}

export default function HomePage() {
  const [loading, setLoading] = useState(false);
  const [rankedResults, setRankedResults] = useState<RankedDestination[]>([]);
  const [displayResults, setDisplayResults] = useState<RankedDestination[]>([]);
  const [lastInput, setLastInput] = useState<TripInput | null>(null);
  const [aiStatusMessage, setAiStatusMessage] = useState("");
  const [waitingForTripText, setWaitingForTripText] = useState(false);

  async function handleGenerate(input: TripInput) {
    setLoading(true);
    setWaitingForTripText(true);
    setLastInput(input);
    setAiStatusMessage("");

    if (typeof window !== "undefined") {
      try {
        sessionStorage.setItem(LAST_INPUT_STORAGE_KEY, JSON.stringify(input));
      } catch (error) {
        console.error("Failed to persist last generated input:", error);
      }
    }

    try {
      const rankResponse = await fetch("/api/rank-trips", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input }),
      });

      const rankText = await rankResponse.text();
      let rankData: RankTripsResponse | null = null;

      if (rankText) {
        try {
          rankData = JSON.parse(rankText);
        } catch (parseError) {
          console.error("Failed to parse /api/rank-trips response:", parseError, rankText);
        }
      }

      if (!rankResponse.ok || !rankData?.results || rankData.results.length === 0) {
        console.error("/api/rank-trips failed:", rankResponse.status, rankData);
        setRankedResults([]);
        setDisplayResults([]);
        setAiStatusMessage("");
        return;
      }

      setRankedResults(rankData.results);
      setDisplayResults([]);

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
          setAiStatusMessage(
            usedLiveData
              ? "Used live Places data for ranking. Using fallback template text."
              : "Using fallback template text."
          );
          return;
        }

        const aiTrips = extractResults(data);

        if (aiTrips && aiTrips.length > 0) {
          setDisplayResults(aiTrips);

          if (data?.source === "live-openai") {
            setAiStatusMessage(
              usedLiveData
                ? "Used live Places data for ranking and live OpenAI-generated trip text."
                : "Using live OpenAI-generated trip text."
            );
          } else {
            setAiStatusMessage(
              usedLiveData
                ? "Used live Places data for ranking. Using fallback template text."
                : "Using fallback template text."
            );
          }
        } else {
          console.error("/api/generate-trip returned no usable results:", data);
          setDisplayResults(rankedTrips);
          setAiStatusMessage(
            usedLiveData
              ? "Used live Places data for ranking. Using fallback template text."
              : "Using fallback template text."
          );
        }
      } catch (error) {
        console.error("AI generation failed, using ranked results:", error);
        setDisplayResults(rankedTrips);
        setAiStatusMessage(
          usedLiveData
            ? "Used live Places data for ranking. Using fallback template text."
            : "Using fallback template text."
        );
      }
    } catch (error) {
      console.error("Trip generation failed:", error);
      setRankedResults([]);
      setDisplayResults([]);
      setAiStatusMessage("");
    } finally {
      setLoading(false);
      setWaitingForTripText(false);
    }
  }

  const compareTrips = displayResults.length > 0 ? displayResults : rankedResults;

  return (
    <main className="min-h-screen bg-[#f8fafc] text-slate-900">
      <div className="mx-auto max-w-7xl px-6 py-8 sm:px-8 lg:px-10">
        <section className="mb-8">
          <div className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
            Alberta weekend planner
          </div>

          <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <h1 className="text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
                Plan a weekend trip without digging through ten tabs.
              </h1>
              <p className="mt-3 text-base leading-7 text-slate-600 sm:text-lg">
                Enter your budget, drive limit, and trip style to get ranked Alberta
                getaway ideas that actually fit your weekend.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3 lg:min-w-[360px]">
              <MiniStat label="Output" value="3 trips" />
              <MiniStat label="Ranking" value="Fit-based" />
              <MiniStat label="Data" value="Live + AI" />
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.45fr_0.75fr]">
          <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
            <TripForm
              onGenerate={handleGenerate}
              loading={loading}
              results={compareTrips}
            />
          </div>

          <aside className="grid gap-4 sm:grid-cols-3 xl:grid-cols-1">
            <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-600">
                What you get
              </div>
              <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
                <li>Ranked destinations based on your constraints</li>
                <li>Budget-aware options with staycation support</li>
                <li>Saveable trip cards with fuller itinerary details</li>
              </ul>
            </div>

            <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-600">
                Example fit
              </div>
              <div className="mt-3 text-xl font-semibold text-slate-900">
                Jasper foodie weekend
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Works well when you want scenic value, a manageable drive, and decent food options without blowing a short-trip budget.
              </p>
            </div>

            <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-600">
                Good default
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                Keep the form simple. Let the trip cards carry the detail after generation.
              </p>
            </div>
          </aside>
        </section>

        {aiStatusMessage ? (
          <div className="mt-6 rounded-2xl border border-violet-200 bg-violet-50 px-5 py-4 text-sm text-violet-900">
            {aiStatusMessage}
          </div>
        ) : null}

        {compareTrips.length > 0 ? (
          <section className="mt-10">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-600">
                  Your matches
                </div>
                <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
                  Compare your best options
                </h2>
              </div>

              <p className="max-w-xl text-sm leading-6 text-slate-600">
                Review the top fits first, then save the one worth turning into a full plan.
              </p>
            </div>

            <div className="mt-6 rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
              <CompareTrips trips={compareTrips} />
            </div>

            {waitingForTripText ? (
              <div className="mt-8 space-y-6">
                <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-slate-600 shadow-sm">
                  Building trip summaries and itinerary text...
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