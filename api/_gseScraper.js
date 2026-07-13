// Fallback data source: scrapes gsemonitor.com/market-movers when the
// primary GSE-API (dev.kwayisi.org) is unavailable, rate-limited, or blocked.
//
// gsemonitor.com renders a plain HTML table (no JS-only rendering needed),
// so a simple fetch + cheerio parse is enough — no headless browser required.
//
// The scraped rows are mapped into the exact same shape the frontend already
// expects from the primary API ({ name, price, change, volume }), so nothing
// downstream needs to know which source actually served the data.

import * as cheerio from "cheerio";

const MARKET_MOVERS_URL = "https://gsemonitor.com/market-movers";
const SCRAPE_TIMEOUT_MS = 10000;

async function fetchHtmlWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        // A plain browser-ish UA; gsemonitor is a normal server-rendered
        // table, not gated behind bot detection as far as we've seen.
        "User-Agent": "Mozilla/5.0 (compatible; GHMyPortfolio/1.0; +https://vercel.com)",
        Accept: "text/html",
      },
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

function parseNumber(text) {
  const cleaned = String(text).replace(/[^0-9.\-]/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

/**
 * Scrapes the full market-movers table from gsemonitor.com.
 * Returns an array of { name, price, change, volume }, matching the shape
 * of dev.kwayisi.org's /apis/gse/live response.
 */
export async function scrapeGseMonitor() {
  const res = await fetchHtmlWithTimeout(MARKET_MOVERS_URL, SCRAPE_TIMEOUT_MS);
  if (!res.ok) {
    throw new Error(`gsemonitor.com returned ${res.status}`);
  }
  const html = await res.text();
  const $ = cheerio.load(html);

  const rows = [];
  $("table tbody tr").each((_, el) => {
    const tds = $(el).find("td");
    if (tds.length < 5) return; // not a data row we recognize

    const name = $(tds[0]).find("p.font-semibold").first().text().trim();
    if (!name) return;

    const price  = parseNumber($(tds[1]).text());
    const change = parseNumber($(tds[3]).text()); // "Change %" column, e.g. "-1.80%"
    const volume = parseNumber($(tds[4]).text());

    rows.push({ name: name.toUpperCase(), price, change, volume });
  });

  if (!rows.length) {
    throw new Error("Parsed 0 rows from gsemonitor.com — the page layout may have changed.");
  }
  return rows;
}
