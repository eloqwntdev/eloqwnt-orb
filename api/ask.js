// Claude for the knowledge-base interview and imports. The page sends the prompt (and any links or files);
// the API key never leaves the server.
import { allow, isAuthed, json } from "../lib/server.js";
import { fetchPage } from "../lib/fetch-page.js";

const MODELS = { quick: "claude-haiku-5-5", default: "claude-sonnet-5-5" };
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_SOURCES = 8;
const MAX_FILE_B64 = 4_200_000; // about 3 MB of file; Vercel caps a request at 4.5 MB

// Turn the page's sources into Claude content blocks. Links are fetched here, on the server.
async function sourceBlocks(sources) {
  const blocks = [];
  const notes = [];
  for (const s of sources.slice(0, MAX_SOURCES)) {
    if (!s || typeof s !== "object") continue;
    const name = String(s.name || s.url || "Source").slice(0, 200);
    if (s.kind === "url") {
      try {
        const page = await fetchPage(s.url);
        if (page.kind === "pdf") blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: page.data }, title: page.url });
        else {
          blocks.push({ type: "text", text: `<source name="${page.url}">\n${page.text}\n</source>` });
          if (page.thin) notes.push(`${name} had very little readable text. If the suggestions miss things, paste the page text or upload a PDF.`);
        }
      } catch (e) {
        const err = new Error(`${name}: ${e.message}`);
        err.code = "fetch_failed";
        throw err;
      }
    } else if (s.kind === "pdf" && typeof s.data === "string" && s.data.length <= MAX_FILE_B64) {
      blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: s.data }, title: name });
    } else if (s.kind === "image" && IMAGE_TYPES.includes(s.mediaType) && typeof s.data === "string" && s.data.length <= MAX_FILE_B64) {
      blocks.push({ type: "text", text: `Image: ${name}` }, { type: "image", source: { type: "base64", media_type: s.mediaType, data: s.data } });
    } else if (s.kind === "text" && typeof s.text === "string" && s.text.trim()) {
      blocks.push({ type: "text", text: `<source name="${name.replace(/"/g, "'")}">\n${s.text.slice(0, 80000)}\n</source>` });
    }
  }
  return { blocks, notes };
}

export async function GET(request) {
  if (!(await isAuthed(request))) return json({ error: "Sign in first." }, 401);
  return json({ configured: Boolean(process.env.ANTHROPIC_API_KEY) });
}

export async function POST(request) {
  if (!(await isAuthed(request))) return json({ error: "Sign in first.", code: "session_expired" }, 401);
  if (!process.env.ANTHROPIC_API_KEY) return json({ error: "Claude isn’t connected. Add ANTHROPIC_API_KEY in Vercel.", code: "sampling_disabled" }, 503);
  if (!(await allow("kb:ask", 120, 3600))) return json({ error: "Too many questions this hour.", code: "rate_limited" }, 429);

  const { prompt, tier, sources, maxTokens } = await request.json().catch(() => ({}));
  if (typeof prompt !== "string" || !prompt.trim()) return json({ error: "Missing prompt.", code: "invalid_request" }, 400);
  if (prompt.length > 200000) return json({ error: "The knowledge base is too large to send at once.", code: "prompt_too_large" }, 413);

  let content = prompt;
  let notes = [];
  if (Array.isArray(sources) && sources.length) {
    try {
      const built = await sourceBlocks(sources);
      if (!built.blocks.length) return json({ error: "None of those files could be read. Try a PDF, Word file, image or text.", code: "invalid_request" }, 400);
      content = [...built.blocks, { type: "text", text: prompt }];
      notes = built.notes;
    } catch (e) {
      return json({ error: e.message, code: e.code || "fetch_failed" }, 422);
    }
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODELS[tier] || MODELS.default,
      max_tokens: Math.min(Math.max(Number(maxTokens) || 2000, 500), 12000),
      system: "You are a careful assistant that edits a knowledge base. When asked for JSON, reply with only the JSON value and nothing else.",
      messages: [{ role: "user", content }],
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = res.status === 429 ? "rate_limited" : res.status === 401 || res.status === 403 ? "sampling_disabled" : res.status === 413 ? "prompt_too_large" : "upstream_error";
    return json({ error: body?.error?.message || "Claude didn’t answer.", code }, res.status === 429 ? 429 : 502);
  }
  const text = (body.content || []).filter((c) => c.type === "text").map((c) => c.text).join("").trim();
  if (!text) return json({ error: "Claude returned an empty answer.", code: "empty_completion" }, 502);
  return json({ text, notes, truncated: body.stop_reason === "max_tokens" });
}
