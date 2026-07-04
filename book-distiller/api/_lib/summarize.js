// Core logic: turn a book title into a structured 80/20 distillation using Claude.
// Shared by the local Node server (server.js) and the Vercel function (api/summarize.js).

import Anthropic from "@anthropic-ai/sdk";

export const MODEL = process.env.BOOK_MODEL || "claude-sonnet-5";

// JSON schema the model must fill. Structured Outputs guarantees the response
// parses into exactly this shape, so the frontend never has to guess.
// All properties are `required` (Anthropic strict schemas allow no optionals),
// so unused arrays are returned empty rather than omitted.
export const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    found: { type: "boolean", description: "true if the input identifies a real, existing book (including a topic resolved to a real defining book). false if no real book can be identified — never fabricate one to make this true." },
    notFoundReason: { type: "string", description: "When found is false: a brief, honest reason, e.g. 'No book with this title is known.' Empty string when found is true." },
    field: { type: "string", description: "The subject / field, e.g. 'Entrepreneurship'." },
    title: { type: "string", description: "The book's title." },
    author: { type: "string", description: "The author(s)." },
    meta: { type: "string", description: "Year and approximate page count, e.g. '2011 · ~330 pp'." },
    thesis: { type: "string", description: "One or two sentences. Use **bold** for 1-3 key phrases." },
    pareto: { type: "string", description: "One sentence framing the 20% that gives 80%." },
    framework: {
      type: "object",
      additionalProperties: false,
      properties: {
        type: { type: "string", enum: ["loop", "grid"], description: "'loop' for a cyclical process; 'grid' for a set of principles." },
        heading: { type: "string" },
        lede: { type: "string" },
        nodes: {
          type: "array",
          description: "For type 'loop' only: 3-5 stages in order. Empty for 'grid'.",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              label: { type: "string", description: "SHORT, UPPERCASE, one word ideally (fits in a circle)." },
              edge: { type: "string", description: "1-2 word label for the transition to the next stage." }
            },
            required: ["label", "edge"]
          }
        },
        center: { type: "array", description: "For 'loop': 1-2 short lines for the loop's center. Empty for 'grid'.", items: { type: "string" } },
        legend: {
          type: "array",
          description: "For 'loop': one entry per node explaining it. Empty for 'grid'.",
          items: {
            type: "object",
            additionalProperties: false,
            properties: { label: { type: "string" }, desc: { type: "string" } },
            required: ["label", "desc"]
          }
        },
        principles: {
          type: "array",
          description: "For type 'grid' only: 6 principles. Empty for 'loop'.",
          items: {
            type: "object",
            additionalProperties: false,
            properties: { t: { type: "string", description: "Short title." }, d: { type: "string", description: "One-line explanation." } },
            required: ["t", "d"]
          }
        }
      },
      required: ["type", "heading", "lede", "nodes", "center", "legend", "principles"]
    },
    takeaways: {
      type: "array",
      description: "Exactly 7 high-impact takeaways.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          n: { type: "string", description: "Two-digit index, e.g. '01'." },
          title: { type: "string" },
          body: { type: "string", description: "2-3 sentences. Use **bold** sparingly." },
          egLabel: { type: "string", description: "One of: Example, Analogy, Rule, Insight, Reframe, Tactic." },
          eg: { type: "string", description: "A concrete example or analogy." }
        },
        required: ["n", "title", "body", "egLabel", "eg"]
      }
    },
    implementation: {
      type: "object",
      additionalProperties: false,
      properties: {
        heading: { type: "string" },
        intro: { type: "string", description: "One or two sentences framing the practical section. Use **bold** sparingly." },
        steps: {
          type: "array",
          description: "5-6 concrete, practical moves.",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              frame: { type: "string", description: "A 1-2 word tag for the idea being applied." },
              title: { type: "string", description: "An imperative action." },
              body: { type: "string", description: "How to do it, concretely." }
            },
            required: ["frame", "title", "body"]
          }
        }
      },
      required: ["heading", "intro", "steps"]
    }
  },
  required: ["found", "notFoundReason", "field", "title", "author", "meta", "thesis", "pareto", "framework", "takeaways", "implementation"]
};

