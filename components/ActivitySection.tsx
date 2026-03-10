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

export default function ActivitySection({ activities }: Props) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="text-2xl font-semibold text-gray-900">Activities</h2>
      <p className="mt-1 text-sm text-gray-600">
        These are the anchor stops that justify the trip, not just random add-ons.
      </p>

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {activities.length > 0 ? (
          activities.map((activity, index) => {
            const primaryLink = activity.bookingLink ?? activity.websiteUrl;

            return (
              <div
                key={activity.id ?? `${activity.name ?? "activity"}-${index}`}
                className="rounded-xl border border-gray-200 p-4"
              >
                <h3 className="text-lg font-semibold text-gray-900">
                  {activity.name ?? "Unnamed activity"}
                </h3>

                <p className="mt-2 text-sm text-gray-600">
                  {activity.shortDescription ?? fallbackActivityDescription(activity)}
                </p>

                <div className="mt-3 space-y-1 text-sm text-gray-700">
                  {activity.type ? <div>Type: {activity.type}</div> : null}
                  {activity.rating !== undefined ? <div>Rating: {activity.rating}</div> : null}
                  {activity.estimatedCost !== undefined ? (
                    <div>
                      Cost: {activity.estimatedCost === 0 ? "Free" : `$${activity.estimatedCost}`}
                    </div>
                  ) : null}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {primaryLink ? (
                    <a
                      href={primaryLink}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg bg-black px-3 py-2 text-sm text-white"
                    >
                      Check activity
                    </a>
                  ) : null}

                  {activity.mapsUrl ? (
                    <a
                      href={activity.mapsUrl}
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
          <p className="text-sm text-gray-600">No activities available yet.</p>
        )}
      </div>
    </section>
  );
}