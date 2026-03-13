"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  RankedDestination,
  TripDataSource,
  TripInput,
} from "../lib/types";
import { buildTripPlan } from "../lib/buildTripPlan";
import { saveTripPlan } from "../lib/tripStore";

const LAST_INPUT_STORAGE_KEY = "weekend-trip-last-input";

type Props = {
  trip: RankedDestination;
  input?: TripInput;
  onSave?: (tripName: string) => void;
  onRemoveSaved?: (tripName: string) => void;
  isSaved?: boolean;
};

function strengthLabel(strength: RankedDestination["styleMatchStrength"]) {
  switch (strength) {
    case "strong":
      return "Strong style match";
    case "medium":
      return "Good style match";
    case "weak":
      return "Light style match";
    default:
      return "Weak style match";
  }
}

function confidenceLabel(confidence?: RankedDestination["confidence"]) {
  switch (confidence) {
    case "high":
      return "Strong match";
    case "medium":
      return "Good match";
    case "low":
      return "Experimental";
    default:
      return "Unrated";
  }
}

function renderSourceBadge(trip: RankedDestination) {
  if (trip.liveDataSummary?.usedPlacesData) {
    return (
      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
        Live Google Places
      </span>
    );
  }

  if (trip.liveDataSummary?.usedFallbackData) {
    return (
      <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">
        Fallback data
      </span>
    );
  }

  return (
    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-600">
      Static ranking data
    </span>
  );
}

function Accordion({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="font-medium text-slate-900">{title}</span>
        <span className="text-sm text-slate-500">{open ? "Hide" : "Show"}</span>
      </button>

      {open ? <div className="border-t border-slate-200 p-4">{children}</div> : null}
    </div>
  );
}

function shortCopyText(trip: RankedDestination) {
  const displayCost =
    trip.budgetBreakdown?.totalExpected ??
    trip.budgetBreakdown?.total ??
    trip.estimatedCost;

  return `${trip.name} — ${trip.summary} Estimated cost: $${displayCost}. Drive: ${trip.driveHoursFromStart}h. Confidence: ${confidenceLabel(
    trip.confidence
  )}.`;
}

function fullCopyText(trip: RankedDestination) {
  const itinerary = trip.aiItinerary?.length
    ? trip.aiItinerary.map((line) => `- ${line}`).join("\n")
    : "No itinerary available.";

  const reasons = trip.rankingReasons?.length
    ? trip.rankingReasons.map((line) => `- ${line.label}`).join("\n")
    : trip.matchReasons?.length
    ? trip.matchReasons.map((line) => `- ${line}`).join("\n")
    : "No match reasons available.";

  const displayCost =
    trip.budgetBreakdown?.totalExpected ??
    trip.budgetBreakdown?.total ??
    trip.estimatedCost;

  return [
    `${trip.name}`,
    ``,
    `Summary: ${trip.summary}`,
    `Estimated cost: $${displayCost}`,
    `Drive time: ${trip.driveHoursFromStart}h`,
    `Style fit: ${trip.styleMatchStrength}`,
    `Confidence: ${confidenceLabel(trip.confidence)}`,
    ``,
    `Why it ranked:`,
    reasons,
    ``,
    `AI summary:`,
    trip.aiSummary ?? "None",
    ``,
    `AI best fit:`,
    trip.aiBestFit ?? "None",
    ``,
    `AI itinerary:`,
    itinerary,
  ].join("\n");
}

function normalizeTripInput(input?: Partial<TripInput> | null): TripInput | undefined {
  if (!input) return undefined;

  return {
    startCity: input.startCity === "Calgary" ? "Calgary" : "Edmonton",
    season: input.season ?? "Summer",
    style: input.style ?? "foodie",
    veganFriendly: Boolean(input.veganFriendly),
    includeStaycations: Boolean(input.includeStaycations),
    strictBudget: Boolean(input.strictBudget),
    maxDriveHours: Number(input.maxDriveHours ?? 5),
    budget: Number(input.budget ?? 600),
    tripLengthDays: Number(input.tripLengthDays ?? 2),
  };
}

