type Stop = {
  time?: string;
  title?: string;
  description?: string;
  mapsUrl?: string;
  websiteUrl?: string;
  estimatedCost?: number;
};

type DayData = {
  title?: string;
  summary?: string;
  stops?: Stop[];
};

type Props = {
  day?: DayData;
  dayNumber?: number;
};

export default function ItineraryDay({ day, dayNumber }: Props) {
  const stops = day?.stops ?? [];

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-4">
        <h3 className="text-xl font-semibold text-gray-900">
          Day {dayNumber ?? "?"}
          {day?.title ? ` — ${day.title}` : ""}
        </h3>
        {day?.summary ? (
          <p className="mt-1 text-sm text-gray-600">{day.summary}</p>
        ) : null}
      </div>

      {stops.length > 0 ? (
        <div className="space-y-3">
          {stops.map((stop, index) => (
            <div
              key={`${stop.title ?? "stop"}-${index}`}
              className="rounded-xl border border-gray-200 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  {stop.time ? (
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {stop.time}
                    </div>
                  ) : null}
                  <h4 className="mt-1 text-lg font-semibold text-gray-900">
                    {stop.title ?? "Untitled stop"}
                  </h4>
                </div>

                {stop.estimatedCost !== undefined ? (
                  <div className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                    {stop.estimatedCost === 0 ? "Free" : `$${stop.estimatedCost}`}
                  </div>
                ) : null}
              </div>

              {stop.description ? (
                <p className="mt-3 text-sm text-gray-700">{stop.description}</p>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-2">
                {stop.mapsUrl ? (
                  <a
                    href={stop.mapsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg bg-black px-3 py-2 text-sm text-white"
                  >
                    Open map
                  </a>
                ) : null}

                {stop.websiteUrl ? (
                  <a
                    href={stop.websiteUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800"
                  >
                    Visit site
                  </a>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-600">No itinerary stops available yet.</p>
      )}
    </section>
  );
}