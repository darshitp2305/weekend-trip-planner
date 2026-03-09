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

export default function CompareTrips({ trips }: { trips: RankedDestination[] }) {
  if (trips.length === 0) return null;

  return (
    <div className="border rounded p-4 space-y-3">
      <h2 className="text-xl font-semibold">Compare top results</h2>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2 pr-4">Destination</th>
              <th className="text-left py-2 pr-4">Drive</th>
              <th className="text-left py-2 pr-4">Cost</th>
              <th className="text-left py-2 pr-4">Style fit</th>
              <th className="text-left py-2 pr-4">Score</th>
            </tr>
          </thead>
          <tbody>
            {trips.map((trip) => (
              <tr key={trip.name} className="border-b last:border-b-0">
                <td className="py-2 pr-4">{trip.name}</td>
                <td className="py-2 pr-4">{trip.driveHoursFromStart}h</td>
                <td className="py-2 pr-4">${trip.estimatedCost}</td>
                <td className="py-2 pr-4">{strengthLabel(trip.styleMatchStrength)}</td>
                <td className="py-2 pr-4">{trip.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}