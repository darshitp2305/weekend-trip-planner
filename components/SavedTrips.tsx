"use client";

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