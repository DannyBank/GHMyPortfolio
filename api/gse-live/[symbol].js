import { fetchFromGse, applyCacheHeaders } from "../_gseProxy.js";

// GET /api/gse-live/:symbol
// Proxies GET https://dev.kwayisi.org/apis/gse/live/{symbol}.
//
// NOTE: this used to fall back to scraping gsemonitor.com/market-movers
// when the primary API failed. That fallback was removed — see the note in
// ./index.js for why (the site no longer server-renders any stock data).
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: `Method ${req.method} not allowed` });
    return;
  }

  const { symbol } = req.query;
  if (!symbol || !symbol.trim()) {
    res.status(400).json({ error: true, message: "Missing symbol." });
    return;
  }
  const sym = symbol.trim().toUpperCase();
  const startedAt = Date.now();
  console.log(`[gse-live/${sym}] request received`);

  const result = await fetchFromGse(`/live/${encodeURIComponent(sym)}`);

  if (result.ok) {
    console.log(`[gse-live/${sym}] success in ${Date.now() - startedAt}ms`);
    applyCacheHeaders(res);
    res.setHeader("X-Data-Source", "gse-api");
    res.status(200).json(result.body);
    return;
  }

  if (result.status === 404) {
    // A real "symbol doesn't exist" response.
    res.status(404).json({ error: true, message: `Symbol "${symbol}" not found on GSE.` });
    return;
  }

  console.error(`[gse-live/${sym}] primary API failed after ${Date.now() - startedAt}ms:`, result.status, result.message || result.raw, result.debug);
  res.status(result.status).json({
    error: true,
    message: `GSE-API is unavailable right now: ${result.message || `status ${result.status}`}`,
    debug: result.debug, // per-attempt error details — check Vercel Runtime Logs for the matching [gse-proxy:<reqId>] lines too
  });
}
