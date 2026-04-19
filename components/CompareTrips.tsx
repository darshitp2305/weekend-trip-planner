/**
 * Reusable UI component for the compare trips section of the planner.
 * Keeping this logic in its own component makes the page-level containers easier to scan and keeps related rendering and state updates together.
 */

import { RankedDestination } from "../lib/types";
import { driveTimeSourceLabel, tripConfidenceLabel } from "../lib/trustSignals";

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
  return confidence ? tripConfidenceLabel(confidence) : "Unrated";
}

function dataSourceLabel(trip: RankedDestination) {
  if (trip.liveDataSummary?.usedPlacesData) return "Live Places";
  if (trip.liveDataSummary?.usedFallbackData) return "Fallback";
  return "Static";
}

function costValue(trip: RankedDestination) {
  return Math.round(
    trip.budgetBreakdown?.totalExpected ??
      trip.budgetBreakdown?.total ??
      trip.estimatedCost
  );
}

function Pill({
  children,
  tone = "slate",
}: {
  children: React.ReactNode;
  tone?: "slate" | "green" | "violet";
}) {
  const className =
    tone === "green"
      ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "violet"
        ? "border border-[#b2f6df] bg-[#effff8] text-[#048f69]"
        : "border border-slate-200 bg-slate-100 text-slate-700";

  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium leading-none ${className}`}
    >
      {children}
    </span>
  );
}

function StatBlock({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-slate-950">{value}</div>
      {detail ? (
        <div className="mt-1 text-xs text-slate-500">{detail}</div>
      ) : null}
    </div>
  );
}

export default function CompareTrips({
  trips,
}: {
  trips: RankedDestination[];
}) {
  if (trips.length === 0) return null;

  return (
    <section>
      <div className="mb-5">
        <h2 className="text-xl font-semibold tracking-tight text-slate-950">
          Compare top results
        </h2>
        <p className="mt-1 text-sm leading-6 text-slate-600">
          See the tradeoffs quickly before opening a full trip card.
        </p>
      </div>

      <div className="space-y-4">
        {trips.map((trip, index) => {
          const whyRanked =
            trip.rankingReasons?.[0]?.label ??
            trip.matchReasons?.[0] ??
            "No summary available";

          return (
            <article
              key={trip.name}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone={index === 0 ? "violet" : "slate"}>
                      #{index + 1}
                    </Pill>
                    <Pill>
                      {trip.isStaycation ? "Staycation" : trip.province}
                    </Pill>
                    <Pill tone="green">{confidenceLabel(trip.confidence)}</Pill>
                    <Pill>{dataSourceLabel(trip)}</Pill>
                  </div>

                  <div className="mt-3">
                    <h3 className="text-xl font-semibold tracking-tight text-slate-950">
                      {trip.name}
                    </h3>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                      {whyRanked}
                    </p>
                  </div>
                </div>

              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <StatBlock
                  label="Drive"
                  value={`${trip.driveHoursFromStart}h`}
                  detail={driveTimeSourceLabel(trip)}
                />
                <StatBlock
                  label="Expected cost"
                  value={`$${costValue(trip)}`}
                />
                <StatBlock
                  label="Style fit"
                  value={strengthLabel(trip.styleMatchStrength)}
                />
                <StatBlock
                  label="Confidence"
                  value={confidenceLabel(trip.confidence)}
                />
                <StatBlock
                  label="Data"
                  value={dataSourceLabel(trip)}
                />
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
