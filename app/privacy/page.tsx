import Link from "next/link";
import BrandLogo from "../../components/BrandLogo";

export const metadata = {
  title: "Privacy Policy | Trippify",
};

export default function PrivacyPage() {
  return (
    <main className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl">
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-white/75 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-[#0c8f69] dark:border-white/10 dark:bg-white/6 dark:text-slate-300 dark:hover:border-white/16 dark:hover:text-[#7decc7]"
        >
          <span aria-hidden="true">←</span>
          <span>Back</span>
        </Link>
        <div className="mt-6 rounded-[2rem] border border-slate-200/80 bg-white/88 p-8 shadow-[0_24px_60px_rgba(148,163,184,0.14)] backdrop-blur dark:border-white/10 dark:bg-white/5 dark:shadow-[0_24px_60px_rgba(0,0,0,0.24)] sm:p-10">
          <BrandLogo href="/" />
          <div className="mt-8 space-y-8 text-slate-700 dark:text-slate-300">
            <header className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#0c8f69] dark:text-[#7decc7]">
                Placeholder Policy
              </p>
              <h1 className="font-brand text-4xl text-slate-950 dark:text-white">
                Privacy Policy
              </h1>
              <p className="text-sm leading-7">
                This is a placeholder privacy policy for Trippify. Replace this page
                with reviewed legal language before public launch.
              </p>
            </header>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-slate-950 dark:text-white">
                Information we may collect
              </h2>
              <p className="leading-7">
                Trip inputs, saved itineraries, booking preferences, account details,
                and product usage analytics may be collected to help the planner work,
                improve recommendations, and keep saved trips available across
                sessions.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-slate-950 dark:text-white">
                How the information may be used
              </h2>
              <p className="leading-7">
                Data may be used to generate trip recommendations, personalize your
                experience, support account features, monitor product quality, and
                investigate misuse or reliability issues.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-slate-950 dark:text-white">
                Third-party services
              </h2>
              <p className="leading-7">
                Trippify may rely on mapping, travel, analytics, authentication, and
                booking partners. Final legal copy should explain which vendors are
                used, what they receive, and how users can contact you about privacy
                requests.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-slate-950 dark:text-white">
                Contact
              </h2>
              <p className="leading-7">
                Add your official support or privacy contact email here before launch.
              </p>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
