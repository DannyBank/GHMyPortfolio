import { fetchFromGse, applyCacheHeaders } from "../_gseProxy.js";

// GET /api/gse-live
// Proxies GET https://dev.kwayisi.org/apis/gse/live.
//
// NOTE: this used to fall back to scraping gsemonitor.com/market-movers
// when the primary API failed. That fallback was removed — gsemonitor.com
// was rebuilt as a client-side-rendered app, so the data is no longer
// present in the server-sent HTML at all (there's nothing left to scrape).
// If the primary API is down, this now fails clearly instead of silently
// returning stale/empty data from a scraper that can't actually find rows.
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: `Method ${req.method} not allowed` });
    return;
  }

  const startedAt = Date.now();
  console.log("[gse-live] request received");

  const result = await fetchFromGse("/live");

  if (result.ok) {
    console.log(`[gse-live] success in ${Date.now() - startedAt}ms`);
    applyCacheHeaders(res);
    res.setHeader("X-Data-Source", "gse-api");
    res.status(200).json(result.body);
    return;
  }

  console.error(`[gse-live] primary API failed after ${Date.now() - startedAt}ms:`, result.status, result.message || result.raw, result.debug);
  res.status(result.status).json({
    error: true,
    message: `GSE-API is unavailable right now: ${result.message || `status ${result.status}`}`,
    debug: result.debug, // per-attempt error details — check Vercel Runtime Logs for the matching [gse-proxy:<reqId>] lines too
  });
}
