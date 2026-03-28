import { sanitizeExternalNavigationUrl } from "../lib/urlSafety";

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

function Pill({
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

export default function FoodSection({ foodSpots }: Props) {
  return (
    <section>
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold tracking-tight text-slate-950">
          Food and cafés
        </h2>
        <p className="text-sm leading-6 text-slate-600">
          Places that give the trip some actual personality instead of generic filler.
        </p>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {foodSpots.length > 0 ? (
          foodSpots.map((spot, index) => {
            const primaryLink = sanitizeExternalNavigationUrl(
              spot.link ?? spot.websiteUrl
            );
            const mapsLink = sanitizeExternalNavigationUrl(spot.mapsUrl);

            return (
              <article
                key={spot.id ?? `${spot.name ?? "food"}-${index}`}
                className="flex h-full flex-col rounded-2xl border border-slate-200 bg-slate-50 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="pr-3 text-lg font-semibold leading-8 text-slate-950">
                    {spot.name ?? "Unnamed food spot"}
                  </h3>

                  {spot.rating !== undefined ? (
                    <Pill tone="green">★ {spot.rating}</Pill>
                  ) : null}
                </div>

                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {spot.shortDescription ?? fallbackFoodDescription(spot)}
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                  {spot.category ? <Pill>{spot.category}</Pill> : null}
                  {spot.estimatedCost !== undefined ? (
                    <Pill>Approx. ${spot.estimatedCost}</Pill>
                  ) : null}
                  {spot.tags?.slice(0, 2).map((tag) => (
                    <Pill key={tag}>{tag}</Pill>
                  ))}
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  {primaryLink ? (
                    <a
                      href={primaryLink}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-10 items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-medium text-white transition hover:bg-slate-800"
                    >
                      Check spot
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
            No food spots available yet.
          </div>
        )}
      </div>
    </section>
  );
}
