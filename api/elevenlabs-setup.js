// Dashboard / setup: is the ElevenLabs webhook working (GET), and import past calls (GET ?action=import). Signed-in only.
import { isAuthed, json, redis, redisConfigured } from "../lib/server.js";
import { eleven, elevenConfigured, upsertCall } from "../lib/voice.js";

const AGENT = process.env.ELEVENLABS_AGENT_ID || "agent_5001m4qkqqaje10b7a0jj9k7hg2r";
const parse = (raw) => { try { return JSON.parse(raw); } catch { return raw; } };

export async function GET(request) {
  if (!(await isAuthed(request))) return json({ error: "Sign in first." }, 401);
  const u = new URL(request.url);
  if (u.searchParams.get("action") === "ping") {
    // call our own public webhook address from outside, like ElevenLabs would; an unsigned call should be logged and refused
    const url = new URL("/api/elevenlabs", request.url).toString();
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const text = (await r.text()).slice(0, 200);
      return json({ url, status: r.status, server: r.headers.get("server"), body: text, verdict: r.status === 401 ? "Reachable. Check deliveries: a “signature didn’t match” line from this test should now be there." : "Not reachable as expected: something in front of the site answered." });
    } catch (e) { return json({ url, error: e.message }, 502); }
  }
  if (u.searchParams.get("action") === "import") {
    if (!elevenConfigured()) return json({ error: "Add ELEVENLABS_API_KEY in Vercel first." }, 400);
    try {
      let cursor = "", seen = 0, saved = 0, skipped = 0, pages = 0;
      const known = new Set(redisConfigured() ? Object.keys(Object.fromEntries(chunk((await redis("HGETALL", "eleven:imported")) || []))) : []);
      do {
        const list = await eleven(`/v1/convai/conversations?agent_id=${AGENT}&page_size=100${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`);
        for (const c of list.conversations || []) {
          seen++;
          if (known.has(c.conversation_id) || c.status !== "done") { skipped++; continue; }
          const d = await eleven(`/v1/convai/conversations/${c.conversation_id}`);
          const r = await upsertCall(d);
          if (r.ok) { saved++; await redis("HSET", "eleven:imported", c.conversation_id, "1"); }
        }
        cursor = list.has_more ? list.next_cursor : "";
        pages++;
      } while (cursor && pages < 10);
      return json({ ok: true, seen, saved, skipped, more: !!cursor });
    } catch (e) { return json({ error: e.status === 401 ? "ElevenLabs rejected the API key (it needs read access to Agents / conversations)." : e.message }, 502); }
  }
  const log = redisConfigured() ? ((await redis("LRANGE", "eleven:log", 0, 9)) || []).map(parse) : [];
  return json({ webhookSecret: Boolean(process.env.ELEVENLABS_WEBHOOK_SECRET), apiKey: elevenConfigured(), agent: AGENT, webhookUrl: new URL("/api/elevenlabs", request.url).toString(), deliveries: log });
}
function chunk(flat) { const out = []; for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1]]); return out; }