function getStoredLastInput(): TripInput | undefined {
  if (typeof window === "undefined") return undefined;

  try {
    const raw = sessionStorage.getItem(LAST_INPUT_STORAGE_KEY);
    if (!raw) return undefined;
    return normalizeTripInput(JSON.parse(raw));
  } catch (error) {
    console.error("Failed to read stored planner input:", error);
    return undefined;
  }
}

export default function TripCard({
  trip,
  input,
  onSave,
  onRemoveSaved,
  isSaved = false,
}: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [openSection, setOpenSection] = useState<string | null>("itinerary");

  const tags = Array.isArray(trip.rawVibes) ? trip.rawVibes.slice(0, 5) : [];
  const topWhyRanked =
    trip.rankingReasons?.[0]?.label ?? trip.matchReasons?.[0] ?? "No summary available";

  async function handleSaveTrip() {
    try {
      setSaving(true);

      let enrichedTrip = trip;
      let source: TripDataSource = trip.liveDataSummary?.usedPlacesData
        ? "live-google-places"
        : trip.liveDataSummary?.usedFallbackData
        ? "static-fallback"
        : "static-ranking";

      const propInput = normalizeTripInput(input);
      const storedInput = getStoredLastInput();
      const effectiveInput = storedInput ?? propInput;

      if (effectiveInput) {
        try {
          const enrichRes = await fetch("/api/enrich-trip", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              trip,
              input: effectiveInput,
            }),
          });

          const text = await enrichRes.text();
          let enrichData: any = null;

          if (text) {
            try {
              enrichData = JSON.parse(text);
            } catch (parseError) {
              console.error(
                "Failed to parse enrich-trip response:",
                parseError,
                text
              );
            }
          }

          if (!enrichRes.ok) {
            console.error(
              "enrich-trip request failed:",
              enrichRes.status,
              enrichData
            );
          } else {
            if (enrichData?.success && enrichData?.trip) {
              enrichedTrip = enrichData.trip;
            }

            if (
              enrichData?.source === "live-google-places" ||
              enrichData?.source === "static-fallback" ||
              enrichData?.source === "static-ranking"
            ) {
              source = enrichData.source;
            }
          }
        } catch (enrichError) {
          console.error("enrich-trip fetch failed, using current trip:", enrichError);
        }
      }

      const plan = buildTripPlan(enrichedTrip, effectiveInput, source);
      saveTripPlan(plan);

      if (onSave) onSave(trip.name);
      router.push(`/trip/${plan.id}`);
    } catch (error) {
      console.error("Failed to save trip:", error);
      alert("Trip save failed. Check terminal/console.");
    } finally {
      setSaving(false);
    }
  }

  const displayCost =
    trip.budgetBreakdown?.totalExpected ??
    trip.budgetBreakdown?.total ??
    trip.estimatedCost;

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {trip.imageUrl ? (
        <div className="h-52 w-full overflow-hidden bg-slate-100">
          <img
            src={trip.imageUrl}
            alt={trip.name}
            className="h-full w-full object-cover"
          />
        </div>
      ) : null}

      <div className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-2xl font-semibold text-slate-900">{trip.name}</h3>
            <p className="mt-1 text-sm text-slate-600">
              Home base: {trip.homeBaseCity} • Drive time: {trip.driveHoursFromStart} hours
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {trip.isStaycation ? "Staycation option" : `${trip.province} getaway`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {renderSourceBadge(trip)}
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700">
              {confidenceLabel(trip.confidence)}
            </span>
          </div>
        </div>

        <p className="mt-4 text-slate-700">{trip.summary}</p>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-slate-50 p-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">
              Estimated cost
            </div>
            <div className="mt-1 text-lg font-semibold text-slate-900">
              ${Math.round(displayCost)}
            </div>
          </div>

          <div className="rounded-xl bg-slate-50 p-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">
              Match score
            </div>
            <div className="mt-1 text-lg font-semibold text-slate-900">
              {trip.score}
            </div>
          </div>

          <div className="rounded-xl bg-slate-50 p-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">
              Style fit
            </div>
            <div className="mt-1 text-lg font-semibold text-slate-900">
              {strengthLabel(trip.styleMatchStrength)}
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs uppercase tracking-wide text-slate-500">
            Why this ranked
          </div>
          <div className="mt-1 text-sm font-medium text-slate-800">
            {topWhyRanked}
          </div>
        </div>

        {tags.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700"
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(shortCopyText(trip))}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Copy short
          </button>

          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(fullCopyText(trip))}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Copy full
          </button>

          {isSaved ? (
            <button
              type="button"
              onClick={() => onRemoveSaved?.(trip.name)}
              className="rounded-xl border border-rose-200 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50"
            >
              Remove saved
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSaveTrip}
              disabled={saving}
              className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save trip"}
            </button>
          )}
        </div>

        <div className="mt-5 space-y-3">
          <Accordion
            title="Overview"
            open={openSection === "overview"}
            onToggle={() =>
              setOpenSection(openSection === "overview" ? null : "overview")
            }
          >
            <p className="text-sm text-slate-700">{trip.summary}</p>

            {trip.aiSummary ? (
              <div className="mt-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  AI trip summary
                </div>
                <p className="mt-1 text-sm text-slate-700">{trip.aiSummary}</p>
              </div>
            ) : null}
          </Accordion>

          <Accordion
            title="Why it matched"
            open={openSection === "matched"}
            onToggle={() =>
              setOpenSection(openSection === "matched" ? null : "matched")
            }
          >
            {trip.rankingReasons?.length ? (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Ranking summary
                </div>
                <ul className="mt-2 space-y-2 text-sm text-slate-700">
                  {trip.rankingReasons.map((reason, index) => (
                    <li key={`${reason.label}-${index}`}>• {reason.label}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="mt-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Match reasons
              </div>
              {trip.matchReasons?.length ? (
                <ul className="mt-2 space-y-2 text-sm text-slate-700">
                  {trip.matchReasons.map((reason, index) => (
                    <li key={`${reason}-${index}`}>• {reason}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-slate-600">
                  No match reasons available.
                </p>
              )}
            </div>

            {trip.aiBestFit ? (
              <div className="mt-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Best fit
                </div>
                <p className="mt-1 text-sm text-slate-700">{trip.aiBestFit}</p>
              </div>
            ) : null}

            {trip.warnings?.length ? (
              <div className="mt-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Warnings
                </div>
                <ul className="mt-2 space-y-2 text-sm text-slate-700">
                  {trip.warnings.map((warning, index) => (
                    <li key={`${warning}-${index}`}>• {warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Accordion>

          <Accordion
            title="Budget"
            open={openSection === "budget"}
            onToggle={() =>
              setOpenSection(openSection === "budget" ? null : "budget")
            }
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
                Hotel: ${trip.budgetBreakdown.hotel}
              </div>
              <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
                Food: ${trip.budgetBreakdown.food}
              </div>
              <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
                Gas: ${trip.budgetBreakdown.gas}
              </div>
              <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
                Activities: ${trip.budgetBreakdown.activities}
              </div>
              <div className="rounded-xl bg-slate-100 p-3 text-sm font-semibold text-slate-900 sm:col-span-2">
                Total: ${trip.budgetBreakdown.totalExpected ?? trip.budgetBreakdown.total}
              </div>
            </div>

            {trip.aiBudgetNote ? (
              <p className="mt-3 text-sm text-slate-700">{trip.aiBudgetNote}</p>
            ) : null}
          </Accordion>

          <Accordion
            title="Suggested itinerary"
            open={openSection === "itinerary"}
            onToggle={() =>
              setOpenSection(openSection === "itinerary" ? null : "itinerary")
            }
          >
            {trip.aiSummary ? (
              <div className="mb-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  AI trip summary
                </div>
                <p className="mt-1 text-sm text-slate-700">{trip.aiSummary}</p>
              </div>
            ) : null}

            {trip.aiBestFit ? (
              <div className="mb-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Best fit
                </div>
                <p className="mt-1 text-sm text-slate-700">{trip.aiBestFit}</p>
              </div>
            ) : null}

            {trip.aiItinerary?.length ? (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Suggested itinerary
                </div>
                <ul className="mt-2 space-y-2 text-sm text-slate-700">
                  {trip.aiItinerary.map((line, index) => (
                    <li key={`${line}-${index}`}>• {line}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-slate-600">
                No AI itinerary available yet.
              </p>
            )}
          </Accordion>
        </div>
      </div>
    </article>
  );
}