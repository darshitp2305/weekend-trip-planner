"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  buildConversationalDraft,
  buildTripInputFromDraft,
  ConversationalAnswers,
  extractPromptTiming,
  getNextIntakeQuestion,
  getQuestionCopy,
  getRetryCopy,
  IntakeQuestionField,
  parseFollowUpAnswer,
} from "../lib/conversationalPlanner";
import {
  getPromptLimitError,
  TRIP_PROMPT_MAX_CHARS,
} from "../lib/promptLimits";
import { StartCity, START_CITY_OPTIONS } from "../lib/startCities";
import { formatDisplayDate, getTodayIsoDate } from "../lib/tripDates";
import { ActivityFocus, TripInput, TripStyle } from "../lib/types";

type Props = {
  onGenerate?: (input: TripInput) => Promise<void> | void;
  onSubmit?: (input: TripInput) => Promise<void> | void;
  loading?: boolean;
  initialInput?: Partial<TripInput>;
};

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
};

type CalendarDatePickerProps = {
  value?: string;
  minDate: string;
  disabled?: boolean;
  onChange: (nextDate?: string) => void;
};

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const MONTH_LABEL_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  month: "long",
  year: "numeric",
});

function formatIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseIsoDate(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const [year, month, day] = value
    .split("-")
    .map((part) => Number.parseInt(part, 10));
  const date = new Date(year, month - 1, day);

  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function isSameDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function buildCalendarDays(visibleMonth: Date) {
  const monthStart = startOfMonth(visibleMonth);
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - monthStart.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);

    return {
      date,
      iso: formatIsoDate(date),
      inCurrentMonth: date.getMonth() === visibleMonth.getMonth(),
    };
  });
}

function CalendarIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <rect x="3" y="4.5" width="18" height="16.5" rx="3.5" />
      <path d="M3 9.5h18" />
    </svg>
  );
}

function ChevronIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 4 6 6-6 6" />
    </svg>
  );
}

