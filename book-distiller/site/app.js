"use strict";

const home = document.getElementById("home");
const loading = document.getElementById("loading");
const reader = document.getElementById("reader");
const form = document.getElementById("promptForm");
const input = document.getElementById("query");
const goBtn = document.getElementById("go");
const homeError = document.getElementById("homeError");
const homeRetry = document.getElementById("homeRetry");
const homeNote = document.getElementById("homeNote");
const recentBox = document.getElementById("recent");
const loadingTitle = document.getElementById("loadingTitle");

const ACCENTS = ["#0E8C72", "#6C5CE0", "#C13B79", "#A9791F", "#2D6FB8", "#0F8FA6", "#B0532A"];
const RECENT_KEY = "bd_recent";
let lastQuery = "";
let currentBook = null;

/* ---------- affiliate "Buy the book" config ----------
   These are public URL tags, so keeping them client-side is fine.
   - AMAZON_TAG: your Amazon Associates tag, e.g. "bookdistiller-20". Leave ""
     and the button still works as a plain Amazon search — it just won't earn a
     commission until you add your tag.
   - BOOKSHOP_SEARCH_TEMPLATE: to use Bookshop.org instead of Amazon, paste your
     affiliate search-link template here with {q} where the query goes, copied
     from your Bookshop.org affiliate dashboard, e.g.
       "https://bookshop.org/a/12345/search?keywords={q}"
     Leave "" to use Amazon. */
const AMAZON_TAG = "";
const BOOKSHOP_SEARCH_TEMPLATE = "";

function buyLink(b) {
  const enc = encodeURIComponent([b.title, b.author].filter(Boolean).join(" "));
  if (BOOKSHOP_SEARCH_TEMPLATE) {
    return { store: "Bookshop.org", href: BOOKSHOP_SEARCH_TEMPLATE.replace("{q}", enc) };
  }
  const tag = AMAZON_TAG ? `&tag=${encodeURIComponent(AMAZON_TAG)}` : "";
  return { store: "Amazon", href: `https://www.amazon.com/s?k=${enc}${tag}` };
}

/* ---------- helpers ---------- */
function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function md(s) {
  return escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*(?!\s)([^*]+?)\*(?!\*)/g, "$1<em>$2</em>");
}
function accentFor(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return ACCENTS[h % ACCENTS.length];
}
function show(el) { for (const s of [home, loading, reader]) s.classList.toggle("hidden", s !== el); }

/* ---------- recently viewed (localStorage) ---------- */
function readRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); }
  catch { return []; }
}
function pushRecent(q, title, field) {
  try {
    const list = readRecent().filter((r) => r.q.toLowerCase() !== q.toLowerCase());
    list.unshift({ q, title, field });
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 8)));
  } catch { /* ignore (private mode) */ }
}
function renderRecent() {
  if (!recentBox) return;
  const list = readRecent();
  if (!list.length) { recentBox.classList.add("hidden"); recentBox.innerHTML = ""; return; }
  recentBox.classList.remove("hidden");
  recentBox.innerHTML = `<span>Recent</span>` +
    list.map((r) => `<button class="chip" type="button" data-q="${escapeHtml(r.q)}" title="${escapeHtml(r.title || r.q)}">${escapeHtml(r.title || r.q)}</button>`).join("");
  for (const chip of recentBox.querySelectorAll(".chip")) {
    chip.addEventListener("click", () => distill(chip.getAttribute("data-q"), { push: true }));
  }
}

