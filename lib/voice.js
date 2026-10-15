// Voice calls from ElevenLabs: the official transcript, length and summary, merged into our conversation record.
// The browser already saves what was said during the call; ElevenLabs fills gaps (tab closed mid-call) and adds
// the call length and its own summary. Reading or receiving these doesn't use ElevenLabs credits.
import { redis, redisConfigured } from "./server.js";
import { loadConv, saveConv } from "./conv.js";
import { newId, sourceLabel } from "./orb-context.js";

const clip = (v, n) => String(v ?? "").slice(0, n).trim();
export const elevenConfigured = () => Boolean(process.env.ELEVENLABS_API_KEY);

/** Remember which of our conversations an ElevenLabs call belongs to. */
export async function linkCall(elevenId, convId) {
  if (!redisConfigured() || !/^[A-Za-z0-9_-]{6,80}$/.test(String(elevenId || ""))) return;
  await redis("HSET", "eleven:calls", elevenId, convId);
}

/** d = ElevenLabs conversation (webhook "data" or GET /v1/convai/conversations/{id}). */
export async function upsertCall(d) {
  const elevenId = String(d.conversation_id || "");
  if (!elevenId || !redisConfigured()) return { ok: false };
  const linked = await redis("HGET", "eleven:calls", elevenId);
  let conv = linked ? await loadConv(linked) : null;
  const meta = d.metadata || {}, analysis = d.analysis || {};
  const started = meta.start_time_unix_secs ? new Date(meta.start_time_unix_secs * 1000) : new Date();
  const transcript = (d.transcript || []).filter((t) => t && t.message).map((t) => ({
    role: t.role === "user" ? "user" : "orb", text: clip(t.message, 1500), at: started.getTime() + Math.round((t.time_in_call_secs || 0) * 1000),
  }));
  let created = false;
  if (!conv) {
    if (!transcript.some((m) => m.role === "user")) return { ok: true, skipped: "no visitor messages" };
    conv = { id: newId(), mode: "voice", startedAt: started.toISOString(), messages: [], name: "", source: {}, channel: sourceLabel({}) };
    created = true;
    await linkCall(elevenId, conv.id);
  }
  const call = {
    elevenId, startedAt: started.toISOString(), duration: Math.round(meta.call_duration_secs || 0),
    summary: clip(analysis.transcript_summary, 1500), successful: analysis.call_successful || "", ended: clip(meta.termination_reason, 200),
    turns: transcript.length,
  };
  conv.calls = [...(conv.calls || []).filter((c) => c.elevenId !== elevenId), call].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  // the page keeps every call of a visit in one conversation; use ElevenLabs' transcript when the page saved less
  const pageCount = (conv.messages || []).length;
  if (created || (conv.calls.length === 1 && transcript.length > pageCount)) conv.messages = transcript;
  await saveConv(conv);
  return { ok: true, convId: conv.id, created };
}

/* ---------- ElevenLabs API (for importing past calls) ---------- */
export async function eleven(path) {
  const r = await fetch("https://api.elevenlabs.io" + path, { headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d?.detail?.message || d?.detail || `ElevenLabs ${r.status}`); e.status = r.status; throw e; }
  return d;
}
