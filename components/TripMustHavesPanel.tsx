"use client";

/**
 * Builder panel for destination-aware trip essentials.
 */

import { useMemo, useState } from "react";
import {
  buildTripMustHaves,
  TripMustHaveCategory,
  TripMustHaveItem,
} from "../lib/tripMustHaves";
import { TripPlan } from "../lib/types";

type Props = {
  trip: TripPlan;
};

function categoryTone(category: TripMustHaveCategory) {
  switch (category) {
    case "Safety":
      return "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-400/25 dark:bg-rose-400/10 dark:text-rose-100";
    case "Weather":
      return "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-400/25 dark:bg-sky-400/10 dark:text-sky-100";
    case "Route":
      return "border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-400/25 dark:bg-indigo-400/10 dark:text-indigo-100";
    case "Activity":
      return "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-100";
    case "Admin":
      return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-100";
    case "Comfort":
    default:
      return "border-slate-200 bg-slate-50 text-slate-700 dark:border-white/10 dark:bg-white/8 dark:text-slate-200";
  }
}

function CopyIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="7" y="5" width="9" height="11" rx="2" />
      <path d="M4 13V4a2 2 0 0 1 2-2h7" />
    </svg>
  );
}

function CheckIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m4.5 10.5 3.5 3.4 7.5-8" />
    </svg>
  );
}

function itemCopy(item: TripMustHaveItem) {
  return `${item.title}: ${item.detail}`;
}

function buildClipboardList(required: TripMustHaveItem[], recommended: TripMustHaveItem[]) {
  return [
    "Must-have packing list",
    "",
    "Required",
    ...required.map((item) => `- ${itemCopy(item)}`),
    "",
    "Recommended",
    ...recommended.map((item) => `- ${itemCopy(item)}`),
  ].join("\n");
}

function ItemCard({ item }: { item: TripMustHaveItem }) {
  const isRequired = item.priority === "required";

  return (
    <article
      className={
        isRequired
          ? "rounded-[1.2rem] border border-amber-200/90 bg-[linear-gradient(180deg,rgba(255,251,235,0.9),rgba(255,247,237,0.74))] p-4 shadow-sm dark:border-amber-400/20 dark:bg-[linear-gradient(180deg,rgba(69,46,14,0.34),rgba(15,23,42,0.72))]"
          : "rounded-[1.2rem] border border-slate-200 bg-white/78 p-4 shadow-sm dark:border-white/10 dark:bg-white/6"
      }
    >
      <div className="flex items-start gap-3">
        <span
          className={
            isRequired
              ? "mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white dark:bg-amber-300 dark:text-slate-950"
              : "mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 dark:border-white/12 dark:bg-slate-950/30 dark:text-slate-300"
          }
        >
          <CheckIcon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold tracking-tight text-slate-950 dark:text-white">
              {item.title}
            </h3>
            <span
              className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${categoryTone(
                item.category
              )}`}
            >
              {item.category}
            </span>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-300">
            {item.detail}
          </p>
          <p className="mt-3 text-xs font-medium leading-5 text-slate-500 dark:text-slate-400">
            {item.reason}
          </p>
        </div>
      </div>
    </article>
  );
}

export default function TripMustHavesPanel({ trip }: Props) {
  const [copied, setCopied] = useState(false);
  const mustHaves = useMemo(() => buildTripMustHaves(trip), [trip]);
  const itemCount = mustHaves.required.length + mustHaves.recommended.length;

  async function handleCopyList() {
    try {
      await navigator.clipboard.writeText(
        buildClipboardList(mustHaves.required, mustHaves.recommended)
      );
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-[1.75rem] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(243,247,251,0.98))] shadow-[0_24px_70px_rgba(148,163,184,0.16)] dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(15,23,42,0.96),rgba(9,15,28,0.92))] dark:shadow-[0_24px_70px_rgba(2,6,23,0.35)]">
      <div className="border-b border-slate-200/80 p-5 dark:border-white/10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#0f766e] dark:text-cyan-200/75">
              Must-haves
            </div>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">
              Pack the trip-specific essentials first
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
              This list adapts to the destination, activities, weather signals, and saved packing notes for this plan.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <span className="inline-flex h-10 items-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 dark:border-white/10 dark:bg-white/6 dark:text-slate-200">
              {itemCount} items
            </span>
            <button
              type="button"
              onClick={() => void handleCopyList()}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-[#06d8a0] dark:text-slate-950 dark:hover:bg-[#3be0ab]"
            >
              <CopyIcon className="h-4 w-4" />
              {copied ? "Copied" : "Copy list"}
            </button>
          </div>
        </div>

        {mustHaves.signals.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {mustHaves.signals.map((signal) => (
              <span
                key={signal}
                className="inline-flex rounded-full border border-slate-200 bg-white/78 px-3 py-1.5 text-xs font-medium text-slate-700 dark:border-white/10 dark:bg-white/6 dark:text-slate-200"
              >
                {signal}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="grid gap-5 p-5 xl:grid-cols-[1fr_0.9fr]">
        <div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700 dark:text-amber-200">
                Required
              </div>
              <h3 className="mt-1 text-lg font-semibold tracking-tight text-slate-950 dark:text-white">
                Must be packed or handled
              </h3>
            </div>
            <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-100">
              {mustHaves.required.length}
            </span>
          </div>

          <div className="mt-4 space-y-3">
            {mustHaves.required.map((requiredItem) => (
              <ItemCard key={requiredItem.id} item={requiredItem} />
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                Recommended
              </div>
              <h3 className="mt-1 text-lg font-semibold tracking-tight text-slate-950 dark:text-white">
                Good to bring
              </h3>
            </div>
            <span className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 dark:border-white/10 dark:bg-white/6 dark:text-slate-200">
              {mustHaves.recommended.length}
            </span>
          </div>

          <div className="mt-4 space-y-3">
            {mustHaves.recommended.map((recommendedItem) => (
              <ItemCard key={recommendedItem.id} item={recommendedItem} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
