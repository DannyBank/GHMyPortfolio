import { fetchFromGse, applyCacheHeaders } from "../_gseProxy.js";

// GET /api/gse-live
// Proxies GET https://dev.kwayisi.org/apis/gse/live
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: `Method ${req.method} not allowed` });
    return;
  }

  const result = await fetchFromGse("/live");

  if (!result.ok) {
    console.error("[gse-live] upstream failure:", result.status, result.message || result.raw);
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
