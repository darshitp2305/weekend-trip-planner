"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getTripPlanById } from "../../../lib/tripStore";
import TripHeader from "../../../components/TripHeader";
import BudgetBreakdown from "../../../components/BudgetBreakdown";
import StaySection from "../../../components/StaySection";
import FoodSection from "../../../components/FoodSection";
import ActivitySection from "../../../components/ActivitySection";
import TripActions from "../../../components/TripActions";
import ItineraryDay from "../../../components/ItineraryDay";

export default function TripPage() {
  const params = useParams<{ tripId: string }>();
  const router = useRouter();
  const [trip, setTrip] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!params?.tripId) return;

    const found = getTripPlanById(params.tripId);
    setTrip(found);
    setLoading(false);
  }, [params?.tripId]);

  if (loading) {
    return (
      <main className="min-h-screen bg-black text-white px-6 py-10">
        <div className="mx-auto max-w-5xl">Loading trip...</div>
      </main>
    );
  }

  if (!trip) {
    return (
      <main className="min-h-screen bg-black text-white px-6 py-10">
        <div className="mx-auto max-w-3xl rounded border p-6 space-y-4">
          <h1 className="text-2xl font-bold">Trip not found</h1>
          <p className="text-sm text-gray-400">
            This trip is stored only in local browser storage right now, so it may not exist on this device or after local data was cleared.
          </p>
          <button
            onClick={() => router.push("/")}
            className="rounded border px-4 py-2"
          >
            Back to planner
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white px-6 py-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <TripHeader trip={trip} />
        <TripActions trip={trip} />
        <BudgetBreakdown breakdown={trip.budgetBreakdown} />
        <StaySection stays={trip.hotelOptions ?? []} />
        <FoodSection foodSpots={trip.foodSpots ?? []} />
        <ActivitySection activities={trip.topActivities ?? []} />

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">Itinerary</h2>
          {Array.isArray(trip.itineraryDays) && trip.itineraryDays.length > 0 ? (
            trip.itineraryDays.map((day: any, index: number) => (
              <ItineraryDay key={index} day={day} dayNumber={index + 1} />
            ))
          ) : (
            <p className="text-sm text-gray-400">No itinerary generated yet.</p>
          )}
        </section>
      </div>
    </main>
  );
}