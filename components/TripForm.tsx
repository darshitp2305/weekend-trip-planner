"use client";

import { useState } from "react";
import { RankedDestination, TripInput, TripStyle } from "../lib/types";

type Props = {
  onGenerate?: (input: TripInput) => Promise<void> | void;
  onSubmit?: (input: TripInput) => Promise<void> | void;
  loading?: boolean;
  results?: RankedDestination[];
};

type FormState = {
  startCity: "Edmonton" | "Calgary";
  maxDriveHours: string;
  budget: string;
  tripLengthDays: string;
  season: string;
  style: TripStyle;
  veganFriendly: boolean;
  includeStaycations: boolean;
  strictBudget: boolean;
};

const DEFAULT_FORM: FormState = {
  startCity: "Edmonton",
  maxDriveHours: "5",
  budget: "600",
  tripLengthDays: "2",
  season: "Summer",
  style: "foodie",
  veganFriendly: false,
  includeStaycations: true,
  strictBudget: false,
};

const SEASONS = ["Spring", "Summer", "Fall", "Winter"];

const TRIP_STYLES: TripStyle[] = [
  "chill",
  "outdoors",
  "foodie",
  "solo reset",
  "adventure",
];

function parsePositiveInt(value: string, fallback: number) {
  const cleaned = value.replace(/[^\d]/g, "");
  if (!cleaned) return fallback;

  const parsed = Number.parseInt(cleaned, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;

  return parsed;
}

function normalizeNumericString(
  value: string,
  options: { min: number; max: number; fallback: number }
) {
  const parsed = parsePositiveInt(value, options.fallback);
  const clamped = Math.min(options.max, Math.max(options.min, parsed));
  return String(clamped);
}

function displayStyleLabel(style: TripStyle) {
  switch (style) {
    case "solo reset":
      return "Solo reset";
    case "foodie":
      return "Foodie";
    case "outdoors":
      return "Outdoors";
    case "adventure":
      return "Adventure";
    case "chill":
      return "Chill";
    default:
      return style;
  }
}

export default function TripForm({
  onGenerate,
  onSubmit,
  loading = false,
  results = [],
}: Props) {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({
      ...prev,
      [key]: value,
    }));
  }

  function handleNumericChange(
    key: "maxDriveHours" | "budget" | "tripLengthDays",
    value: string
  ) {
    const digitsOnly = value.replace(/[^\d]/g, "");
    updateField(key, digitsOnly as FormState[typeof key]);
  }

  function handleNumericBlur(key: "maxDriveHours" | "budget" | "tripLengthDays") {
    if (key === "maxDriveHours") {
      updateField(
        key,
        normalizeNumericString(form[key], {
          min: 1,
          max: 12,
          fallback: 5,
        }) as FormState[typeof key]
      );
      return;
    }

    if (key === "budget") {
      updateField(
        key,
        normalizeNumericString(form[key], {
          min: 50,
          max: 5000,
          fallback: 600,
        }) as FormState[typeof key]
      );
      return;
    }

    updateField(
      key,
      normalizeNumericString(form[key], {
        min: 1,
        max: 7,
        fallback: 2,
      }) as FormState[typeof key]
    );
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const cleanedInput: TripInput = {
      startCity: form.startCity,
      maxDriveHours: parsePositiveInt(form.maxDriveHours, 5),
      budget: parsePositiveInt(form.budget, 600),
      tripLengthDays: parsePositiveInt(form.tripLengthDays, 2),
      season: form.season,
      style: form.style,
      veganFriendly: form.veganFriendly,
      includeStaycations: form.includeStaycations,
      strictBudget: form.strictBudget,
    };

    cleanedInput.maxDriveHours = Math.min(12, Math.max(1, cleanedInput.maxDriveHours));
    cleanedInput.budget = Math.min(5000, Math.max(50, cleanedInput.budget));
    cleanedInput.tripLengthDays = Math.min(7, Math.max(1, cleanedInput.tripLengthDays));

    setForm((prev) => ({
      ...prev,
      maxDriveHours: String(cleanedInput.maxDriveHours),
      budget: String(cleanedInput.budget),
      tripLengthDays: String(cleanedInput.tripLengthDays),
    }));

    const submitHandler = onGenerate ?? onSubmit;

    if (typeof submitHandler !== "function") {
      console.error("TripForm requires an onGenerate or onSubmit prop.");
      return;
    }

    await submitHandler(cleanedInput);
  }

  return (
    <section className="w-full">
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label
            htmlFor="startCity"
            className="mb-2 block text-sm font-medium text-white"
          >
            Start city
          </label>
          <select
            id="startCity"
            value={form.startCity}
            onChange={(e) =>
              updateField(
                "startCity",
                e.target.value as FormState["startCity"]
              )
            }
            className="w-full rounded-none border border-white bg-black px-3 py-2 text-white outline-none"
          >
            <option value="Edmonton">Edmonton</option>
            <option value="Calgary">Calgary</option>
          </select>
        </div>

        <div>
          <label
            htmlFor="maxDriveHours"
            className="mb-2 block text-sm font-medium text-white"
          >
            Max drive hours
          </label>
          <input
            id="maxDriveHours"
            inputMode="numeric"
            pattern="[0-9]*"
            type="text"
            value={form.maxDriveHours}
            onChange={(e) => handleNumericChange("maxDriveHours", e.target.value)}
            onBlur={() => handleNumericBlur("maxDriveHours")}
            className="w-full rounded-none border border-white bg-black px-3 py-2 text-white outline-none"
          />
        </div>

        <div>
          <label
            htmlFor="budget"
            className="mb-2 block text-sm font-medium text-white"
          >
            Total budget ($)
          </label>
          <input
            id="budget"
            inputMode="numeric"
            pattern="[0-9]*"
            type="text"
            value={form.budget}
            onChange={(e) => handleNumericChange("budget", e.target.value)}
            onBlur={() => handleNumericBlur("budget")}
            className="w-full rounded-none border border-white bg-black px-3 py-2 text-white outline-none"
          />
        </div>

        <div>
          <label
            htmlFor="tripLengthDays"
            className="mb-2 block text-sm font-medium text-white"
          >
            Trip length (days)
          </label>
          <input
            id="tripLengthDays"
            inputMode="numeric"
            pattern="[0-9]*"
            type="text"
            value={form.tripLengthDays}
            onChange={(e) => handleNumericChange("tripLengthDays", e.target.value)}
            onBlur={() => handleNumericBlur("tripLengthDays")}
            className="w-full rounded-none border border-white bg-black px-3 py-2 text-white outline-none"
          />
        </div>

        <div>
          <label
            htmlFor="season"
            className="mb-2 block text-sm font-medium text-white"
          >
            Season
          </label>
          <select
            id="season"
            value={form.season}
            onChange={(e) => updateField("season", e.target.value)}
            className="w-full rounded-none border border-white bg-black px-3 py-2 text-white outline-none"
          >
            {SEASONS.map((season) => (
              <option key={season} value={season}>
                {season}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="style"
            className="mb-2 block text-sm font-medium text-white"
          >
            Trip style
          </label>
          <select
            id="style"
            value={form.style}
            onChange={(e) =>
              updateField("style", e.target.value as TripStyle)
            }
            className="w-full rounded-none border border-white bg-black px-3 py-2 text-white outline-none"
          >
            {TRIP_STYLES.map((style) => (
              <option key={style} value={style}>
                {displayStyleLabel(style)}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-2 text-white">
          <input
            type="checkbox"
            checked={form.veganFriendly}
            onChange={(e) => updateField("veganFriendly", e.target.checked)}
          />
          <span>Vegan-friendly only</span>
        </label>

        <label className="flex items-center gap-2 text-white">
          <input
            type="checkbox"
            checked={form.includeStaycations}
            onChange={(e) => updateField("includeStaycations", e.target.checked)}
          />
          <span>Include staycations</span>
        </label>

        <label className="flex items-center gap-2 text-white">
          <input
            type="checkbox"
            checked={form.strictBudget}
            onChange={(e) => updateField("strictBudget", e.target.checked)}
          />
          <span>Strict budget</span>
        </label>

        <button
          type="submit"
          disabled={loading}
          className="rounded bg-black px-4 py-2 text-white outline outline-1 outline-white disabled:opacity-60"
        >
          {loading ? "Generating..." : "Generate trip"}
        </button>
      </form>

      <div className="mt-6 rounded border border-white px-4 py-4 text-white">
        {results.length > 0
          ? `${results.length} destinations matched your filters.`
          : "No destinations generated yet."}
      </div>
    </section>
  );
}