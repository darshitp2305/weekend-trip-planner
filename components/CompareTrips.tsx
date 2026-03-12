import { RankedDestination } from "../lib/types";

function strengthLabel(strength: RankedDestination["styleMatchStrength"]) {
  switch (strength) {
    case "strong":
      return "Strong";
    case "medium":
      return "Good";
    case "weak":
      return "Light";
    default:
      return "Weak";
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

function dataSourceLabel(trip: RankedDestination) {
  if (trip.liveDataSummary?.usedPlacesData) return "Live Places";
  if (trip.liveDataSummary?.usedFallbackData) return "Fallback";
  return "Static ranking";
}

export default function CompareTrips({
  trips,
}: {
  trips: RankedDestination[];
}) {
  if (trips.length === 0) return null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-900">Compare top results</h2>
        <p className="mt-1 text-sm text-slate-600">
          This makes the tradeoffs visible instead of forcing users to guess why a result ranked higher.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-3 pr-4 font-medium">Destination</th>
              <th className="py-3 pr-4 font-medium">Drive</th>
              <th className="py-3 pr-4 font-medium">Cost</th>
              <th className="py-3 pr-4 font-medium">Style fit</th>
              <th className="py-3 pr-4 font-medium">Confidence</th>
              <th className="py-3 pr-4 font-medium">Data</th>
              <th className="py-3 pr-4 font-medium">Why it ranked</th>
              <th className="py-3 font-medium">Score</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100">
            {trips.map((trip) => (
              <tr key={trip.name} className="align-top">
                <td className="py-4 pr-4">
                  <div className="font-medium text-slate-900">{trip.name}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {trip.isStaycation ? "Staycation option" : trip.province}
                  </div>
                </td>

                <td className="py-4 pr-4 text-slate-700">{trip.driveHoursFromStart}h</td>

                <td className="py-4 pr-4 text-slate-700">
                  $
                  {Math.round(
                    trip.budgetBreakdown?.totalExpected ??
                      trip.budgetBreakdown?.total ??
                      trip.estimatedCost
                  )}
                </td>

                <td className="py-4 pr-4 text-slate-700">
                  {strengthLabel(trip.styleMatchStrength)}
                </td>

                <td className="py-4 pr-4 text-slate-700">
                  {confidenceLabel(trip.confidence)}
                </td>

                <td className="py-4 pr-4 text-slate-700">{dataSourceLabel(trip)}</td>

                <td className="py-4 pr-4 text-slate-700">
                  {trip.rankingReasons?.[0]?.label ??
                    trip.matchReasons?.[0] ??
                    "No summary available"}
                </td>

                <td className="py-4 text-slate-900">{trip.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}