// Vercel serverless function: POST /api/speak
// Renders higher-quality narration via OpenAI TTS. Returns 501 { unavailable: true }
// when OPENAI_API_KEY isn't set, so the frontend falls back to the free browser voice.
import { ttsConfigured, synthesizeSpeech } from "./_lib/speak.js";

const RATE_MAX = 80; // narration is chunked client-side, so one listen = several small requests
const RATE_WINDOW_MS = 10 * 60_000;
const CACHE_TTL_MS = 24 * 60 * 60_000;
const CACHE_MAX = 200;

const hits = new Map();
const cache = new Map();

function clientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length) return xff.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}
function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > RATE_MAX;
}
function hashKey(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  return `${h}:${text.length}`;
}
function cacheGet(key) {
  const e = cache.get(key);
  if (e && Date.now() - e.ts < CACHE_TTL_MS) return e.buf;
  return null;
}
function cacheSet(key, buf) {
  cache.set(key, { buf, ts: Date.now() });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!ttsConfigured()) {
    res.status(501).json({ unavailable: true });
    return;
  }

  const text = ((req.body && req.body.text) || "").toString().trim();
  if (!text) {
    res.status(400).json({ error: "Nothing to read." });
    return;
  }

  if (rateLimited(clientIp(req))) {
    res.setHeader("retry-after", "600");
    res.status(429).json({ error: "Too many requests. Try again in a few minutes." });
    return;
  }

  const key = hashKey(text);
  const cached = cacheGet(key);
  if (cached) {
    res.setHeader("content-type", "audio/mpeg");
    res.setHeader("cache-control", "private, max-age=86400");
    res.status(200).end(cached);
    return;
  }

  try {
    const buf = await synthesizeSpeech(text);
    cacheSet(key, buf);
    res.setHeader("content-type", "audio/mpeg");
    res.setHeader("cache-control", "private, max-age=86400");
    res.status(200).end(buf);
  } catch (err) {
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 502;
    const message =
      status === 401 ? "Invalid OpenAI API key."
      : status === 429 ? "Rate limited by OpenAI. Try again shortly."
      : "Narration failed. Please try again.";
    console.error(`[speak] failed (${status}): ${err?.message || err}`);
    res.status(status).json({ error: message });
  }
}
