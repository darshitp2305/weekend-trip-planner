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
    routeSummary?: {
      distanceMeters?: number;
      durationSeconds?: number;
      origin?: {
        label?: string;
      };
      destination?: {
        label?: string;
      };
    };
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

function formatDriveHours(hours?: number) {
  if (hours === undefined || !Number.isFinite(hours)) return "—";
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  return `${Math.round(hours * 10) / 10} hours`;
}

function formatDurationFromSeconds(seconds?: number) {
  if (seconds === undefined || !Number.isFinite(seconds)) return undefined;

  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} hr`;
  return `${hours} hr ${minutes} min`;
}

function formatDistanceFromMeters(meters?: number) {
  if (meters === undefined || !Number.isFinite(meters)) return "—";
  const km = meters / 1000;
  return `${Math.round(km)} km`;
}

export default function TripHeader({ trip }: TripHeaderProps) {
  const title = trip.title ?? trip.name ?? trip.destination ?? "Saved trip";
  const vibes = Array.isArray(trip.rawVibes) ? trip.rawVibes.slice(0, 5) : [];

  const fallbackDriveHours =
    trip.driveHours !== undefined
      ? trip.driveHours
      : trip.driveHoursFromStart !== undefined
        ? trip.driveHoursFromStart
        : undefined;

  const routedDuration = formatDurationFromSeconds(
    trip.routeSummary?.durationSeconds
  );

  const driveTimeValue =
    routedDuration ?? formatDriveHours(fallbackDriveHours);

  const distanceValue = formatDistanceFromMeters(
    trip.routeSummary?.distanceMeters
  );

  const originLabel = trip.routeSummary?.origin?.label;
  const destinationLabel = trip.routeSummary?.destination?.label;

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
          {trip.routeSummary ? <Badge>OpenStreetMap route</Badge> : null}
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

          {originLabel && destinationLabel ? (
            <p className="mt-3 text-sm text-slate-500">
              Route: {originLabel} → {destinationLabel}
            </p>
          ) : null}
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:max-w-4xl">
          <Stat label="Drive time" value={driveTimeValue} />
          <Stat label="Distance" value={distanceValue} />
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