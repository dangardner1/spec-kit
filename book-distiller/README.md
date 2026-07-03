# Book Distiller

A small web app with **live AI inside**: type any book title (or a topic) and Claude
returns an 80/20 distillation — the book's core framework as an infographic, seven
high-impact takeaways with real examples, and a practical way to put it to work.

It's the interactive successor to the static "field notes" artifact: instead of a fixed
library, the summary is generated on the fly by the Claude API through a small backend
that holds your API key (a key can't live in the browser).

## How it works

```
browser (public/)  ──POST /api/summarize──▶  backend  ──▶  Claude API
   renders JSON  ◀──────── structured JSON ────────┘   (model: claude-opus-4-8)
```

- **`site/`** — the frontend (no build step): a prompt box, a loading state, and the
  renderer that draws the framework diagram, takeaway cards, and implementation steps.
- **`lib/summarize.js`** — the core: the prompt, a JSON Schema, and the Claude call.
  [Structured Outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
  guarantee the model returns exactly the shape the frontend renders.
- **`server.js`** — a zero-dependency Node server for local use (static files + the API).
- **`api/summarize.js`** — the same logic as a Vercel serverless function for deployment.

The key never reaches the browser — it stays on the server and is read from the
`ANTHROPIC_API_KEY` environment variable.

## Run locally

```bash
cd book-distiller
npm install
ANTHROPIC_API_KEY=sk-ant-... npm start
# open http://localhost:3000
```

Without a key, the app still runs in **demo mode** — the endpoint returns a single fixed
sample (clearly labelled) so you can see the UI immediately. Set the key to distill any
book live.

Optional environment variables:

| Variable            | Default            | Purpose                                        |
| ------------------- | ------------------ | ---------------------------------------------- |
| `ANTHROPIC_API_KEY` | —                  | Your Anthropic API key (enables live AI).      |
| `BOOK_MODEL`        | `claude-opus-4-8`  | Model to use (e.g. `claude-sonnet-5` for lower cost). |
| `PORT`              | `3000`             | Local server port.                             |

## Deploy (Vercel)

```bash
npm i -g vercel
vercel                                  # first deploy
vercel env add ANTHROPIC_API_KEY        # paste your key (Production)
vercel --prod
```

`api/summarize.js` is picked up automatically as a serverless function; `site/` is served
as static assets (via the rewrites in `vercel.json`). Any platform that supports Node serverless functions works the same way —
just expose `POST /api/summarize` and set `ANTHROPIC_API_KEY`.

## Notes

- Each request is one Claude call (~a few thousand output tokens). Cost scales with usage;
  switch `BOOK_MODEL` to a cheaper model if you expect high traffic.
- If you type a title the model doesn't recognise, it distills the closest well-known book
  on that topic rather than failing.
