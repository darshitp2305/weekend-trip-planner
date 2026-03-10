"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RankedDestination, TripInput } from "../lib/types";
import { buildTripPlan } from "../lib/buildTripPlan";
import { saveTripPlan } from "../lib/tripStore";

type Props = {
  trip: RankedDestination;
  input?: Partial<TripInput>;
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

  async function handleSaveTrip() {
    try {
      setSaving(true);

      const plan = buildTripPlan(trip, input);
      saveTripPlan(plan);

      if (onSave) onSave(trip.name);

      router.push(`/trip/${plan.id}`);
    } catch (error) {
      console.error("Failed to save trip:", error);
      alert("Trip save failed. Check the console and fix the pipeline.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border rounded p-4 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-3xl font-bold">{trip.name}</h3>
          <p className="text-sm text-gray-400">
            Home base: {trip.homeBaseCity} • Drive time: {trip.driveHoursFromStart} hours
          </p>
          <p className="text-sm text-gray-500">
            {trip.isStaycation ? "Staycation option" : `${trip.province} getaway`}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <button
            className="border rounded px-3 py-2 text-sm"
            onClick={() => navigator.clipboard.writeText(shortCopyText(trip))}
          >
            Copy short
          </button>

          <button
            className="border rounded px-3 py-2 text-sm"
            onClick={() => navigator.clipboard.writeText(fullCopyText(trip))}
          >
            Copy full
          </button>

          {isSaved ? (
            <button
              className="border rounded px-3 py-2 text-sm"
              onClick={() => onRemoveSaved?.(trip.name)}
            >
              Remove saved
            </button>
          ) : (
            <button
              className="border rounded px-3 py-2 text-sm"
              onClick={handleSaveTrip}
              disabled={saving}
            >
              {saving ? "Saving..." : "Save trip"}
            </button>
          )}
        </div>
      </div>

      <p className="text-base leading-7">{trip.summary}</p>

      <div className="space-y-1 text-sm text-gray-300">
        <div>Estimated cost: ${trip.estimatedCost}</div>
        <div>Match score: {trip.score}</div>
        <div>{strengthLabel(trip.styleMatchStrength)}</div>
      </div>

      {tags.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span key={tag} className="border rounded-full px-3 py-1 text-xs">
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      <Accordion
        title="Overview"
        open={openSection === "overview"}
        onToggle={() => setOpenSection(openSection === "overview" ? null : "overview")}
      >
        <div className="space-y-2 text-sm">
          <p>{trip.summary}</p>
          {trip.aiSummary ? (
            <>
              <div className="font-semibold pt-2">AI trip summary</div>
              <p>{trip.aiSummary}</p>
            </>
          ) : null}
        </div>
      </Accordion>

      <Accordion
        title="Why it matched"
        open={openSection === "matched"}
        onToggle={() => setOpenSection(openSection === "matched" ? null : "matched")}
      >
        <div className="space-y-2 text-sm">
          {trip.matchReasons?.length ? (
            <ul className="list-disc pl-5 space-y-1">
              {trip.matchReasons.map((reason, index) => (
                <li key={index}>{reason}</li>
              ))}
            </ul>
          ) : (
            <p>No match reasons available.</p>
          )}

          {trip.aiBestFit ? (
            <>
              <div className="font-semibold pt-2">Best fit</div>
              <p>{trip.aiBestFit}</p>
            </>
          ) : null}

          {trip.warnings?.length ? (
            <>
              <div className="font-semibold pt-2">Warnings</div>
              <ul className="list-disc pl-5 space-y-1">
                {trip.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </Accordion>

      <Accordion
        title="Budget"
        open={openSection === "budget"}
        onToggle={() => setOpenSection(openSection === "budget" ? null : "budget")}
      >
        <div className="space-y-1 text-sm">
          <div>Hotel: ${trip.budgetBreakdown.hotel}</div>
          <div>Food: ${trip.budgetBreakdown.food}</div>
          <div>Gas: ${trip.budgetBreakdown.gas}</div>
          <div>Activities: ${trip.budgetBreakdown.activities}</div>
          <div className="font-semibold">Total: ${trip.budgetBreakdown.total}</div>
          {trip.aiBudgetNote ? <p className="pt-2">{trip.aiBudgetNote}</p> : null}
        </div>
      </Accordion>

      <Accordion
        title="AI itinerary"
        open={openSection === "itinerary"}
        onToggle={() => setOpenSection(openSection === "itinerary" ? null : "itinerary")}
      >
        <div className="space-y-3 text-sm">
          {trip.aiSummary ? (
            <>
              <div className="font-semibold">AI trip summary</div>
              <p>{trip.aiSummary}</p>
            </>
          ) : null}

          {trip.aiBestFit ? (
            <>
              <div className="font-semibold">Best fit</div>
              <p>{trip.aiBestFit}</p>
            </>
          ) : null}

          {trip.aiItinerary?.length ? (
            <>
              <div className="font-semibold">Suggested itinerary</div>
              <ul className="list-disc pl-5 space-y-1">
                {trip.aiItinerary.map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
              </ul>
            </>
          ) : (
            <p>No AI itinerary available yet.</p>
          )}
        </div>
      </Accordion>
    </div>
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
    <div className="border rounded">
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-left"
        onClick={onToggle}
      >
        <span>{title}</span>
        <span className="text-sm text-gray-400">{open ? "Hide" : "Show"}</span>
      </button>

      {open ? <div className="border-t px-4 py-3">{children}</div> : null}
    </div>
  );
}

function shortCopyText(trip: RankedDestination) {
  return `${trip.name} — ${trip.summary} Estimated cost: $${trip.estimatedCost}. Drive: ${trip.driveHoursFromStart}h.`;
}

function fullCopyText(trip: RankedDestination) {
  const itinerary = trip.aiItinerary?.length
    ? trip.aiItinerary.map((line) => `- ${line}`).join("\n")
    : "No itinerary available.";

  const reasons = trip.matchReasons?.length
    ? trip.matchReasons.map((line) => `- ${line}`).join("\n")
    : "No match reasons available.";

  return [
    `${trip.name}`,
    ``,
    `Summary: ${trip.summary}`,
    `Estimated cost: $${trip.estimatedCost}`,
    `Drive time: ${trip.driveHoursFromStart}h`,
    `Style fit: ${trip.styleMatchStrength}`,
    ``,
    `Why it matched:`,
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