/* ---------- framework: loop diagram ---------- */
function loopSVG(nodes, center) {
  const N = nodes.length, cx = 210, cy = 210, Rp = 120, arcR = 120, Rlab = 158;
  const seg = 360 / N, gap = N === 3 ? 24 : 20;
  const rad = (d) => (d * Math.PI) / 180;
  const pt = (r, d) => [cx + r * Math.sin(rad(d)), cy - r * Math.cos(rad(d))];
  let arcs = "", labels = "", circles = "";
  for (let i = 0; i < N; i++) {
    const ang = i * seg;
    const [nx, ny] = pt(Rp, ang);
    const nr = N >= 4 ? 44 : 47;
    const L = (nodes[i].label || "").toUpperCase();
    const fs = L.length <= 4 ? 16 : L.length <= 6 ? 13 : 11.5;
    const color = i % 2 ? "var(--accent-deep)" : "var(--accent)";
    circles += `<circle cx="${nx.toFixed(1)}" cy="${ny.toFixed(1)}" r="${nr}" fill="${color}"/>`
      + `<text x="${nx.toFixed(1)}" y="${(ny + fs * 0.34).toFixed(1)}" fill="#fff" font-size="${fs}" letter-spacing="1" text-anchor="middle" font-family="var(--mono)" font-weight="700">${escapeHtml(L)}</text>`;
    const a1 = ang + gap, a2 = ang + seg - gap;
    const [sx, sy] = pt(arcR, a1), [ex, ey] = pt(arcR, a2);
    arcs += `<path d="M${sx.toFixed(1)} ${sy.toFixed(1)} A${arcR} ${arcR} 0 0 1 ${ex.toFixed(1)} ${ey.toFixed(1)}" fill="none" stroke="var(--accent)" stroke-width="2.4" marker-end="url(#ar)" opacity=".9"/>`;
    if (nodes[i].edge) {
      const [lx, ly] = pt(Rlab, ang + seg / 2);
      labels += `<text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" text-anchor="middle" font-family="var(--mono)" font-size="11.5" fill="var(--ink-soft)">${escapeHtml(nodes[i].edge)}</text>`;
    }
  }
  let ctr = "";
  if (center && center.length) {
    const y0 = 214 - (center.length - 1) * 7.5;
    center.forEach((line, idx) => {
      ctr += `<text x="210" y="${(y0 + idx * 15).toFixed(1)}" text-anchor="middle" font-family="var(--mono)" font-size="11" fill="var(--ink-soft)">${escapeHtml(line)}</text>`;
    });
  }
  return `<svg viewBox="0 0 420 420" role="img" aria-label="Framework loop diagram">
    <defs><marker id="ar" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="var(--accent)"/></marker></defs>
    <g>${arcs}</g><g>${labels}</g><g>${circles}</g>${ctr}</svg>`;
}
function legendHTML(legend) {
  return `<div class="loop-legend">` + legend.map((l, i) => `
    <div class="leg-item"><span class="dot" style="background:${i % 2 ? "var(--accent-deep)" : "var(--accent)"}"></span>
      <h4>${escapeHtml(l.label)}</h4><p>${md(l.desc)}</p></div>`).join("") + `</div>`;
}
function gridHTML(principles) {
  return `<div class="pgrid">` + principles.map((p, i) => `
    <div class="ptile"><span class="pn">${String(i + 1).padStart(2, "0")}</span><h4>${escapeHtml(p.t)}</h4><p>${md(p.d)}</p></div>`).join("") + `</div>`;
}
function frameworkBlock(fw) {
  const isLoop = fw.type === "loop" && Array.isArray(fw.nodes) && fw.nodes.length >= 2;
  if (isLoop) return `<div class="fw-card is-loop">${loopSVG(fw.nodes, fw.center)}${(fw.legend && fw.legend.length) ? legendHTML(fw.legend) : ""}</div>`;
  return `<div class="fw-card is-grid">${gridHTML(fw.principles || [])}</div>`;
}
function cardHTML(t, wide) {
  return `<div class="card${wide ? " wide" : ""}"><span class="no">TAKEAWAY ${escapeHtml(t.n)}</span>
    <h3>${escapeHtml(t.title)}</h3><p>${md(t.body)}</p>
    ${t.eg ? `<span class="eg"><b>${escapeHtml(t.egLabel || "Example")}</b>${md(t.eg)}</span>` : ""}</div>`;
}
function stepHTML(s) {
  return `<div class="step"><span class="frame">${escapeHtml(s.frame)}</span>
    <div><h3>${escapeHtml(s.title)}</h3><p>${md(s.body)}</p></div></div>`;
}

