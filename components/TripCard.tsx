"use client";

import { useState } from "react";
import { RankedDestination } from "../lib/types";

function getMatchStrengthLabel(strength: RankedDestination["styleMatchStrength"]) {
  switch (strength) {
    case "strong":
      return "Strong style match";
    case "medium":
      return "Good style match";
    case "weak":
      return "Light style match";
    case "poor":
    default:
      return "Weak style match";
  }
}

function Section({
  title,
  isOpen,
  onToggle,
  children,
}: {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border rounded">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 text-left font-medium"
      >
        <span>{title}</span>
        <span className="text-sm text-gray-400">{isOpen ? "Hide" : "Show"}</span>
      </button>

      {isOpen && <div className="px-4 pb-4 space-y-4 border-t">{children}</div>}
    </div>
  );
}

function buildTripFullText(trip: RankedDestination) {
  const itineraryLines =
    trip.aiItinerary && trip.aiItinerary.length > 0
      ? trip.aiItinerary.map((item) => `- ${item}`).join("\n")
      : "- No itinerary available";

  const reasons =
    trip.matchReasons.length > 0
      ? trip.matchReasons.map((item) => `- ${item}`).join("\n")
      : "- No match reasons available";

  const warnings =
    trip.warnings.length > 0
      ? trip.warnings.map((item) => `- ${item}`).join("\n")
      : "- None";

  return `${trip.name}
Home base: ${trip.homeBaseCity}
Drive time: ${trip.driveHoursFromStart} hours
Estimated cost: $${trip.estimatedCost}
Match score: ${trip.score}
Style fit: ${trip.styleMatchStrength}
Staycation: ${trip.isStaycation ? "Yes" : "No"}

Summary:
${trip.summary}

AI Summary:
${trip.aiSummary || "No AI summary available"}

Best Fit:
${trip.aiBestFit || "No best-fit note available"}

Match Reasons:
${reasons}

Warnings:
${warnings}

Budget Breakdown:
- Hotel: $${trip.budgetBreakdown.hotel}
- Food: $${trip.budgetBreakdown.food}
- Gas: $${trip.budgetBreakdown.gas}
- Activities: $${trip.budgetBreakdown.activities}
- Total: $${trip.budgetBreakdown.total}

Suggested Itinerary:
${itineraryLines}
`;
}

function buildTripShortText(trip: RankedDestination) {
  const itineraryPreview =
    trip.aiItinerary && trip.aiItinerary.length > 0
      ? trip.aiItinerary.slice(0, 2).map((item) => `- ${item}`).join("\n")
      : "- No itinerary available";

  return `${trip.name}
Cost: $${trip.estimatedCost}
Drive time: ${trip.driveHoursFromStart} hours
Best fit: ${trip.aiBestFit || "No best-fit note available"}

Summary:
${trip.aiSummary || trip.summary}

2-day plan:
${itineraryPreview}
`;
}

