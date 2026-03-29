"use client";

/**
 * Primary form for collecting trip preferences before generation.
 * The component manages builder-prompt input, validation, and the normalized values that are sent to the ranking and generation APIs.
 */


import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import DestinationShowcase from "./DestinationShowcase";
import {
  deriveTripIntentFromPrompt,
  extractPromptBudget,
  extractPromptDepartureTime,
  extractPromptStartCity,
  extractPromptTravelerCount,
} from "../lib/tripIntent";
import {
  getPromptLimitError,
  TRIP_PROMPT_MAX_CHARS,
} from "../lib/promptLimits";
import { isStartCity, START_CITY_OPTIONS, type StartCity } from "../lib/startCities";
import {
  clampTripEndDate,
  clampTripStartDate,
  deriveTripEndDate,
  deriveTripLengthDays,
  deriveSeasonFromDateRange,
  formatDateRange,
  getTodayIsoDate,
} from "../lib/tripDates";
import { ActivityFocus, TripInput, TripStyle } from "../lib/types";

type Props = {
  onGenerate?: (input: TripInput) => Promise<void> | void;
  onSubmit?: (input: TripInput) => Promise<void> | void;
  loading?: boolean;
  initialInput?: Partial<TripInput>;
};

type FormState = {
  startCity: StartCity;
  travelerCount: string;
  budgetPerTraveler: string;
  maxDriveHours: string;
  tripPrompt: string;
  tripStartDate: string;
  tripEndDate: string;
};

const DEFAULT_FORM: FormState = {
  startCity: "Edmonton",
  travelerCount: "2",
  budgetPerTraveler: "",
  maxDriveHours: "",
  tripPrompt: "",
  tripStartDate: "",
  tripEndDate: "",
};

const DATE_TRIGGER_CLASS =
  "flex h-12 w-full items-center justify-between rounded-[1.25rem] border border-slate-300 bg-white px-4 text-left text-slate-950 shadow-sm outline-none transition hover:border-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-slate-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:border-slate-600 dark:focus:ring-slate-700";
const CALENDAR_WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function parseIsoDate(value?: string) {
  if (!value) return null;

  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;

  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return null;

  return date;
}

function formatIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatTimeInputValue(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes()
  ).padStart(2, "0")}`;
}

function formatDateButtonLabel(value: string) {
  const date = parseIsoDate(value);
  if (!date) return "Select date";

  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatCalendarMonth(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    month: "long",
    year: "numeric",
  }).format(date);
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, delta: number) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

function isSameDay(left: Date | null, right: Date | null) {
  if (!left || !right) return false;

  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function CalendarIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5 text-slate-500 dark:text-slate-400"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M7.5 3.5v4M16.5 3.5v4M3.5 9.5h17" />
    </svg>
  );
}

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {direction === "left" ? (
        <path d="M15 18l-6-6 6-6" />
      ) : (
        <path d="M9 18l6-6-6-6" />
      )}
    </svg>
  );
}

function DatePickerField({
  id,
  label,
  value,
  min,
  max,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  min?: string;
  max?: string;
  onChange: (value: string) => void;
}) {
  const selectedDate = parseIsoDate(value);
  const minDate = parseIsoDate(min);
  const maxDate = parseIsoDate(max);
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState<Date>(
    () => selectedDate ?? minDate ?? new Date()
  );
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (!popoverRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const monthStart = startOfMonth(visibleMonth);
  const monthGridStart = new Date(
    monthStart.getFullYear(),
    monthStart.getMonth(),
    1 - monthStart.getDay()
  );
  const minMonth = minDate ? startOfMonth(minDate) : null;
  const maxMonth = maxDate ? startOfMonth(maxDate) : null;
  const canGoPrev = !minMonth || addMonths(monthStart, -1) >= minMonth;
  const canGoNext = !maxMonth || addMonths(monthStart, 1) <= maxMonth;

  return (
    <div className="relative">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <button
        id={id}
        type="button"
        onClick={() =>
          setOpen((current) => {
            if (!current) {
              setVisibleMonth(selectedDate ?? minDate ?? new Date());
            }

            return !current;
          })
        }
        className={DATE_TRIGGER_CLASS}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span className="text-base">{formatDateButtonLabel(value)}</span>
        <CalendarIcon />
      </button>

      {open ? (
        <div
          ref={popoverRef}
          className="absolute left-0 top-full z-30 mt-3 w-[20rem] rounded-[1.6rem] border border-slate-200/80 bg-white/95 p-4 shadow-[0_24px_70px_rgba(15,23,42,0.18)] backdrop-blur dark:border-slate-700/80 dark:bg-slate-900/95"
          role="dialog"
          aria-label={`${label} calendar`}
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">
                Pick a date
              </div>
              <div className="mt-1 text-lg font-semibold text-slate-950 dark:text-slate-100">
                {formatCalendarMonth(monthStart)}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => canGoPrev && setVisibleMonth((current) => addMonths(current, -1))}
                disabled={!canGoPrev}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-800"
                aria-label="Previous month"
              >
                <ChevronIcon direction="left" />
              </button>
              <button
                type="button"
                onClick={() => canGoNext && setVisibleMonth((current) => addMonths(current, 1))}
                disabled={!canGoNext}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-800"
                aria-label="Next month"
              >
                <ChevronIcon direction="right" />
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
            {CALENDAR_WEEKDAY_LABELS.map((day) => (
              <div key={day} className="py-2">
                {day}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: 42 }, (_, index) => {
              const date = new Date(
                monthGridStart.getFullYear(),
                monthGridStart.getMonth(),
                monthGridStart.getDate() + index
              );
              const iso = formatIsoDate(date);
              const inCurrentMonth = date.getMonth() === monthStart.getMonth();
              const disabled =
                (typeof min === "string" && iso < min) ||
                (typeof max === "string" && iso > max);
              const selected = isSameDay(date, selectedDate);
              const isToday = isSameDay(date, new Date());

              return (
                <button
                  key={iso}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    onChange(iso);
                    setOpen(false);
                  }}
                  className={[
                    "flex h-10 items-center justify-center rounded-xl text-sm font-medium transition",
                    selected
                      ? "bg-slate-950 text-white shadow-[0_10px_24px_rgba(15,23,42,0.22)] dark:bg-emerald-400 dark:text-slate-950"
                      : disabled
                        ? "cursor-not-allowed text-slate-300 dark:text-slate-700"
                        : inCurrentMonth
                          ? "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                          : "text-slate-400 hover:bg-slate-100 dark:text-slate-500 dark:hover:bg-slate-800",
                    isToday && !selected
                      ? "border border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10"
                      : "",
                  ].join(" ")}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-3 dark:border-slate-700">
            <button
              type="button"
              onClick={() => {
                const todayIso = formatIsoDate(new Date());
                const target =
                  minDate && min && todayIso < min ? minDate : new Date();
                const normalized = startOfMonth(target);
                setVisibleMonth(normalized);
                const iso = formatIsoDate(target);

                if (
                  (!min || iso >= min) &&
                  (!max || iso <= max)
                ) {
                  onChange(iso);
                  setOpen(false);
                }
              }}
              className="text-sm font-semibold text-emerald-700 transition hover:text-emerald-800 dark:text-emerald-300 dark:hover:text-emerald-200"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-sm font-semibold text-slate-500 transition hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function buildFormState(
  initialInput?: Partial<TripInput>,
  minimumDate = getTodayIsoDate()
): FormState {
  const promptTravelerCount =
    extractPromptTravelerCount(initialInput?.tripPrompt ?? "") ?? undefined;
  const initialPromptBudget = extractPromptBudget(initialInput?.tripPrompt ?? "");
  const promptDerivedBudgetPerTraveler =
    initialPromptBudget?.scope === "per_traveler"
      ? initialPromptBudget.amount
      : initialPromptBudget?.scope === "group_total" &&
          typeof (promptTravelerCount ?? initialInput?.travelerCount) === "number" &&
          (promptTravelerCount ?? initialInput?.travelerCount)! > 0
        ? clampNumber(
            Math.max(
              1,
              Math.round(
                initialPromptBudget.amount /
                  (promptTravelerCount ?? initialInput?.travelerCount ?? 2)
              )
            ),
            50,
            5000
          )
        : undefined;
  const tripStartDate = clampTripStartDate(
    initialInput?.tripStartDate,
    minimumDate
  );
  const requestedTripEndDate =
    initialInput?.tripEndDate ??
    deriveTripEndDate(tripStartDate, initialInput?.tripLengthDays ?? 2);
  const tripEndDate =
    clampTripEndDate(requestedTripEndDate, tripStartDate, 7) ?? tripStartDate;

  return {
    ...DEFAULT_FORM,
    startCity: isStartCity(initialInput?.startCity)
      ? initialInput.startCity
      : DEFAULT_FORM.startCity,
    travelerCount: String(promptTravelerCount ?? initialInput?.travelerCount ?? 2),
    budgetPerTraveler:
      typeof initialInput?.budgetPerTraveler === "number" &&
      initialInput.budgetPerTraveler !== promptDerivedBudgetPerTraveler
        ? String(initialInput.budgetPerTraveler)
        : "",
    maxDriveHours:
      typeof initialInput?.maxDriveHours === "number"
        ? String(initialInput.maxDriveHours)
        : "",
    tripPrompt: initialInput?.tripPrompt ?? "",
    tripStartDate,
    tripEndDate,
  };
}

function parsePositiveInt(value: string, fallback: number) {
  const cleaned = value.replace(/[^\d]/g, "");
  if (!cleaned) return fallback;

  const parsed = Number.parseInt(cleaned, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;

  return parsed;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(value);
}

function displayStyleLabel(style: TripStyle) {
  switch (style) {
    case "solo reset":
      return "Solo reset";
    case "hidden gems":
      return "Hidden gems";
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

function displayActivityFocusLabel(activityFocus?: ActivityFocus) {
  switch (activityFocus) {
    case "skiing":
      return "Skiing";
    case "hiking":
      return "Hiking";
    case "camping":
      return "Camping";
    default:
      return null;
  }
}

function budgetSignalLabel(options: {
  manualBudgetPerTraveler?: number;
  promptBudgetAmount?: number;
  promptBudgetScope?: "per_traveler" | "group_total";
  promptBudgetApproximate?: boolean;
  resolvedBudgetPerTraveler: number;
  travelerCount: number;
}) {
  if (typeof options.manualBudgetPerTraveler === "number") {
    return `Budget override: ${formatCurrency(options.manualBudgetPerTraveler)} each`;
  }

  if (
    typeof options.promptBudgetAmount === "number" &&
    options.promptBudgetScope === "per_traveler"
  ) {
    return `${options.promptBudgetApproximate ? "Budget from prompt: about" : "Budget from prompt:"} ${formatCurrency(options.promptBudgetAmount)} each`;
  }

  if (
    typeof options.promptBudgetAmount === "number" &&
    options.promptBudgetScope === "group_total"
  ) {
    return `${options.promptBudgetApproximate ? "Budget from prompt: about" : "Budget from prompt:"} ${formatCurrency(options.promptBudgetAmount)} total (${formatCurrency(options.resolvedBudgetPerTraveler)} each)`;
  }

  return `Budget assumption: ${formatCurrency(options.resolvedBudgetPerTraveler)} each`;
}

function hardConstraintLabels(intent: ReturnType<typeof deriveTripIntentFromPrompt>) {
  const labels: string[] = [];

  if (intent.hardConstraints.activityAnchor === "summit_hike") {
    labels.push("Hard: summit-style hike");
  } else if (intent.hardConstraints.activityAnchor === "campground_base") {
    labels.push("Hard: camping base");
  } else if (intent.hardConstraints.activityAnchor === "ski_trip") {
    labels.push("Hard: ski-focused trip");
  }

  if (intent.hardConstraints.hikeDistanceKmTarget) {
    labels.push(`Hard: about ${Math.round(intent.hardConstraints.hikeDistanceKmTarget)} km`);
  }

  if (intent.hardConstraints.requiresScenicView) {
    labels.push("Hard: scenic payoff");
  }

  if (intent.hardConstraints.requiresVegetarianOptions) {
    labels.push(
      intent.hardConstraints.mixedDietGroup
        ? "Hard: vegetarian-friendly for the group"
        : intent.hardConstraints.dietaryPreference === "vegan"
          ? "Hard: vegan-friendly food"
          : "Hard: vegetarian-friendly food"
    );
  }

  return labels;
}

function softPreferenceLabels(intent: ReturnType<typeof deriveTripIntentFromPrompt>) {
  const labels: string[] = [];

  if (intent.softPreferences.wantsGoodFood) {
    labels.push("Soft: good food");
  }

  if (intent.softPreferences.wantsGetawayFeel && !intent.includeStaycations) {
    labels.push("Soft: real getaway feel");
  }

  if (intent.softPreferences.wantsLowEffort) {
    labels.push("Soft: low-friction pacing");
  }

  if (intent.softPreferences.wantsRecoveryDays) {
    labels.push("Soft: relax on the other days");
  }

  return labels;
}

function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300"
    >
      {children}
    </label>
  );
}

function SignalPill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-800 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
      {children}
    </span>
  );
}

export default function TripForm({
  onGenerate,
  onSubmit,
  loading = false,
  initialInput,
}: Props) {
  const minTripStartDate = getTodayIsoDate();
  const [form, setForm] = useState<FormState>(() =>
    buildFormState(initialInput, minTripStartDate)
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const lastPromptTravelerCountRef = useRef<number | null>(null);
  const lastPromptStartCityRef = useRef<StartCity | null>(null);

  const derivedIntent = useMemo(
    () => deriveTripIntentFromPrompt(form.tripPrompt),
    [form.tripPrompt]
  );
  const promptBudget = useMemo(
    () => extractPromptBudget(form.tripPrompt),
    [form.tripPrompt]
  );
  const promptTravelerCount = derivedIntent.suggestedTravelerCount;
  const promptStartCity = extractPromptStartCity(form.tripPrompt);

  useEffect(() => {
    const previousPromptTravelerCount = lastPromptTravelerCountRef.current;

    if (
      typeof promptTravelerCount === "number" &&
      promptTravelerCount !== previousPromptTravelerCount &&
      form.travelerCount !== String(promptTravelerCount)
    ) {
      setForm((prev) => ({
        ...prev,
        travelerCount: String(promptTravelerCount),
      }));
    }

    if (previousPromptTravelerCount !== null && promptTravelerCount === undefined) {
      setForm((prev) => {
        if (prev.travelerCount !== String(previousPromptTravelerCount)) {
          return prev;
        }

        return {
          ...prev,
          travelerCount: DEFAULT_FORM.travelerCount,
        };
      });
    }

    lastPromptTravelerCountRef.current = promptTravelerCount ?? null;
  }, [form.travelerCount, promptTravelerCount]);

  useEffect(() => {
    const previousPromptStartCity = lastPromptStartCityRef.current;

    if (
      promptStartCity &&
      promptStartCity !== previousPromptStartCity &&
      form.startCity !== promptStartCity
    ) {
      setForm((prev) => ({
        ...prev,
        startCity: promptStartCity,
      }));
    }

    if (previousPromptStartCity && !promptStartCity) {
      setForm((prev) => {
        if (prev.startCity !== previousPromptStartCity) {
          return prev;
        }

        return {
          ...prev,
          startCity: DEFAULT_FORM.startCity,
        };
      });
    }

    lastPromptStartCityRef.current = promptStartCity ?? null;
  }, [form.startCity, promptStartCity]);

  const resolvedTravelerCount = clampNumber(
    parsePositiveInt(form.travelerCount, 2),
    1,
    12
  );
  const manualBudgetPerTraveler = form.budgetPerTraveler
    ? clampNumber(parsePositiveInt(form.budgetPerTraveler, 300), 50, 5000)
    : undefined;
  const promptBudgetPerTraveler =
    promptBudget?.scope === "per_traveler"
      ? promptBudget.amount
      : promptBudget?.scope === "group_total"
        ? clampNumber(
            Math.max(1, Math.round(promptBudget.amount / resolvedTravelerCount)),
            50,
            5000
          )
        : undefined;
  const resolvedBudgetPerTraveler = clampNumber(
    manualBudgetPerTraveler ??
      promptBudgetPerTraveler ??
      derivedIntent.suggestedBudgetPerTraveler ??
      300,
    50,
    5000
  );
  const resolvedMaxDriveHours = clampNumber(
    parsePositiveInt(form.maxDriveHours, derivedIntent.suggestedMaxDriveHours ?? 5),
    1,
    12
  );

  const totalBudget = resolvedTravelerCount * resolvedBudgetPerTraveler;
  const tripDateRange = formatDateRange(
    form.tripStartDate || undefined,
    form.tripEndDate || undefined
  );
  const trimmedTripPrompt = form.tripPrompt.trim();
  const tripPromptTooLong = trimmedTripPrompt.length > TRIP_PROMPT_MAX_CHARS;
  const maxTripEndDate =
    deriveTripEndDate(form.tripStartDate, 7) ?? form.tripStartDate;

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({
      ...prev,
      [key]: value,
    }));
  }

  function handleNumericChange(
    key: "travelerCount" | "budgetPerTraveler" | "maxDriveHours",
    value: string
  ) {
    updateField(key, value.replace(/[^\d]/g, "") as FormState[typeof key]);
  }

  function handleTripStartDateChange(value: string) {
    const tripStartDate = clampTripStartDate(value, minTripStartDate);

    setForm((prev) => {
      const tripLengthDays =
        deriveTripLengthDays(prev.tripStartDate, prev.tripEndDate) ?? 2;
      const tripEndDate =
        clampTripEndDate(
          deriveTripEndDate(tripStartDate, tripLengthDays),
          tripStartDate,
          7
        ) ?? tripStartDate;

      return {
        ...prev,
        tripStartDate,
        tripEndDate,
      };
    });
  }

  function handleTripEndDateChange(value: string) {
    updateField(
      "tripEndDate",
      (clampTripEndDate(value, form.tripStartDate, 7) ??
        form.tripStartDate) as FormState["tripEndDate"]
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!form.tripStartDate || !trimmedTripPrompt || tripPromptTooLong) {
      return;
    }

    const tripStartDate = clampTripStartDate(
      form.tripStartDate,
      minTripStartDate
    );
    const tripEndDate =
      clampTripEndDate(form.tripEndDate, tripStartDate, 7) ?? tripStartDate;
    const tripLengthDays =
      deriveTripLengthDays(tripStartDate, tripEndDate) ?? 1;
    const season = deriveSeasonFromDateRange(tripStartDate, tripEndDate);
    const departureTime =
      extractPromptDepartureTime(form.tripPrompt) ??
      (tripStartDate === minTripStartDate
        ? formatTimeInputValue(new Date())
        : undefined);

    const cleanedInput: TripInput = {
      startCity: form.startCity,
      maxDriveHours: resolvedMaxDriveHours,
      maxDriveMinutesBetweenStops: 45,
      budget: totalBudget,
      budgetPerTraveler: resolvedBudgetPerTraveler,
      travelerCount: resolvedTravelerCount,
      tripLengthDays,
      season,
      style: derivedIntent.style,
      tripPrompt: trimmedTripPrompt,
      activityFocus: derivedIntent.activityFocus,
      veganFriendly: derivedIntent.veganFriendly,
      includeStaycations: derivedIntent.includeStaycations,
      strictBudget: derivedIntent.strictBudget,
      preferredDestination: derivedIntent.preferredDestination,
      tripStartDate,
      tripEndDate,
      departureTime,
    };

    const submitHandler = onGenerate ?? onSubmit;

    if (typeof submitHandler !== "function") {
      console.error("TripForm requires an onGenerate or onSubmit prop.");
      return;
    }

    await submitHandler(cleanedInput);
  }

  return (
    <section className="w-full">
      <form onSubmit={handleSubmit} className="space-y-7">
        <DestinationShowcase />

        <div className="rounded-[1.9rem] border border-slate-200 bg-white p-5 shadow-[0_12px_32px_rgba(15,23,42,0.05)] dark:border-slate-700/80 dark:bg-slate-900">
          <div className="grid gap-4 md:grid-cols-4">
            <div>
              <FieldLabel htmlFor="startCity">Starting city</FieldLabel>
              <select
                id="startCity"
                value={form.startCity}
                onChange={(event) =>
                  updateField("startCity", event.target.value as StartCity)
                }
                className="h-12 w-full rounded-[1.25rem] border border-slate-300 bg-white px-4 text-slate-950 shadow-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-slate-700"
              >
                {START_CITY_OPTIONS.map((city) => (
                  <option key={city} value={city}>
                    {city}
                  </option>
                ))}
              </select>
            </div>

            <DatePickerField
              id="tripStartDate"
              label="Start date"
              min={minTripStartDate}
              value={form.tripStartDate}
              onChange={handleTripStartDateChange}
            />

            <DatePickerField
              id="tripEndDate"
              label="End date"
              min={form.tripStartDate}
              max={maxTripEndDate}
              value={form.tripEndDate}
              onChange={handleTripEndDateChange}
            />

            <div>
              <FieldLabel htmlFor="travelerCount">How many people</FieldLabel>
              <input
                id="travelerCount"
                inputMode="numeric"
                pattern="[0-9]*"
                type="text"
                value={form.travelerCount}
                onChange={(event) =>
                  handleNumericChange("travelerCount", event.target.value)
                }
                className="h-12 w-full rounded-[1.25rem] border border-slate-300 bg-white px-4 text-slate-950 shadow-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-slate-700"
              />
            </div>
          </div>
        </div>

        <div className="rounded-[1.9rem] border border-slate-200 bg-white p-5 shadow-[0_12px_32px_rgba(15,23,42,0.05)] dark:border-slate-700/80 dark:bg-slate-900">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <FieldLabel htmlFor="tripPrompt">What do you want from this trip?</FieldLabel>
              <p className="mb-3 max-w-3xl text-sm leading-6 text-slate-700 dark:text-slate-300">
                Describe the kind of trip people would actually say yes to.
                Mention the vibe, pace, food, scenery, or any destination you
                already have in mind.
              </p>
            </div>
            <SignalPill>
              {tripDateRange ?? "Flexible dates"}
            </SignalPill>
          </div>

          <textarea
            id="tripPrompt"
            required
            minLength={8}
            maxLength={TRIP_PROMPT_MAX_CHARS}
            value={form.tripPrompt}
            onChange={(event) => updateField("tripPrompt", event.target.value)}
            placeholder="Example: We want a low-effort mountain trip with good coffee, one scenic hike, and enough payoff that four of us would actually commit to going."
            className="min-h-[170px] w-full rounded-[1.55rem] border border-slate-300 bg-white px-5 py-4 text-sm leading-7 text-slate-950 shadow-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-slate-700"
          />

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p
              className={
                tripPromptTooLong
                  ? "text-xs font-medium text-rose-700 dark:text-rose-300"
                  : "text-xs text-slate-500 dark:text-slate-400"
              }
            >
              {tripPromptTooLong
                ? getPromptLimitError("Trip prompt", TRIP_PROMPT_MAX_CHARS)
                : "Keep the brief focused so the planner can parse it cleanly."}
            </p>
            <p
              className={
                tripPromptTooLong
                  ? "text-xs font-semibold text-rose-700 dark:text-rose-300"
                  : "text-xs text-slate-500 dark:text-slate-400"
              }
            >
              {trimmedTripPrompt.length}/{TRIP_PROMPT_MAX_CHARS}
            </p>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {hardConstraintLabels(derivedIntent).map((label) => (
              <SignalPill key={label}>{label}</SignalPill>
            ))}
            <SignalPill>Style: {displayStyleLabel(derivedIntent.style)}</SignalPill>
            {displayActivityFocusLabel(derivedIntent.activityFocus) ? (
              <SignalPill>
                Activity: {displayActivityFocusLabel(derivedIntent.activityFocus)}
              </SignalPill>
            ) : null}
            {derivedIntent.preferredDestination ? (
              <SignalPill>
                Destination signal: {derivedIntent.preferredDestination}
              </SignalPill>
            ) : null}
            <SignalPill>
              Drive assumption: up to {resolvedMaxDriveHours}h
            </SignalPill>
            <SignalPill>
              {budgetSignalLabel({
                manualBudgetPerTraveler,
                promptBudgetAmount: promptBudget?.amount,
                promptBudgetScope: promptBudget?.scope,
                promptBudgetApproximate: promptBudget?.approximate,
                resolvedBudgetPerTraveler,
                travelerCount: resolvedTravelerCount,
              })}
            </SignalPill>
            <SignalPill>Starts from {form.startCity}</SignalPill>
            <SignalPill>Local trips allowed</SignalPill>
            {softPreferenceLabels(derivedIntent).map((label) => (
              <SignalPill key={label}>{label}</SignalPill>
            ))}
          </div>
        </div>

        <div className="rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-[0_10px_28px_rgba(15,23,42,0.04)] dark:border-slate-700 dark:bg-slate-900">
          <button
            type="button"
            onClick={() => setAdvancedOpen((current) => !current)}
            className="flex w-full items-center justify-between gap-3 text-left"
          >
            <div>
              <div className="text-sm font-semibold text-slate-950 dark:text-slate-100">
                Optional planning assumptions
              </div>
              <p className="mt-1 text-sm leading-6 text-slate-700 dark:text-slate-300">
                Only open this if you want to override the prompt-led budget or
                drive assumptions.
              </p>
            </div>
            <span className="inline-flex h-10 items-center justify-center rounded-full border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
              {advancedOpen ? "Hide" : "Edit"}
            </span>
          </button>

          {advancedOpen ? (
            <div className="mt-4 grid gap-4 border-t border-slate-200 pt-4 dark:border-slate-700 md:grid-cols-2">
              <div>
                <FieldLabel htmlFor="maxDriveHours">Max drive hours</FieldLabel>
                <input
                  id="maxDriveHours"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  type="text"
                  value={form.maxDriveHours}
                  onChange={(event) =>
                    handleNumericChange("maxDriveHours", event.target.value)
                  }
                  placeholder={`Auto: ${resolvedMaxDriveHours}`}
                  className="h-12 w-full rounded-[1.25rem] border border-slate-300 bg-white px-4 text-slate-950 shadow-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-slate-700"
                />
              </div>

              <div>
                <FieldLabel htmlFor="budgetPerTraveler">Budget per traveler</FieldLabel>
                <input
                  id="budgetPerTraveler"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  type="text"
                  value={form.budgetPerTraveler}
                  onChange={(event) =>
                    handleNumericChange("budgetPerTraveler", event.target.value)
                  }
                  placeholder={
                    promptBudget
                      ? `Prompt: ${resolvedBudgetPerTraveler}`
                      : `Auto: ${resolvedBudgetPerTraveler}`
                  }
                  className="h-12 w-full rounded-[1.25rem] border border-slate-300 bg-white px-4 text-slate-950 shadow-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-slate-700"
                />
              </div>
            </div>
          ) : null}
        </div>

        <div className="overflow-hidden rounded-[1.9rem] border border-slate-200 bg-white px-5 py-5 shadow-[0_12px_32px_rgba(15,23,42,0.05)] dark:border-slate-700 dark:bg-slate-900">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-950 dark:text-slate-100">
                Estimated target budget: {formatCurrency(totalBudget)}
              </div>
              <p className="mt-1 text-sm leading-6 text-slate-700 dark:text-slate-300">
                Based on {resolvedTravelerCount} traveler
                {resolvedTravelerCount === 1 ? "" : "s"} at{" "}
                {formatCurrency(resolvedBudgetPerTraveler)} each.
                {promptBudget?.scope === "group_total"
                  ? ` That comes from ${formatCurrency(promptBudget.amount)} total in your brief.`
                  : promptBudget?.scope === "per_traveler"
                    ? " That comes from the budget written in your brief."
                    : ""}
                {" "}You will get one trip recommendation, then you can swap stops day by day in the builder.
              </p>
            </div>

            <button
              type="submit"
              disabled={
                loading ||
                !form.tripStartDate ||
                !trimmedTripPrompt ||
                tripPromptTooLong
              }
              className="inline-flex h-12 items-center justify-center rounded-2xl bg-slate-900 px-6 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-white"
            >
              {loading ? "Building your trip..." : "Build my trip"}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
