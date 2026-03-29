"use client";

/**
 * Reusable UI component for the saved trips section of the planner.
 * Keeping this logic in its own component makes the page-level containers easier to scan and keeps related rendering and state updates together.
 */


import { RankedDestination } from "../lib/types";
import TripCard from "./TripCard";

export default function SavedTrips({
  trips,
  onRemove,
}: {
  trips: RankedDestination[];
  onRemove: (tripName: string) => void;
}) {
  if (trips.length === 0) return null;

  return (
    <div className="space-y-4">
      <div className="grid gap-4">
        {trips.map((trip) => (
          <TripCard
            key={`saved-${trip.name}`}
            trip={trip}
            isSaved={true}
            onRemoveSaved={onRemove}
          />
        ))}
      </div>
    </div>
  );
}