"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatDateRange } from "../lib/tripDates";

declare global {
  interface Window {
    eg?: {
      widgets?: {
        initialized?: boolean;
        loaded?: boolean;
        elements?: Record<string, Element>;
      };
    };
  }
}

type Props = {
  destinationLabel?: string;
  selectedHotelName?: string;
  tripStartDate?: string;
  tripEndDate?: string;
};

function buildExpediaSearchUrl({
  destinationLabel,
  selectedHotelName,
  tripStartDate,
  tripEndDate,
}: Props) {
  const params = new URLSearchParams();
  const query = selectedHotelName?.trim() || destinationLabel?.trim() || "Alberta";

  params.set("destination", query);

  if (tripStartDate) {
    params.set("startDate", tripStartDate);
  }

  if (tripEndDate) {
    params.set("endDate", tripEndDate);
  }

  params.set("sort", "RECOMMENDED");
  params.set("categorySearch", "any_option");
  params.set("useRewards", "false");

  return `https://www.expedia.ca/Hotel-Search?${params.toString()}`;
}

export default function ExpediaStayWidget({
  destinationLabel,
  selectedHotelName,
  tripStartDate,
  tripEndDate,
}: Props) {
  const widgetHostRef = useRef<HTMLDivElement | null>(null);
  const [embedStatus, setEmbedStatus] = useState<"loading" | "ready" | "failed">(
    "loading"
  );
  const recommendedSearch =
    selectedHotelName?.trim() || destinationLabel?.trim() || "your destination";
  const dateRange = formatDateRange(tripStartDate, tripEndDate);
  const searchUrl = useMemo(
    () =>
      buildExpediaSearchUrl({
        destinationLabel,
        selectedHotelName,
        tripStartDate,
        tripEndDate,
      }),
    [destinationLabel, selectedHotelName, tripEndDate, tripStartDate]
  );

  useEffect(() => {
    const host = widgetHostRef.current;
    if (!host) return;

    const resetStatusTimeout = window.setTimeout(() => {
      setEmbedStatus("loading");
    }, 0);
    host.innerHTML = "";

    const widget = document.createElement("div");
    widget.className = "eg-widget";
    widget.setAttribute("data-widget", "search");
    widget.setAttribute("data-program", "ca-expedia");
    widget.setAttribute("data-lobs", "stays");
    widget.setAttribute("data-network", "pz");
    widget.setAttribute("data-camref", "10115EIB5");
    widget.setAttribute("data-pubref", "");

    host.appendChild(widget);

    const statusCheckTimeouts: number[] = [];

    const checkRendered = () => {
      const rendered = host.querySelector("iframe, form, input, button");
      setEmbedStatus(rendered ? "ready" : "failed");
    };

    const scheduleChecks = () => {
      statusCheckTimeouts.push(
        window.setTimeout(checkRendered, 800),
        window.setTimeout(checkRendered, 2200)
      );
    };

    const dispatchBootstrapEvent = () => {
      if (window.eg?.widgets) {
        window.eg.widgets.loaded = false;
        window.eg.widgets.elements = {};
      }

      window.dispatchEvent(new Event("DOMContentLoaded"));
      document.dispatchEvent(new Event("DOMContentLoaded"));
      scheduleChecks();
    };

    const existingScript = document.querySelector<HTMLScriptElement>(
      "script.eg-widgets-script"
    );

    if (existingScript && window.eg?.widgets?.initialized) {
      dispatchBootstrapEvent();
    } else {
      const script = existingScript ?? document.createElement("script");
      script.className = "eg-widgets-script";
      script.src =
        "https://creator.expediagroup.com/products/widgets/assets/eg-widgets.js";
      script.async = true;

      script.onload = () => {
        dispatchBootstrapEvent();
      };

      script.onerror = () => {
        statusCheckTimeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
        setEmbedStatus("failed");
      };

      if (!existingScript) {
        document.body.appendChild(script);
      }
    }

    return () => {
      window.clearTimeout(resetStatusTimeout);
      statusCheckTimeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
      host.innerHTML = "";
    };
  }, [destinationLabel, selectedHotelName, tripEndDate, tripStartDate]);

  return (
    <section className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col gap-1">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-600 dark:text-violet-300">
          Hotel booking
        </div>
        <h2 className="text-xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">
          Search Expedia for your stay
        </h2>
        <p className="max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
          This uses Expedia&apos;s official search widget embed. If Expedia still does not render it here, use the direct search shortcut below.
        </p>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
          Search: {recommendedSearch}
        </span>
        {tripStartDate ? (
          <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
            Check-in: {tripStartDate}
          </span>
        ) : null}
        {tripEndDate ? (
          <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
            Check-out: {tripEndDate}
          </span>
        ) : null}
      </div>

      <div className="mt-4 rounded-[1.25rem] border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950/40">
        <div
          ref={widgetHostRef}
          className="min-h-[196px]"
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <a
          href={searchUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Open Expedia search
        </a>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {embedStatus === "loading"
            ? "Loading Expedia widget..."
            : embedStatus === "ready"
              ? "Expedia widget loaded."
              : "Expedia widget did not render. The direct Expedia search link is still available."}
        </span>
      </div>

      <p className="mt-3 text-xs leading-5 text-slate-500 dark:text-slate-400">
        Powered by Expedia. If the widget stays blank, open Expedia and search for{" "}
        <span className="font-semibold text-slate-700 dark:text-slate-200">
          {recommendedSearch}
        </span>
        {dateRange ? ` for ${dateRange}` : ""}.
      </p>
    </section>
  );
}
