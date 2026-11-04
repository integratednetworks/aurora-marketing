import type { Metadata } from "next";
import FinvizWatchlist from "@/components/FinvizWatchlist";

export const metadata: Metadata = {
  title: "Finviz → TradingView Watchlist Tool — Aurora Growth Academy",
  description:
    "Turn a Finviz stock screen into a clean, de-duplicated ticker list, ready to import into a TradingView watchlist. Fetch a screen or paste your own — free.",
  alternates: { canonical: "/finviz-watchlist" },
  openGraph: {
    title: "Finviz → TradingView Watchlist Tool",
    description:
      "Turn a Finviz screen into a clean ticker list for TradingView — in a couple of clicks.",
    url: "/finviz-watchlist",
    siteName: "Aurora Growth Academy",
    type: "website",
  },
};

export default function FinvizWatchlistPage() {
  return (
    <section className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-16">
      <header className="mb-10 text-center">
        <p
          className="text-xs font-bold uppercase tracking-[0.18em] mb-3"
          style={{ color: "var(--accent-cyan)" }}
        >
          Free tool
        </p>
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-white leading-tight">
          Finviz <span className="aurora-text">→</span> TradingView watchlist
        </h1>
        <p
          className="mt-5 text-lg leading-relaxed mx-auto max-w-2xl"
          style={{ color: "var(--text-2)" }}
        >
          Run one of the Aurora screens, or paste your own Finviz results, and get
          a clean, de-duplicated ticker list formatted for a TradingView import.
          No sign-up, nothing to install.
        </p>
      </header>

      <FinvizWatchlist />

      <p
        className="mt-8 text-center text-xs leading-relaxed mx-auto max-w-2xl"
        style={{ color: "var(--text-3)" }}
      >
        Educational tool only. The screens are starting points for your own
        research, not recommendations to buy or sell. Aurora Growth Academy
        provides education, not financial advice.
      </p>
    </section>
  );
}
