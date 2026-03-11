type Props = {
  trip: {
    destinationName?: string;
    region?: string;
    summary?: string;
    driveTimeText?: string;
    imageUrl?: string;
    score?: number;
    styleMatchStrength?: string;
    tags?: string[];
    dataSource?: "live-google-places" | "static-fallback";
  };
};

function sourceLabel(source?: "live-google-places" | "static-fallback") {
  if (source === "live-google-places") return "Live Google Places data";
  return "Static fallback data";
}

function sourceBadgeClasses(source?: "live-google-places" | "static-fallback") {
  if (source === "live-google-places") {
    return "rounded-xl bg-green-100 px-4 py-2 text-sm text-green-800";
  }
  return "rounded-xl bg-yellow-100 px-4 py-2 text-sm text-yellow-800";
}

export default function TripHeader({ trip }: Props) {
  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      {trip.imageUrl ? (
        <img
          src={trip.imageUrl}
          alt={trip.destinationName ?? "Trip image"}
          className="h-64 w-full object-cover"
        />
      ) : null}

      <div className="p-6">
        {trip.region ? (
          <p className="text-sm font-medium uppercase tracking-wide text-gray-500">
            {trip.region}
          </p>
        ) : null}

        <h1 className="mt-1 text-3xl font-bold text-gray-900">
          {trip.destinationName ?? "Weekend Trip"}
        </h1>

        {trip.summary ? (
          <p className="mt-3 max-w-3xl text-gray-700">{trip.summary}</p>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-3">
          {trip.driveTimeText ? (
            <div className="rounded-xl bg-gray-100 px-4 py-2 text-sm text-gray-700">
              <span className="font-medium text-gray-900">Drive time:</span>{" "}
              {trip.driveTimeText}
            </div>
          ) : null}

          {trip.styleMatchStrength ? (
            <div className="rounded-xl bg-gray-100 px-4 py-2 text-sm text-gray-700">
              <span className="font-medium text-gray-900">Style fit:</span>{" "}
              {trip.styleMatchStrength}
            </div>
          ) : null}

          {trip.score !== undefined ? (
            <div className="rounded-xl bg-gray-100 px-4 py-2 text-sm text-gray-700">
              <span className="font-medium text-gray-900">Score:</span> {trip.score}
            </div>
          ) : null}

          {trip.dataSource ? (
            <div className={sourceBadgeClasses(trip.dataSource)}>
              {sourceLabel(trip.dataSource)}
            </div>
          ) : null}
        </div>

        {trip.tags && trip.tags.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {trip.tags.slice(0, 5).map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-gray-300 px-3 py-1 text-xs text-gray-700"
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}