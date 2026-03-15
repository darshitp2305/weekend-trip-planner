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
};

type Props = {
  stays: Stay[];
};

function fallbackStayDescription(stay: Stay) {
  const price = stay.pricePerNight ?? stay.estimatedCost;
  if (price !== undefined) {
    return `Practical base option at about $${price} per night.`;
  }
  return "Solid base option for this trip.";
}

function InfoPill({
  children,
  tone = "slate",
}: {
  children: React.ReactNode;
  tone?: "slate" | "green";
}) {
  const className =
    tone === "green"
      ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
      : "border border-slate-200 bg-slate-100 text-slate-700";

  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium leading-none ${className}`}
    >
      {children}
    </span>
  );
}

export default function StaySection({ stays }: Props) {
  return (
    <section>
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold tracking-tight text-slate-950">
          Where to stay
        </h2>
        <p className="text-sm leading-6 text-slate-600">
          Lodging picks that give the trip a usable base, not just a destination name.
        </p>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {stays.length > 0 ? (
          stays.map((stay, index) => {
            const price = stay.pricePerNight ?? stay.estimatedCost;
            const primaryLink = stay.bookingLink ?? stay.websiteUrl;

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
                  {stay.shortDescription ?? fallbackStayDescription(stay)}
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                  {price !== undefined ? (
                    <InfoPill>Nightly est. ${price}</InfoPill>
                  ) : null}
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  {primaryLink ? (
                    <a
                      href={primaryLink}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-10 items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-medium text-white transition hover:bg-slate-800"
                    >
                      Check stay
                    </a>
                  ) : null}

                  {stay.mapsUrl ? (
                    <a
                      href={stay.mapsUrl}
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