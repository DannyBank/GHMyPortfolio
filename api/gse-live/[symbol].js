import { fetchFromGse, applyCacheHeaders } from "../_gseProxy.js";
import { scrapeGseMonitor } from "../_gseScraper.js";

// GET /api/gse-live/:symbol
// Proxies GET https://dev.kwayisi.org/apis/gse/live/{symbol}, falling back to
// scraping gsemonitor.com/market-movers (and filtering for this symbol) if
// the primary API fails or times out.
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

  const result = await fetchFromGse(`/live/${encodeURIComponent(sym)}`);

  if (result.ok) {
    applyCacheHeaders(res);
    res.setHeader("X-Data-Source", "gse-api");
    res.status(200).json(result.body);
    return;
  }

  if (result.status === 404) {
    // A real "symbol doesn't exist" response — no point falling back for this one.
    res.status(404).json({ error: true, message: `Symbol "${symbol}" not found on GSE.` });
    return;
  }

  console.error(`[gse-live/${sym}] primary API failed:`, result.status, result.message || result.raw);
  console.error(`[gse-live/${sym}] falling back to gsemonitor.com scrape…`);

  try {
    const rows = await scrapeGseMonitor();
    const hit = rows.find(r => r.name === sym);
    if (!hit) {
      res.status(404).json({ error: true, message: `Symbol "${symbol}" not found on GSE (checked API and gsemonitor.com fallback).` });
      return;
    }
    console.log(`[gse-live/${sym}] scrape fallback succeeded`);
    applyCacheHeaders(res);
    res.setHeader("X-Data-Source", "gsemonitor-scrape");
    res.status(200).json(hit);
  } catch (scrapeErr) {
    console.error(`[gse-live/${sym}] scrape fallback also failed:`, scrapeErr.message);
    res.status(result.status).json({
      error: true,
      message:
        `Both the GSE-API and the gsemonitor.com fallback failed. ` +
        `API: ${result.message || `status ${result.status}`}. Scrape: ${scrapeErr.message}`,
    });
  }
}
