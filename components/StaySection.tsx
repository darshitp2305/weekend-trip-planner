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

export default function StaySection({ stays }: Props) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="text-2xl font-semibold text-gray-900">Where to stay</h2>
      <p className="mt-1 text-sm text-gray-600">
        Lodging picks that give the trip a usable base, not just a destination name.
      </p>

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {stays.length > 0 ? (
          stays.map((stay, index) => {
            const price = stay.pricePerNight ?? stay.estimatedCost;
            const primaryLink = stay.bookingLink ?? stay.websiteUrl;

            return (
              <div
                key={stay.id ?? `${stay.name ?? "stay"}-${index}`}
                className="rounded-xl border border-gray-200 p-4"
              >
                <h3 className="text-lg font-semibold text-gray-900">
                  {stay.name ?? "Unnamed stay"}
                </h3>

                <p className="mt-2 text-sm text-gray-600">
                  {stay.shortDescription ?? fallbackStayDescription(stay)}
                </p>

                <div className="mt-3 space-y-1 text-sm text-gray-700">
                  {stay.rating !== undefined ? <div>Rating: {stay.rating}</div> : null}
                  {price !== undefined ? <div>Approx. nightly cost: ${price}</div> : null}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {primaryLink ? (
                    <a
                      href={primaryLink}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg bg-black px-3 py-2 text-sm text-white"
                    >
                      Check stay
                    </a>
                  ) : null}

                  {stay.mapsUrl ? (
                    <a
                      href={stay.mapsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800"
                    >
                      Open map
                    </a>
                  ) : null}
                </div>
              </div>
            );
          })
        ) : (
          <p className="text-sm text-gray-600">No stay options available yet.</p>
        )}
      </div>
    </section>
  );
}