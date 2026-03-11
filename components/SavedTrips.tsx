"use client";

import TripCard from "./TripCard";
import type { RankedDestination } from "@/lib/types";

type Props = {
  trips: RankedDestination[];
  onRemove: (tripName: string) => void;
};

export default function SavedTrips({ trips, onRemove }: Props) {
  if (!trips.length) {
    return (
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-semibold text-slate-900">Saved trips</h2>
        <p className="mt-2 text-slate-600">You have not saved any trips yet.</p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-semibold text-slate-900">Saved trips</h2>
        <p className="mt-2 text-slate-600">These are stored locally in this browser.</p>
      </div>

      <div className="space-y-6">
        {trips.map((trip) => (
          <TripCard
            key={trip.name}
            trip={trip}
            isSaved={true}
            onRemove={onRemove}
          />
        ))}
      </div>
    </section>
  );
}