function CalendarDatePicker({
  value,
  minDate,
  disabled = false,
  onChange,
}: CalendarDatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const minimumDate = parseIsoDate(minDate) ?? new Date();
  const selectedDate = parseIsoDate(value);
  const [visibleMonth, setVisibleMonth] = useState(() =>
    startOfMonth(selectedDate ?? minimumDate)
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (
        containerRef.current &&
        event.target instanceof Node &&
        !containerRef.current.contains(event.target)
      ) {
        setIsOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  const today = parseIsoDate(getTodayIsoDate()) ?? new Date();
  const minimumMonth = startOfMonth(minimumDate);
  const canGoToPreviousMonth =
    visibleMonth.getFullYear() > minimumMonth.getFullYear() ||
    (visibleMonth.getFullYear() === minimumMonth.getFullYear() &&
      visibleMonth.getMonth() > minimumMonth.getMonth());
  const calendarDays = buildCalendarDays(visibleMonth);
  const triggerLabel = value ? formatDisplayDate(value) ?? value : "Choose exact date";
  const helperLabel = value
    ? "Selected date"
    : "Optional if you want a specific day";

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => {
          if (!disabled) {
            if (!isOpen) {
              setVisibleMonth(startOfMonth(selectedDate ?? minimumDate));
            }

            setIsOpen((current) => !current);
          }
        }}
        disabled={disabled}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        className="group inline-flex h-12 min-w-[15rem] items-center justify-between gap-3 rounded-full border border-[#d9b57c]/28 bg-[linear-gradient(180deg,rgba(255,252,246,0.94),rgba(247,242,233,0.96))] px-4 text-left text-sm font-medium text-slate-800 shadow-[0_12px_32px_rgba(148,163,184,0.14)] transition hover:-translate-y-0.5 hover:border-[#d9b57c]/44 hover:shadow-[0_18px_40px_rgba(148,163,184,0.18)] focus:outline-none focus:ring-2 focus:ring-[#d9b57c]/18 disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#7decc7]/18 dark:bg-[linear-gradient(180deg,rgba(16,24,39,0.94),rgba(10,17,29,0.98))] dark:text-slate-100 dark:shadow-[0_16px_40px_rgba(2,6,23,0.26)] dark:hover:border-[#7decc7]/30 dark:hover:shadow-[0_20px_48px_rgba(2,6,23,0.34)] dark:focus:ring-[#7decc7]/14"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[radial-gradient(circle_at_top,rgba(217,181,124,0.3),rgba(217,181,124,0.14))] text-[#8a5b18] dark:bg-[radial-gradient(circle_at_top,rgba(125,236,199,0.2),rgba(125,236,199,0.08))] dark:text-[#b6f4db]">
            <CalendarIcon className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-semibold">{triggerLabel}</span>
            <span className="block truncate text-[11px] uppercase tracking-[0.16em] text-slate-500 dark:text-white/42">
              {helperLabel}
            </span>
          </span>
        </span>
        <ChevronIcon
          className={`h-4 w-4 shrink-0 text-slate-500 transition duration-200 dark:text-white/48 ${
            isOpen ? "rotate-90" : ""
          }`}
        />
      </button>

      {isOpen ? (
        <div
          role="dialog"
          aria-label="Trip date calendar"
          className="absolute bottom-[calc(100%+0.75rem)] right-0 z-30 w-[21rem] max-w-[calc(100vw-2.5rem)] rounded-[1.55rem] border border-slate-200/85 bg-[linear-gradient(180deg,rgba(255,255,255,0.97),rgba(241,246,251,0.98))] p-4 shadow-[0_30px_90px_rgba(148,163,184,0.24)] backdrop-blur-xl dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(14,22,37,0.98),rgba(8,14,24,0.96))] dark:shadow-[0_34px_110px_rgba(2,6,23,0.42)]"
        >
          <div className="rounded-[1.2rem] border border-slate-200/80 bg-[radial-gradient(circle_at_top_left,rgba(125,236,199,0.14),transparent_42%),radial-gradient(circle_at_top_right,rgba(217,181,124,0.16),transparent_46%),linear-gradient(180deg,rgba(255,255,255,0.88),rgba(247,242,234,0.76))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] dark:border-white/8 dark:bg-[radial-gradient(circle_at_top_left,rgba(125,236,199,0.08),transparent_40%),radial-gradient(circle_at_top_right,rgba(217,181,124,0.12),transparent_44%),linear-gradient(180deg,rgba(17,26,42,0.82),rgba(10,16,28,0.9))] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#0f766e] dark:text-[#7decc7]">
                  Exact trip date
                </p>
                <h3 className="mt-2 text-[1.15rem] font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">
                  {MONTH_LABEL_FORMATTER.format(visibleMonth)}
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setVisibleMonth((current) => addMonths(current, -1))}
                  disabled={!canGoToPreviousMonth}
                  aria-label="Previous month"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200/80 bg-white/86 text-slate-600 transition hover:border-slate-300 hover:bg-white hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-35 dark:border-white/10 dark:bg-white/6 dark:text-slate-300 dark:hover:border-white/16 dark:hover:bg-white/10 dark:hover:text-white"
                >
                  <ChevronIcon className="h-4 w-4 rotate-180" />
                </button>
                <button
                  type="button"
                  onClick={() => setVisibleMonth((current) => addMonths(current, 1))}
                  aria-label="Next month"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200/80 bg-white/86 text-slate-600 transition hover:border-slate-300 hover:bg-white hover:text-slate-950 dark:border-white/10 dark:bg-white/6 dark:text-slate-300 dark:hover:border-white/16 dark:hover:bg-white/10 dark:hover:text-white"
                >
                  <ChevronIcon className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-7 gap-2 text-center">
              {WEEKDAY_LABELS.map((label) => (
                <div
                  key={label}
                  className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-white/42"
                >
                  {label}
                </div>
              ))}

              {calendarDays.map(({ date, iso, inCurrentMonth }) => {
                const isDisabled = iso < minDate;
                const isSelected = Boolean(selectedDate && isSameDay(date, selectedDate));
                const isToday = isSameDay(date, today);

                let dayClasses =
                  "inline-flex h-10 w-10 items-center justify-center rounded-[1rem] border text-sm font-semibold transition";

                if (isSelected) {
                  dayClasses +=
                    " border-slate-950 bg-slate-950 text-white shadow-[0_14px_28px_rgba(15,23,42,0.18)] dark:border-white dark:bg-white dark:text-slate-950 dark:shadow-[0_14px_30px_rgba(255,255,255,0.08)]";
                } else if (isDisabled) {
                  dayClasses +=
                    " border-transparent text-slate-300/80 opacity-60 dark:text-slate-600/70";
                } else if (isToday) {
                  dayClasses +=
                    " border-[#d9b57c]/50 bg-[#fff6e7]/88 text-[#8a5b18] hover:bg-[#fff1d8] dark:border-[#d9b57c]/28 dark:bg-[#d9b57c]/14 dark:text-[#f4d8b1] dark:hover:bg-[#d9b57c]/20";
                } else if (inCurrentMonth) {
                  dayClasses +=
                    " border-transparent bg-white/72 text-slate-700 hover:border-slate-200 hover:bg-white hover:text-slate-950 dark:bg-white/[0.04] dark:text-slate-200 dark:hover:border-white/14 dark:hover:bg-white/10 dark:hover:text-white";
                } else {
                  dayClasses +=
                    " border-transparent bg-transparent text-slate-400 hover:bg-white/70 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-white/6 dark:hover:text-slate-300";
                }

                return (
                  <button
                    key={iso}
                    type="button"
                    onClick={() => {
                      if (!isDisabled) {
                        onChange(iso);
                        setIsOpen(false);
                      }
                    }}
                    disabled={isDisabled}
                    aria-pressed={isSelected}
                    className={dayClasses}
                  >
                    {date.getDate()}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-200/80 pt-4 dark:border-white/8">
              <button
                type="button"
                onClick={() => {
                  onChange(undefined);
                  setIsOpen(false);
                }}
                className="inline-flex h-10 items-center justify-center rounded-full border border-slate-200/80 bg-white/86 px-4 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:bg-white hover:text-slate-950 dark:border-white/10 dark:bg-white/6 dark:text-slate-300 dark:hover:border-white/16 dark:hover:bg-white/10 dark:hover:text-white"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => {
                  const todayIso = formatIsoDate(today);
                  const nextDate = todayIso < minDate ? minDate : todayIso;
                  onChange(nextDate);
                  setVisibleMonth(startOfMonth(parseIsoDate(nextDate) ?? minimumDate));
                  setIsOpen(false);
                }}
                className="inline-flex h-10 items-center justify-center rounded-full bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-[#f5efe5]"
              >
                Today
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
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
      return "Food-led";
    case "outdoors":
      return "Outdoors";
    case "adventure":
      return "Adventure";
    case "chill":
      return "Slow and easy";
    default:
      return style;
  }
}

function displayActivityLabel(activityFocus?: ActivityFocus) {
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

function buildSeedAnswers(initialInput?: Partial<TripInput>): ConversationalAnswers {
  const answers: ConversationalAnswers = {};

  if (
    typeof initialInput?.travelerCount === "number" &&
    initialInput.travelerCount >= 1
  ) {
    answers.travelerCount = initialInput.travelerCount;
  }

  if (typeof initialInput?.tripLengthDays === "number") {
    answers.tripLengthDays = initialInput.tripLengthDays;
  }

  if (typeof initialInput?.season === "string") {
    if (
      initialInput.season === "Spring" ||
      initialInput.season === "Summer" ||
      initialInput.season === "Fall" ||
      initialInput.season === "Winter"
    ) {
      answers.season = initialInput.season;
    }
  }

  if (typeof initialInput?.tripStartDate === "string") {
    answers.tripStartDate = initialInput.tripStartDate;
  }

  if (typeof initialInput?.startCity === "string") {
    answers.startCity = initialInput.startCity as StartCity;
  }

  if (
    typeof initialInput?.budgetPerTraveler === "number" &&
    Number.isFinite(initialInput.budgetPerTraveler) &&
    initialInput.budgetPerTraveler >= 75
  ) {
    answers.budgetPerTraveler = Math.round(initialInput.budgetPerTraveler);
  }

  return answers;
}

function buildAssumptionPills(draft: ReturnType<typeof buildConversationalDraft>) {
  const pills: string[] = [];

  if (draft.startCity) {
    pills.push(`Starting from ${draft.startCity}`);
  }

  if (draft.travelerCount) {
    pills.push(
      `${draft.travelerCount} traveler${draft.travelerCount === 1 ? "" : "s"}`
    );
  }

  if (draft.tripLengthDays) {
    pills.push(`${draft.tripLengthDays} day${draft.tripLengthDays === 1 ? "" : "s"}`);
  }

  if (draft.season) {
    pills.push(draft.season);
  }

  pills.push(displayStyleLabel(draft.intent.style));

  const activityLabel = displayActivityLabel(draft.intent.activityFocus);
  if (activityLabel) {
    pills.push(activityLabel);
  }

  if (draft.intent.preferredDestination) {
    pills.push(draft.intent.preferredDestination);
  }

  if (draft.hasExplicitBudget) {
    pills.push(`Budget target ${formatCurrency(draft.budgetPerTraveler)} each`);
  }
  pills.push(`Drive up to ${draft.maxDriveHours}h`);

  return pills;
}

function nextComposerPlaceholder(field: IntakeQuestionField | null) {
  switch (field) {
    case "travelerCount":
      return "Example: 4 people";
    case "startCity":
      return "Example: Calgary";
    case "tripTiming":
      return "Example: this summer, or pick a date below";
    case "tripLengthDays":
      return "Example: 3 days";
    case "budgetPerTraveler":
      return "Example: $300 each";
    default:
      return "Describe the Alberta trip you want to take";
  }
}

function normalizeStartCityQuery(value: string) {
  return value.trim().toLocaleLowerCase();
}

export default function TripForm({
  onGenerate,
  onSubmit,
  loading = false,
  initialInput,
}: Props) {
  const [prompt, setPrompt] = useState(initialInput?.tripPrompt ?? "");
  const [composerValue, setComposerValue] = useState(initialInput?.tripPrompt ?? "");
  const [answers, setAnswers] = useState<ConversationalAnswers>(() =>
    buildSeedAnswers(initialInput)
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingField, setPendingField] = useState<IntakeQuestionField | null>(null);
  const [mode, setMode] = useState<"prompt" | "followup">("prompt");
  const [errorMessage, setErrorMessage] = useState("");
  const [isStartCityInputFocused, setIsStartCityInputFocused] = useState(false);
  const [activeStartCityIndex, setActiveStartCityIndex] = useState(0);
  const messageIdRef = useRef(0);
  const chatViewportRef = useRef<HTMLDivElement | null>(null);
  const startCityInputRef = useRef<HTMLInputElement | null>(null);
  const startCityListboxId = useId();

  const previewPrompt = mode === "prompt" ? composerValue : prompt;
  const draft = buildConversationalDraft(previewPrompt, answers);
  const trimmedComposerValue = composerValue.trim();
  const tripPromptTooLong = trimmedComposerValue.length > TRIP_PROMPT_MAX_CHARS;
  const submitHandler = onGenerate ?? onSubmit;
  const isTripTimingQuestion = mode === "followup" && pendingField === "tripTiming";
  const isStartCityQuestion = mode === "followup" && pendingField === "startCity";
  const selectedCalendarDate = isTripTimingQuestion
    ? extractPromptTiming(composerValue).tripStartDate ?? ""
    : "";
  const minimumTripDate = getTodayIsoDate();
  const shouldShowAssumptionPills =
    mode === "followup" || messages.length > 0 || trimmedComposerValue.length > 0;
  const normalizedStartCityQuery = normalizeStartCityQuery(composerValue);
  const filteredStartCities = START_CITY_OPTIONS.filter((city) =>
    normalizeStartCityQuery(city).includes(normalizedStartCityQuery)
  );
  const hasExactStartCityMatch = START_CITY_OPTIONS.some(
    (city) => normalizeStartCityQuery(city) === normalizedStartCityQuery
  );
  const shouldShowStartCitySuggestions =
    isStartCityQuestion &&
    isStartCityInputFocused &&
    filteredStartCities.length > 0 &&
    !hasExactStartCityMatch;
  const highlightedStartCityIndex = Math.min(
    activeStartCityIndex,
    Math.max(filteredStartCities.length - 1, 0)
  );

  function nextMessageId(prefix: string) {
    messageIdRef.current += 1;
    return `${prefix}-${messageIdRef.current}`;
  }

  useEffect(() => {
    if (!chatViewportRef.current || messages.length === 0) {
      return;
    }

    chatViewportRef.current.scrollTop = chatViewportRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (!isStartCityQuestion || loading) {
      return;
    }

    startCityInputRef.current?.focus();
  }, [isStartCityQuestion, loading]);

  async function handleResolvedDraft(
    resolvedDraft: ReturnType<typeof buildConversationalDraft>,
    nextMessages: ChatMessage[]
  ) {
    const input = buildTripInputFromDraft(resolvedDraft);
    if (!input) {
      return;
    }

    setMessages([
        ...nextMessages,
        {
          id: nextMessageId("assistant-ready"),
          role: "assistant",
          text: "Perfect. Building your Alberta trip now.",
        },
    ]);

    if (typeof submitHandler === "function") {
      await submitHandler(input);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (loading || !submitHandler) {
      return;
    }

    setErrorMessage("");

    if (mode === "prompt") {
      if (!trimmedComposerValue) {
        setErrorMessage("Start with the kind of Alberta trip you want.");
        return;
      }

      if (tripPromptTooLong) {
        setErrorMessage(
          getPromptLimitError("Trip prompt", TRIP_PROMPT_MAX_CHARS)
        );
        return;
      }

      const nextPrompt = trimmedComposerValue;
      const nextDraft = buildConversationalDraft(nextPrompt, answers);
      const nextQuestion = getNextIntakeQuestion(nextDraft);
      const initialMessages: ChatMessage[] = [
        {
          id: nextMessageId("user-prompt"),
          role: "user",
          text: nextPrompt,
        },
      ];

      setPrompt(nextPrompt);

      if (nextQuestion) {
        setMode("followup");
        setPendingField(nextQuestion);
        setComposerValue("");
        setIsStartCityInputFocused(false);
        setActiveStartCityIndex(0);
        setMessages([
          ...initialMessages,
          {
            id: nextMessageId("assistant-question"),
            role: "assistant",
            text: getQuestionCopy(nextQuestion),
          },
        ]);
        return;
      }

      setPendingField(null);
      setMode("followup");
      setComposerValue("");
      setIsStartCityInputFocused(false);
      setActiveStartCityIndex(0);
      await handleResolvedDraft(nextDraft, initialMessages);
      return;
    }

    if (!pendingField || !trimmedComposerValue) {
      setErrorMessage("Reply to the question so I can finish the plan.");
      return;
    }

    const parsedAnswer = parseFollowUpAnswer(
      pendingField,
      trimmedComposerValue,
      new Date(),
      draft
    );
    const userMessage: ChatMessage = {
      id: nextMessageId("user-answer"),
      role: "user",
      text: trimmedComposerValue,
    };

    if (!parsedAnswer) {
      setMessages((current) => [
        ...current,
        userMessage,
        {
          id: `assistant-retry-${Date.now()}`,
          role: "assistant",
          text: getRetryCopy(pendingField),
        },
      ]);
      setComposerValue("");
      setIsStartCityInputFocused(false);
      setActiveStartCityIndex(0);
      return;
    }

    const nextAnswers = { ...answers, ...parsedAnswer };
    const nextDraft = buildConversationalDraft(prompt, nextAnswers);
    const nextQuestion = getNextIntakeQuestion(nextDraft);
    const nextMessages = [...messages, userMessage];

    setAnswers(nextAnswers);
    setComposerValue("");

    if (nextQuestion) {
      setPendingField(nextQuestion);
      setIsStartCityInputFocused(false);
      setActiveStartCityIndex(0);
      setMessages([
        ...nextMessages,
        {
          id: nextMessageId("assistant-question"),
          role: "assistant",
          text: getQuestionCopy(nextQuestion),
        },
      ]);
      return;
    }

    setPendingField(null);
    setIsStartCityInputFocused(false);
    setActiveStartCityIndex(0);
    await handleResolvedDraft(nextDraft, nextMessages);
  }

  function handleComposerKeyDown(
    event: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>
  ) {
    if (isStartCityQuestion) {
      if (event.key === "ArrowDown" && filteredStartCities.length > 0) {
        event.preventDefault();
        setIsStartCityInputFocused(true);
        setActiveStartCityIndex((current) =>
          current >= filteredStartCities.length - 1 ? 0 : current + 1
        );
        return;
      }

      if (event.key === "ArrowUp" && filteredStartCities.length > 0) {
        event.preventDefault();
        setIsStartCityInputFocused(true);
        setActiveStartCityIndex((current) =>
          current <= 0 ? filteredStartCities.length - 1 : current - 1
        );
        return;
      }

      if (event.key === "Escape") {
        setIsStartCityInputFocused(false);
        setActiveStartCityIndex(0);
        return;
      }

      if (
        event.key === "Enter" &&
        shouldShowStartCitySuggestions &&
        filteredStartCities[highlightedStartCityIndex]
      ) {
        event.preventDefault();
        setComposerValue(filteredStartCities[highlightedStartCityIndex]);
        setErrorMessage("");
        setIsStartCityInputFocused(false);
        return;
      }
    }

    if (event.key !== "Enter" || event.nativeEvent.isComposing) {
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      return;
    }

    event.preventDefault();

    if (loading || !submitHandler || tripPromptTooLong) {
      return;
    }

    event.currentTarget.form?.requestSubmit();
  }

  function handleTripDateChange(nextDate?: string) {
    setComposerValue(nextDate ? formatDisplayDate(nextDate) ?? nextDate : "");
    setErrorMessage("");
  }

  function handleStartCitySelect(city: StartCity) {
    setComposerValue(city);
    setErrorMessage("");
    setIsStartCityInputFocused(false);
  }

  const assumptionPills = buildAssumptionPills(draft);

  return (
    <section className="w-full rounded-[2rem] border border-slate-200/70 bg-[linear-gradient(180deg,rgba(247,244,238,0.82),rgba(241,245,249,0.76))] p-5 text-slate-950 shadow-[0_28px_70px_rgba(148,163,184,0.14)] backdrop-blur-lg sm:p-7 dark:border-white/12 dark:bg-[linear-gradient(180deg,rgba(8,14,22,0.78),rgba(10,18,29,0.54))] dark:text-white dark:shadow-[0_32px_90px_rgba(0,0,0,0.28)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-white sm:text-[2rem]">
            Tell me the trip you actually want.
          </h2>
        </div>
        <div className="rounded-full border border-slate-200/70 bg-[#fbf7ef]/76 px-4 py-2 text-xs font-medium text-slate-700 dark:border-white/12 dark:bg-white/8 dark:text-white/72">
          I&apos;ll ask for anything important that&apos;s missing.
        </div>
      </div>

      {shouldShowAssumptionPills ? (
        <div className="mt-6 flex flex-wrap gap-2">
          {assumptionPills.slice(0, 6).map((pill) => (
            <span
              key={pill}
              className="inline-flex items-center rounded-full border border-slate-200/70 bg-[#fbf7ef]/76 px-3 py-1.5 text-xs font-medium text-slate-800 dark:border-white/12 dark:bg-white/8 dark:text-white/84"
            >
              {pill}
            </span>
          ))}
        </div>
      ) : null}

      {messages.length > 0 ? (
        <div className="mt-6 rounded-[1.6rem] border border-slate-200/70 bg-[#fbf7ef]/72 p-4 dark:border-white/10 dark:bg-black/12">
          <div
            ref={chatViewportRef}
            className="max-h-[18rem] space-y-3 overflow-y-auto pr-1"
          >
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${
                  message.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[92%] rounded-[1.35rem] px-4 py-3 text-sm leading-6 sm:max-w-[80%] ${
                    message.role === "user"
                      ? "bg-slate-950 text-white dark:bg-white dark:text-slate-950"
                      : "border border-slate-200/70 bg-[#fbf7ef]/82 text-slate-800 dark:border-white/10 dark:bg-white/8 dark:text-white/88"
                  }`}
                >
                  {message.text}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-6 rounded-[1.6rem] border border-slate-200/70 bg-[#fbf7ef]/72 p-4 text-sm leading-6 text-slate-700 dark:border-white/10 dark:bg-black/12 dark:text-white/74">
          Try something like: &quot;Plan a low-effort mountain trip from Edmonton
          with good coffee, one scenic hike, and enough payoff that four friends
          would actually commit.&quot;
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        <div className="rounded-[1.7rem] border border-slate-200/70 bg-[#f7f3eb]/82 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] dark:border-white/14 dark:bg-white/10 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
          {isStartCityQuestion ? (
            <>
              <div className="relative">
                <input
                  ref={startCityInputRef}
                  type="text"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={shouldShowStartCitySuggestions}
                  aria-controls={
                    shouldShowStartCitySuggestions ? startCityListboxId : undefined
                  }
                  aria-activedescendant={
                    shouldShowStartCitySuggestions
                      ? `${startCityListboxId}-option-${highlightedStartCityIndex}`
                      : undefined
                  }
                  value={composerValue}
                  onChange={(event) => {
                    setComposerValue(event.target.value);
                    setErrorMessage("");
                    setIsStartCityInputFocused(true);
                    setActiveStartCityIndex(0);
                  }}
                  onFocus={() => setIsStartCityInputFocused(true)}
                  onBlur={() => {
                    window.setTimeout(() => setIsStartCityInputFocused(false), 120);
                  }}
                  onKeyDown={handleComposerKeyDown}
                  placeholder={nextComposerPlaceholder(pendingField)}
                  disabled={loading}
                  autoComplete="off"
                  className="h-16 w-full border-0 bg-transparent px-2 text-[15px] leading-7 text-slate-950 placeholder:text-slate-500 focus:outline-none dark:text-white dark:placeholder:text-white/42"
                />

                {shouldShowStartCitySuggestions ? (
                  <div className="px-2 pb-2">
                    <div className="overflow-hidden rounded-[1.35rem] border border-[#d9b57c]/30 bg-[linear-gradient(180deg,rgba(255,252,246,0.98),rgba(247,242,233,0.96))] shadow-[0_18px_42px_rgba(15,23,42,0.1)] dark:border-[#7decc7]/16 dark:bg-[linear-gradient(180deg,rgba(11,18,29,0.96),rgba(7,13,24,0.98))] dark:shadow-[0_24px_48px_rgba(2,6,23,0.4)]">
                      <div className="border-b border-slate-200/70 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-500 dark:border-white/8 dark:text-white/40">
                        Starting city
                      </div>
                      <div
                        id={startCityListboxId}
                        role="listbox"
                        aria-label="Suggested Alberta departure cities"
                        className="max-h-60 overflow-y-auto p-2"
                      >
                        {filteredStartCities.map((city, index) => {
                          const isActive = index === highlightedStartCityIndex;

                          return (
                            <button
                              key={city}
                              id={`${startCityListboxId}-option-${index}`}
                              type="button"
                              role="option"
                              aria-selected={isActive}
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => handleStartCitySelect(city)}
                              onMouseEnter={() => setActiveStartCityIndex(index)}
                              className={`flex w-full items-center justify-between rounded-[1rem] px-3 py-3 text-left text-[15px] font-medium transition ${
                                isActive
                                  ? "bg-slate-950 text-white shadow-[0_10px_24px_rgba(15,23,42,0.16)] dark:bg-[linear-gradient(135deg,rgba(125,236,199,0.18),rgba(59,130,246,0.18))] dark:text-white dark:shadow-[0_12px_28px_rgba(2,6,23,0.34)]"
                                  : "text-slate-700 hover:bg-white/80 hover:text-slate-950 dark:text-white/78 dark:hover:bg-white/8 dark:hover:text-white"
                              }`}
                            >
                              <span>{city}</span>
                              {isActive ? (
                                <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/72 dark:text-[#b2f6df]">
                                  Enter
                                </span>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <textarea
              value={composerValue}
              onChange={(event) => setComposerValue(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder={nextComposerPlaceholder(pendingField)}
              disabled={loading}
              className={`w-full resize-none border-0 bg-transparent px-2 text-[15px] leading-7 text-slate-950 placeholder:text-slate-500 focus:outline-none dark:text-white dark:placeholder:text-white/42 ${
                mode === "prompt" ? "min-h-[150px]" : "min-h-[88px]"
              }`}
            />
          )}
          {isTripTimingQuestion ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[1.2rem] border border-slate-200/80 bg-white/70 px-4 py-3 dark:border-white/10 dark:bg-slate-950/35">
              <div className="space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600 dark:text-white/56">
                  Pick an exact date
                </p>
                <p className="text-xs text-slate-600 dark:text-white/60">
                  Opens a themed calendar and still lets people type a month or season.
                </p>
              </div>
              <CalendarDatePicker
                value={selectedCalendarDate}
                minDate={minimumTripDate}
                disabled={loading}
                onChange={handleTripDateChange}
              />
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-2 pt-3 dark:border-white/10">
            <div className="text-xs text-slate-700 dark:text-white/58">
              {mode === "prompt"
                ? "Start with the full idea. I’ll ask one follow-up at a time if I need it."
                : "Reply naturally. Short answers are fine."}
            </div>
            <div className="text-xs font-medium text-slate-600 dark:text-white/52">
              {trimmedComposerValue.length}/{TRIP_PROMPT_MAX_CHARS}
            </div>
          </div>
        </div>

        {errorMessage ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-300/24 dark:bg-rose-400/10 dark:text-rose-100">
            {errorMessage}
          </div>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm font-medium leading-6 text-slate-700 dark:text-white/70">
            {draft.intent.preferredDestination
              ? `Destination signal detected: ${draft.intent.preferredDestination}.`
              : "The planner will infer style and driving tolerance, then ask for any missing trip facts."}
          </div>
          <button
            type="submit"
            disabled={loading || !submitHandler || tripPromptTooLong}
            className="inline-flex h-12 items-center justify-center rounded-full bg-slate-950 px-6 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-950 dark:hover:bg-[#f5efe5]"
          >
            {loading
              ? "Building your trip..."
              : mode === "prompt"
                ? "Plan my trip"
                : "Send answer"}
          </button>
        </div>
      </form>
    </section>
  );
}
