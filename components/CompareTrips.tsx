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
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-xl font-semibold text-slate-900">
        Compare top results
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        This makes the tradeoffs visible instead of forcing users to guess why a
        result ranked higher.
      </p>

      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-slate-600">
              <th className="px-3 py-2 font-medium">Destination</th>
              <th className="px-3 py-2 font-medium">Drive</th>
              <th className="px-3 py-2 font-medium">Cost</th>
              <th className="px-3 py-2 font-medium">Style fit</th>
              <th className="px-3 py-2 font-medium">Confidence</th>
              <th className="px-3 py-2 font-medium">Data</th>
              <th className="px-3 py-2 font-medium">Why it ranked</th>
              <th className="px-3 py-2 font-medium">Score</th>
            </tr>
          </thead>
          <tbody>
            {trips.map((trip) => (
              <tr key={trip.name} className="border-b border-slate-100 align-top">
                <td className="px-3 py-3">
                  <div className="font-semibold text-slate-900">{trip.name}</div>
                  <div className="text-xs text-slate-500">
                    {trip.isStaycation ? "Staycation option" : trip.province}
                  </div>
                </td>
                <td className="px-3 py-3 text-slate-700">
                  {trip.driveHoursFromStart}h
                </td>
                <td className="px-3 py-3 text-slate-700">
                  ${Math.round(trip.estimatedCost)}
                </td>
                <td className="px-3 py-3 text-slate-700">
                  {strengthLabel(trip.styleMatchStrength)}
                </td>
                <td className="px-3 py-3">
                  <span className="rounded-full border border-slate-200 px-2 py-1 text-xs text-slate-700">
                    {confidenceLabel(trip.confidence)}
                  </span>
                </td>
                <td className="px-3 py-3">
                  <span className="rounded-full border border-slate-200 px-2 py-1 text-xs text-slate-700">
                    {dataSourceLabel(trip)}
                  </span>
                </td>
                <td className="px-3 py-3 text-slate-700">
                  {trip.rankingReasons?.[0]?.label ??
                    trip.matchReasons?.[0] ??
                    "No summary available"}
                </td>
                <td className="px-3 py-3 font-semibold text-slate-900">
                  {trip.score}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}