const SYSTEM = `You are a sharp non-fiction editor who distills books using the Pareto principle: the 20% of ideas that deliver 80% of the understanding.

You will be given a book title (and sometimes an author, or just a topic). Produce a one-page distillation as structured JSON matching the provided schema. Rules:

- First decide if the input identifies a REAL book. A close match still counts as real: minor misspellings, partial titles, a title plus author, or a well-known abbreviation all clearly point to one specific real book — resolve to that book (this is identifying intent, not fabricating). If the user typed a topic or genre rather than a title, pick the single most defining, canonical real book on that topic. In all of these cases, set found=true and proceed normally.
- Before concluding a book doesn't exist, use web_search to check for it — a small-press, academic, or ebook/audiobook-only title can be real even if you don't recognize it from training. Search retailer and catalog listings (Amazon Kindle/print, Audible, Google Books, Goodreads, publisher pages) rather than relying only on your own knowledge. Skip the search when you already recognize the book with confidence — most queries don't need it.
- If, after checking, the input does NOT correspond to any real book — a nonsense string, a title that doesn't exist, or a "book" with no genuine listing anywhere — set found=false, give a brief honest reason in notFoundReason (e.g. "No book with this title is known."), and leave every other field as an empty string or empty array. Do not invent a plausible-sounding book to make this succeed — never fabricate a title, author, or content for a book that doesn't exist.
- When found is true, set notFoundReason to "".
- Identify the vital few: the framework plus 7 takeaways that carry most of the book's value. Cut the war stories.
- Every takeaway needs a CONCRETE example or analogy in "eg" — a real case from the book, a named company, a vivid analogy. Not vague restatement.
- Choose framework.type = "loop" ONLY when the book genuinely centers on a cyclical/sequential process (e.g. a feedback loop, a habit cycle, a repeating method). Provide 3-5 ordered nodes with SHORT uppercase labels, a matching legend, and 1-2 center lines. Otherwise use "grid" with exactly 6 principles, and leave nodes/center/legend as empty arrays.
- For a "loop", leave principles as an empty array. For a "grid", leave nodes/center/legend as empty arrays.
- "implementation" should be genuinely practical and specific — 5-6 concrete moves a motivated reader could start this week, not restatements of the takeaways.
- Use **double-asterisk bold** for at most a few key phrases in thesis / bodies / intro. No other markdown, no headings, no emoji.
- Be concise and high-signal. Aim for clarity and immediate insight over completeness.`;

export function buildUserPrompt(query) {
  return `Book (or topic): ${query}\n\nProduce the 80/20 distillation as JSON.`;
}

// Max rounds of "pause_turn" resumption for the built-in web_search loop
// (each round is itself capped at 3 searches via tools[0].max_uses).
const MAX_SEARCH_RESUMPTIONS = 3;

// Calls Claude and returns the parsed object. Throws on API/parse failure.
export async function summarizeBook(query) {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) from env
  const userContent = buildUserPrompt(query);
  const params = {
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM,
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }],
    output_config: { format: { type: "json_schema", schema: SCHEMA } }
  };

  let messages = [{ role: "user", content: userContent }];
  let response = await client.messages.create({ ...params, messages });

  let resumptions = 0;
  while (response.stop_reason === "pause_turn" && resumptions < MAX_SEARCH_RESUMPTIONS) {
    messages = [
      { role: "user", content: userContent },
      { role: "assistant", content: response.content }
    ];
    response = await client.messages.create({ ...params, messages });
    resumptions++;
  }

  if (response.stop_reason === "refusal") {
    const err = new Error("The model declined to answer this request.");
    err.status = 422;
    throw err;
  }

  // The final schema-conforming answer is the LAST text block — web_search
  // rounds can emit earlier text blocks interleaved with tool use.
  const textBlock = response.content.findLast((b) => b.type === "text");
  if (!textBlock) {
    throw new Error("No text content returned from the model.");
  }
  return JSON.parse(textBlock.text);
}

