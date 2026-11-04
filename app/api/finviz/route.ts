// Server-side Finviz fetch.
//
// Pulls a screener's results straight from Finviz so the user doesn't have to
// copy tickers page by page. Finviz's free screener shows 20 rows per page and
// has no official API, so we page through with the `r=` row offset and scrape
// the `quote.ashx?t=` links out of the Overview (v=111) HTML.
//
// Notes / deliberate choices:
//  - Runs server-side (never in the browser) so there's no CORS issue and the
//    user's IP isn't the one hitting Finviz.
//  - Hard page cap + small delay between pages to stay gentle. This is a
//    convenience layer, not a bulk harvester.
//  - This scrapes the free public screener. Finviz's terms may not allow
//    automated access, so treat this as best-effort: if it ever stops working,
//    the paste box on the tool still does the job, and Finviz Elite (export +
//    API) is the sanctioned route for automation.
//  - Returns partial results with `truncated: true` rather than failing if the
//    screen is bigger than the cap.

import { presetById, finvizUrl } from "@/app/finviz-watchlist/presets";

const PER_PAGE = 20; // Finviz free screener page size
const MAX_PAGES = 30; // safety cap (~600 names) so we never loop forever
const PAGE_DELAY_MS = 350; // be polite between requests
const PAGE_TIMEOUT_MS = 8000;

// A plain desktop browser UA. We deliberately do NOT send any personal
// identifier here.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

// A fuller set of browser-like headers. Finviz turns away requests that look
// too much like a bare bot, so we mimic a real Chrome navigation.
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-GB,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "Upgrade-Insecure-Requests": "1",
  "sec-ch-ua": '"Chromium";v="125", "Not.A/Brand";v="24", "Google Chrome";v="125"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-User": "?1",
};

const TICKER_RE = /quote\.ashx\?t=([A-Za-z0-9.\-]+)/g;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Visit the Finviz homepage first to pick up any cookies it sets, then send
// them with the screener requests. A lot of basic bot checks are satisfied
// just by arriving with a valid session cookie and a Referer.
async function primeCookies(): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);
  try {
    const res = await fetch("https://finviz.com/", {
      headers: { ...BROWSER_HEADERS, "Sec-Fetch-Site": "none" },
      signal: controller.signal,
      cache: "no-store",
    });
    // undici (Node 18+) exposes getSetCookie(); fall back to the folded header.
    const h = res.headers as Headers & { getSetCookie?: () => string[] };
    const raw = h.getSetCookie?.() ?? (res.headers.get("set-cookie") ? [res.headers.get("set-cookie") as string] : []);
    return raw
      .map((c) => c.split(";")[0])
      .filter(Boolean)
      .join("; ");
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPage(
  filter: string,
  offset: number,
  cookie: string,
): Promise<string> {
  const url = `https://finviz.com/screener.ashx?v=111&f=${filter}&o=-marketcap&r=${offset}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      ...BROWSER_HEADERS,
      Referer: "https://finviz.com/screener.ashx",
    };
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(url, {
      headers,
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Finviz returned ${res.status}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseTickers(html: string): string[] {
  const found: string[] = [];
  let m: RegExpExecArray | null;
  TICKER_RE.lastIndex = 0;
  while ((m = TICKER_RE.exec(html)) !== null) {
    found.push(m[1].toUpperCase());
  }
  return found;
}

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const presetId = searchParams.get("preset");

  // Resolve the filter: a known preset, or a raw filter string passed directly.
  let filter: string | null = null;
  if (presetId) {
    const preset = presetById(presetId);
    if (!preset) {
      return Response.json(
        { ok: false, error: `Unknown preset "${presetId}".` },
        { status: 400 },
      );
    }
    filter = preset.filter;
  } else {
    filter = searchParams.get("f");
  }

  if (!filter) {
    return Response.json(
      { ok: false, error: "No screen specified. Pass ?preset= or ?f=." },
      { status: 400 },
    );
  }

  // Light validation so we only ever forward Finviz-style filter tokens.
  if (!/^[a-z0-9_.,-]+$/i.test(filter)) {
    return Response.json(
      { ok: false, error: "That screen filter doesn't look valid." },
      { status: 400 },
    );
  }

  const seen = new Set<string>();
  const tickers: string[] = [];
  let pages = 0;
  let truncated = false;

  // Warm up a session cookie once, then reuse it across all pages.
  const cookie = await primeCookies();

  try {
    for (let i = 0; i < MAX_PAGES; i++) {
      const offset = i * PER_PAGE + 1; // Finviz rows are 1-indexed: 1, 21, 41…
      const html = await fetchPage(filter, offset, cookie);
      const pageTickers = parseTickers(html);
      pages++;

      let added = 0;
      for (const t of pageTickers) {
        if (!seen.has(t)) {
          seen.add(t);
          tickers.push(t);
          added++;
        }
      }

      // Stop when a page brings nothing new (end of results) or returns a
      // short/empty page.
      if (added === 0 || pageTickers.length < PER_PAGE) break;

      if (i === MAX_PAGES - 1) truncated = true;
      await sleep(PAGE_DELAY_MS);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Fetch failed";
    // If we got some tickers before failing, hand them back with a warning
    // rather than throwing the lot away.
    if (tickers.length > 0) {
      return Response.json(
        {
          ok: true,
          partial: true,
          warning: `Stopped early: ${message}`,
          count: tickers.length,
          pages,
          truncated,
          tickers,
        },
        { headers: { "Cache-Control": "s-maxage=900" } },
      );
    }
    return Response.json(
      {
        ok: false,
        error: `Couldn't reach Finviz (${message}). Use the paste box instead.`,
      },
      { status: 502 },
    );
  }

  return Response.json(
    {
      ok: true,
      count: tickers.length,
      pages,
      truncated,
      tickers,
      source: finvizUrl(filter),
    },
    // Cache the result at the edge for 15 min so repeated loads don't re-hit
    // Finviz. The screen only changes with the market, so this is plenty fresh.
    { headers: { "Cache-Control": "s-maxage=900, stale-while-revalidate=1800" } },
  );
}
