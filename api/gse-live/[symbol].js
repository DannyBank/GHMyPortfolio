import { fetchFromGse, applyCacheHeaders } from "../_gseProxy.js";

// GET /api/gse-live/:symbol
// Proxies GET https://dev.kwayisi.org/apis/gse/live/{symbol}
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

  const result = await fetchFromGse(`/live/${encodeURIComponent(symbol.trim().toUpperCase())}`);

  if (!result.ok) {
    if (result.status === 404) {
      res.status(404).json({ error: true, message: `Symbol "${symbol}" not found on GSE.` });
      return;
    }
    console.error(`[gse-live/${symbol}] upstream failure:`, result.status, result.message || result.raw);
    res.status(result.status).json({
      error: true,
      message:
        result.message ||
        `GSE-API returned ${result.status}. It may be rate-limiting or temporarily blocking this request.`,
    });
    return;
  }

  applyCacheHeaders(res);
  res.status(200).json(result.body);
}
