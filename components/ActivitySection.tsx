import { sanitizeExternalNavigationUrl } from "../lib/urlSafety";

type Activity = {
  id?: string;
  name?: string;
  rating?: number;
  estimatedCost?: number;
  shortDescription?: string;
  mapsUrl?: string;
  websiteUrl?: string;
  bookingLink?: string;
  type?: string;
};

type Props = {
  activities: Activity[];
};

function fallbackActivityDescription(activity: Activity) {
  if (activity.type) {
    return `Useful ${activity.type} stop that anchors the trip.`;
  }
  return "One of the main stops that gives this trip a reason to exist.";
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

function formatCost(value?: number) {
  if (value === undefined) return null;
  if (value === 0) return "Free";
  return `$${value}`;
}

export default function ActivitySection({ activities }: Props) {
  return (
    <section>
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold tracking-tight text-slate-950">
          Activities
        </h2>
        <p className="text-sm leading-6 text-slate-600">
          These are the anchor stops that justify the trip, not just random add-ons.
        </p>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {activities.length > 0 ? (
          activities.map((activity, index) => {
            const primaryLink = sanitizeExternalNavigationUrl(
              activity.bookingLink ?? activity.websiteUrl
            );
            const mapsLink = sanitizeExternalNavigationUrl(activity.mapsUrl);
            const cost = formatCost(activity.estimatedCost);

            return (
              <article
                key={activity.id ?? `${activity.name ?? "activity"}-${index}`}
                className="flex h-full flex-col rounded-2xl border border-slate-200 bg-slate-50 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="pr-3 text-lg font-semibold leading-8 text-slate-950">
                    {activity.name ?? "Unnamed activity"}
                  </h3>

                  {activity.rating !== undefined ? (
                    <Pill tone="green">Rating {activity.rating}</Pill>
                  ) : null}
                </div>

                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {activity.shortDescription ?? fallbackActivityDescription(activity)}
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                  {activity.type ? <Pill>{activity.type}</Pill> : null}
                  {cost ? (
                    <Pill tone={cost === "Free" ? "violet" : "slate"}>{cost}</Pill>
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
                      Check activity
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
            No activities available yet.
          </div>
        )}
      </div>
    </section>
  );
}
