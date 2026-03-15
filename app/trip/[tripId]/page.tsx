"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getTripPlanById } from "../../../lib/tripStore";
import TripHeader from "../../../components/TripHeader";
import BudgetBreakdown from "../../../components/BudgetBreakdown";
import StaySection from "../../../components/StaySection";
import FoodSection from "../../../components/FoodSection";
import ActivitySection from "../../../components/ActivitySection";
import TripActions from "../../../components/TripActions";
import ItineraryDay from "../../../components/ItineraryDay";

function formatMoney(value: number) {
  return `$${Math.round(value)}`;
}

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

  const itineraryDays = Array.isArray(trip?.itineraryDays) ? trip.itineraryDays : [];

  const travelerCount = useMemo(() => {
    const value = Number(trip?.travelerCount ?? 1);
    return Number.isFinite(value) && value > 0 ? value : 1;
  }, [trip]);

  const targetTotalBudget = useMemo(() => {
    const fromSavedField = Number(trip?.totalBudget);
    if (Number.isFinite(fromSavedField) && fromSavedField > 0) {
      return fromSavedField;
    }
    return 0;
  }, [trip]);

  const budgetPerTraveler = useMemo(() => {
    const saved = Number(trip?.budgetPerTraveler);
    if (Number.isFinite(saved) && saved > 0) {
      return saved;
    }

    if (targetTotalBudget > 0 && travelerCount > 0) {
      return Math.round(targetTotalBudget / travelerCount);
    }

    return 0;
  }, [trip, targetTotalBudget, travelerCount]);

  const estimatedTotalCost = useMemo(() => {
    const fromBreakdown = Number(
      trip?.budgetBreakdown?.totalExpected ?? trip?.budgetBreakdown?.total
    );
    if (Number.isFinite(fromBreakdown) && fromBreakdown > 0) {
      return fromBreakdown;
    }
    return 0;
  }, [trip]);

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

  return (
    <main className="min-h-screen bg-[#f8fafc] px-6 py-8 text-slate-900">
      <div className="mx-auto max-w-7xl space-y-6">
        <TripHeader trip={trip} />

        <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
          <div className="space-y-6">
            <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-5">
                <h2 className="text-2xl font-semibold text-slate-950">Budget</h2>
                <p className="mt-2 text-sm text-slate-600">
                  Compare your target budget against the estimated trip cost.
                </p>
              </div>

              <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                    Travelers
                  </div>
                  <div className="mt-2 text-xl font-semibold text-slate-900">
                    {travelerCount}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                    Budget per traveler
                  </div>
                  <div className="mt-2 text-xl font-semibold text-slate-900">
                    {formatMoney(budgetPerTraveler)}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                    Target total budget
                  </div>
                  <div className="mt-2 text-xl font-semibold text-slate-900">
                    {formatMoney(targetTotalBudget)}
                  </div>
                </div>

                <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
                  <div className="text-xs font-medium uppercase tracking-[0.16em] text-violet-700">
                    Estimated total cost
                  </div>
                  <div className="mt-2 text-xl font-semibold text-slate-950">
                    {formatMoney(estimatedTotalCost)}
                  </div>
                </div>
              </div>

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