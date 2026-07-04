// Global "books distilled" counter, backed by Vercel KV (Upstash Redis under
// the hood) via its plain REST API — no SDK dependency needed. Falls back to
// "not configured" when KV_REST_API_URL / KV_REST_API_TOKEN aren't set, so
// the counter just doesn't render anywhere rather than breaking anything.
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const COUNTER_KEY = "book_distiller:distill_count";

export function counterConfigured() {
  return Boolean(KV_URL && KV_TOKEN);
}

async function kvCommand(path) {
  const res = await fetch(`${KV_URL}/${path}`, {
    headers: { authorization: `Bearer ${KV_TOKEN}` },
  });
  if (!res.ok) {
    const err = new Error(`KV request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  const body = await res.json();
  return body.result;
}

export async function incrementDistillCount() {
  return Number(await kvCommand(`incr/${COUNTER_KEY}`)) || 0;
}

export async function getDistillCount() {
  return Number(await kvCommand(`get/${COUNTER_KEY}`)) || 0;
}
