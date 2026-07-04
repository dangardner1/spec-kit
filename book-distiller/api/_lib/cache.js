// Shared, persistent summary cache backed by Vercel KV (Upstash Redis) via its
// REST API — the same store used by the request counter. This is an L2 cache in
// front of Anthropic: popular titles get distilled once and served from KV for
// everyone after that, so the marginal API cost of a repeat view drops to ~zero.
//
// It caches the generated summary keyed by the normalized public book query —
// not anything a user typed about themselves — consistent with the privacy
// stance (and the transient-cache disclosure already in the Terms).
//
// Falls back to "not configured" when KV_REST_API_URL / KV_REST_API_TOKEN aren't
// set, so callers behave exactly as before (in-memory cache only).
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const KEY_PREFIX = "book_distiller:summary:";
const TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export function cacheConfigured() {
  return Boolean(KV_URL && KV_TOKEN);
}

// Upstash accepts a Redis command as a JSON array POSTed to the base URL. This
// keeps large JSON values in the request body rather than the URL path.
async function kvCommand(command) {
  const res = await fetch(KV_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${KV_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(command),
  });
  if (!res.ok) {
    const err = new Error(`KV request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  const body = await res.json();
  return body.result;
}

export async function getCachedSummary(key) {
  const raw = await kvCommand(["GET", KEY_PREFIX + key]);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function setCachedSummary(key, data) {
  await kvCommand(["SET", KEY_PREFIX + key, JSON.stringify(data), "EX", String(TTL_SECONDS)]);
}
