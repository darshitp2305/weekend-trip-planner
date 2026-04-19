import Link from "next/link";

type BrandTone = "auto" | "light" | "dark";

type BrandLogoProps = {
  variant?: "horizontal" | "stacked" | "icon";
  href?: string;
  className?: string;
  priority?: boolean;
  tone?: BrandTone;
};

type BrandMarkProps = {
  tone?: BrandTone;
  className?: string;
};

type ResolvedBrandTone = Exclude<BrandTone, "auto">;

function cx(...values: Array<string | undefined | false>) {
  return values.filter(Boolean).join(" ");
}

function resolveBrandPalette(tone: BrandTone) {
  if (tone === "light") {
    return {
      title: "text-slate-950",
      highlight: "text-[#0c8f69]",
      horizontalShell:
        "border-slate-800/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.16),rgba(15,23,42,0.08))] shadow-[0_14px_28px_rgba(15,23,42,0.08)] backdrop-blur-[6px]",
      markBorder: "border-slate-200/80 shadow-[0_16px_38px_rgba(148,163,184,0.16)]",
      markInner:
        "bg-[linear-gradient(160deg,rgba(255,255,255,0.96),rgba(243,237,226,0.92))]",
      ring: "border-[#d9b57c]/24",
      ringSoft: "border-[#7decc7]/26",
      peak: "fill-[#0c5a44]",
      ridge: "fill-[#d9b57c]",
      trail: "stroke-[#9b6219]",
      sun: "fill-[#3be0ab]",
    };
  }

  if (tone === "dark") {
    return {
      title: "text-white",
      highlight: "text-[#7decc7]",
      horizontalShell:
        "border-white/10 bg-[linear-gradient(180deg,rgba(10,16,27,0.8),rgba(7,12,22,0.94))] shadow-[0_18px_40px_rgba(0,0,0,0.26)] backdrop-blur-[8px]",
      markBorder: "border-white/12 shadow-[0_18px_44px_rgba(0,0,0,0.3)]",
      markInner:
        "bg-[linear-gradient(160deg,rgba(8,15,27,0.98),rgba(13,22,36,0.9))]",
      ring: "border-white/12",
      ringSoft: "border-[#7decc7]/20",
      peak: "fill-[#c7f9e4]",
      ridge: "fill-[#f2d7ab]",
      trail: "stroke-[#f2d7ab]",
      sun: "fill-[#7decc7]",
    };
  }

  return {
    title: "text-slate-950 dark:text-white",
    highlight: "text-[#0c8f69] dark:text-[#7decc7]",
    horizontalShell:
      "border-slate-800/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.16),rgba(15,23,42,0.08))] shadow-[0_14px_28px_rgba(15,23,42,0.08)] backdrop-blur-[6px] dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(10,16,27,0.8),rgba(7,12,22,0.94))] dark:shadow-[0_18px_40px_rgba(0,0,0,0.26)] dark:backdrop-blur-[8px]",
    markBorder:
      "border-slate-200/80 shadow-[0_16px_38px_rgba(148,163,184,0.16)] dark:border-white/12 dark:shadow-[0_18px_44px_rgba(0,0,0,0.3)]",
    markInner:
      "bg-[linear-gradient(160deg,rgba(255,255,255,0.96),rgba(243,237,226,0.92))] dark:bg-[linear-gradient(160deg,rgba(8,15,27,0.98),rgba(13,22,36,0.9))]",
    ring: "border-[#d9b57c]/24 dark:border-white/12",
    ringSoft: "border-[#7decc7]/26 dark:border-[#7decc7]/20",
    peak: "fill-[#0c5a44] dark:fill-[#c7f9e4]",
    ridge: "fill-[#d9b57c] dark:fill-[#f2d7ab]",
    trail: "stroke-[#9b6219] dark:stroke-[#f2d7ab]",
    sun: "fill-[#3be0ab] dark:fill-[#7decc7]",
  };
}