/* ---------- export: markdown ---------- */
function slugify(s) {
  return (s || "book").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "book";
}
function buildMarkdown(b) {
  const lines = [];
  const takeaways = Array.isArray(b.takeaways) ? b.takeaways : [];
  const fw = b.framework || {};
  const impl = b.implementation || {};

  lines.push(`# ${b.title}`);
  const byline = [b.author, b.meta].filter(Boolean).join(" · ");
  if (byline) lines.push(`*${byline}*`);
  lines.push("", `**Field:** ${b.field || "Non-fiction"}`, "");
  lines.push("## Thesis", b.thesis || "", "");
  lines.push(`**The 20%:** ${b.pareto || ""}`, "");
  lines.push(`## ${fw.heading || ""}`, fw.lede || "", "");
  if (fw.type === "loop" && Array.isArray(fw.legend)) {
    for (const l of fw.legend) lines.push(`- **${l.label}** — ${l.desc}`);
  } else if (Array.isArray(fw.principles)) {
    for (const p of fw.principles) lines.push(`- **${p.t}** — ${p.d}`);
  }
  lines.push("", `## The Vital Few — ${takeaways.length} Takeaways`, "");
  for (const t of takeaways) {
    lines.push(`### ${t.n}. ${t.title}`, t.body || "", "");
    if (t.eg) lines.push(`> **${t.egLabel || "Example"}:** ${t.eg}`, "");
  }
  lines.push(`## ${impl.heading || "Put it to work"}`);
  if (impl.intro) lines.push(impl.intro, "");
  for (const s of impl.steps || []) lines.push(`- **[${s.frame}] ${s.title}** — ${s.body}`);
  lines.push("", "---", `_Generated by Book Distiller · ${b.field || ""}_`);
  return lines.join("\n");
}
function buildBrowseMarkdown(rec, query) {
  const cat = rec.category || query || "Reading list";
  const recent = Array.isArray(rec.recent) ? rec.recent : [];
  const classics = Array.isArray(rec.classics) ? rec.classics : [];
  const listItems = (books) => {
    const out = [];
    for (const b of books) {
      const meta = [b.author, b.year].filter(Boolean).join(", ");
      out.push(`- **${b.title}**${meta ? ` — ${meta}` : ""}`);
      if (b.blurb) out.push(`  ${b.blurb}`);
    }
    return out;
  };
  const lines = [`# ${cat} — highly rated books`, ""];
  if (recent.length) {
    lines.push("## New & notable — the past year", "", ...listItems(recent), "");
  }
  if (classics.length) {
    lines.push("## The classics", "", ...listItems(classics), "");
  }
  lines.push("---", `_Generated by Book Distiller · ${cat}_`);
  return lines.join("\n");
}
function saveMarkdown(markdown, filename) {
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
function downloadMarkdown(b) {
  saveMarkdown(buildMarkdown(b), `${slugify(b.title)}-field-notes.md`);
}
async function copyMarkdownText(btn, text) {
  try {
    await navigator.clipboard.writeText(text);
    const prev = btn.textContent;
    btn.textContent = "✓ Copied";
    btn.classList.add("copied");
    setTimeout(() => { btn.textContent = prev; btn.classList.remove("copied"); }, 1600);
  } catch {
    btn.textContent = "Copy failed";
    setTimeout(() => { btn.textContent = "⧉ Copy"; }, 1600);
  }
}
function copyMarkdown(btn) { return copyMarkdownText(btn, buildMarkdown(currentBook)); }

/* ---------- listen: OpenAI TTS narration, falling back to the free browser voice ----------
   Narration is synthesized in sentence-aligned chunks: a small first chunk so audio
   starts within a couple of seconds, with later chunks fetched while earlier ones play. */
const BROWSER_TTS_SUPPORTED = typeof window !== "undefined" && "speechSynthesis" in window;
let ttsPlayer = null;     // chunked-audio player when using OpenAI narration
let ttsMode = null;       // "audio" | "browser" | null — which playback path is active

function stripMd(s) {
  return String(s || "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(^|[^*])\*(?!\s)([^*]+?)\*(?!\*)/g, "$1$2");
}
function buildSpeechText(b) {
  const takeaways = Array.isArray(b.takeaways) ? b.takeaways : [];
  const parts = [`${b.title}${b.author ? ", by " + b.author : ""}.`];
  if (b.thesis) parts.push(stripMd(b.thesis));
  for (const t of takeaways) {
    parts.push(`Takeaway ${t.n}: ${t.title}.`);
    if (t.body) parts.push(stripMd(t.body));
  }
  return parts.join(" ");
}
function splitSpeechChunks(text) {
  // Split on sentence boundaries. First chunk stays small so playback starts fast.
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [text];
  const chunks = [];
  let cur = "";
  for (const s of sentences) {
    const limit = chunks.length === 0 ? 280 : 700;
    if (cur && (cur + s).length > limit) { chunks.push(cur.trim()); cur = s; }
    else cur += s;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}
function stopSpeech() {
  if (ttsPlayer) { ttsPlayer.stop(); ttsPlayer = null; }
  if (BROWSER_TTS_SUPPORTED) window.speechSynthesis.cancel();
  ttsMode = null;
}
async function fetchSpeechAudioUrl(text) {
  const res = await fetch("/api/speak", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (res.status === 501) return null; // OpenAI TTS not configured server-side
  if (!res.ok) throw new Error(`Narration request failed (${res.status}).`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}
function speakWithBrowser(btn, text) {
  if (!BROWSER_TTS_SUPPORTED) { btn.textContent = "🔊 Listen"; btn.classList.remove("speaking"); return; }
  ttsMode = "browser";
  const synth = window.speechSynthesis;
  const utter = new SpeechSynthesisUtterance(text);
  utter.onend = () => { btn.textContent = "🔊 Listen"; btn.classList.remove("speaking"); ttsMode = null; };
  utter.onerror = () => { btn.textContent = "🔊 Listen"; btn.classList.remove("speaking"); ttsMode = null; };
  synth.cancel();
  synth.speak(utter);
  btn.textContent = "⏸ Pause";
  btn.classList.add("speaking");
}
function createNarration(fullText, btn) {
  const chunks = splitSpeechChunks(fullText);
  const urlPromises = new Array(chunks.length).fill(null);
  let audio = null, stopped = false, paused = false;

  const fetchChunk = (i) => urlPromises[i] || (urlPromises[i] = fetchSpeechAudioUrl(chunks[i]));
  const setBtn = (t, speaking) => { btn.textContent = t; btn.classList.toggle("speaking", !!speaking); };
  const cleanupUrl = (u) => { if (u) URL.revokeObjectURL(u); };

  function done() {
    stopped = true;
    setBtn("🔊 Listen", false);
    if (ttsPlayer === player) { ttsPlayer = null; ttsMode = null; }
  }

  async function playChunk(i) {
    if (stopped) return;
    let url;
    try { url = await fetchChunk(i); } catch { url = null; }
    if (stopped) { cleanupUrl(url); return; }
    if (!url) {
      // First chunk unavailable (no key / error): fall back to the browser voice
      // for the whole text. A later chunk failing just ends playback early.
      done();
      if (i === 0) speakWithBrowser(btn, fullText);
      return;
    }
    if (i + 1 < chunks.length) fetchChunk(i + 1).catch(() => {}); // prefetch while playing
    audio = new Audio(url);
    audio.onended = () => {
      cleanupUrl(url);
      audio = null;
      if (!stopped && i + 1 < chunks.length) playChunk(i + 1);
      else done();
    };
    audio.onerror = () => { cleanupUrl(url); audio = null; done(); };
    try { await audio.play(); } catch { cleanupUrl(url); audio = null; done(); return; }
    if (paused) audio.pause();
    else setBtn("⏸ Pause", true);
  }

  const player = {
    get paused() { return paused; },
    start() { setBtn("… Loading", false); playChunk(0); },
    pause() { paused = true; if (audio) audio.pause(); setBtn("▶ Resume", false); },
    resume() { paused = false; if (audio) audio.play(); setBtn("⏸ Pause", true); },
    stop() {
      stopped = true;
      if (audio) { audio.pause(); audio.src = ""; audio = null; }
      setBtn("🔊 Listen", false);
    },
  };
  return player;
}
function toggleListen(btn) {
  if (!currentBook) return;

  if (ttsMode === "audio" && ttsPlayer) {
    if (ttsPlayer.paused) ttsPlayer.resume();
    else ttsPlayer.pause();
    return;
  }
  if (ttsMode === "browser" && BROWSER_TTS_SUPPORTED) {
    const synth = window.speechSynthesis;
    if (synth.speaking && !synth.paused) { synth.pause(); btn.textContent = "▶ Resume"; btn.classList.remove("speaking"); return; }
    if (synth.paused) { synth.resume(); btn.textContent = "⏸ Pause"; btn.classList.add("speaking"); return; }
  }

  ttsMode = "audio";
  ttsPlayer = createNarration(buildSpeechText(currentBook), btn);
  ttsPlayer.start();
}

/* ---------- render ---------- */
function render(b, isDemo) {
  stopSpeech();
  currentBook = b;
  reader.style.setProperty("--accent", accentFor((b.title || "") + (b.field || "")));
  const takeaways = Array.isArray(b.takeaways) ? b.takeaways : [];
  const steps = (b.implementation && b.implementation.steps) || [];
  reader.innerHTML = `
    <div class="topbar">
      <button class="back" id="backBtn">← Distill another</button>
      <div class="topbar-right">
        <div class="action-menu" id="actionMenu">
          <button class="back" id="copyBtn">⧉ Copy</button>
          <button class="back" id="downloadBtn">⬇ Download .md</button>
          <button class="back" id="listenBtn">🔊 Listen</button>
        </div>
        <button class="back more-toggle" id="moreToggle" type="button" aria-haspopup="true" aria-expanded="false">⋯ More</button>
      </div>
    </div>
    ${isDemo ? `<div class="demo-banner"><b>Demo</b> — no API key is configured, so this is a fixed sample. Set <code>ANTHROPIC_API_KEY</code> to distill any book live.</div>` : ""}
    <header class="rhero">
      <span class="eyebrow">${escapeHtml(b.field || "Non-fiction")} · 80/20 distillation</span>
      <h1>${escapeHtml(b.title)}</h1>
      <p class="byline">${escapeHtml(b.author || "")}${b.meta ? " · " + escapeHtml(b.meta) : ""} → the vital few, in one page</p>
      ${(() => { const l = buyLink(b); return `<p class="buy-cta">
        <a class="cta-link" href="${l.href}" target="_blank" rel="noopener sponsored">📖 Buy the full book on ${escapeHtml(l.store)}</a>
        <span class="affiliate-note">Affiliate link — we may earn a commission, at no extra cost to you.</span>
      </p>`; })()}
      <p class="thesis">${md(b.thesis)}</p>
      <div class="pareto"><span class="num">20<span class="pct">%</span></span><p>${md(b.pareto)}</p></div>
    </header>
    <section>
      <div class="sec-head"><span class="idx">01</span><h2>${escapeHtml(b.framework.heading)}</h2></div>
      <p class="lede">${md(b.framework.lede)}</p>
      ${frameworkBlock(b.framework)}
    </section>
    <section>
      <div class="sec-head"><span class="idx">02</span><h2>The vital few — ${takeaways.length} takeaways</h2></div>
      <div class="cards">${takeaways.map((t, i) => cardHTML(t, i === takeaways.length - 1 && takeaways.length % 2 === 1)).join("")}</div>
    </section>
    <section>
      <div class="sec-head"><span class="idx">03</span><h2>${escapeHtml((b.implementation && b.implementation.heading) || "Put it to work")}</h2></div>
      ${b.implementation && b.implementation.intro ? `<p class="impl-intro">${md(b.implementation.intro)}</p>` : ""}
      <div class="steps">${steps.map(stepHTML).join("")}</div>
    </section>
    <footer>
      <span>${escapeHtml((b.title || "").toUpperCase())}${b.author ? " · " + escapeHtml(b.author.toUpperCase()) : ""}</span>
      <button class="linklike" id="footBack">← Distill another book</button>
    </footer>`;
  document.getElementById("backBtn").addEventListener("click", goHome);
  document.getElementById("footBack").addEventListener("click", goHome);
  document.getElementById("downloadBtn").addEventListener("click", () => downloadMarkdown(currentBook));
  document.getElementById("copyBtn").addEventListener("click", (e) => copyMarkdown(e.currentTarget));
  const listenBtn = document.getElementById("listenBtn");
  if (listenBtn) listenBtn.addEventListener("click", (e) => toggleListen(e.currentTarget));
  wireMoreToggle();
  show(reader);
  reader.classList.remove("enter"); void reader.offsetWidth; reader.classList.add("enter");
  window.scrollTo(0, 0);
}

/* Mobile-only "⋯ More" menu for Copy/Download/Listen. The toggle button is
   recreated on every render(), so only its own listener is (re)attached here;
   the outside-click/Escape close handlers are wired once, globally, below. */
function wireMoreToggle() {
  const toggle = document.getElementById("moreToggle");
  const menu = document.getElementById("actionMenu");
  if (!toggle || !menu) return;
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = menu.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(isOpen));
  });
}
document.addEventListener("click", (e) => {
  const menu = document.getElementById("actionMenu");
  const toggle = document.getElementById("moreToggle");
  if (!menu || !toggle || !menu.classList.contains("open")) return;
  if (!menu.contains(e.target) && e.target !== toggle) {
    menu.classList.remove("open");
    toggle.setAttribute("aria-expanded", "false");
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const menu = document.getElementById("actionMenu");
  const toggle = document.getElementById("moreToggle");
  if (menu) menu.classList.remove("open");
  if (toggle) toggle.setAttribute("aria-expanded", "false");
});

/* ---------- category browse ---------- */
function pickCard(b, kind) {
  return `<div class="card book-pick" role="button" tabindex="0"
      data-q="${escapeHtml(`${b.title} by ${b.author}`)}">
    <span class="no pick-year pick-${kind}">${escapeHtml(b.year || "")}</span>
    <h3>${escapeHtml(b.title)}</h3>
    <p class="pick-author">${escapeHtml(b.author)}</p>
    <p>${escapeHtml(b.blurb)}</p>
    <span class="eg"><b>Distill this book →</b></span>
  </div>`;
}

/* ---------- author bibliography ---------- */
function authorBookCard(b, author) {
  return `<div class="card book-pick" role="button" tabindex="0"
      data-q="${escapeHtml(`${b.title} by ${author}`)}">
    <span class="no pick-year">${escapeHtml(b.year || "")}</span>
    <h3>${escapeHtml(b.title)}</h3>
    <span class="eg"><b>Distill this book →</b></span>
  </div>`;
}
function renderAuthorList(rec, query) {
  stopSpeech();
  currentBook = null;
  const author = rec.author || query;
  reader.style.setProperty("--accent", accentFor(author));
  const books = Array.isArray(rec.books) ? rec.books : [];
  reader.innerHTML = `
    <div class="topbar">
      <button class="back" id="backBtn">← Search again</button>
    </div>
    <header class="rhero">
      <span class="eyebrow">Author · ${books.length} book${books.length === 1 ? "" : "s"}, chronological</span>
      <h1>${escapeHtml(author)}</h1>
      <p class="byline">Every book by this author, oldest first — pick one and it gets distilled on the spot.</p>
    </header>
    <section>
      <div class="sec-head"><span class="idx">01</span><h2>Bibliography</h2></div>
      <div class="cards browse-cards">${books.map((b) => authorBookCard(b, author)).join("")}</div>
    </section>
    <footer>
      <span>${escapeHtml(author.toUpperCase())} · AUTHOR</span>
      <button class="linklike" id="footBack">← Search again</button>
    </footer>`;
  document.getElementById("backBtn").addEventListener("click", goHome);
  document.getElementById("footBack").addEventListener("click", goHome);
  for (const card of reader.querySelectorAll(".book-pick")) {
    const go = () => distill(card.getAttribute("data-q"), { push: true });
    card.addEventListener("click", go);
    card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
  }
  show(reader);
  reader.classList.remove("enter"); void reader.offsetWidth; reader.classList.add("enter");
  window.scrollTo(0, 0);
}
function renderBrowse(rec, query) {
  stopSpeech();
  currentBook = null;
  reader.style.setProperty("--accent", accentFor(rec.category || query));
  const recent = Array.isArray(rec.recent) ? rec.recent : [];
  const classics = Array.isArray(rec.classics) ? rec.classics : [];
  reader.innerHTML = `
    <div class="topbar">
      <button class="back" id="backBtn">← Search again</button>
      <div class="topbar-right">
        <div class="action-menu" id="actionMenu">
          <button class="back" id="copyBtn">⧉ Copy</button>
          <button class="back" id="downloadBtn">⬇ Download .md</button>
        </div>
        <button class="back more-toggle" id="moreToggle" type="button" aria-haspopup="true" aria-expanded="false">⋯ More</button>
      </div>
    </div>
    <header class="rhero">
      <span class="eyebrow">Category browse · ${recent.length + classics.length} picks</span>
      <h1>${escapeHtml(rec.category || query)}</h1>
      <p class="byline">Highly rated books in this category — pick one and it gets distilled on the spot.</p>
    </header>
    <section>
      <div class="sec-head"><span class="idx">01</span><h2>New &amp; notable — the past year</h2></div>
      <p class="lede">The best-reviewed books in ${escapeHtml(rec.category || "this category")} published in roughly the last twelve months.</p>
      <div class="cards browse-cards">${recent.map((b) => pickCard(b, "recent")).join("")}</div>
    </section>
    <section>
      <div class="sec-head"><span class="idx">02</span><h2>The classics</h2></div>
      <p class="lede">The enduring canon — where a serious reader of ${escapeHtml(rec.category || "this category")} would start.</p>
      <div class="cards browse-cards">${classics.map((b) => pickCard(b, "classic")).join("")}</div>
    </section>
    <footer>
      <span>${escapeHtml((rec.category || query).toUpperCase())} · CATEGORY BROWSE</span>
      <button class="linklike" id="footBack">← Search again</button>
    </footer>`;
  document.getElementById("backBtn").addEventListener("click", goHome);
  document.getElementById("footBack").addEventListener("click", goHome);
  document.getElementById("copyBtn").addEventListener("click", (e) => copyMarkdownText(e.currentTarget, buildBrowseMarkdown(rec, query)));
  document.getElementById("downloadBtn").addEventListener("click", () => saveMarkdown(buildBrowseMarkdown(rec, query), `${slugify(rec.category || query)}-reading-list.md`));
  wireMoreToggle();
  for (const card of reader.querySelectorAll(".book-pick")) {
    const go = () => distill(card.getAttribute("data-q"), { push: true });
    card.addEventListener("click", go);
    card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
  }
  show(reader);
  reader.classList.remove("enter"); void reader.offsetWidth; reader.classList.add("enter");
  window.scrollTo(0, 0);
}

/* ---------- flow ---------- */
async function distill(query, opts = {}) {
  query = (query || "").trim();
  if (!query) return;
  lastQuery = query;
  hideError();
  stopSpeech();
  loadingTitle.textContent = query;
  show(loading);
  if (opts.push !== false) {
    history.pushState({ q: query }, "", "/?q=" + encodeURIComponent(query));
  }
  try {
    // First: is this a category or an author? (In demo mode the server always says no.)
    try {
      const recRes = await fetch("/api/recommend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query })
      });
      if (recRes.ok) {
        const recPayload = await recRes.json().catch(() => ({}));
        const rec = recPayload && recPayload.data;
        if (rec && rec.is_author && (rec.books || []).length) {
          renderAuthorList(rec, query);
          pushRecent(query, `✍️ ${rec.author || query}`, rec.author || query);
          return;
        }
        if (rec && rec.is_category && ((rec.recent || []).length || (rec.classics || []).length)) {
          renderBrowse(rec, query);
          pushRecent(query, `📚 ${rec.category || query}`, rec.category || query);
          return;
        }
      }
    } catch { /* classification is best-effort — fall through to a normal distill */ }

    const res = await fetch("/api/summarize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query })
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || `Request failed (${res.status}).`);
    render(payload.data, payload.demo);
    if (payload.data) pushRecent(query, payload.data.title, payload.data.field);
  } catch (err) {
    showError(err.message || "Something went wrong. Please try again.");
  }
}

function showError(msg) {
  show(home);
  renderRecent();
  homeError.textContent = msg;
  homeError.classList.remove("hidden");
  if (homeRetry) homeRetry.classList.toggle("hidden", !lastQuery);
  input.value = lastQuery;
  input.focus();
}
function hideError() {
  homeError.classList.add("hidden");
  if (homeRetry) homeRetry.classList.add("hidden");
}

function goHome(opts = {}) {
  hideError();
  stopSpeech();
  show(home);
  renderRecent();
  input.value = "";
  input.focus();
  if (opts.push !== false) history.pushState({}, "", "/");
  window.scrollTo(0, 0);
}

/* ---------- routing (permalinks) ---------- */
function routeFromUrl(push) {
  const q = new URLSearchParams(location.search).get("q");
  if (q && q.trim()) distill(q.trim(), { push });
  else goHome({ push });
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = input.value.trim();
  if (q) distill(q, { push: true });
});
for (const chip of document.querySelectorAll("#home .examples .chip")) {
  chip.addEventListener("click", () => distill(chip.textContent, { push: true }));
}
if (homeRetry) homeRetry.addEventListener("click", () => { if (lastQuery) distill(lastQuery, { push: true }); });
window.addEventListener("popstate", () => routeFromUrl(false));

// Cheap GET config check (no model call) to set the home footnote. Kept to a
// single line — the reader page's own demo banner covers the ANTHROPIC_API_KEY
// detail when someone actually hits demo mode, so this doesn't repeat it.
fetch("/api/summarize", { method: "GET" })
  .then((r) => r.json()).then((p) => {
    homeNote.textContent = p && p.demo
      ? "Running in demo mode — try an example above."
      : "Powered by Claude · every summary is generated fresh.";
  }).catch(() => {});

// Global "books distilled" counter — only appears if the server has a KV
// store configured; silently absent otherwise.
const distillCount = document.getElementById("distillCount");
if (distillCount) {
  fetch("/api/count")
    .then((r) => r.json())
    .then((p) => {
      if (!p || !p.configured || typeof p.count !== "number") return;
      distillCount.querySelector("b").textContent = p.count.toLocaleString();
      distillCount.classList.remove("hidden");
    })
    .catch(() => {});
}

/* ---------- category-browse discoverability tip (shown once) ---------- */
const CATEGORY_TIP_KEY = "bd_category_tip_seen";
function showCategoryTipIfNew() {
  const box = document.getElementById("categoryTip");
  if (!box) return;
  try { if (localStorage.getItem(CATEGORY_TIP_KEY)) return; } catch { return; }
  box.classList.remove("hidden");
  const dismiss = document.getElementById("categoryTipDismiss");
  if (dismiss) dismiss.addEventListener("click", () => {
    box.classList.add("hidden");
    try { localStorage.setItem(CATEGORY_TIP_KEY, "1"); } catch { /* ignore (private mode) */ }
  });
}

// Initial route: honour ?q= permalink, otherwise show home.
renderRecent();
showCategoryTipIfNew();
routeFromUrl(false);
