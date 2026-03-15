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
    let cancelled = false;

    async function loadTrip() {
      if (!params?.tripId) return;

      setLoading(true);
      const found = await getTripPlanById(params.tripId);

      if (!cancelled) {
        setTrip(found);
        setLoading(false);
      }
    }

    loadTrip();

    return () => {
      cancelled = true;
    };
  }, [params?.tripId]);

  if (loading) {
    return (
      <main className="min-h-screen bg-[#f8fafc] px-6 py-10 text-slate-900">
        <div className="mx-auto max-w-7xl rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm">
          Loading trip...
        </div>
      </main>
    );
  }

  if (!trip) {
    return (
      <main className="min-h-screen bg-[#f8fafc] px-6 py-10 text-slate-900">
        <div className="mx-auto max-w-3xl rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-950">Trip not found</h1>
          <p className="mt-3 text-slate-600">
            This trip could not be found locally or in the shared trip database.
          </p>
          <button
            onClick={() => router.push("/")}
            className="mt-6 rounded-2xl bg-slate-950 px-5 py-3 text-white transition hover:bg-slate-800"
          >
            Back to planner
          </button>
        </div>
      </main>
    );
  }

  const itineraryDays = Array.isArray(trip.itineraryDays) ? trip.itineraryDays : [];

  return (
    <main className="min-h-screen bg-[#f8fafc] px-6 py-8 text-slate-900">
      <div className="mx-auto max-w-7xl space-y-6">
        <TripHeader trip={trip} />

        <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
          <div className="space-y-6">
            <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
              <BudgetBreakdown breakdown={trip.budgetBreakdown} />
            </div>

            <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
              <TripActions trip={trip} />
            </div>
          </div>

          <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
            <StaySection stays={trip.hotelOptions ?? []} />
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
            <FoodSection foodSpots={trip.foodSpots ?? []} />
          </div>

          <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
            <ActivitySection activities={trip.topActivities ?? []} />
          </div>
        </div>

        <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-2xl font-semibold text-slate-950">Itinerary</h2>

          {itineraryDays.length > 0 ? (
            <div className="mt-5 space-y-4">
              {itineraryDays.map((day: any, index: number) => (
                <ItineraryDay key={index} day={day} dayNumber={index + 1} />
              ))}
            </div>
          ) : (
            <p className="mt-4 text-slate-600">No itinerary generated yet.</p>
          )}
        </section>
      </div>
    </main>
  );
}