export default function TripCard({
  trip,
  isSaved = false,
  onSave,
  onRemove,
}: {
  trip: RankedDestination;
  isSaved?: boolean;
  onSave?: (trip: RankedDestination) => void;
  onRemove?: (tripName: string) => void;
}) {
  const [openSections, setOpenSections] = useState({
    overview: false,
    reasons: false,
    budget: false,
    itinerary: true,
  });
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");

  function toggleSection(section: keyof typeof openSections) {
    setOpenSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus("copied");
      setTimeout(() => setCopyStatus("idle"), 2000);
    } catch (err) {
      console.error("Failed to copy trip:", err);
      setCopyStatus("failed");
      setTimeout(() => setCopyStatus("idle"), 2000);
    }
  }

  return (
    <div className="border rounded p-5 shadow-sm space-y-4">
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold">{trip.name}</h2>
            <p className="text-sm text-gray-400">
              Home base: {trip.homeBaseCity} • Drive time: {trip.driveHoursFromStart} hours
            </p>
            {trip.isStaycation && (
              <p className="text-sm text-gray-400">Staycation option</p>
            )}
          </div>

          <div className="shrink-0 flex flex-col gap-2 items-end">
            <button
              type="button"
              onClick={() => copyText(buildTripShortText(trip))}
              className="border rounded px-3 py-2 text-sm"
            >
              Copy short
            </button>

            <button
              type="button"
              onClick={() => copyText(buildTripFullText(trip))}
              className="border rounded px-3 py-2 text-sm"
            >
              Copy full
            </button>

            {isSaved ? (
              <button
                type="button"
                onClick={() => onRemove?.(trip.name)}
                className="border rounded px-3 py-2 text-sm"
              >
                Remove saved
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onSave?.(trip)}
                className="border rounded px-3 py-2 text-sm"
              >
                Save trip
              </button>
            )}

            {copyStatus === "copied" && (
              <span className="text-xs text-gray-400">Copied</span>
            )}
            {copyStatus === "failed" && (
              <span className="text-xs text-red-400">Copy failed</span>
            )}
          </div>
        </div>

        <p>{trip.summary}</p>

        <div>
          <p className="font-medium">Estimated cost: ${trip.estimatedCost}</p>
          <p className="text-sm text-gray-400">Match score: {trip.score}</p>
          <p className="text-sm text-gray-400">
            {getMatchStrengthLabel(trip.styleMatchStrength)}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {trip.tripStyles.map((style) => (
            <span
              key={style}
              className="border rounded-full px-3 py-1 text-sm text-gray-200"
            >
              {style}
            </span>
          ))}
        </div>
      </div>

      <Section
        title="Overview"
        isOpen={openSections.overview}
        onToggle={() => toggleSection("overview")}
      >
        <div>
          <p className="font-medium mb-1">Top things to do</p>
          <ul className="list-disc pl-5 space-y-1">
            {trip.topActivities.slice(0, 3).map((activity) => (
              <li key={activity.name}>{activity.name}</li>
            ))}
          </ul>
        </div>

        <p className="text-sm text-gray-400">
          Best seasons: {trip.bestSeasons.join(", ")}
        </p>
      </Section>

      <Section
        title="Why it matched"
        isOpen={openSections.reasons}
        onToggle={() => toggleSection("reasons")}
      >
        <div>
          <p className="font-medium mb-1">Reasons</p>
          <ul className="list-disc pl-5 space-y-1">
            {trip.matchReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>

        {trip.warnings.length > 0 && (
          <div>
            <p className="font-medium mb-1">Things to watch</p>
            <ul className="list-disc pl-5 space-y-1 text-sm text-yellow-300">
              {trip.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section
        title="Budget"
        isOpen={openSections.budget}
        onToggle={() => toggleSection("budget")}
      >
        <div>
          <p className="font-medium mb-1">Budget breakdown</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Hotel: ${trip.budgetBreakdown.hotel}</li>
            <li>Food: ${trip.budgetBreakdown.food}</li>
            <li>Gas: ${trip.budgetBreakdown.gas}</li>
            <li>Activities: ${trip.budgetBreakdown.activities}</li>
            <li>Total: ${trip.budgetBreakdown.total}</li>
          </ul>
        </div>

        {trip.aiBudgetNote && (
          <div>
            <p className="font-medium mb-1">Budget note</p>
            <p>{trip.aiBudgetNote}</p>
          </div>
        )}
      </Section>

      <Section
        title="AI itinerary"
        isOpen={openSections.itinerary}
        onToggle={() => toggleSection("itinerary")}
      >
        {trip.aiSummary && (
          <div>
            <p className="font-medium mb-1">AI trip summary</p>
            <p>{trip.aiSummary}</p>
          </div>
        )}

        {trip.aiBestFit && (
          <div>
            <p className="font-medium mb-1">Best fit</p>
            <p>{trip.aiBestFit}</p>
          </div>
        )}

        {trip.aiItinerary && trip.aiItinerary.length > 0 && (
          <div>
            <p className="font-medium mb-1">Suggested itinerary</p>
            <ul className="list-disc pl-5 space-y-1">
              {trip.aiItinerary.map((item, index) => (
                <li key={`${trip.name}-itinerary-${index}`}>{item}</li>
              ))}
            </ul>
          </div>
        )}

        {!trip.aiSummary && (!trip.aiItinerary || trip.aiItinerary.length === 0) && (
          <p className="text-gray-400">No AI itinerary content available.</p>
        )}
      </Section>
    </div>
  );
}