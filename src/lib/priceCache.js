// Shared cache for the live GSE price snapshot.
//
// The upstream GSE-API (dev.kwayisi.org) is a free, unauthenticated hobby
// project with tight, undocumented rate limits. Every part of the app that
// wants "the current price of a stock" must reuse the ONE snapshot fetched
// by the "Fetch Live Prices" button rather than making its own network
// request — otherwise multiple screens hitting the endpoint independently
// is exactly what trips the throttle.
//
// This module also persists the snapshot to localStorage so a page reload
// doesn't silently drop the cache and tempt some other part of the app into
// firing off its own fetch to refill it.

const STORAGE_KEY = "gse_live_snapshot_v1";

/**
 * Reads the last cached snapshot (survives page reloads).
 * Returns { items, fetchedAt } or null if nothing has been cached yet.
 */
export function loadCachedSnapshot() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.items) || !parsed?.fetchedAt) return null;
    return { items: parsed.items, fetchedAt: new Date(parsed.fetchedAt) };
  } catch {
    return null;
  }
}

/**
 * Persists a snapshot ({ items, fetchedAt: Date }) so it survives reloads.
 */
export function saveCachedSnapshot(snapshot) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        items: snapshot.items,
        fetchedAt: snapshot.fetchedAt.toISOString(),
      })
    );
  } catch {
    // localStorage can throw in private-browsing/quota-exceeded situations —
    // the in-memory copy still works for the current session either way.
  }
}

/**
 * Looks up a single symbol's row inside an already-fetched snapshot.
 * Never touches the network — returns null if the symbol isn't in the
 * cached snapshot (e.g. it hasn't been fetched yet, or is misspelled).
 */
export function findCachedPrice(snapshot, symbol) {
  if (!snapshot?.items || !symbol) return null;
  const sym = symbol.trim().toUpperCase();
  return snapshot.items.find((item) => item.name?.toUpperCase() === sym) || null;
}
