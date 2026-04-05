import Link from "next/link";
import BrandLogo from "./BrandLogo";

type SocialLink = {
  name: string;
  href: string;
  icon: React.ReactNode;
};

function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
      <rect
        x="3.5"
        y="3.5"
        width="17"
        height="17"
        rx="5"
        className="stroke-current"
        strokeWidth="1.8"
      />
      <circle cx="12" cy="12" r="4.1" className="stroke-current" strokeWidth="1.8" />
      <circle cx="17.3" cy="6.8" r="1.1" className="fill-current" />
    </svg>
  );
}

function TikTokIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
      <path d="M14.9 3c.4 2 1.6 3.3 3.7 3.6v2.8c-1.5 0-2.8-.4-3.9-1.2v6.2c0 3.1-2.1 5.6-5.4 5.6-2.9 0-5.3-2.2-5.3-5.1 0-3.1 2.5-5.3 5.8-5.3.4 0 .8 0 1.1.1v2.9a3.7 3.7 0 0 0-1.1-.2c-1.5 0-2.8.9-2.8 2.5 0 1.4 1.1 2.4 2.5 2.4 1.8 0 2.7-1.2 2.7-3V3h2.7Z" />
    </svg>
  );
}

function YouTubeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
      <path d="M21.4 7.2a2.8 2.8 0 0 0-2-2C17.6 4.7 12 4.7 12 4.7s-5.6 0-7.4.5a2.8 2.8 0 0 0-2 2A29.5 29.5 0 0 0 2 12a29.5 29.5 0 0 0 .6 4.8 2.8 2.8 0 0 0 2 2c1.8.5 7.4.5 7.4.5s5.6 0 7.4-.5a2.8 2.8 0 0 0 2-2A29.5 29.5 0 0 0 22 12a29.5 29.5 0 0 0-.6-4.8ZM10.2 15.6V8.4l6.2 3.6-6.2 3.6Z" />
    </svg>
  );
}

const SOCIAL_LINKS: SocialLink[] = [
  {
    name: "Instagram",
    href: "https://www.instagram.com/trippify.ca/",
    icon: <InstagramIcon />,
  },
  {
    name: "TikTok",
    href: "https://www.tiktok.com/@trippify.ca",
    icon: <TikTokIcon />,
  },
  {
    name: "YouTube",
    href: "https://www.youtube.com/@Trippify-ca",
    icon: <YouTubeIcon />,
  },
];

const POLICY_LINKS = [
  { name: "Privacy Policy", href: "/privacy" },
  { name: "Terms & Conditions", href: "/terms" },
];

export default function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="relative mt-8 px-4 pb-6 pt-18 sm:px-6 sm:pt-22 lg:px-8">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-[linear-gradient(180deg,rgba(232,238,245,0),rgba(232,238,245,0.55)_34%,rgba(232,238,245,0.92)_100%)] dark:bg-[linear-gradient(180deg,rgba(2,6,23,0),rgba(4,10,20,0.46)_34%,rgba(6,11,19,0.82)_100%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-8 h-24 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.28),transparent_68%)] opacity-70 blur-2xl dark:bg-[radial-gradient(circle_at_center,rgba(125,236,199,0.08),transparent_72%)] dark:opacity-100"
      />
      <div className="relative mx-auto max-w-7xl overflow-hidden rounded-[2.25rem] border border-slate-200/65 bg-[linear-gradient(180deg,rgba(255,255,255,0.72),rgba(242,246,251,0.86))] px-6 py-8 shadow-[0_20px_65px_rgba(148,163,184,0.1)] backdrop-blur-xl dark:border-white/8 dark:bg-[linear-gradient(180deg,rgba(9,14,25,0.74),rgba(6,10,18,0.9))] dark:shadow-[0_20px_65px_rgba(0,0,0,0.2)] sm:px-8 sm:py-10">
        <div className="grid gap-10 lg:grid-cols-[1.3fr_0.8fr_0.8fr]">
          <div className="space-y-4">
            <BrandLogo href="/" tone="auto" />
            <p className="max-w-xl text-sm leading-7 text-slate-600 dark:text-slate-300">
              Trip planning for Alberta weekends, scenic escapes, and better short
              getaways. Built to help travelers move from idea to a trip they can
              actually trust and book.
            </p>
          </div>

          <div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-900 dark:text-white">
              Follow
            </h2>
            <div className="mt-4 flex flex-col gap-3">
              {SOCIAL_LINKS.map((link) => (
                <a
                  key={link.name}
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-3 text-sm font-medium text-slate-700 transition hover:text-[#0c8f69] dark:text-slate-300 dark:hover:text-[#7decc7]"
                >
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200/80 bg-white/72 text-slate-700 shadow-[0_10px_24px_rgba(148,163,184,0.08)] dark:border-white/10 dark:bg-white/5 dark:text-slate-100 dark:shadow-none">
                    {link.icon}
                  </span>
                  <span>{link.name}</span>
                </a>
              ))}
            </div>
          </div>

          <div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-900 dark:text-white">
              Policies
            </h2>
            <div className="mt-4 flex flex-col gap-3">
              {POLICY_LINKS.map((link) => (
                <Link
                  key={link.name}
                  href={link.href}
                  className="text-sm font-medium text-slate-700 transition hover:text-[#0c8f69] dark:text-slate-300 dark:hover:text-[#7decc7]"
                >
                  {link.name}
                </Link>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-8 border-t border-slate-200/60 pt-5 text-sm text-slate-500 dark:border-white/8 dark:text-slate-400">
          <p>
            Placeholder policy pages are included for launch polish and should be
            replaced with your final legal copy before going live.
          </p>
          <p className="mt-2">&copy; {year} Trippify. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
