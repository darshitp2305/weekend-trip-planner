import Image from "next/image";
import { formatDisplayTag, formatDisplayText } from "../lib/displayText";

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
      ? "border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200"
      : tone === "violet"
        ? "border border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-200"
        : "border border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200";

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
    <div className="rounded-[1.1rem] border border-slate-200 bg-slate-50 px-3.5 py-3 dark:border-slate-700 dark:bg-slate-800/80">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className="mt-1 text-[15px] font-semibold text-slate-950 dark:text-slate-100">{value}</div>
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
  if (hours === undefined || !Number.isFinite(hours)) return "-";
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
  if (meters === undefined || !Number.isFinite(meters)) return "-";
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

  const driveTimeValue = routedDuration ?? formatDriveHours(fallbackDriveHours);

  const distanceValue = formatDistanceFromMeters(
    trip.routeSummary?.distanceMeters
  );

  const originLabel = trip.routeSummary?.origin?.label;
  const destinationLabel = trip.routeSummary?.destination?.label;

  return (
    <section className="overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      {trip.imageUrl ? (
        <div className="aspect-[16/4.5] w-full overflow-hidden bg-slate-100 dark:bg-slate-800">
          <Image
            src={trip.imageUrl}
            alt={title}
            width={1600}
            height={450}
            unoptimized
            className="h-full w-full object-cover"
          />
        </div>
      ) : null}

      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{trip.province ?? "Alberta"}</Badge>
          <Badge tone="violet">{confidenceLabel(trip.confidence)}</Badge>
          <Badge tone="green">{sourceLabel(trip)}</Badge>
          {trip.routeSummary ? <Badge>OpenStreetMap route</Badge> : null}
        </div>

        <div className="mt-3.5">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950 dark:text-slate-100 sm:text-[2.15rem]">
            {title}
          </h1>

          {trip.summary ? (
            <p className="mt-2.5 max-w-4xl text-[15px] leading-7 text-slate-600 dark:text-slate-300">
              {formatDisplayText(trip.summary)}
            </p>
          ) : null}

          {originLabel && destinationLabel ? (
            <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
              Route: {originLabel} -&gt; {destinationLabel}
            </p>
          ) : null}
        </div>

        <div className="mt-5 grid gap-2.5 sm:grid-cols-2 lg:max-w-4xl lg:grid-cols-4">
          <Stat label="Drive time" value={driveTimeValue} />
          <Stat label="Distance" value={distanceValue} />
          <Stat label="Style fit" value={trip.styleMatchStrength ?? "-"} />
          <Stat
            label="Score"
            value={trip.score !== undefined ? String(trip.score) : "-"}
          />
        </div>

        {vibes.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {vibes.map((tag) => (
              <span
                key={tag}
                className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              >
                {formatDisplayTag(tag)}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