function renderBrandMark(
  palette: ReturnType<typeof resolveBrandPalette>,
  className?: string
) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "relative inline-flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[1.35rem] border",
        palette.markBorder,
        className
      )}
    >
      <span className="absolute inset-0 bg-[conic-gradient(from_210deg_at_50%_50%,rgba(12,90,68,0.18),rgba(125,236,199,0.72),rgba(217,181,124,0.68),rgba(12,90,68,0.18))]" />
      <span
        className={cx(
          "absolute inset-[1.5px] rounded-[calc(1.35rem-2px)]",
          palette.markInner
        )}
      />
      <span className={cx("absolute inset-[18%] rounded-[1rem] border", palette.ring)} />
      <span
        className={cx("absolute inset-[29%] rounded-[0.8rem] border", palette.ringSoft)}
      />
      <svg
        viewBox="0 0 64 64"
        className="relative z-10 h-[56%] w-[56%]"
        fill="none"
      >
        <circle cx="46" cy="15" r="5" className={palette.sun} />
        <path
          d="M10 47.5 25.5 23l8.5 10.5 7-8L54 47.5H10Z"
          className={palette.peak}
        />
        <path
          d="M23 47.5 34 32l7 7.5 6.5 8H23Z"
          className={palette.ridge}
        />
        <path
          d="M18 50c6.5-4 13-5 20-3.5 4.2.9 8.4.5 13-2"
          strokeLinecap="round"
          className={cx("stroke-[3.2]", palette.trail)}
        />
      </svg>
    </span>
  );
}

export function BrandMark({ tone = "auto", className }: BrandMarkProps) {
  if (tone === "auto") {
    return (
      <>
        <span className="inline-flex dark:hidden">
          {renderBrandMark(resolveBrandPalette("light"), className)}
        </span>
        <span className="hidden dark:inline-flex">
          {renderBrandMark(resolveBrandPalette("dark"), className)}
        </span>
      </>
    );
  }

  return renderBrandMark(resolveBrandPalette(tone), className);
}

export default function BrandLogo({
  variant = "horizontal",
  href,
  className,
  tone = "auto",
}: BrandLogoProps) {
  const isStacked = variant === "stacked";

  function renderLogoContent(resolvedTone: ResolvedBrandTone) {
    const palette = resolveBrandPalette(resolvedTone);

    if (variant === "icon") {
      return <BrandMark tone={resolvedTone} className={className} />;
    }

    return (
      <span
        className={cx(
          "group relative inline-flex transition duration-300",
          isStacked
            ? "flex-col items-center text-center"
            : "items-center gap-3.5 rounded-full border px-2.5 py-1.5",
          !isStacked && palette.horizontalShell,
          className
        )}
      >
        <BrandMark
          tone={resolvedTone}
          className={isStacked ? "h-16 w-16" : "h-12 w-12"}
        />
        <span
          className={cx("relative z-10 flex", isStacked ? "items-center" : "items-start")}
        >
          <span
            className={cx("flex flex-col", isStacked ? "items-center" : "items-start")}
          >
            {isStacked ? (
              <span className="text-[0.6rem] font-semibold uppercase tracking-[0.3em] text-[#7a4307] dark:text-[#e7c99c]">
                Canada trip studio
              </span>
            ) : null}
            <span
              className={cx(
                "font-brand font-semibold leading-none tracking-[-0.02em]",
                palette.title,
                isStacked ? "mt-2 text-[2.35rem]" : "text-[1.9rem]"
              )}
            >
              Trippi
              <span className={palette.highlight}>fy</span>
            </span>
            {isStacked ? (
              <span className="mt-1.5 text-[0.62rem] font-semibold uppercase tracking-[0.24em] text-slate-700 dark:text-white/66">
                Trail planner
              </span>
            ) : null}
          </span>
        </span>
      </span>
    );
  }

  const content =
    tone === "auto" ? (
      <>
        <span className="inline-flex dark:hidden">{renderLogoContent("light")}</span>
        <span className="hidden dark:inline-flex">{renderLogoContent("dark")}</span>
      </>
    ) : (
      renderLogoContent(tone)
    );

  if (!href) {
    return content;
  }

  return (
    <Link
      href={href}
      aria-label="Trippify home"
      className="inline-flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d9b57c]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
    >
      {content}
    </Link>
  );
}
