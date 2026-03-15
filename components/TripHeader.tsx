type TripHeaderProps = {
  trip: {
    title?: string;
    name?: string;
    destination?: string;
    province?: string;
    imageUrl?: string;
    summary?: string;
    driveHours?: number;
    driveHoursFromStart?: number;
    styleMatchStrength?: string;
    score?: number;
    source?: string;
    rawVibes?: string[];
    confidence?: string;
    liveDataSummary?: {
      usedPlacesData?: boolean;
      usedFallbackData?: boolean;
    };
  };
};

function Badge({
  children,
  tone = "slate",
}: {
  children: React.ReactNode;
  tone?: "slate" | "green" | "violet";
}) {
  const toneClass =
    tone === "green"
      ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "violet"
        ? "border border-violet-200 bg-violet-50 text-violet-700"
        : "border border-slate-200 bg-slate-100 text-slate-700";

  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium leading-none ${toneClass}`}
    >
      {children}
    </span>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl bg-slate-50 px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-slate-950">{value}</div>
    </div>
  );
}

function confidenceLabel(confidence?: string) {
  switch (confidence) {
    case "high":
      return "Strong match";
    case "medium":
      return "Good match";
    case "low":
      return "Experimental";
    default:
      return "Trip plan";
  }
}

function sourceLabel(trip: TripHeaderProps["trip"]) {
  if (trip.source === "live-google-places") return "Live Google Places";
  if (trip.source === "static-fallback") return "Fallback data";
  if (trip.source === "static-ranking") return "Static ranking";
  if (trip.liveDataSummary?.usedPlacesData) return "Live Google Places";
  if (trip.liveDataSummary?.usedFallbackData) return "Fallback data";
  return "Saved trip";
}

export default function TripHeader({ trip }: TripHeaderProps) {
  const title = trip.title ?? trip.name ?? trip.destination ?? "Saved trip";
  const vibes = Array.isArray(trip.rawVibes) ? trip.rawVibes.slice(0, 5) : [];
  const driveValue =
    trip.driveHours !== undefined
      ? trip.driveHours
      : trip.driveHoursFromStart !== undefined
        ? trip.driveHoursFromStart
        : undefined;

  return (
    <section className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-sm">
      {trip.imageUrl ? (
        <div className="aspect-[16/5] w-full overflow-hidden bg-slate-100">
          <img
            src={trip.imageUrl}
            alt={title}
            className="h-full w-full object-cover"
          />
        </div>
      ) : null}

      <div className="p-6 sm:p-7">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{trip.province ?? "Alberta"}</Badge>
          <Badge tone="violet">{confidenceLabel(trip.confidence)}</Badge>
          <Badge tone="green">{sourceLabel(trip)}</Badge>
        </div>

        <div className="mt-4">
          <h1 className="text-4xl font-semibold tracking-tight text-slate-950">
            {title}
          </h1>

          {trip.summary ? (
            <p className="mt-3 max-w-4xl text-base leading-7 text-slate-600">
              {trip.summary}
            </p>
          ) : null}
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3 lg:max-w-2xl">
          <Stat
            label="Drive time"
            value={driveValue !== undefined ? `${driveValue} hours` : "—"}
          />
          <Stat
            label="Style fit"
            value={trip.styleMatchStrength ?? "—"}
          />
          <Stat
            label="Score"
            value={trip.score !== undefined ? String(trip.score) : "—"}
          />
        </div>

        {vibes.length > 0 ? (
          <div className="mt-5 flex flex-wrap gap-2">
            {vibes.map((tag) => (
              <span
                key={tag}
                className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600"
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