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

function CostPill({ value }: { value?: number }) {
  if (value === undefined) return null;

  const label = value === 0 ? "Free" : `$${value}`;

  return (
    <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-medium leading-none text-slate-700">
      {label}
    </span>
  );
}

export default function ItineraryDay({ day, dayNumber }: Props) {
  const stops = day?.stops ?? [];

  return (
    <section className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-5">
      <div className="mb-4">
        <h3 className="text-xl font-semibold tracking-tight text-slate-950">
          Day {dayNumber ?? "?"}
          {day?.title ? ` — ${day.title}` : ""}
        </h3>

        {day?.summary ? (
          <p className="mt-1 text-sm leading-6 text-slate-600">{day.summary}</p>
        ) : null}
      </div>

      {stops.length > 0 ? (
        <div className="space-y-3">
          {stops.map((stop, index) => (
            <div
              key={`${stop.title ?? "stop"}-${index}`}
              className="rounded-2xl border border-slate-200 bg-white p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  {stop.time ? (
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                      {stop.time}
                    </div>
                  ) : null}

                  <h4 className="mt-1 text-base font-semibold text-slate-950">
                    {stop.title ?? "Untitled stop"}
                  </h4>
                </div>

                <CostPill value={stop.estimatedCost} />
              </div>

              {stop.description ? (
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {stop.description}
                </p>
              ) : null}

              {(stop.mapsUrl || stop.websiteUrl) ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {stop.mapsUrl ? (
                    <a
                      href={stop.mapsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-9 items-center justify-center rounded-xl bg-slate-950 px-3.5 text-sm font-medium text-white transition hover:bg-slate-800"
                    >
                      Open map
                    </a>
                  ) : null}

                  {stop.websiteUrl ? (
                    <a
                      href={stop.websiteUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-9 items-center justify-center rounded-xl border border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                    >
                      Visit site
                    </a>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-4 text-sm text-slate-600">
          No itinerary stops available yet.
        </div>
      )}
    </section>
  );
}