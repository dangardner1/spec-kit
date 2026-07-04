// Shared OpenAI TTS helper for /api/speak. Falls back silently to the free
// browser voice (site/app.js) whenever OPENAI_API_KEY isn't configured.
const TTS_MODEL = process.env.OPENAI_TTS_MODEL || "tts-1";
const TTS_VOICE = process.env.OPENAI_TTS_VOICE || "alloy";
const MAX_CHARS = 4000; // OpenAI tts-1 input limit is 4096 characters

export function ttsConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function synthesizeSpeech(text) {
  const input = String(text || "").slice(0, MAX_CHARS);
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: TTS_MODEL, voice: TTS_VOICE, input, response_format: "mp3" }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const err = new Error(`OpenAI TTS request failed (${res.status}): ${detail.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return Buffer.from(await res.arrayBuffer());
}
