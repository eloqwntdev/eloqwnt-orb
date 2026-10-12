// Claude for the knowledge-base interview. The page sends the full prompt; the API key never leaves the server.
import { allow, isAuthed, json } from "../lib/server.js";

const MODELS = { quick: "claude-haiku-5-5", default: "claude-sonnet-5-5" };

export async function GET(request) {
  if (!(await isAuthed(request))) return json({ error: "Sign in first." }, 401);
  return json({ configured: Boolean(process.env.ANTHROPIC_API_KEY) });
}

export async function POST(request) {
  if (!(await isAuthed(request))) return json({ error: "Sign in first.", code: "session_expired" }, 401);
  if (!process.env.ANTHROPIC_API_KEY) return json({ error: "Claude isn’t connected. Add ANTHROPIC_API_KEY in Vercel.", code: "sampling_disabled" }, 503);
  if (!(await allow("kb:ask", 120, 3600))) return json({ error: "Too many questions this hour.", code: "rate_limited" }, 429);

  const { prompt, tier } = await request.json().catch(() => ({}));
  if (typeof prompt !== "string" || !prompt.trim()) return json({ error: "Missing prompt.", code: "invalid_request" }, 400);
  if (prompt.length > 200000) return json({ error: "The knowledge base is too large to send at once.", code: "prompt_too_large" }, 413);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODELS[tier] || MODELS.default,
      max_tokens: 2000,
      system: "You are a careful assistant that edits a knowledge base. When asked for JSON, reply with only the JSON value and nothing else.",
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = res.status === 429 ? "rate_limited" : res.status === 401 || res.status === 403 ? "sampling_disabled" : "upstream_error";
    return json({ error: body?.error?.message || "Claude didn’t answer.", code }, res.status === 429 ? 429 : 502);
  }
  const text = (body.content || []).filter((c) => c.type === "text").map((c) => c.text).join("").trim();
  if (!text) return json({ error: "Claude returned an empty answer.", code: "empty_completion" }, 502);
  return json({ text, truncated: body.stop_reason === "max_tokens" });
}
