// Minimal zero-framework Node server: serves the static frontend and the
// POST /api/summarize endpoint. Run with `npm start` (set ANTHROPIC_API_KEY for
// live AI; without it, the endpoint serves a labelled demo response).

import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { summarizeBook, DEMO, MODEL } from "./lib/summarize.js";

const ROOT = fileURLToPath(new URL("./site", import.meta.url));
const PORT = process.env.PORT || 3000;
const HAS_KEY = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
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

  // Demo mode: no key configured → return the canned example, flagged.
  if (!HAS_KEY) { send(res, 200, { demo: true, data: DEMO }); return; }

  try {
    const data = await summarizeBook(query);
    send(res, 200, { demo: false, data });
  } catch (err) {
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 502;
    const message =
      status === 401 ? "Invalid API key. Check ANTHROPIC_API_KEY."
      : status === 429 ? "Rate limited by the API. Try again in a moment."
      : status === 422 ? "The model declined this request. Try a different title."
      : "The AI request failed. Please try again.";
    console.error("summarize error:", err?.message || err);
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
  if (req.url === "/api/summarize" && req.method === "POST") return handleSummarize(req, res);
  if (req.url === "/api/summarize" && req.method === "GET") return send(res, 200, { demo: !HAS_KEY, model: MODEL });
  if (req.method === "GET") return serveStatic(req, res);
  send(res, 405, { error: "Method not allowed" });
});

server.listen(PORT, () => {
  console.log(`Book Distiller running at http://localhost:${PORT}`);
  console.log(HAS_KEY ? `Live AI enabled (model: ${MODEL}).` : "No ANTHROPIC_API_KEY set — serving demo mode.");
});
