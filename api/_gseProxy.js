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
const TIMEOUT_MS = 8000;
const MAX_ATTEMPTS = 3; // 2 retries on network/timeout failure

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        // A plain browser-ish UA — some hosts are quicker to throttle or
        // block requests that look like a bare server-side fetch with no
        // UA at all.
        "User-Agent": "Mozilla/5.0 (compatible; GHMyPortfolio/1.0; +https://vercel.com)",
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches `path` (e.g. "/live" or "/live/GCB") from the upstream GSE-API,
 * retrying on network-level failure (timeout, DNS, connection reset).
 * Does NOT retry on HTTP error responses (404, 429, etc.) — those are
 * passed straight through since retrying won't help.
 */
export async function fetchFromGse(path) {
  const url = `${UPSTREAM_BASE}${path}`;
  const reqId = Math.random().toString(36).slice(2, 8);
  let lastErr;
  const attempts = []; // per-attempt diagnostics, also returned on failure

  console.log(`[gse-proxy:${reqId}] → GET ${url}`);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const startedAt = Date.now();
    try {
      const upstreamRes = await fetchWithTimeout(url, TIMEOUT_MS);
      const durationMs = Date.now() - startedAt;
      const text = await upstreamRes.text();

      let body;
      try {
        body = JSON.parse(text);
      } catch {
        // Upstream returned non-JSON (HTML error page, empty body, etc.)
        body = null;
      }

      console.log(
        `[gse-proxy:${reqId}] ← attempt ${attempt} responded ${upstreamRes.status} in ${durationMs}ms` +
          (body === null ? ` (non-JSON body, ${text.length} chars, starts: ${JSON.stringify(text.slice(0, 120))})` : "")
      );

      return { ok: upstreamRes.ok, status: upstreamRes.status, body, raw: text };
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      lastErr = err;
      const detail = {
        attempt,
        durationMs,
        name: err?.name,           // e.g. "AbortError", "TypeError"
        code: err?.cause?.code || err?.code, // e.g. "ECONNRESET", "ENOTFOUND", "ETIMEDOUT"
        causeMessage: err?.cause?.message,
        message: err?.message,
      };
      attempts.push(detail);
      // Full structured log line — this is the one to check in Vercel's
      // Runtime Logs (or the local terminal running `npm run dev`) to see
      // exactly what killed the request: AbortError = our own timeout
      // fired; ECONNREFUSED/ENOTFOUND/ETIMEDOUT/ECONNRESET = a real
      // network-level failure reaching dev.kwayisi.org, which is the
      // signature of the host being unreachable/blocked from this IP.
      console.error(`[gse-proxy:${reqId}] ✗ attempt ${attempt} failed after ${durationMs}ms:`, detail);
      if (err?.stack) console.error(`[gse-proxy:${reqId}] stack:`, err.stack);
      // small backoff before retrying
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }

  // All attempts failed at the network level (no HTTP response at all).
  // Note: dev.kwayisi.org has been reported by other developers to
  // consistently time out specifically from Vercel/cloud serverless IPs
  // while working fine from a regular home/office connection — if this
  // keeps happening only in production (never locally), that's likely an
  // upstream-side block rather than anything fixable in this code.
  const isTimeout = lastErr?.name === "AbortError";
  console.error(`[gse-proxy:${reqId}] all ${MAX_ATTEMPTS} attempts failed. Summary:`, attempts);

  return {
    ok: false,
    status: isTimeout ? 504 : 502,
    body: null,
    networkError: true,
    message: isTimeout
      ? `Timed out waiting for GSE-API after ${TIMEOUT_MS}ms (tried ${MAX_ATTEMPTS}x). If this only happens in production, dev.kwayisi.org may be blocking requests from this host's IP range.`
      : `Could not reach GSE-API: ${lastErr?.message || "unknown error"}`,
    // Included so the failure is diagnosable straight from the app's error
    // message / network tab, without needing to open the Vercel dashboard.
    debug: { reqId, url, attempts },
  };
}

export function applyCacheHeaders(res) {
  // Serve slightly-stale data instantly while revalidating in the
  // background, rather than making every visitor wait on the upstream API.
  res.setHeader("Cache-Control", "public, s-maxage=20, stale-while-revalidate=90");
}
