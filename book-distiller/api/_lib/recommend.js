// Category/author detection + book recommendations using Claude.
// Shared by the local Node server (server.js) and the Vercel function (api/recommend.js).
//
// Given the user's query, Claude decides whether it names a specific book, an
// author, or a category/genre/topic. For a category it returns two lists: 10
// highly rated books from roughly the past year, and 10 enduring classics of
// the category. For an author it returns every book by that author it knows
// of, ordered chronologically by original publication year.

import Anthropic from "@anthropic-ai/sdk";

// Classification runs before every query, so it uses the fastest/cheapest
// model (Haiku 4.5); summaries stay on the higher-quality BOOK_MODEL.
export const REC_MODEL = process.env.REC_MODEL || "claude-haiku-4-5";

const BOOK_ITEM = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    author: { type: "string" },
    year: { type: "string", description: "Publication year, e.g. '2025'." },
    blurb: { type: "string", description: "One sentence: what it is and why it's rated highly." }
  },
  required: ["title", "author", "year", "blurb"]
};

const AUTHOR_BOOK_ITEM = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    year: { type: "string", description: "Original publication year, e.g. '1953'. Empty string if unknown." }
  },
  required: ["title", "year"]
};

export const REC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    is_category: {
      type: "boolean",
      description: "true if the query names a category/genre/subject; false otherwise."
    },
    category: { type: "string", description: "Canonical display name for the category, e.g. 'Behavioral Psychology'. Empty string when is_category is false." },
    recent: { type: "array", description: "Exactly 10 highly rated books published within roughly the past year. Empty when is_category is false.", items: BOOK_ITEM },
    classics: { type: "array", description: "Exactly 10 highly rated, enduring classics of the category. Empty when is_category is false.", items: BOOK_ITEM },
    is_author: {
      type: "boolean",
      description: "true if the query names a specific author (a person, not a book title or a topic/genre); false otherwise."
    },
    author: { type: "string", description: "Canonical form of the author's name. Empty string when is_author is false." },
    books: {
      type: "array",
      description: "When is_author is true: every real book by this author you have genuine knowledge of, ordered chronologically by original publication year (oldest first). Empty when is_author is false.",
      items: AUTHOR_BOOK_ITEM
    }
  },
  required: ["is_category", "category", "recent", "classics", "is_author", "author", "books"]
};

const SYSTEM = `You are a well-read librarian. Decide whether the user's input names ONE SPECIFIC BOOK, an AUTHOR, or a CATEGORY of books, then respond as structured JSON matching the schema.

Classification rules:
- A specific book: an actual title (even misspelled or partial, e.g. "thinking fast and slow", "zero to one"), or a title plus author. Set is_category=false, is_author=false, category="", author="", books=[], and both recent/classics lists empty.
- An author: the input is a person's name and nothing more — no book title, no topic. A trailing credential or honorific is still just a name (e.g. "Calvin Colarusso, MD", "Dr. Seuss", "Robert C. Martin", "haruki murakami", "Agatha Christie"). Set is_author=true, author=the canonical form of their name, and books=every real book by this author, ordered chronologically by original publication year (oldest first). If you are not certain you know the author's full body of work, use web_search to look it up — their Amazon author page, Goodreads author page, Wikipedia bibliography, or publisher page — before answering. A real author can be one you don't recognize from memory; an unfamiliar author's name is still an author, NOT a single book title, so find their books rather than falling back to a book classification. Real books only — never invent a title or a year; use "" for a book's year only if you truly can't find it. Leave is_category=false, category="", recent=[], classics=[].
- A category: a genre, subject, field, or topic (e.g. "entrepreneurship", "behavioral psychology", "science fiction", "leadership", "personal finance", "world war 2 history"). Set is_category=true. Leave is_author=false, author="", books=[].
- When genuinely ambiguous between an author and a book, prefer whichever the input more directly names: a title-shaped phrase points to a book; a bare personal name (with or without a credential like MD or PhD) and no topic meaning points to an author. When genuinely ambiguous otherwise, prefer a book so the user gets a distillation rather than a detour.
- Use web_search only when you need it — skip it for authors, books, and categories you already know well, so common queries stay fast. Reach for it mainly to confirm or complete an unfamiliar author's bibliography.

For a category, produce:
- "recent": exactly 10 highly rated, well-reviewed books in the category published within roughly the past year (the most recent you know of; use each book's real publication year).
- "classics": exactly 10 enduring, highly rated classics of the category — the canon a serious reader would start with.
- No duplicates between lists. Real books only — never invent a title, author, or year. If fewer than 10 genuinely recent titles are known, fill the remainder with the most recent excellent titles you are confident exist and their true years.
- Each blurb: one tight sentence on what the book is and why it's rated highly. No markdown, no emoji.`;

// Max rounds of "pause_turn" resumption for the built-in web_search loop
// (each round is itself capped at 3 searches via tools[0].max_uses).
const MAX_SEARCH_RESUMPTIONS = 3;

// Calls Claude and returns the parsed object. Throws on API/parse failure.
export async function recommendBooks(query) {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) from env
  const userContent = `Input: ${query}\n\nClassify and respond as JSON.`;
  const params = {
    model: REC_MODEL,
    max_tokens: 8000,
    system: SYSTEM,
    // Basic web_search (not the _20260209 dynamic-filtering variant) because the
    // classifier runs on Haiku 4.5. Lets it look up an obscure author's real
    // bibliography instead of guessing or falling back to a single book.
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
    output_config: { format: { type: "json_schema", schema: REC_SCHEMA } }
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
