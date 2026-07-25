import { fetchFromGse, applyCacheHeaders } from "../_gseProxy.js";
import { scrapeGseMonitor } from "../_gseScraper.js";

// GET /api/gse-live
// Proxies GET https://dev.kwayisi.org/apis/gse/live, falling back to scraping
// gsemonitor.com/market-movers if the primary API fails or times out.
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: `Method ${req.method} not allowed` });
    return;
  }

  const result = await fetchFromGse("/live");

  if (result.ok) {
    applyCacheHeaders(res);
    res.setHeader("X-Data-Source", "gse-api");
    res.status(200).json(result.body);
    return;
  }

  console.error("[gse-live] primary API failed:", result.status, result.message || result.raw);
  console.error("[gse-live] falling back to gsemonitor.com scrape…");

  try {
    const rows = await scrapeGseMonitor();
    console.log(`[gse-live] scrape fallback succeeded: ${rows.length} rows`);
    applyCacheHeaders(res);
    res.setHeader("X-Data-Source", "gsemonitor-scrape");
    res.status(200).json(rows);
  } catch (scrapeErr) {
    console.error("[gse-live] scrape fallback also failed:", scrapeErr.message);
    res.status(result.status).json({
      error: true,
      message:
        `Both the GSE-API and the gsemonitor.com fallback failed. ` +
        `API: ${result.message || `status ${result.status}`}. Scrape: ${scrapeErr.message}`,
    });
  }
}
