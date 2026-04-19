"use client";

/**
 * Reusable UI component for the destination showcase section of the planner.
 * Keeping this logic in its own component makes the page-level containers easier to scan and keeps related rendering and state updates together.
 */


import { useEffect, useState } from "react";
import rawDestinations from "../lib/destinationCatalog";
import { formatDisplayTag, formatDisplayText } from "../lib/displayText";
import { normalizeTripImageSet } from "../lib/tripImages";
import { RawDestination } from "../lib/types";

type ShowcaseSlide = {
  id: string;
  name: string;
  imageUrl: string;
  imageUrlLight: string;
  imageUrlDark: string;
  caption: string;
  tripTypeLabel: string;
  vibeLabel: string;
  seasonLabel: string;
};

const AUTO_ROTATE_MS = 4200;
const DESTINATION_SOURCE = rawDestinations as RawDestination[];

function joinLabels(labels: string[]) {
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

function buildCaption(destination: RawDestination) {
  const leadDescription = destination.anchor_experiences[0]?.description?.trim();
  const secondaryAnchor = destination.anchor_experiences[1]?.title?.trim();
  const firstAnchor = destination.anchor_experiences[0]?.title?.trim();
  const vibeText = joinLabels(
    destination.vibes
      .slice(0, 3)
      .map((vibe) => formatDisplayText(vibe).toLowerCase())
      .filter(Boolean)
  );

  if (leadDescription && secondaryAnchor) {
    return `${leadDescription} Pair it with ${secondaryAnchor}.`;
  }

  if (leadDescription) {
    return leadDescription;
  }

  if (firstAnchor) {
    return `Built around ${firstAnchor}${vibeText ? ` with a ${vibeText} trip feel.` : "."}`;
  }

  if (vibeText) {
    return `A ${vibeText} Canadian ${destination.is_staycation ? "staycation" : "getaway"} from the planner database.`;
  }

  return `A real Canadian place already in the planner database.`;
}

function buildTripTypeLabel(destination: RawDestination) {
  return destination.is_staycation ? "Staycation-ready" : "Road-trip pick";
}

function buildVibeLabel(destination: RawDestination) {
  const labels = destination.vibes
    .slice(0, 2)
    .map((vibe) => formatDisplayTag(vibe))
    .filter(Boolean);

  return labels.length > 0 ? labels.join(" + ") : "Trip fit";
}

function buildSeasonLabel(destination: RawDestination) {
  const labels = destination.best_seasons
    .slice(0, 2)
    .map((season) => formatDisplayTag(season))
    .filter(Boolean);

  return labels.length > 0
    ? `Best in ${joinLabels(labels)}`
    : "Good year-round";
}

function buildShowcaseSlides(): ShowcaseSlide[] {
  return DESTINATION_SOURCE.filter(
    (destination) => destination.name.trim().length > 0
  ).map((destination) => {
    const imageSet = normalizeTripImageSet(
      {
        imageUrl: destination.image_url_light ?? destination.image_url,
        imageUrlLight: destination.image_url_light ?? destination.image_url,
        imageUrlDark:
          destination.image_url_dark ??
          destination.image_url_light ??
          destination.image_url,
      },
      destination.name
    );

    return {
      id: destination.id,
      name: destination.name,
      imageUrl: imageSet.defaultUrl,
      imageUrlLight: imageSet.lightUrl,
      imageUrlDark: imageSet.darkUrl,
      caption: buildCaption(destination),
      tripTypeLabel: buildTripTypeLabel(destination),
      vibeLabel: buildVibeLabel(destination),
      seasonLabel: buildSeasonLabel(destination),
    };
  });
}

const SHOWCASE_SLIDES = buildShowcaseSlides();

export default function DestinationShowcase() {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (SHOWCASE_SLIDES.length <= 1) {
      return;
    }

    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % SHOWCASE_SLIDES.length);
    }, AUTO_ROTATE_MS);

    return () => window.clearInterval(intervalId);
  }, []);

  if (SHOWCASE_SLIDES.length === 0) {
    return null;
  }

  const currentSlide = SHOWCASE_SLIDES[activeIndex] ?? SHOWCASE_SLIDES[0];

  return (
    <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-slate-950 shadow-sm dark:border-slate-800">
      <div className="relative min-h-[320px] sm:min-h-[360px]">
        {SHOWCASE_SLIDES.map((slide, index) => (
          <div
            key={slide.id}
            aria-hidden={index !== activeIndex}
            className={`absolute inset-0 bg-cover bg-center transition-opacity duration-700 ${
              index === activeIndex ? "opacity-100" : "opacity-0"
            }`}
          >
            <div
              className="absolute inset-0 bg-cover bg-center dark:hidden"
              style={{ backgroundImage: `url("${slide.imageUrlLight}")` }}
            />
            <div
              className="absolute inset-0 hidden bg-cover bg-center dark:block"
              style={{ backgroundImage: `url("${slide.imageUrlDark}")` }}
            />
          </div>
        ))}

        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(15,23,42,0.18),rgba(15,23,42,0.74)_68%,rgba(2,6,23,0.92)_100%)]" />

        <div className="absolute inset-x-0 bottom-0 p-5 sm:p-6">
          <div className="max-w-2xl">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/72">
              Trip inspiration
            </div>
            <h3 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-[2.15rem]">
              {currentSlide.name}
            </h3>
            <p className="mt-3 max-w-xl text-sm leading-6 text-white/84 sm:text-[15px]">
              {currentSlide.caption}
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              <span className="inline-flex items-center rounded-full border border-white/14 bg-white/12 px-3 py-1.5 text-xs font-medium text-white/90 backdrop-blur-sm">
                {currentSlide.tripTypeLabel}
              </span>
              <span className="inline-flex items-center rounded-full border border-white/14 bg-white/12 px-3 py-1.5 text-xs font-medium text-white/90 backdrop-blur-sm">
                {currentSlide.vibeLabel}
              </span>
              <span className="inline-flex items-center rounded-full border border-white/14 bg-white/12 px-3 py-1.5 text-xs font-medium text-white/90 backdrop-blur-sm">
                {currentSlide.seasonLabel}
              </span>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <div className="max-w-full overflow-x-auto pb-1">
              <div className="flex min-w-max gap-2">
              {SHOWCASE_SLIDES.map((slide, index) => (
                <button
                  key={slide.id}
                  type="button"
                  aria-label={`Show ${slide.name}`}
                  aria-pressed={index === activeIndex}
                  onClick={() => setActiveIndex(index)}
                  className={`h-2.5 rounded-full transition-all ${
                    index === activeIndex
                      ? "w-10 bg-white"
                      : "w-2.5 bg-white/42 hover:bg-white/68"
                  }`}
                />
              ))}
              </div>
            </div>

            <div className="text-xs font-medium text-white/70">
              {activeIndex + 1} / {SHOWCASE_SLIDES.length}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
