// Vercel serverless function: GET /api/count
// Returns the current global "books distilled" count. Never errors out to the
// caller — if Vercel KV isn't configured (or the request fails), it reports
// { configured: false } so the frontend simply hides the counter.
import { counterConfigured, getDistillCount } from "./_lib/counter.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!counterConfigured()) {
    res.status(200).json({ configured: false, count: null });
    return;
  }
  try {
    const count = await getDistillCount();
    res.status(200).json({ configured: true, count });
  } catch (err) {
    console.error(`[count] read failed: ${err?.message || err}`);
    res.status(200).json({ configured: false, count: null });
  }
}
