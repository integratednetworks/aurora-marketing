"use client";

import { useMemo, useRef, useState } from "react";
import { PRESETS, finvizUrl, type FinvizPreset } from "@/app/finviz-watchlist/presets";

// Finviz → TradingView watchlist converter.
//
// Two ways in: fetch a known screen straight from Finviz, or paste whatever
// you've copied off the screen yourself (an Elite CSV, or a plain list of
// tickers). Both feed the same cleaner, which de-duplicates and formats a
// single comma-separated line ready for a TradingView import .txt.

// ---- ticker extraction --------------------------------------------------

type Extracted = { ticker: string; exchange: string };

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        q = !q;
      }
    } else if (ch === "," && !q) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function isTicker(t: string): boolean {
  return /^[A-Z]{1,6}([.\-][A-Z]{1,4})?$/.test(t);
}

function extract(text: string): Extracted[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  // CSV path: look for a header row naming a Ticker/Symbol column.
  let headerIdx = -1;
  let tCol = -1;
  let eCol = -1;
  for (let i = 0; i < Math.min(lines.length, 3); i++) {
    const cells = splitCsvLine(lines[i]);
    let tc = -1;
    let ec = -1;
    cells.forEach((cell, j) => {
      const h = cell.toLowerCase();
      if (tc === -1 && (h === "ticker" || h === "symbol")) tc = j;
      if (ec === -1 && h === "exchange") ec = j;
    });
    if (tc !== -1) {
      headerIdx = i;
      tCol = tc;
      eCol = ec;
      break;
    }
  }

  const res: Extracted[] = [];
  if (headerIdx !== -1) {
    for (let r = headerIdx + 1; r < lines.length; r++) {
      const row = splitCsvLine(lines[r]);
      if (row.length <= tCol) continue;
      const tk = (row[tCol] || "").toUpperCase();
      if (!tk) continue;
      const ex = eCol !== -1 && row[eCol] ? row[eCol].toUpperCase() : "";
      res.push({ ticker: tk, exchange: ex });
    }
  } else {
    // Free text: pull every ticker-shaped token.
    text
      .toUpperCase()
      .split(/[^A-Z.\-]+/)
      .forEach((tok) => {
        if (tok && isTicker(tok)) res.push({ ticker: tok, exchange: "" });
      });
  }
  return res;
}

// ---- component ----------------------------------------------------------

const labelCls =
  "block text-xs font-bold uppercase tracking-[0.18em] mb-2";

