"use client";

import { useMemo, useState } from "react";
import type { RankedDestination } from "@/lib/types";

type Props = {
  trip: RankedDestination;
  isSaved?: boolean;
  onRemove?: (tripName: string) => void;
};

type TripCardTrip = RankedDestination & {
  confidenceLabel?: string;
  source?: string;
  homeBase?: string;
  aiSuggestedItinerary?: string;
  aiBestFit?: string;
  aiTripSummary?: string;
};

function sectionText(value?: string | null): string {
  return value?.trim() || "No information available yet.";
}

function getStyleFitLabel(trip: RankedDestination): string {
  if (trip.styleMatchStrength === "strong") return "Strong style match";
  if (trip.styleMatchStrength === "medium") return "Good style match";
  if (trip.styleMatchStrength === "weak") return "Weak style match";
  return "Poor style match";
}

export default function TripCard({ trip, isSaved = false, onRemove }: Props) {
  const cardTrip = trip as TripCardTrip;

  const [openSections, setOpenSections] = useState({
    overview: false,
    whyMatched: false,
    budget: false,
    itinerary: true,
  });

  const toggleSection = (key: keyof typeof openSections) => {
    setOpenSections((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const confidenceLabel =
    cardTrip.confidenceLabel ??
    (trip.confidence === "high"
      ? "Strong match"
      : trip.confidence === "medium"
      ? "Good match"
      : trip.confidence === "low"
      ? "Promising"
      : "Match");

  const dataBadge = useMemo(() => {
    if (trip.liveDataSummary?.usedPlacesData) return "Live Google Places";
    if (cardTrip.source === "static-fallback") return "Static ranking data";
    return "Static ranking";
  }, [trip.liveDataSummary?.usedPlacesData, cardTrip.source]);

  const whyRanked =
    trip.rankingReasons?.[0]?.label ||
    trip.matchReasons?.[0] ||
    "Matched your trip filters.";

  const itineraryText = trip.aiSummary?.trim()
    ? trip.aiSummary
    : cardTrip.aiTripSummary?.trim()
    ? [
        cardTrip.aiTripSummary,
        cardTrip.aiBestFit ? `\n\nBEST FIT\n${cardTrip.aiBestFit}` : "",
        cardTrip.aiSuggestedItinerary
          ? `\n\nSUGGESTED ITINERARY\n${cardTrip.aiSuggestedItinerary}`
          : "",
      ].join("")
    : "No AI itinerary available yet.";

  return (
    <article className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      {trip.imageUrl ? (
        <img
          src={trip.imageUrl}
          alt={trip.name}
          className="h-48 w-full object-cover"
        />
      ) : null}

      <div className="p-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold text-slate-900">{trip.name}</h2>
            <p className="mt-1 text-sm text-slate-600">
              Home base: {cardTrip.homeBase || trip.name} • Drive time: {trip.driveHoursFromStart} hours
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {trip.isStaycation ? "Staycation option" : "Alberta getaway"}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <span
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                trip.liveDataSummary?.usedPlacesData
                  ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                  : "border-slate-200 bg-slate-50 text-slate-600"
              }`}
            >
              {dataBadge}
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
              {confidenceLabel}
            </span>
          </div>
        </div>

        <p className="mb-6 text-base leading-7 text-slate-700">{trip.summary}</p>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl bg-slate-50 p-4">
            <div className="text-xs uppercase tracking-wide text-slate-500">Estimated cost</div>
            <div className="mt-2 text-3xl font-semibold text-slate-900">
              ${trip.estimatedCost}
            </div>
          </div>

          <div className="rounded-2xl bg-slate-50 p-4">
            <div className="text-xs uppercase tracking-wide text-slate-500">Match score</div>
            <div className="mt-2 text-3xl font-semibold text-slate-900">{trip.score}</div>
          </div>

          <div className="rounded-2xl bg-slate-50 p-4">
            <div className="text-xs uppercase tracking-wide text-slate-500">Style fit</div>
            <div className="mt-2 text-3xl font-semibold text-slate-900">
              {getStyleFitLabel(trip)}
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Why this ranked</div>
          <div className="mt-2 text-base text-slate-800">{whyRanked}</div>
        </div>

        {!!trip.rawVibes?.length && (
          <div className="mt-4 flex flex-wrap gap-2">
            {trip.rawVibes.map((vibe) => (
              <span
                key={vibe}
                className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700"
              >
                {vibe}
              </span>
            ))}
          </div>
        )}

        <div className="mt-5 flex flex-wrap gap-3">
          {isSaved && onRemove ? (
            <button
              type="button"
              onClick={() => onRemove(trip.name)}
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100"
            >
              Remove trip
            </button>
          ) : null}
        </div>

        <div className="mt-6 space-y-3">
          <div className="rounded-2xl border border-slate-200">
            <button
              type="button"
              onClick={() => toggleSection("overview")}
              className="flex w-full items-center justify-between px-4 py-4 text-left"
            >
              <span className="text-lg font-medium text-slate-900">Overview</span>
              <span className="text-sm text-slate-500">
                {openSections.overview ? "Hide" : "Show"}
              </span>
            </button>
            {openSections.overview ? (
              <div className="border-t border-slate-200 px-4 py-4 text-slate-700">
                {sectionText(trip.summary)}
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-slate-200">
            <button
              type="button"
              onClick={() => toggleSection("whyMatched")}
              className="flex w-full items-center justify-between px-4 py-4 text-left"
            >
              <span className="text-lg font-medium text-slate-900">Why it matched</span>
              <span className="text-sm text-slate-500">
                {openSections.whyMatched ? "Hide" : "Show"}
              </span>
            </button>
            {openSections.whyMatched ? (
              <div className="border-t border-slate-200 px-4 py-4">
                <ul className="space-y-2 text-slate-700">
                  {(trip.rankingReasons?.length
                    ? trip.rankingReasons.map((reason) => reason.label)
                    : trip.matchReasons?.length
                    ? trip.matchReasons
                    : ["Matched your selected filters."]
                  ).map((item) => (
                    <li key={item}>• {item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-slate-200">
            <button
              type="button"
              onClick={() => toggleSection("budget")}
              className="flex w-full items-center justify-between px-4 py-4 text-left"
            >
              <span className="text-lg font-medium text-slate-900">Budget</span>
              <span className="text-sm text-slate-500">
                {openSections.budget ? "Hide" : "Show"}
              </span>
            </button>
            {openSections.budget ? (
              <div className="border-t border-slate-200 px-4 py-4 text-slate-700">
                Estimated total cost: <span className="font-semibold">${trip.estimatedCost}</span>
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-slate-200">
            <button
              type="button"
              onClick={() => toggleSection("itinerary")}
              className="flex w-full items-center justify-between px-4 py-4 text-left"
            >
              <span className="text-lg font-medium text-slate-900">Suggested itinerary</span>
              <span className="text-sm text-slate-500">
                {openSections.itinerary ? "Hide" : "Show"}
              </span>
            </button>
            {openSections.itinerary ? (
              <div className="border-t border-slate-200 px-4 py-4 whitespace-pre-line text-slate-700">
                {itineraryText}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}