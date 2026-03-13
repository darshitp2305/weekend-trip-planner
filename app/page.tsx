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
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm animate-pulse">
      <div className="h-52 w-full bg-slate-200" />

      <div className="p-5">
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
          <div className="rounded-xl bg-slate-100 p-3">
            <div className="h-3 w-24 rounded bg-slate-200" />
            <div className="mt-3 h-7 w-20 rounded bg-slate-200" />
          </div>
          <div className="rounded-xl bg-slate-100 p-3">
            <div className="h-3 w-24 rounded bg-slate-200" />
            <div className="mt-3 h-7 w-20 rounded bg-slate-200" />
          </div>
          <div className="rounded-xl bg-slate-100 p-3">
            <div className="h-3 w-24 rounded bg-slate-200" />
            <div className="mt-3 h-7 w-36 rounded bg-slate-200" />
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="h-3 w-28 rounded bg-slate-200" />
          <div className="mt-3 h-4 w-64 rounded bg-slate-200" />
        </div>
      </div>
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
    <main className="min-h-screen bg-black px-7 py-6 text-white">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-5xl font-bold tracking-tight">
          Weekend Trip Planner
        </h1>

        <p className="mt-4 text-lg text-white/85">
          Choose your city, budget, drive limit, and travel style to get 3 Alberta
          trip ideas ranked for fit.
        </p>

        <div className="mt-10">
          <TripForm
            onGenerate={handleGenerate}
            loading={loading}
            results={compareTrips}
          />
        </div>

        {aiStatusMessage ? (
          <div className="mt-5 rounded border border-white px-4 py-4 text-white/80">
            {aiStatusMessage}
          </div>
        ) : null}

        {compareTrips.length > 0 ? (
          <div className="mt-8 space-y-6">
            <CompareTrips trips={compareTrips} />

            {waitingForTripText ? (
              <div className="space-y-8">
                <div className="rounded border border-white/20 bg-white/5 px-4 py-5 text-white/80">
                  Building trip summaries and itinerary text...
                </div>

                <SkeletonTripCard />
                <SkeletonTripCard />
                <SkeletonTripCard />
              </div>
            ) : (
              <div className="space-y-8">
                {displayResults.map((trip) => (
                  <TripCard
                    key={trip.name}
                    trip={trip}
                    input={lastInput ?? undefined}
                  />
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </main>
  );
}