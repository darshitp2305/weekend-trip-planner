type FoodSpot = {
  id?: string;
  name?: string;
  category?: string;
  rating?: number;
  estimatedCost?: number;
  shortDescription?: string;
  mapsUrl?: string;
  websiteUrl?: string;
  link?: string;
  tags?: string[];
};

type Props = {
  foodSpots: FoodSpot[];
};

function fallbackFoodDescription(spot: FoodSpot) {
  if (spot.tags && spot.tags.length > 0) {
    return `Good fit for ${spot.tags.slice(0, 3).join(", ")}.`;
  }
  return "Useful food stop that helps the trip feel more real.";
}

export default function FoodSection({ foodSpots }: Props) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="text-2xl font-semibold text-gray-900">Food and cafés</h2>
      <p className="mt-1 text-sm text-gray-600">
        Places that give the trip some actual personality instead of generic filler.
      </p>

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {foodSpots.length > 0 ? (
          foodSpots.map((spot, index) => {
            const primaryLink = spot.link ?? spot.websiteUrl;

            return (
              <div
                key={spot.id ?? `${spot.name ?? "food"}-${index}`}
                className="rounded-xl border border-gray-200 p-4"
              >
                <h3 className="text-lg font-semibold text-gray-900">
                  {spot.name ?? "Unnamed food spot"}
                </h3>

                <p className="mt-2 text-sm text-gray-600">
                  {spot.shortDescription ?? fallbackFoodDescription(spot)}
                </p>

                <div className="mt-3 space-y-1 text-sm text-gray-700">
                  {spot.category ? <div>Type: {spot.category}</div> : null}
                  {spot.rating !== undefined ? <div>Rating: {spot.rating}</div> : null}
                  {spot.estimatedCost !== undefined ? (
                    <div>Approx. cost: ${spot.estimatedCost}</div>
                  ) : null}
                </div>

                {spot.tags && spot.tags.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {spot.tags.slice(0, 4).map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-700"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}

                <div className="mt-4 flex flex-wrap gap-2">
                  {primaryLink ? (
                    <a
                      href={primaryLink}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg bg-black px-3 py-2 text-sm text-white"
                    >
                      Check spot
                    </a>
                  ) : null}

                  {spot.mapsUrl ? (
                    <a
                      href={spot.mapsUrl}
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
          <p className="text-sm text-gray-600">No food spots available yet.</p>
        )}
      </div>
    </section>
  );
}