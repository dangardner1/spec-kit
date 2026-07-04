// Minimal zero-framework Node server: serves the static frontend and the
// POST /api/summarize endpoint. Run with `npm start` (set ANTHROPIC_API_KEY for
// live AI; without it, the endpoint serves a labelled demo response).

import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { summarizeBook, DEMO, MODEL } from "./lib/summarize.js";
import { recommendBooks } from "./lib/recommend.js";
import { ttsConfigured, synthesizeSpeech } from "./lib/speak.js";
import { counterConfigured, incrementDistillCount, getDistillCount } from "./lib/counter.js";
import { cacheConfigured, getCachedSummary, setCachedSummary } from "./lib/cache.js";

const ROOT = fileURLToPath(new URL("./site", import.meta.url));
const PORT = process.env.PORT || 3000;
const HAS_KEY = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

const RATE_MAX = 20;
const RATE_WINDOW_MS = 10 * 60_000;
const CACHE_TTL_MS = 24 * 60 * 60_000;
const CACHE_MAX = 300;
const hits = new Map();
const cache = new Map();

const SPEAK_RATE_MAX = 80; // narration is chunked client-side, so one listen = several small requests
const SPEAK_CACHE_MAX = 200;
const speakHits = new Map();
const speakCache = new Map();
function speakRateLimited(ip) {
  const now = Date.now();
  const arr = (speakHits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  arr.push(now);
  speakHits.set(ip, arr);
  if (speakHits.size > 5000) speakHits.clear();
  return arr.length > SPEAK_RATE_MAX;
}
function speakHashKey(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  return `${h}:${text.length}`;
}
function speakCacheGet(key) {
  const e = speakCache.get(key);
  if (e && Date.now() - e.ts < CACHE_TTL_MS) return e.buf;
  return null;
}
function speakCacheSet(key, buf) {
  speakCache.set(key, { buf, ts: Date.now() });
  if (speakCache.size > SPEAK_CACHE_MAX) speakCache.delete(speakCache.keys().next().value);
}

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

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

async function bumpCounter() {
  if (!counterConfigured()) return;
  try { await incrementDistillCount(); } catch (err) { console.error(`[count] increment failed: ${err?.message || err}`); }
}

async function handleCount(req, res) {
  if (!counterConfigured()) { send(res, 200, { configured: false, count: null }); return; }
  try {
    const count = await getDistillCount();
    send(res, 200, { configured: true, count });
  } catch (err) {
    console.error(`[count] read failed: ${err?.message || err}`);
    send(res, 200, { configured: false, count: null });
  }
}

async function handleSummarize(req, res) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 4000) { send(res, 413, { error: "Request too large." }); return; }
  }
  let query;
  try { query = (JSON.parse(raw || "{}").query || "").trim(); }
  catch { send(res, 400, { error: "Invalid JSON." }); return; }

  if (!query) { send(res, 400, { error: "Enter a book title or topic." }); return; }
  if (query.length > 200) { send(res, 400, { error: "That's a bit long — try a book title or topic." }); return; }

  if (rateLimited(clientIp(req))) {
    send(res, 429, { error: "You've made a lot of requests — take a short break and try again in a few minutes." }, { "retry-after": "600" });
    return;
  }

  if (!HAS_KEY) {
    console.log(`[query] "${query}" (demo)`);
    await bumpCounter();
    send(res, 200, { demo: true, data: DEMO });
    return;
  }

  const cached = cacheGet(query);
  if (cached) {
    console.log(`[query] "${query}" -> "${cached.title}" (cache hit)`);
    await bumpCounter();
    send(res, 200, { demo: false, cached: true, data: cached });
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
        send(res, 200, { demo: false, cached: true, data: kvData });
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
      send(res, 404, { error: data.notFoundReason || `Couldn't find a book matching "${query}". Check the spelling or try a different title.` });
      return;
    }
    cacheSet(query, data);
    if (cacheConfigured()) {
      try { await setCachedSummary(cacheKey(query), data); }
      catch (err) { console.error(`[cache] kv write failed: ${err?.message || err}`); }
    }
    console.log(`[query] "${query}" -> "${data.title}" (${data.field})`);
    await bumpCounter();
    send(res, 200, { demo: false, data });
  } catch (err) {
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 502;
    const message =
      status === 401 ? "Invalid API key. Check ANTHROPIC_API_KEY."
      : status === 429 ? "Rate limited by the API. Try again in a moment."
      : status === 422 ? "The model declined this request. Try a different title."
      : "The AI request failed. Please try again.";
    console.error(`[query] "${query}" failed (${status}): ${err?.message || err}`);
    send(res, status, { error: message });
  }
}

