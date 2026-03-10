"use client";

import { useState } from "react";

type Props = {
  trip: {
    id?: string;
    hotelOptions?: Array<{ websiteUrl?: string; bookingLink?: string }>;
  };
};

export default function TripActions({ trip }: Props) {
  const [copied, setCopied] = useState(false);

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  const firstHotelSite =
    trip.hotelOptions?.[0]?.websiteUrl || trip.hotelOptions?.[0]?.bookingLink;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="text-2xl font-semibold text-gray-900">Actions</h2>
      <p className="mt-1 text-sm text-gray-600">
        This page is stored locally in this browser right now, so the copied link is only reliable on this device.
      </p>

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          onClick={handleCopyLink}
          className="rounded-lg bg-black px-4 py-2 text-sm text-white"
        >
          {copied ? "Link copied" : "Copy page link"}
        </button>

        {firstHotelSite ? (
          <a
            href={firstHotelSite}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-800"
          >
            Open lodging link
          </a>
        ) : null}
      </div>
    </section>
  );
}