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
  budgetPerTraveler: string;
  travelerCount: string;
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
  budgetPerTraveler: "300",
  travelerCount: "2",
  tripLengthDays: "2",
  season: "Summer",
  style: "foodie",
  veganFriendly: false,
  includeStaycations: false,
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

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(value);
}

function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-2 block text-sm font-medium text-slate-700"
    >
      {children}
    </label>
  );
}

function ToggleRow({
  title,
  checked,
  onChange,
}: {
  title: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 transition hover:bg-slate-100">
      <span className="text-sm font-medium text-slate-800">{title}</span>

      <div className="relative">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <div className="h-6 w-11 rounded-full bg-slate-300 transition peer-checked:bg-violet-500" />
        <div className="absolute left-1 top-1 h-4 w-4 rounded-full bg-white transition peer-checked:translate-x-5" />
      </div>
    </label>
  );
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
    key: "maxDriveHours" | "budgetPerTraveler" | "travelerCount" | "tripLengthDays",
    value: string
  ) {
    const digitsOnly = value.replace(/[^\d]/g, "");
    updateField(key, digitsOnly as FormState[typeof key]);
  }

  function handleNumericBlur(
    key: "maxDriveHours" | "budgetPerTraveler" | "travelerCount" | "tripLengthDays"
  ) {
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

    if (key === "budgetPerTraveler") {
      updateField(
        key,
        normalizeNumericString(form[key], {
          min: 50,
          max: 5000,
          fallback: 300,
        }) as FormState[typeof key]
      );
      return;
    }

    if (key === "travelerCount") {
      updateField(
        key,
        normalizeNumericString(form[key], {
          min: 1,
          max: 12,
          fallback: 2,
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

    const travelerCount = Math.min(
      12,
      Math.max(1, parsePositiveInt(form.travelerCount, 2))
    );

    const budgetPerTraveler = Math.min(
      5000,
      Math.max(50, parsePositiveInt(form.budgetPerTraveler, 300))
    );

    const cleanedInput: TripInput = {
      startCity: form.startCity,
      maxDriveHours: Math.min(
        12,
        Math.max(1, parsePositiveInt(form.maxDriveHours, 5))
      ),
      budget: travelerCount * budgetPerTraveler,
      budgetPerTraveler,
      travelerCount,
      tripLengthDays: Math.min(
        7,
        Math.max(1, parsePositiveInt(form.tripLengthDays, 2))
      ),
      season: form.season,
      style: form.style,
      veganFriendly: form.veganFriendly,
      includeStaycations: form.includeStaycations,
      strictBudget: form.strictBudget,
    };

    setForm((prev) => ({
      ...prev,
      maxDriveHours: String(cleanedInput.maxDriveHours),
      budgetPerTraveler: String(cleanedInput.budgetPerTraveler),
      travelerCount: String(cleanedInput.travelerCount),
      tripLengthDays: String(cleanedInput.tripLengthDays),
    }));

    const submitHandler = onGenerate ?? onSubmit;

    if (typeof submitHandler !== "function") {
      console.error("TripForm requires an onGenerate or onSubmit prop.");
      return;
    }

    await submitHandler(cleanedInput);
  }

  const liveTravelerCount = Math.min(
    12,
    Math.max(1, parsePositiveInt(form.travelerCount, 2))
  );

  const liveBudgetPerTraveler = Math.min(
    5000,
    Math.max(50, parsePositiveInt(form.budgetPerTraveler, 300))
  );

  const totalBudget = liveTravelerCount * liveBudgetPerTraveler;

  return (
    <section className="w-full">
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid gap-4 lg:grid-cols-3">
          <div>
            <FieldLabel htmlFor="startCity">Start city</FieldLabel>
            <select
              id="startCity"
              value={form.startCity}
              onChange={(e) =>
                updateField("startCity", e.target.value as FormState["startCity"])
              }
              className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-slate-900 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            >
              <option value="Edmonton">Edmonton</option>
              <option value="Calgary">Calgary</option>
            </select>
          </div>

          <div>
            <FieldLabel htmlFor="season">Season</FieldLabel>
            <select
              id="season"
              value={form.season}
              onChange={(e) => updateField("season", e.target.value)}
              className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-slate-900 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            >
              {SEASONS.map((season) => (
                <option key={season} value={season}>
                  {season}
                </option>
              ))}
            </select>
          </div>

          <div>
            <FieldLabel htmlFor="style">Trip style</FieldLabel>
            <select
              id="style"
              value={form.style}
              onChange={(e) => updateField("style", e.target.value as TripStyle)}
              className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-slate-900 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            >
              {TRIP_STYLES.map((style) => (
                <option key={style} value={style}>
                  {displayStyleLabel(style)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <FieldLabel htmlFor="budgetPerTraveler">
              Budget per traveller ($)
            </FieldLabel>
            <input
              id="budgetPerTraveler"
              inputMode="numeric"
              pattern="[0-9]*"
              type="text"
              value={form.budgetPerTraveler}
              onChange={(e) =>
                handleNumericChange("budgetPerTraveler", e.target.value)
              }
              onBlur={() => handleNumericBlur("budgetPerTraveler")}
              className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-slate-900 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
          </div>

          <div>
            <FieldLabel htmlFor="travelerCount">How many people</FieldLabel>
            <input
              id="travelerCount"
              inputMode="numeric"
              pattern="[0-9]*"
              type="text"
              value={form.travelerCount}
              onChange={(e) => handleNumericChange("travelerCount", e.target.value)}
              onBlur={() => handleNumericBlur("travelerCount")}
              className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-slate-900 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
          </div>

          <div>
            <FieldLabel htmlFor="maxDriveHours">Drive hours</FieldLabel>
            <input
              id="maxDriveHours"
              inputMode="numeric"
              pattern="[0-9]*"
              type="text"
              value={form.maxDriveHours}
              onChange={(e) => handleNumericChange("maxDriveHours", e.target.value)}
              onBlur={() => handleNumericBlur("maxDriveHours")}
              className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-slate-900 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
          </div>

          <div>
            <FieldLabel htmlFor="tripLengthDays">Trip days</FieldLabel>
            <input
              id="tripLengthDays"
              inputMode="numeric"
              pattern="[0-9]*"
              type="text"
              value={form.tripLengthDays}
              onChange={(e) => handleNumericChange("tripLengthDays", e.target.value)}
              onBlur={() => handleNumericBlur("tripLengthDays")}
              className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-slate-900 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="text-sm font-medium text-slate-800">
            Estimated total budget: {formatCurrency(totalBudget)}
          </div>
          <div className="mt-1 text-xs text-slate-600">
            Based on {liveTravelerCount} traveler
            {liveTravelerCount === 1 ? "" : "s"} at{" "}
            {formatCurrency(liveBudgetPerTraveler)} each.
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-3">
          <ToggleRow
            title="Vegan-friendly only"
            checked={form.veganFriendly}
            onChange={(checked) => updateField("veganFriendly", checked)}
          />
          <ToggleRow
            title="Include staycations"
            checked={form.includeStaycations}
            onChange={(checked) => updateField("includeStaycations", checked)}
          />
          <ToggleRow
            title="Strict budget"
            checked={form.strictBudget}
            onChange={(checked) => updateField("strictBudget", checked)}
          />
        </div>

        <div className="flex flex-col gap-4 border-t border-slate-200 pt-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="text-sm text-slate-600">
            {results.length > 0
              ? `${results.length} destination${results.length === 1 ? "" : "s"} matched your filters.`
              : "Choose your preferences and generate ranked trip ideas."}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-12 items-center justify-center rounded-2xl bg-slate-950 px-6 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Generating..." : "Generate trips"}
          </button>
        </div>
      </form>
    </section>
  );
}