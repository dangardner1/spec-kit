// Vercel serverless function: POST /api/summarize
// Same logic as the local server's endpoint, in Vercel's handler shape.
import { summarizeBook, DEMO } from "../lib/summarize.js";

const HAS_KEY = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

export default async function handler(req, res) {
  if (req.method === "GET") {
    res.status(200).json({ demo: !HAS_KEY(), model: process.env.BOOK_MODEL || "claude-opus-4-8" });
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

  if (!HAS_KEY()) {
    res.status(200).json({ demo: true, data: DEMO });
    return;
  }

  try {
    const data = await summarizeBook(query);
    res.status(200).json({ demo: false, data });
  } catch (err) {
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 502;
    const message =
      status === 401 ? "Invalid API key. Check ANTHROPIC_API_KEY."
      : status === 429 ? "Rate limited by the API. Try again in a moment."
      : status === 422 ? "The model declined this request. Try a different title."
      : "The AI request failed. Please try again.";
    console.error("summarize error:", err?.message || err);
    res.status(status).json({ error: message });
  }
}
