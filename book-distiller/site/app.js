"use strict";

const home = document.getElementById("home");
const loading = document.getElementById("loading");
const reader = document.getElementById("reader");
const form = document.getElementById("promptForm");
const input = document.getElementById("query");
const goBtn = document.getElementById("go");
const homeError = document.getElementById("homeError");
const homeNote = document.getElementById("homeNote");
const loadingTitle = document.getElementById("loadingTitle");

const ACCENTS = ["#0E8C72", "#6C5CE0", "#C13B79", "#A9791F", "#2D6FB8", "#0F8FA6", "#B0532A"];

/* ---------- helpers ---------- */
function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
// Escape, then render a safe subset of markdown: **bold** and *italic*.
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

/* ---------- render ---------- */
function render(b, isDemo) {
  reader.style.setProperty("--accent", accentFor((b.title || "") + (b.field || "")));
  const takeaways = Array.isArray(b.takeaways) ? b.takeaways : [];
  const steps = (b.implementation && b.implementation.steps) || [];
  reader.innerHTML = `
    <div class="topbar">
      <button class="back" id="backBtn">← Distill another</button>
      <span class="field-chip">${escapeHtml(b.field || "Non-fiction")}</span>
    </div>
    ${isDemo ? `<div class="demo-banner"><b>Demo</b> — no API key is configured, so this is a fixed sample. Set <code>ANTHROPIC_API_KEY</code> to distill any book live.</div>` : ""}
    <header class="rhero">
      <span class="eyebrow">${escapeHtml(b.field || "Non-fiction")} · 80/20 distillation</span>
      <h1>${escapeHtml(b.title)}</h1>
      <p class="byline">${escapeHtml(b.author || "")}${b.meta ? " · " + escapeHtml(b.meta) : ""} → the vital few, in one page</p>
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
  show(reader);
  reader.classList.remove("enter"); void reader.offsetWidth; reader.classList.add("enter");
  window.scrollTo(0, 0);
}

/* ---------- flow ---------- */
async function distill(query) {
  homeError.classList.add("hidden");
  loadingTitle.textContent = query;
  show(loading);
  try {
    const res = await fetch("/api/summarize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query })
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || `Request failed (${res.status}).`);
    render(payload.data, payload.demo);
  } catch (err) {
    show(home);
    homeError.textContent = err.message || "Something went wrong. Please try again.";
    homeError.classList.remove("hidden");
    input.focus();
  }
}

function goHome() {
  show(home);
  input.value = "";
  input.focus();
  window.scrollTo(0, 0);
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = input.value.trim();
  if (q) distill(q);
});
for (const chip of document.querySelectorAll(".chip")) {
  chip.addEventListener("click", () => { input.value = chip.textContent; distill(chip.textContent); });
}

// Cheap GET config check (no model call) to set the home footnote.
fetch("/api/summarize", { method: "GET" })
  .then((r) => r.json()).then((p) => {
    homeNote.textContent = p && p.demo
      ? "Running in demo mode — set ANTHROPIC_API_KEY on the server to distill any book live with Claude."
      : "Powered by Claude · every summary is generated fresh.";
  }).catch(() => {});
