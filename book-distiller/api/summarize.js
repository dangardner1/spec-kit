// Vercel serverless function: POST /api/summarize
// Same logic as the local server's endpoint, in Vercel's handler shape.
import { summarizeBook, DEMO } from "./_lib/summarize.js";
import { counterConfigured, incrementDistillCount } from "./_lib/counter.js";
import { cacheConfigured, getCachedSummary, setCachedSummary } from "./_lib/cache.js";

const HAS_KEY = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

async function bumpCounter() {
  if (!counterConfigured()) return;
  try { await incrementDistillCount(); } catch (err) { console.error(`[count] increment failed: ${err?.message || err}`); }
}

// Best-effort in-memory helpers. On serverless these live per warm instance —
// not a hard guarantee across all instances, but they meaningfully cut abuse
// and repeated cost without any external store.
const RATE_MAX = 20;                 // requests per window, per IP
const RATE_WINDOW_MS = 10 * 60_000;  // 10 minutes
const CACHE_TTL_MS = 24 * 60 * 60_000; // 24h
const CACHE_MAX = 300;

const hits = new Map();   // ip -> number[] (timestamps)
const cache = new Map();  // normalized query -> { data, ts }

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
  if (hits.size > 5000) hits.clear(); // guard against unbounded growth
  return arr.length > RATE_MAX;
}
const cacheKey = (q) => q.toLowerCase().replace(/\s+/g, " ").trim();
function cacheGet(q) {
  const e = cache.get(cacheKey(q));
  if (e && Date.now() - e.ts < CACHE_TTL_MS) return e.data;
  return null;
}
function cacheSet(q, data) {
  cache.set(cacheKey(q), { data, ts: Date.now() });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    res.status(200).json({ demo: !HAS_KEY(), model: process.env.BOOK_MODEL || "claude-sonnet-5" });
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const query = ((req.body && req.body.query) || "").toString().trim();
  if (!query) {
    res.status(400).json({ error: "Enter a book title or topic." });
    return;
  }
  if (query.length > 200) {
    res.status(400).json({ error: "That's a bit long — try a book title or topic." });
    return;
  }

  if (rateLimited(clientIp(req))) {
    res.setHeader("retry-after", "600");
    res.status(429).json({ error: "You've made a lot of requests — take a short break and try again in a few minutes." });
    return;
  }

  if (!HAS_KEY()) {
    console.log(`[query] "${query}" (demo)`);
    await bumpCounter();
    res.status(200).json({ demo: true, data: DEMO });
    return;
  }

  const cached = cacheGet(query);
  if (cached) {
    console.log(`[query] "${query}" -> "${cached.title}" (cache hit)`);
    await bumpCounter();
    res.status(200).json({ demo: false, cached: true, data: cached });
    return;
  }

  // L2: shared KV cache — a hit here means another visitor already distilled
  // this title, so we skip the Anthropic call entirely.
  if (cacheConfigured()) {
    try {
      const kvData = await getCachedSummary(cacheKey(query));
      if (kvData) {
        cacheSet(query, kvData); // warm the in-memory L1
        console.log(`[query] "${query}" -> "${kvData.title}" (kv hit)`);
        await bumpCounter();
        res.status(200).json({ demo: false, cached: true, data: kvData });
        return;
      }
    } catch (err) {
      console.error(`[cache] kv read failed: ${err?.message || err}`);
    }
  }

  try {
    const data = await summarizeBook(query);
    if (data.found === false) {
      console.log(`[query] "${query}" -> not found`);
      res.status(404).json({ error: data.notFoundReason || `Couldn't find a book matching "${query}". Check the spelling or try a different title.` });
      return;
    }
    cacheSet(query, data);
    if (cacheConfigured()) {
      try { await setCachedSummary(cacheKey(query), data); }
      catch (err) { console.error(`[cache] kv write failed: ${err?.message || err}`); }
    }
    console.log(`[query] "${query}" -> "${data.title}" (${data.field})`);
    await bumpCounter();
    res.status(200).json({ demo: false, data });
  } catch (err) {
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 502;
    const message =
      status === 401 ? "Invalid API key. Check ANTHROPIC_API_KEY."
      : status === 429 ? "Rate limited by the API. Try again in a moment."
      : status === 422 ? "The model declined this request. Try a different title."
      : "The AI request failed. Please try again.";
    console.error(`[query] "${query}" failed (${status}): ${err?.message || err}`);
    res.status(status).json({ error: message });
  }
}
