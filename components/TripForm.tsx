"use client";

import { useEffect, useMemo, useState } from "react";
import TripCard from "./TripCard";
import CompareTrips from "./CompareTrips";
import SavedTrips from "./SavedTrips";
import { RankedDestination, TripStyle, TripInput } from "../lib/types";

const SAVED_TRIPS_KEY = "weekend_trip_planner_saved_trips";

function buildSavedTripsFullText(savedTrips: RankedDestination[]) {
  return savedTrips
    .map((trip, index) => {
      const itineraryLines =
        trip.aiItinerary && trip.aiItinerary.length > 0
          ? trip.aiItinerary.map((item) => `- ${item}`).join("\n")
          : "- No itinerary available";

      const reasons =
        trip.matchReasons && trip.matchReasons.length > 0
          ? trip.matchReasons.map((item) => `- ${item}`).join("\n")
          : "- No match reasons available";

      const budget = trip.budgetBreakdown ?? {
        hotel: 0,
        food: 0,
        gas: 0,
        activities: 0,
        total: trip.estimatedCost ?? 0,
      };

      return `${index + 1}. ${trip.name}
Home base: ${trip.homeBaseCity}
Drive time: ${trip.driveHoursFromStart} hours
Estimated cost: $${trip.estimatedCost}
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

Budget Breakdown:
- Hotel: $${budget.hotel}
- Food: $${budget.food}
- Gas: $${budget.gas}
- Activities: $${budget.activities}
- Total: $${budget.total}

Suggested Itinerary:
${itineraryLines}

----------------------------------------
`;
    })
    .join("\n");
}

function buildSavedTripsShortText(savedTrips: RankedDestination[]) {
  return savedTrips
    .map((trip, index) => {
      const itineraryPreview =
        trip.aiItinerary && trip.aiItinerary.length > 0
          ? trip.aiItinerary.slice(0, 2).map((item) => `- ${item}`).join("\n")
          : "- No itinerary available";

      return `${index + 1}. ${trip.name}
Cost: $${trip.estimatedCost}
Drive time: ${trip.driveHoursFromStart} hours
Best fit: ${trip.aiBestFit || "No best-fit note available"}

Summary:
${trip.aiSummary || trip.summary}

2-day plan:
${itineraryPreview}

----------------------------------------
`;
    })
    .join("\n");
}

function isValidRankedDestination(trip: any): trip is RankedDestination {
  return (
    trip &&
    typeof trip.name === "string" &&
    typeof trip.summary === "string" &&
    typeof trip.driveHoursFromStart === "number" &&
    typeof trip.homeBaseCity === "string" &&
    typeof trip.estimatedCost === "number" &&
    typeof trip.score === "number" &&
    trip.budgetBreakdown &&
    typeof trip.budgetBreakdown.hotel === "number" &&
    typeof trip.budgetBreakdown.food === "number" &&
    typeof trip.budgetBreakdown.gas === "number" &&
    typeof trip.budgetBreakdown.activities === "number" &&
    typeof trip.budgetBreakdown.total === "number"
  );
}

