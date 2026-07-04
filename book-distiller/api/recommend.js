// Vercel serverless function: POST /api/recommend
// Classifies the query as a specific book vs. a category; for categories,
// returns 10 recent + 10 classic highly rated books.
import { recommendBooks } from "./_lib/recommend.js";

const HAS_KEY = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

const RATE_MAX = 20;
const RATE_WINDOW_MS = 10 * 60_000;
const CACHE_TTL_MS = 24 * 60 * 60_000;
const CACHE_MAX = 300;

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
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const query = ((req.body && req.body.query) || "").toString().trim();
  if (!query) {
    res.status(400).json({ error: "Enter a book title or category." });
    return;
  }
  if (query.length > 200) {
    res.status(400).json({ error: "That's a bit long — try a book title or category." });
    return;
  }

  // Without a key there's nothing to classify with; the frontend proceeds to
  // the demo summary as before.
  if (!HAS_KEY()) {
    res.status(200).json({ demo: true, data: { is_category: false, category: "", recent: [], classics: [] } });
    return;
  }

  if (rateLimited(clientIp(req))) {
    res.setHeader("retry-after", "600");
    res.status(429).json({ error: "You've made a lot of requests — take a short break and try again in a few minutes." });
    return;
  }

  const cached = cacheGet(query);
  if (cached) {
    res.status(200).json({ demo: false, cached: true, data: cached });
    return;
  }

  try {
    const data = await recommendBooks(query);
    cacheSet(query, data);
    if (data.is_category) console.log(`[browse] "${query}" -> "${data.category}"`);
    res.status(200).json({ demo: false, data });
  } catch (err) {
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 502;
    console.error(`[browse] "${query}" failed (${status}): ${err?.message || err}`);
    res.status(status).json({ error: "Could not check the category. Please try again." });
  }
}
