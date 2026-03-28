"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildExpediaHotelSearchUrl,
  directHotelPropertyUrl,
  directExpediaPropertyUrl,
} from "../lib/expediaLinks";
import { formatDateRange, isIsoDate } from "../lib/tripDates";
import { isCampingStayLikeHotel } from "../lib/tripSpecificity";
import { HotelOption } from "../lib/types";
import { sanitizeExternalNavigationUrl } from "../lib/urlSafety";

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
  selectedHotel?: Pick<
    HotelOption,
    "name" | "websiteUrl" | "bookingLink" | "mapsUrl"
  >;
  tripStartDate?: string;
  tripEndDate?: string;
};

function initialSearchQuery(
  destinationLabel?: string,
  selectedHotelName?: string
) {
  return selectedHotelName?.trim() || destinationLabel?.trim() || "";
}

function normalizeIsoDate(value?: string) {
  return isIsoDate(value) ? value : "";
}

export default function ExpediaStayWidget({
  destinationLabel,
  selectedHotel,
  tripStartDate,
  tripEndDate,
}: Props) {
  const widgetHostRef = useRef<HTMLDivElement | null>(null);
  const [showOfficialWidget, setShowOfficialWidget] = useState(false);
  const [embedStatus, setEmbedStatus] = useState<"loading" | "ready" | "failed">(
    "loading"
  );
  const selectedHotelName = selectedHotel?.name;
  const [searchQuery, setSearchQuery] = useState(
    initialSearchQuery(destinationLabel, selectedHotelName)
  );
  const [checkInDate, setCheckInDate] = useState(normalizeIsoDate(tripStartDate));
  const [checkOutDate, setCheckOutDate] = useState(normalizeIsoDate(tripEndDate));

  useEffect(() => {
    setSearchQuery(initialSearchQuery(destinationLabel, selectedHotelName));
  }, [destinationLabel, selectedHotelName]);

  useEffect(() => {
    setCheckInDate(normalizeIsoDate(tripStartDate));
  }, [tripStartDate]);

  useEffect(() => {
    setCheckOutDate(normalizeIsoDate(tripEndDate));
  }, [tripEndDate]);

  const recommendedSearch = searchQuery.trim() || "your destination";
  const dateRange = formatDateRange(
    checkInDate || undefined,
    checkOutDate || undefined
  );
  const directStayUrl = useMemo(
    () => directHotelPropertyUrl({ hotel: selectedHotel }),
    [selectedHotel]
  );
  const directExpediaUrl = useMemo(
    () => directExpediaPropertyUrl({ hotel: selectedHotel }),
    [selectedHotel]
  );
  const isCampingStay = isCampingStayLikeHotel(selectedHotel);
  const safeSelectedHotelMapUrl = useMemo(
    () => sanitizeExternalNavigationUrl(selectedHotel?.mapsUrl),
    [selectedHotel?.mapsUrl]
  );
  const searchUrl = useMemo(
    () => {
      const trimmedQuery = searchQuery.trim();

      return buildExpediaHotelSearchUrl({
        hotel: trimmedQuery ? { name: trimmedQuery } : undefined,
        destination: destinationLabel,
        tripStartDate: checkInDate || undefined,
        tripEndDate: checkOutDate || undefined,
      });
    },
    [checkInDate, checkOutDate, destinationLabel, searchQuery]
  );
  const canSearch = Boolean(searchQuery.trim());
  const isExactSelectedHotelSearch =
    Boolean(selectedHotelName?.trim()) &&
    searchQuery.trim().toLowerCase() === selectedHotelName!.trim().toLowerCase();
  const actionUrl = isCampingStay
    ? directStayUrl ?? safeSelectedHotelMapUrl ?? searchUrl
    : directExpediaUrl && isExactSelectedHotelSearch
      ? directExpediaUrl
      : searchUrl;
  const actionLabel = isCampingStay
    ? directStayUrl
      ? "Open stay site"
      : safeSelectedHotelMapUrl
        ? "Open map"
        : "Search stay"
    : directExpediaUrl && isExactSelectedHotelSearch
      ? "Open selected hotel"
      : "Search Expedia";
  const actionHint = isCampingStay
    ? "Campgrounds rarely book cleanly through Expedia. Start with the selected stay site or map, then confirm campsite availability directly."
    : directExpediaUrl && isExactSelectedHotelSearch
      ? "A direct property link is available for this stay, so the button opens that hotel directly."
      : "Adjust the hotel name or dates if needed, then jump straight into Expedia search results using the selected stay plus destination.";

  useEffect(() => {
    const host = widgetHostRef.current;
    if (!showOfficialWidget || !host) return;

    setEmbedStatus("loading");
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
      statusCheckTimeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
      host.innerHTML = "";
    };
  }, [showOfficialWidget]);

  function handleOpenSearch() {
    if (!canSearch || !actionUrl) return;
    window.open(actionUrl, "_blank", "noopener,noreferrer");
  }

  if (isCampingStay) {
    return (
      <section className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-600 dark:text-violet-300">
            Stay booking
          </div>
          <h2 className="text-xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">
            Check your campsite or campground directly
          </h2>
          <p className="max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            Camping stays are better booked from the selected stay site or map than
            through a hotel aggregator.
          </p>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
            Stay: {selectedHotelName ?? recommendedSearch}
          </span>
          {checkInDate ? (
            <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
              Check-in: {checkInDate}
            </span>
          ) : null}
          {checkOutDate ? (
            <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
              Check-out: {checkOutDate}
            </span>
          ) : null}
        </div>

        <div className="mt-4 rounded-[1.25rem] border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950/40">
          <div className="rounded-[1rem] border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
              Selected stay
            </div>
            <h3 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">
              Start with your current basecamp
            </h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              {actionHint}
            </p>

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleOpenSearch}
                disabled={!canSearch}
                className="inline-flex h-12 items-center justify-center rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-violet-500 dark:text-slate-950 dark:hover:bg-violet-400"
              >
                {actionLabel}
              </button>
              {safeSelectedHotelMapUrl ? (
                <a
                  href={safeSelectedHotelMapUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-12 items-center justify-center rounded-xl border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Open map
                </a>
              ) : null}
            </div>
          </div>
        </div>

        <p className="mt-3 text-xs leading-5 text-slate-500 dark:text-slate-400">
          Use the selected stay source for current availability
          {dateRange ? ` for ${dateRange}` : ""}.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col gap-1">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-600 dark:text-violet-300">
          Stay booking
        </div>
        <h2 className="text-xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">
          Search Expedia for your stay
        </h2>
        <p className="max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
          The search form below is prefilled from your current hotel selection and trip
          dates, then opens Expedia with those details applied.
        </p>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
          Search: {recommendedSearch}
        </span>
        {checkInDate ? (
          <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
            Check-in: {checkInDate}
          </span>
        ) : null}
        {checkOutDate ? (
          <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
            Check-out: {checkOutDate}
          </span>
        ) : null}
      </div>

      <div className="mt-4 rounded-[1.25rem] border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950/40">
        <div className="rounded-[1rem] border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
            Prefilled search
          </div>
          <h3 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">
            Start with your selected stay
          </h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            {actionHint}
          </p>

          <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
            <label className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                Hotel or destination
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Enter hotel or destination"
                className="h-12 rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-violet-500/20"
              />
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                Check-in
              </span>
              <input
                type="date"
                value={checkInDate}
                onChange={(event) => setCheckInDate(event.target.value)}
                className="date-input-fix h-12 rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-violet-500/20 dark:[&::-webkit-calendar-picker-indicator]:invert"
              />
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                Check-out
              </span>
              <input
                type="date"
                value={checkOutDate}
                onChange={(event) => setCheckOutDate(event.target.value)}
                className="date-input-fix h-12 rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-violet-500/20 dark:[&::-webkit-calendar-picker-indicator]:invert"
              />
            </label>

            <button
              type="button"
              onClick={handleOpenSearch}
              disabled={!canSearch}
              className="inline-flex h-12 items-center justify-center rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-violet-500 dark:text-slate-950 dark:hover:bg-violet-400"
            >
              {actionLabel}
            </button>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setShowOfficialWidget((current) => !current)}
          className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          {showOfficialWidget ? "Hide official Expedia widget" : "Show official Expedia widget"}
        </button>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          Expedia&apos;s embedded widget does not reliably accept prefilled hotel and date
          values, so the search form above is the reliable path.
        </span>
      </div>

      {showOfficialWidget ? (
        <div className="mt-4 rounded-[1.25rem] border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950/40">
          <div ref={widgetHostRef} className="min-h-[196px]" />
          <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            {embedStatus === "loading"
              ? "Loading Expedia widget..."
              : embedStatus === "ready"
                ? "Expedia widget loaded."
                : "Expedia widget did not render. Use the prefilled search form above instead."}
          </div>
        </div>
      ) : null}

      <p className="mt-3 text-xs leading-5 text-slate-500 dark:text-slate-400">
        Powered by Expedia. Search for{" "}
        <span className="font-semibold text-slate-700 dark:text-slate-200">
          {recommendedSearch}
        </span>
        {dateRange ? ` for ${dateRange}` : ""}.
      </p>
    </section>
  );
}