export default function TripForm() {
  const [form, setForm] = useState<TripInput>({
    startCity: "Edmonton",
    maxDriveHours: 5,
    budget: 600,
    tripLengthDays: 2,
    season: "summer",
    style: "foodie",
    veganFriendly: false,
    includeStaycations: true,
    strictBudget: false,
  });

  const [trips, setTrips] = useState<RankedDestination[]>([]);
  const [savedTrips, setSavedTrips] = useState<RankedDestination[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [mode, setMode] = useState("");
  const [savedCopyStatus, setSavedCopyStatus] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SAVED_TRIPS_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;

      const validTrips = parsed.filter(isValidRankedDestination);
      setSavedTrips(validTrips);

      if (validTrips.length !== parsed.length) {
        localStorage.setItem(SAVED_TRIPS_KEY, JSON.stringify(validTrips));
      }
    } catch (err) {
      console.error("Failed to load saved trips:", err);
      localStorage.removeItem(SAVED_TRIPS_KEY);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(SAVED_TRIPS_KEY, JSON.stringify(savedTrips));
    } catch (err) {
      console.error("Failed to save trips:", err);
    }
  }, [savedTrips]);

  const savedTripNames = useMemo(
    () => new Set(savedTrips.map((trip) => trip.name)),
    [savedTrips]
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setHasSearched(true);

    try {
      const response = await fetch("/api/generate-trip", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(form),
      });

      const data = await response.json();
      setMode(data.mode ?? "");

      if (!data.success) {
        throw new Error(data.error || "Something went wrong.");
      }

      const nextTrips = Array.isArray(data.trips) ? data.trips.filter(isValidRankedDestination) : [];
      setTrips(nextTrips);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to generate trip results.");
      setTrips([]);
      setMode("");
    } finally {
      setLoading(false);
    }
  }

  function saveTrip(tripName: string) {
    const found = trips.find((trip) => trip.name === tripName);
    if (!found) return;

    setSavedTrips((prev) => {
      if (prev.some((item) => item.name === found.name)) return prev;
      return [found, ...prev];
    });
  }

  function removeSavedTrip(tripName: string) {
    setSavedTrips((prev) => prev.filter((trip) => trip.name !== tripName));
  }

  function downloadFile(filename: string, content: string, mimeType: string) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();

    URL.revokeObjectURL(url);
  }

  function exportSavedTripsAsJson() {
    if (savedTrips.length === 0) return;

    const payload = {
      exportedAt: new Date().toISOString(),
      tripCount: savedTrips.length,
      trips: savedTrips,
    };

    downloadFile(
      "saved-trips.json",
      JSON.stringify(payload, null, 2),
      "application/json"
    );
  }

  function exportSavedTripsAsText() {
    if (savedTrips.length === 0) return;

    downloadFile(
      "saved-trips.txt",
      buildSavedTripsFullText(savedTrips),
      "text/plain;charset=utf-8"
    );
  }

  async function copySavedTripsShort() {
    if (savedTrips.length === 0) return;

    try {
      await navigator.clipboard.writeText(buildSavedTripsShortText(savedTrips));
      setSavedCopyStatus("copied");
      setTimeout(() => setSavedCopyStatus("idle"), 2000);
    } catch (err) {
      console.error("Failed to copy short saved trips:", err);
      setSavedCopyStatus("failed");
      setTimeout(() => setSavedCopyStatus("idle"), 2000);
    }
  }

  async function copySavedTripsFull() {
    if (savedTrips.length === 0) return;

    try {
      await navigator.clipboard.writeText(buildSavedTripsFullText(savedTrips));
      setSavedCopyStatus("copied");
      setTimeout(() => setSavedCopyStatus("idle"), 2000);
    } catch (err) {
      console.error("Failed to copy full saved trips:", err);
      setSavedCopyStatus("failed");
      setTimeout(() => setSavedCopyStatus("idle"), 2000);
    }
  }

  function clearSavedTrips() {
    setSavedTrips([]);
    localStorage.removeItem(SAVED_TRIPS_KEY);
  }

  function renderResultsMessage() {
    if (!hasSearched || loading || error) return null;

    if (trips.length === 0) {
      return (
        <div className="border rounded p-4 text-yellow-300">
          No destinations matched your current filters. Try increasing your budget,
          increasing max drive hours, allowing staycations, or turning off strict budget.
        </div>
      );
    }

    if (trips.length === 1) {
      return (
        <div className="border rounded p-4 text-gray-300">
          1 destination matched your filters. Your current settings are narrow, so try loosening
          budget or drive time if you want more options.
        </div>
      );
    }

    if (trips.length === 2) {
      return (
        <div className="border rounded p-4 text-gray-300">
          2 destinations matched your filters. A stricter budget or drive limit may be reducing your options.
        </div>
      );
    }

    return (
      <div className="border rounded p-4 text-gray-300">
        {trips.length} destinations matched your filters.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="space-y-4 max-w-xl">
        <div>
          <label className="block mb-1 font-medium">Start city</label>
          <select
            className="border p-2 w-full"
            value={form.startCity}
            onChange={(e) =>
              setForm({
                ...form,
                startCity: e.target.value as "Edmonton" | "Calgary",
              })
            }
          >
            <option value="Edmonton">Edmonton</option>
            <option value="Calgary">Calgary</option>
          </select>
        </div>

        <div>
          <label className="block mb-1 font-medium">Max drive hours</label>
          <input
            className="border p-2 w-full"
            type="number"
            min={0}
            max={12}
            step={0.5}
            value={form.maxDriveHours}
            onChange={(e) =>
              setForm({ ...form, maxDriveHours: Number(e.target.value) })
            }
          />
        </div>

        <div>
          <label className="block mb-1 font-medium">Total budget ($)</label>
          <input
            className="border p-2 w-full"
            type="number"
            min={50}
            step={50}
            value={form.budget}
            onChange={(e) => setForm({ ...form, budget: Number(e.target.value) })}
          />
        </div>

        <div>
          <label className="block mb-1 font-medium">Trip length (days)</label>
          <input
            className="border p-2 w-full"
            type="number"
            min={1}
            max={14}
            step={1}
            value={form.tripLengthDays}
            onChange={(e) =>
              setForm({ ...form, tripLengthDays: Number(e.target.value) })
            }
          />
        </div>

        <div>
          <label className="block mb-1 font-medium">Season</label>
          <select
            className="border p-2 w-full"
            value={form.season}
            onChange={(e) => setForm({ ...form, season: e.target.value })}
          >
            <option value="spring">Spring</option>
            <option value="summer">Summer</option>
            <option value="fall">Fall</option>
            <option value="winter">Winter</option>
          </select>
        </div>

        <div>
          <label className="block mb-1 font-medium">Trip style</label>
          <select
            className="border p-2 w-full"
            value={form.style}
            onChange={(e) =>
              setForm({ ...form, style: e.target.value as TripStyle })
            }
          >
            <option value="chill">Chill</option>
            <option value="outdoors">Outdoors</option>
            <option value="foodie">Foodie</option>
            <option value="solo reset">Solo Reset</option>
            <option value="adventure">Adventure</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <input
            id="veganFriendly"
            type="checkbox"
            checked={form.veganFriendly}
            onChange={(e) =>
              setForm({ ...form, veganFriendly: e.target.checked })
            }
          />
          <label htmlFor="veganFriendly" className="font-medium">
            Vegan-friendly only
          </label>
        </div>

        <div className="flex items-center gap-2">
          <input
            id="includeStaycations"
            type="checkbox"
            checked={form.includeStaycations}
            onChange={(e) =>
              setForm({ ...form, includeStaycations: e.target.checked })
            }
          />
          <label htmlFor="includeStaycations" className="font-medium">
            Include staycations
          </label>
        </div>

        <div className="flex items-center gap-2">
          <input
            id="strictBudget"
            type="checkbox"
            checked={form.strictBudget}
            onChange={(e) =>
              setForm({ ...form, strictBudget: e.target.checked })
            }
          />
          <label htmlFor="strictBudget" className="font-medium">
            Strict budget
          </label>
        </div>

        <button className="bg-black text-white px-4 py-2 rounded" type="submit">
          {loading ? "Generating..." : "Generate trip"}
        </button>
      </form>

      {error && <p className="text-red-600">{error}</p>}

      {!hasSearched && !loading && !error && (
        <div className="border rounded p-4 text-gray-400">
          Fill in your trip preferences and generate destination ideas.
        </div>
      )}

      {renderResultsMessage()}

      {mode && !loading && !error && (
        <div className="border rounded p-3 text-sm text-gray-400">
          {mode === "fake-ai" && "Using placeholder AI text for development mode."}
          {mode === "real-ai" && "Using live AI-generated trip text."}
          {mode === "real-ai-empty" &&
            "Live AI was called, but no usable itinerary content came back. Try generating again."}
        </div>
      )}

      {savedTrips.length > 0 && (
        <div className="border rounded p-4 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold">Saved trips</h2>
              <p className="text-sm text-gray-400 mt-1">
                These trips are saved in your browser on this device.
              </p>
            </div>

            <div className="flex flex-wrap gap-2 items-center">
              <button
                type="button"
                onClick={copySavedTripsShort}
                className="border rounded px-3 py-2 text-sm"
              >
                Copy all short
              </button>
              <button
                type="button"
                onClick={copySavedTripsFull}
                className="border rounded px-3 py-2 text-sm"
              >
                Copy all full
              </button>
              <button
                type="button"
                onClick={exportSavedTripsAsJson}
                className="border rounded px-3 py-2 text-sm"
              >
                Export JSON
              </button>
              <button
                type="button"
                onClick={exportSavedTripsAsText}
                className="border rounded px-3 py-2 text-sm"
              >
                Export text
              </button>
              <button
                type="button"
                onClick={clearSavedTrips}
                className="border rounded px-3 py-2 text-sm"
              >
                Clear saved
              </button>
              {savedCopyStatus === "copied" && (
                <span className="text-xs text-gray-400">Copied</span>
              )}
              {savedCopyStatus === "failed" && (
                <span className="text-xs text-red-400">Copy failed</span>
              )}
            </div>
          </div>
        </div>
      )}

      <SavedTrips trips={savedTrips} onRemove={removeSavedTrip} />

      {!loading && trips.length > 0 && (
        <>
          <CompareTrips trips={trips} />

          <div className="grid gap-4">
            {trips.map((trip) => (
              <TripCard
                key={trip.name}
                trip={trip}
                input={form}
                isSaved={savedTripNames.has(trip.name)}
                onSave={saveTrip}
                onRemoveSaved={removeSavedTrip}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}