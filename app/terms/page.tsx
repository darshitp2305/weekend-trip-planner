import Link from "next/link";
import BrandLogo from "../../components/BrandLogo";

export const metadata = {
  title: "Terms & Conditions | Trippify",
};

export default function TermsPage() {
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
                Terms & Conditions
              </h1>
              <p className="text-sm leading-7">
                This is a placeholder terms page for Trippify. Replace it with your
                final reviewed legal terms before launch.
              </p>
            </header>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-slate-950 dark:text-white">
                Use of the service
              </h2>
              <p className="leading-7">
                Users may browse, generate, save, and refine trip plans through the
                service, subject to any future product rules, availability limits, and
                account requirements you decide to publish.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-slate-950 dark:text-white">
                Planning and booking disclaimer
              </h2>
              <p className="leading-7">
                Trip ideas, pricing, availability, drive times, and attraction details
                can change. Final legal language should make clear that users are
                responsible for verifying booking, opening hours, seasonal access, and
                travel safety details before purchase or departure.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-slate-950 dark:text-white">
                Accounts and saved trips
              </h2>
              <p className="leading-7">
                If accounts or saved-trip sharing are enabled, your final terms should
                define acceptable use, ownership of submitted content, and the right to
                suspend misuse or fraudulent activity.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-slate-950 dark:text-white">
                Contact
              </h2>
              <p className="leading-7">
                Add your official legal or support contact details here before launch.
              </p>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