async function handleRecommend(req, res) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 4000) { send(res, 413, { error: "Request too large." }); return; }
  }
  let query;
  try { query = (JSON.parse(raw || "{}").query || "").trim(); }
  catch { send(res, 400, { error: "Invalid JSON." }); return; }

  if (!query) { send(res, 400, { error: "Enter a book title or category." }); return; }
  if (query.length > 200) { send(res, 400, { error: "That's a bit long — try a book title or category." }); return; }

  if (!HAS_KEY) {
    send(res, 200, { demo: true, data: { is_category: false, category: "", recent: [], classics: [] } });
    return;
  }

  if (rateLimited(clientIp(req))) {
    send(res, 429, { error: "You've made a lot of requests — take a short break and try again in a few minutes." }, { "retry-after": "600" });
    return;
  }

  const recKey = "rec:" + query;
  const cached = cacheGet(recKey);
  if (cached) {
    send(res, 200, { demo: false, cached: true, data: cached });
    return;
  }

  try {
    const data = await recommendBooks(query);
    cacheSet(recKey, data);
    if (data.is_category) console.log(`[browse] "${query}" -> "${data.category}"`);
    send(res, 200, { demo: false, data });
  } catch (err) {
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 502;
    console.error(`[browse] "${query}" failed (${status}): ${err?.message || err}`);
    send(res, status, { error: "Could not check the category. Please try again." });
  }
}

async function handleSpeak(req, res) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 6000) { send(res, 413, { error: "Request too large." }); return; }
  }
  let text;
  try { text = ((JSON.parse(raw || "{}").text) || "").toString().trim(); }
  catch { send(res, 400, { error: "Invalid JSON." }); return; }

  if (!ttsConfigured()) { send(res, 501, { unavailable: true }); return; }
  if (!text) { send(res, 400, { error: "Nothing to read." }); return; }
  if (speakRateLimited(clientIp(req))) {
    send(res, 429, { error: "Too many requests. Try again in a few minutes." }, { "retry-after": "600" });
    return;
  }

  const key = speakHashKey(text);
  const cached = speakCacheGet(key);
  if (cached) {
    res.writeHead(200, { "content-type": "audio/mpeg" });
    res.end(cached);
    return;
  }
  try {
    const buf = await synthesizeSpeech(text);
    speakCacheSet(key, buf);
    res.writeHead(200, { "content-type": "audio/mpeg" });
    res.end(buf);
  } catch (err) {
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 502;
    const message =
      status === 401 ? "Invalid OpenAI API key."
      : status === 429 ? "Rate limited by OpenAI. Try again shortly."
      : "Narration failed. Please try again.";
    console.error(`[speak] failed (${status}): ${err?.message || err}`);
    send(res, status, { error: message });
  }
}

async function serveStatic(req, res) {
  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const filePath = normalize(join(ROOT, rel));
  if (!filePath.startsWith(ROOT)) { send(res, 403, { error: "Forbidden" }); return; }
  try {
    const body = await readFile(filePath);
    res.writeHead(200, { "content-type": MIME[extname(filePath)] || "application/octet-stream" });
    res.end(body);
  } catch {
    send(res, 404, { error: "Not found" });
  }
}

const server = http.createServer((req, res) => {
  const path = (req.url || "/").split("?")[0];
  if (path === "/api/summarize" && req.method === "POST") return handleSummarize(req, res);
  if (path === "/api/summarize" && req.method === "GET") return send(res, 200, { demo: !HAS_KEY, model: MODEL });
  if (path === "/api/recommend" && req.method === "POST") return handleRecommend(req, res);
  if (path === "/api/speak" && req.method === "POST") return handleSpeak(req, res);
  if (path === "/api/count" && req.method === "GET") return handleCount(req, res);
  if (req.method === "GET") return serveStatic(req, res);
  send(res, 405, { error: "Method not allowed" });
});

server.listen(PORT, () => {
  console.log(`Book Distiller running at http://localhost:${PORT}`);
  console.log(HAS_KEY ? `Live AI enabled (model: ${MODEL}).` : "No ANTHROPIC_API_KEY set — serving demo mode.");
  console.log(ttsConfigured() ? "OpenAI TTS enabled for Listen button." : "OPENAI_API_KEY not set — Listen button uses free browser voice.");
  console.log(counterConfigured() ? "Distill counter enabled (Vercel KV)." : "KV_REST_API_URL/TOKEN not set — distill counter hidden.");
  console.log(cacheConfigured() ? "Shared KV summary cache enabled." : "KV not set — using in-memory summary cache only.");
});