// A canned example so the app is runnable (and demonstrable) before an API key
// is configured. The frontend shows a clear "demo" banner when this is served.
export const DEMO = {
  field: "Entrepreneurship",
  title: "The Lean Startup",
  author: "Eric Ries",
  meta: "2011 · ~330 pp",
  thesis: "A startup is an **experiment machine**, not a smaller big company. Its job is to learn what customers want **before** it runs out of money.",
  pareto: "Skip the war stories. Seven ideas plus one feedback loop carry ~80% of what the book teaches.",
  framework: {
    type: "loop",
    heading: "The engine: Build → Measure → Learn",
    lede: "You turn ideas into something real, measure how customers actually respond, and learn whether to keep going or change course. The only score that matters is how fast you get all the way around.",
    nodes: [
      { label: "BUILD", edge: "product" },
      { label: "MEASURE", edge: "data" },
      { label: "LEARN", edge: "ideas" }
    ],
    center: ["minimize", "loop time"],
    legend: [
      { label: "Build", desc: "Turn an idea into the smallest thing that can test it." },
      { label: "Measure", desc: "Watch what real people do — behaviour, not opinions." },
      { label: "Learn", desc: "Was the bet right? Pivot or persevere." }
    ],
    principles: []
  },
  takeaways: [
    { n: "01", title: "Progress = validated learning", body: "Not features shipped or hours worked. The unit of progress is a proven fact about your customer.", egLabel: "Analogy", eg: "A treadmill measures effort, never distance. Most 'productive' startups are sprinting on one." },
    { n: "02", title: "The MVP is a question, not a product", body: "The smallest experiment that starts the learning — scrappy, manual, even faked.", egLabel: "Example", eg: "Dropbox tested demand with a demo video before building sync." },
    { n: "03", title: "Name your leaps of faith", body: "Every plan rests on a **value** bet and a **growth** bet. Test the riskiest first.", egLabel: "Rule", eg: "If an assumption can't be proven wrong by an experiment, it's a wish." },
    { n: "04", title: "Keep innovation accounts", body: "Vanity metrics only rise and hide the truth. Use cohorts and A/B splits that tie a change to a cause.", egLabel: "Analogy", eg: "A check-engine light tells you something; a bumper sticker tells you nothing." },
    { n: "05", title: "Pivot or persevere — on a clock", body: "When data stalls, change strategy while keeping the vision. Put the decision on a cadence.", egLabel: "Example", eg: "Groupon began as an activism site called The Point." },
    { n: "06", title: "Work in small batches", body: "Small batches expose problems sooner and cut the waste of building the wrong thing at scale.", egLabel: "Example", eg: "Stuffing envelopes one at a time catches a misprint on #1, not #100." },
    { n: "07", title: "Pick one engine of growth", body: "Sticky, viral, or paid — most teams dilute themselves chasing all three.", egLabel: "Insight", eg: "Know which loop you're running and instrument its one number." }
  ],
  implementation: {
    heading: "Put it to work",
    intro: "Make each plan **falsifiable** so you're testing bets, not documenting intentions.",
    steps: [
      { frame: "Leaps of faith", title: "Write down the riskiest assumption first", body: "Before building, state the value and growth bets and which one dies first if you're wrong." },
      { frame: "MVP", title: "Define the kill/keep threshold before coding", body: "Decide the number that would make you stop, e.g. 'keep if ≥40% return in week 2'." },
      { frame: "Small batches", title: "Ship tiny, deploy continuously", body: "Each merge is one testable increment, so a bad assumption surfaces early." },
      { frame: "Accounting", title: "Instrument one cohort metric per bet", body: "Ship a cohort chart tied to the hypothesis, not a dashboard of cumulative totals." },
      { frame: "Pivot", title: "Book a recurring 30-minute review", body: "Read each experiment's data against its threshold and record: persevere, pivot, or kill." }
    ]
  }
};
