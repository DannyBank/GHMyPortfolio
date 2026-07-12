// Shared helper for proxying requests to the GSE-API (dev.kwayisi.org).
//
// Why this exists: the frontend used to call dev.kwayisi.org directly from
// the browser. That API is a free, unauthenticated hobby project with no
// SLA — it's known to rate-limit / block whole IP ranges (including mobile
// carrier NAT pools) without warning, and calling it straight from the
// browser meant those failures were invisible in Vercel's logs (the request
// never touched Vercel's servers at all).
//
// Routing it through a Vercel serverless function fixes both problems:
//  - the outbound request now comes from Vercel's infrastructure, not the
//    visitor's phone/carrier IP
//  - failures/timeouts/retries are logged here, so they show up in the
//    Vercel dashboard's Runtime Logs
//  - we can cache the last good response at the edge so a flaky upstream
//    doesn't mean a broken button

const UPSTREAM_BASE = "https://dev.kwayisi.org/apis/gse";
const TIMEOUT_MS = 5000;
const MAX_ATTEMPTS = 2; // 1 retry on network/timeout failure

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches `path` (e.g. "/live" or "/live/GCB") from the upstream GSE-API,
 * retrying once on network-level failure (timeout, DNS, connection reset).
 * Does NOT retry on HTTP error responses (404, 429, etc.) — those are
 * passed straight through since retrying won't help.
 */
export async function fetchFromGse(path) {
  const url = `${UPSTREAM_BASE}${path}`;
  let lastErr;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const upstreamRes = await fetchWithTimeout(url, TIMEOUT_MS);
      const text = await upstreamRes.text();

      let body;
      try {
        body = JSON.parse(text);
      } catch {
        // Upstream returned non-JSON (HTML error page, empty body, etc.)
        body = null;
      }

      return { ok: upstreamRes.ok, status: upstreamRes.status, body, raw: text };
    } catch (err) {
      lastErr = err;
      console.error(`[gse-proxy] attempt ${attempt} failed for ${url}:`, err.message);
      // small backoff before retrying
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 400));
    }
  }

  // All attempts failed at the network level (no HTTP response at all)
  const isTimeout = lastErr?.name === "AbortError";
  return {
    ok: false,
    status: isTimeout ? 504 : 502,
    body: null,
    networkError: true,
    message: isTimeout
      ? `Timed out waiting for GSE-API after ${TIMEOUT_MS}ms`
      : `Could not reach GSE-API: ${lastErr?.message || "unknown error"}`,
  };
}

export function applyCacheHeaders(res) {
  // Serve slightly-stale data instantly while revalidating in the
  // background, rather than making every visitor wait on the upstream API.
  res.setHeader("Cache-Control", "public, s-maxage=20, stale-while-revalidate=90");
}
