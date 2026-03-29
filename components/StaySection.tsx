/**
 * Reusable UI component for the stay section section of the planner.
 * Keeping this logic in its own component makes the page-level containers easier to scan and keeps related rendering and state updates together.
 */

import { formatDateRange } from "../lib/tripDates";
import {
  hotelAvailabilityLabel,
  hotelAvailabilityTone,
} from "../lib/hotelAvailability";
import { sanitizeExternalNavigationUrl } from "../lib/urlSafety";

type Stay = {
  id?: string;
  name?: string;
  rating?: number;
  estimatedCost?: number;
  shortDescription?: string;
  mapsUrl?: string;
  websiteUrl?: string;
  bookingLink?: string;
  pricePerNight?: number;
  totalStayPrice?: number;
  pricingSource?: string;
  availabilityStatus?: "available" | "sold_out" | "unverified";
  availabilitySource?: string;
};

type Props = {
  stays: Stay[];
  tripStartDate?: string;
  tripEndDate?: string;
};

function fallbackStayDescription(
  stay: Stay,
  dateRange?: string
) {
  if (stay.availabilityStatus === "sold_out") {
    return dateRange
      ? `This property appears sold out for ${dateRange}. Use the search link for alternatives nearby.`
      : "This property appears sold out right now.";
  }
  if (stay.availabilityStatus === "unverified" && dateRange) {
    return `Useful base option for ${dateRange}, but live availability could not be confirmed from the current hotel source.`;
  }
  if (stay.pricePerNight !== undefined) {
    const totalText =
      stay.totalStayPrice !== undefined ? `, about $${stay.totalStayPrice} total` : "";
    return `Practical base option at about $${stay.pricePerNight} per night${totalText}.`;
  }
  if (dateRange) {
    return `Useful base option for ${dateRange}. Live room pricing is not available from the current hotel source.`;
  }
  return "Solid base option for this trip.";
}

function InfoPill({
  children,
  tone = "slate",
}: {
  children: React.ReactNode;
  tone?: "slate" | "green" | "amber" | "rose";
}) {
  const className =
    tone === "green"
      ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "rose"
        ? "border border-rose-200 bg-rose-50 text-rose-700"
      : tone === "amber"
        ? "border border-amber-200 bg-amber-50 text-amber-700"
        : "border border-slate-200 bg-slate-100 text-slate-700";

  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium leading-none ${className}`}
    >
      {children}
    </span>
  );
}

export default function StaySection({
  stays,
  tripStartDate,
  tripEndDate,
}: Props) {
  const dateRange = formatDateRange(tripStartDate, tripEndDate);

  return (
    <section>
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold tracking-tight text-slate-950">
          Where to stay
        </h2>
        <p className="text-sm leading-6 text-slate-600">
          Lodging picks that give the trip a usable base, not just a destination name.
        </p>
        {dateRange ? (
          <p className="text-sm leading-6 text-slate-500">
            Travel dates: {dateRange}
          </p>
        ) : null}
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {stays.length > 0 ? (
          stays.map((stay, index) => {
            const primaryLink = sanitizeExternalNavigationUrl(
              stay.bookingLink ?? stay.websiteUrl
            );
            const mapsLink = sanitizeExternalNavigationUrl(stay.mapsUrl);
            const hasNightlyPrice = stay.pricePerNight !== undefined;
            const hasDates = Boolean(dateRange);
            const availabilityLabel = hotelAvailabilityLabel(stay, hasDates);
            const availabilityTone = hotelAvailabilityTone(stay.availabilityStatus);
            const primaryActionLabel =
              stay.availabilityStatus === "sold_out"
                ? "Search alternatives"
                : stay.availabilityStatus === "available" && hasDates
                  ? "Check live rate"
                  : hasDates
                    ? "Search stay"
                    : "Check stay";

            return (
              <article
                key={stay.id ?? `${stay.name ?? "stay"}-${index}`}
                className="flex h-full flex-col rounded-2xl border border-slate-200 bg-slate-50 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="pr-3 text-lg font-semibold leading-8 text-slate-950">
                    {stay.name ?? "Unnamed stay"}
                  </h3>

                  {stay.rating !== undefined ? (
                    <InfoPill tone="green">★ {stay.rating}</InfoPill>
                  ) : null}
                </div>

                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {stay.shortDescription ?? fallbackStayDescription(stay, dateRange)}
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                  <InfoPill tone={availabilityTone}>{availabilityLabel}</InfoPill>
                  {hasNightlyPrice ? (
                    <>
                      <InfoPill>Nightly est. ${stay.pricePerNight}</InfoPill>
                      {stay.totalStayPrice !== undefined ? (
                        <InfoPill>Total est. ${stay.totalStayPrice}</InfoPill>
                      ) : null}
                      {stay.pricingSource ? (
                        <InfoPill tone="green">{stay.pricingSource}</InfoPill>
                      ) : null}
                    </>
                  ) : (
                    <InfoPill tone="amber">
                      {dateRange ? "Live price unavailable" : "Price unavailable"}
                    </InfoPill>
                  )}
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  {primaryLink ? (
                    <a
                      href={primaryLink}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-10 items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-medium text-white transition hover:bg-slate-800"
                    >
                      {primaryActionLabel}
                    </a>
                  ) : null}

                  {mapsLink ? (
                    <a
                      href={mapsLink}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                    >
                      Open map
                    </a>
                  ) : null}
                </div>
              </article>
            );
          })
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-600">
            No stay options available yet.
          </div>
        )}
      </div>
    </section>
  );
}
