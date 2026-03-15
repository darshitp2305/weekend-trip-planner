"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  RankedDestination,
  TripDataSource,
  TripInput,
} from "../lib/types";
import { buildTripPlan } from "../lib/buildTripPlan";
import { deriveTripEndDate } from "../lib/tripDates";
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

function sourceLabel(trip: RankedDestination) {
  if (trip.liveDataSummary?.usedPlacesData) return "Live Places";
  if (trip.liveDataSummary?.usedFallbackData) return "Fallback data";
  return "Static ranking";
}

function shortCopyText(trip: RankedDestination, input?: TripInput) {
  const displayCost =
    trip.budgetBreakdown?.totalExpected ??
    trip.budgetBreakdown?.total ??
    trip.estimatedCost;

  const travelerCount = Math.max(1, input?.travelerCount ?? 1);
  const perTraveler = Math.round(displayCost / travelerCount);

  return `${trip.name} — ${trip.summary} Estimated total cost: $${displayCost}. Approx. per traveler: $${perTraveler}. Drive: ${trip.driveHoursFromStart}h. Confidence: ${confidenceLabel(trip.confidence)}.`;
}

function fullCopyText(trip: RankedDestination, input?: TripInput) {
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

  const travelerCount = Math.max(1, input?.travelerCount ?? 1);
  const perTraveler = Math.round(displayCost / travelerCount);

  return [
    `${trip.name}`,
    ``,
    `Summary: ${trip.summary}`,
    `Estimated total cost: $${displayCost}`,
    `Estimated per traveler: $${perTraveler}`,
    `Travelers: ${travelerCount}`,
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

  const travelerCount = Number(input.travelerCount ?? 2);
  const budgetPerTraveler = Number(input.budgetPerTraveler ?? 300);
  const computedBudget = travelerCount * budgetPerTraveler;
  const tripLengthDays = Number(input.tripLengthDays ?? 2);
  const tripStartDate =
    typeof input.tripStartDate === "string" ? input.tripStartDate : undefined;

  return {
    startCity: input.startCity === "Calgary" ? "Calgary" : "Edmonton",
    season: input.season ?? "Summer",
    style: input.style ?? "foodie",
    veganFriendly: Boolean(input.veganFriendly),
    includeStaycations: Boolean(input.includeStaycations),
    strictBudget: Boolean(input.strictBudget),
    maxDriveHours: Number(input.maxDriveHours ?? 5),
    budget: Number(input.budget ?? computedBudget),
    budgetPerTraveler,
    travelerCount,
    tripLengthDays,
    preferredDestination:
      typeof input.preferredDestination === "string"
        ? input.preferredDestination.trim() || undefined
        : undefined,
    tripStartDate,
    tripEndDate: deriveTripEndDate(tripStartDate, tripLengthDays),
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

function Badge({
  children,
  tone = "slate",
}: {
  children: React.ReactNode;
  tone?: "slate" | "green" | "violet";
}) {
  const toneClass =
    tone === "green"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "violet"
        ? "border-violet-200 bg-violet-50 text-violet-700"
        : "border-slate-200 bg-slate-50 text-slate-700";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${toneClass}`}
    >
      {children}
    </span>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl bg-slate-50 p-3">
      <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function Section({
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
    <div className="rounded-2xl border border-slate-200 bg-slate-50">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm font-semibold text-slate-900">{title}</span>
        <span className="text-sm text-slate-500">{open ? "Hide" : "Show"}</span>
      </button>

      {open ? <div className="border-t border-slate-200 px-4 py-4">{children}</div> : null}
    </div>
  );
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
  const [openSection, setOpenSection] = useState<string | null>(null);

  const tags = Array.isArray(trip.rawVibes) ? trip.rawVibes.slice(0, 4) : [];
  const topWhyRanked =
    trip.rankingReasons?.[0]?.label ??
    trip.matchReasons?.[0] ??
    "No summary available";

  const displayCost =
    trip.budgetBreakdown?.totalExpected ??
    trip.budgetBreakdown?.total ??
    trip.estimatedCost;

  const normalizedPropInput = normalizeTripInput(input);
  const travelerCount = Math.max(1, normalizedPropInput?.travelerCount ?? 1);
  const perTravelerDisplay = Math.round(displayCost / travelerCount);

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
              console.error("Failed to parse enrich-trip response:", parseError, text);
            }
          }

          if (!enrichRes.ok) {
            console.error("enrich-trip request failed:", enrichRes.status, enrichData);
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
      const saveResult = await saveTripPlan(plan);

      if (!saveResult.success) {
        throw new Error("Trip save failed.");
      }

      onSave?.(trip.name);
      router.push(`/trip/${plan.id}`);
    } catch (error) {
      console.error("Failed to save trip:", error);
      alert("Trip save failed. Check terminal/console.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
      {trip.imageUrl ? (
        <div className="aspect-[16/10] w-full overflow-hidden bg-slate-100">
          <img
            src={trip.imageUrl}
            alt={trip.name}
            className="h-full w-full object-cover"
          />
        </div>
      ) : null}

      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-2xl font-semibold tracking-tight text-slate-950">
              {trip.name}
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              {trip.homeBaseCity} • {trip.driveHoursFromStart}h drive
            </p>
          </div>

          <Badge tone={trip.confidence === "high" ? "green" : "violet"}>
            {confidenceLabel(trip.confidence)}
          </Badge>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Badge>{trip.isStaycation ? "Staycation" : `${trip.province} getaway`}</Badge>
          <Badge>{sourceLabel(trip)}</Badge>
        </div>

        <p className="mt-4 text-sm leading-6 text-slate-600">{trip.summary}</p>

        <div className="mt-5 grid grid-cols-3 gap-3">
          <Stat label="Budget total" value={`$${Math.round(displayCost)}`} />
          <Stat label="Per traveler" value={`$${perTravelerDisplay}`} />
          <Stat label="Style fit" value={strengthLabel(trip.styleMatchStrength)} />
        </div>

        <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">
            Why this ranked
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-700">{topWhyRanked}</p>
        </div>

        {tags.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600"
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(shortCopyText(trip, normalizedPropInput))}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Copy short
          </button>

          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(fullCopyText(trip, normalizedPropInput))}
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
              className="rounded-xl bg-slate-950 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {saving ? "Building..." : "Build trip"}
            </button>
          )}
        </div>

        <div className="mt-5 space-y-3">
          <Section
            title="Overview"
            open={openSection === "overview"}
            onToggle={() =>
              setOpenSection(openSection === "overview" ? null : "overview")
            }
          >
            <p className="text-sm leading-6 text-slate-700">{trip.summary}</p>

            {trip.aiSummary ? (
              <div className="mt-4">
                <div className="text-sm font-semibold text-slate-900">AI trip summary</div>
                <p className="mt-2 text-sm leading-6 text-slate-700">
                  {trip.aiSummary}
                </p>
              </div>
            ) : null}
          </Section>

          <Section
            title="Why it matched"
            open={openSection === "matched"}
            onToggle={() =>
              setOpenSection(openSection === "matched" ? null : "matched")
            }
          >
            {trip.rankingReasons?.length ? (
              <div>
                <div className="text-sm font-semibold text-slate-900">Ranking summary</div>
                <ul className="mt-2 space-y-2 text-sm text-slate-700">
                  {trip.rankingReasons.map((reason, index) => (
                    <li key={`${reason.label}-${index}`}>• {reason.label}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="mt-4">
              <div className="text-sm font-semibold text-slate-900">Match reasons</div>
              {trip.matchReasons?.length ? (
                <ul className="mt-2 space-y-2 text-sm text-slate-700">
                  {trip.matchReasons.map((reason, index) => (
                    <li key={`${reason}-${index}`}>• {reason}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-slate-600">No match reasons available.</p>
              )}
            </div>

            {trip.aiBestFit ? (
              <div className="mt-4">
                <div className="text-sm font-semibold text-slate-900">Best fit</div>
                <p className="mt-2 text-sm leading-6 text-slate-700">{trip.aiBestFit}</p>
              </div>
            ) : null}

            {trip.warnings?.length ? (
              <div className="mt-4">
                <div className="text-sm font-semibold text-slate-900">Warnings</div>
                <ul className="mt-2 space-y-2 text-sm text-amber-700">
                  {trip.warnings.map((warning, index) => (
                    <li key={`${warning}-${index}`}>• {warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Section>

          <Section
            title="Budget"
            open={openSection === "budget"}
            onToggle={() =>
              setOpenSection(openSection === "budget" ? null : "budget")
            }
          >
            {trip.budgetBreakdown ? (
              <div className="grid grid-cols-2 gap-3 text-sm text-slate-700">
                <div className="rounded-xl bg-white p-3">Hotel: ${trip.budgetBreakdown.hotel}</div>
                <div className="rounded-xl bg-white p-3">Food: ${trip.budgetBreakdown.food}</div>
                <div className="rounded-xl bg-white p-3">Gas: ${trip.budgetBreakdown.gas}</div>
                <div className="rounded-xl bg-white p-3">
                  Activities: ${trip.budgetBreakdown.activities}
                </div>
                <div className="rounded-xl bg-white p-3">
                  Per traveler: ${perTravelerDisplay}
                </div>
                <div className="rounded-xl bg-white p-3">
                  Travelers: {travelerCount}
                </div>
                <div className="col-span-2 rounded-xl bg-slate-100 p-3 font-semibold text-slate-900">
                  Total: $
                  {trip.budgetBreakdown.totalExpected ?? trip.budgetBreakdown.total}
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-600">No budget breakdown available.</p>
            )}

            {trip.aiBudgetNote ? (
              <p className="mt-4 text-sm leading-6 text-slate-700">{trip.aiBudgetNote}</p>
            ) : null}
          </Section>

          <Section
            title="Itinerary"
            open={openSection === "itinerary"}
            onToggle={() =>
              setOpenSection(openSection === "itinerary" ? null : "itinerary")
            }
          >
            {trip.aiSummary ? (
              <div>
                <div className="text-sm font-semibold text-slate-900">AI trip summary</div>
                <p className="mt-2 text-sm leading-6 text-slate-700">{trip.aiSummary}</p>
              </div>
            ) : null}

            {trip.aiBestFit ? (
              <div className="mt-4">
                <div className="text-sm font-semibold text-slate-900">Best fit</div>
                <p className="mt-2 text-sm leading-6 text-slate-700">{trip.aiBestFit}</p>
              </div>
            ) : null}

            <div className="mt-4">
              <div className="text-sm font-semibold text-slate-900">Suggested itinerary</div>
              {trip.aiItinerary?.length ? (
                <ul className="mt-2 space-y-2 text-sm text-slate-700">
                  {trip.aiItinerary.map((line, index) => (
                    <li key={`${line}-${index}`}>• {line}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-slate-600">No AI itinerary available yet.</p>
              )}
            </div>
          </Section>
        </div>
      </div>
    </article>
  );
}