export default function FinvizWatchlist() {
  const [raw, setRaw] = useState("");
  const [usePrefix, setUsePrefix] = useState(false);
  const [prefix, setPrefix] = useState("NASDAQ");
  const [activePreset, setActivePreset] = useState<string>(PRESETS[0].id);
  const [fetching, setFetching] = useState(false);
  const [fetchMsg, setFetchMsg] = useState<string | null>(null);
  const [fetchErr, setFetchErr] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const preset = useMemo<FinvizPreset>(
    () => PRESETS.find((p) => p.id === activePreset) ?? PRESETS[0],
    [activePreset],
  );

  const { list, count, dups } = useMemo(() => {
    const raws = extract(raw);
    const seen = new Set<string>();
    const clean: Extracted[] = [];
    let d = 0;
    for (const item of raws) {
      if (seen.has(item.ticker)) {
        d++;
        continue;
      }
      seen.add(item.ticker);
      clean.push(item);
    }
    const pfx = prefix.trim().toUpperCase().replace(/:$/, "");
    const formatted = clean.map((item) => {
      if (item.exchange) return `${item.exchange}:${item.ticker}`;
      if (usePrefix && pfx) return `${pfx}:${item.ticker}`;
      return item.ticker;
    });
    return { list: formatted.join(","), count: clean.length, dups: d };
  }, [raw, usePrefix, prefix]);

  function showFlash(msg: string) {
    setFlash(msg);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 1600);
  }

  async function handleFetch() {
    setFetching(true);
    setFetchErr(null);
    setFetchMsg(null);
    try {
      const res = await fetch(`/api/finviz?preset=${preset.id}`);
      const data = await res.json();
      if (!data.ok) {
        setFetchErr(data.error || "Fetch failed. Try the paste box below.");
        return;
      }
      const tickers: string[] = data.tickers || [];
      setRaw(tickers.join(", "));
      let msg = `Pulled ${data.count} tickers from the ${preset.label} screen.`;
      if (data.truncated) msg += " Capped at the first 600 or so.";
      if (data.partial && data.warning) msg += ` (${data.warning})`;
      setFetchMsg(msg);
    } catch {
      setFetchErr("Couldn't reach the fetcher. Use the paste box below.");
    } finally {
      setFetching(false);
    }
  }

  function handleCopy() {
    if (!list) return;
    const done = () => showFlash("Copied");
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(list).then(done, fallbackCopy);
    } else {
      fallbackCopy();
    }
  }

  function fallbackCopy() {
    const ta = document.createElement("textarea");
    ta.value = list;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      showFlash("Copied");
    } catch {
      showFlash("Copy failed — select and copy manually");
    }
    document.body.removeChild(ta);
  }

  function handleDownload() {
    if (!list) return;
    const blob = new Blob([list], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${preset.id}-watchlist.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showFlash("Downloaded");
  }

  const inputStyle = {
    background: "var(--bg-deep)",
    borderColor: "var(--border)",
  } as const;

  return (
    <div
      className="rounded-3xl p-6 sm:p-8 border"
      style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
    >
      {/* Step 1 — choose a screen */}
      <div className="mb-8">
        <span className={labelCls} style={{ color: "var(--text-3)" }}>
          1 · Choose a screen
        </span>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => {
            const active = p.id === activePreset;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setActivePreset(p.id);
                  setFetchMsg(null);
                  setFetchErr(null);
                }}
                className="rounded-full px-4 py-2 text-sm font-semibold border transition"
                style={{
                  background: active
                    ? "linear-gradient(90deg, rgba(34,211,238,0.2), rgba(236,72,153,0.2))"
                    : "transparent",
                  borderColor: active ? "var(--accent-cyan)" : "var(--border)",
                  color: active ? "#fff" : "var(--text-2)",
                }}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <p
          className="mt-3 text-sm leading-relaxed"
          style={{ color: "var(--text-3)" }}
        >
          {preset.blurb}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleFetch}
            disabled={fetching}
            className="btn-aurora rounded-xl px-5 py-2.5 text-sm disabled:opacity-50"
          >
            {fetching ? "Fetching…" : `Fetch ${preset.label} from Finviz`}
          </button>
          <a
            href={finvizUrl(preset.filter)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-semibold underline-offset-2 hover:underline"
            style={{ color: "var(--accent-cyan)" }}
          >
            Open the screen in Finviz ↗
          </a>
        </div>

        {fetchMsg && (
          <p className="mt-3 text-sm" style={{ color: "var(--accent-emerald)" }}>
            {fetchMsg}
          </p>
        )}
        {fetchErr && (
          <p className="mt-3 text-sm" style={{ color: "var(--accent-rose)" }}>
            {fetchErr}
          </p>
        )}
        <p className="mt-3 text-xs leading-relaxed" style={{ color: "var(--text-3)" }}>
          Auto-fetch reads the free Finviz screen directly. If it's ever rate-limited
          or down, copy the tickers off the screen and paste them below instead.
        </p>
      </div>

      {/* Step 2 — paste / review */}
      <div className="mb-8">
        <span className={labelCls} style={{ color: "var(--text-3)" }}>
          2 · Paste or edit tickers
        </span>
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="Fetched tickers land here. Or paste your own — an Elite CSV (keep the header row), or a plain list like AAPL, MSFT, NVDA."
          className="w-full rounded-xl px-4 py-3 text-white border font-mono text-sm leading-relaxed"
          style={{ ...inputStyle, minHeight: "150px", resize: "vertical" }}
        />

        <div className="mt-4 flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: "var(--text-2)" }}>
            <input
              type="checkbox"
              checked={usePrefix}
              onChange={(e) => setUsePrefix(e.target.checked)}
              className="w-4 h-4 accent-cyan-400"
            />
            Add an exchange prefix
          </label>
          <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text-3)" }}>
            <input
              type="text"
              value={prefix}
              disabled={!usePrefix}
              maxLength={12}
              spellCheck={false}
              onChange={(e) => setPrefix(e.target.value)}
              className="w-28 rounded-lg px-3 py-1.5 text-white border uppercase font-mono text-sm disabled:opacity-40"
              style={inputStyle}
            />
            <span>applied to all</span>
          </div>
        </div>
        <p className="mt-2 text-xs leading-relaxed" style={{ color: "var(--text-3)" }}>
          Leave the prefix off unless a few tickers come up blank in TradingView. These
          screens mix NYSE and NASDAQ, so one prefix won't fit the whole list.
        </p>
      </div>

      {/* Step 3 — output */}
      <div>
        <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
          <span className={labelCls + " mb-0"} style={{ color: "var(--text-3)" }}>
            3 · Ready for TradingView
          </span>
          <span className="font-mono text-sm" style={{ color: "var(--text-3)" }}>
            <span
              className="text-base font-bold"
              style={{
                background: "linear-gradient(90deg,#22d3ee,#ec4899 60%,#a78bfa)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              {count}
            </span>{" "}
            tickers
            {dups > 0 && ` · ${dups} duplicate${dups > 1 ? "s" : ""} removed`}
          </span>
        </div>
        <div
          className="w-full rounded-xl px-4 py-3 border font-mono text-sm leading-relaxed break-words whitespace-pre-wrap"
          style={{
            background: count ? "rgba(34,211,238,0.06)" : "var(--bg-deep)",
            borderColor: count ? "var(--border-cyan)" : "var(--border)",
            color: count ? "var(--text-1)" : "var(--text-3)",
            minHeight: "84px",
          }}
        >
          {count ? list : "Your formatted list will appear here."}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleCopy}
            disabled={!count}
            className="btn-aurora rounded-xl px-5 py-2.5 text-sm disabled:opacity-40"
          >
            Copy list
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={!count}
            className="rounded-xl px-5 py-2.5 text-sm font-semibold border disabled:opacity-40"
            style={{ background: "transparent", borderColor: "var(--border)", color: "var(--text-1)" }}
          >
            Download .txt
          </button>
          {flash && (
            <span className="font-mono text-sm" style={{ color: "var(--accent-cyan)" }}>
              {flash}
            </span>
          )}
        </div>

        {/* How to import */}
        <div
          className="mt-8 rounded-2xl p-5 border"
          style={{ background: "var(--bg-deep)", borderColor: "var(--border)" }}
        >
          <p className="text-xs font-bold uppercase tracking-[0.18em] mb-2" style={{ color: "var(--text-3)" }}>
            Getting it into TradingView
          </p>
          <p className="text-sm leading-relaxed" style={{ color: "var(--text-2)" }}>
            Open your watchlist, click the name at the top of the right-hand panel, choose{" "}
            <strong>Import list</strong> (sometimes shown as “Upload list”), and pick the{" "}
            <code className="font-mono" style={{ color: "var(--accent-cyan)" }}>.txt</code>{" "}
            you download here. Importing a list needs a paid TradingView plan; on the free
            plan you may have to add symbols one at a time.
          </p>
        </div>
      </div>
    </div>
  );
}
