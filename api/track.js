// What visitors do around the conversation, for script analytics.
// POST {type:"voice", convId?, messages, name, source, events}  → saves a voice call (returns convId)
// POST {type:"event", convId, event}                             → notes a step: book_click, brief_open, case_shown, brief_offered
import { allow, clientIp, json } from "../lib/server.js";
import { loadConv, saveConv } from "../lib/conv.js";
import { cleanSource, newId, sourceLabel } from "../lib/orb-context.js";
import { linkCall } from "../lib/voice.js";

const clip = (v, n) => String(v ?? "").slice(0, n).trim();
const EVENTS = ["book_click", "brief_open", "case_shown", "brief_offered", "page_process", "page_packages"];

function addEvents(conv, list) {
  const have = new Set((conv.events || []).map((e) => e.type));
  for (const t of list) if (EVENTS.includes(t) && !have.has(t)) { (conv.events = conv.events || []).push({ type: t, at: Date.now() }); have.add(t); }
}

export async function POST(request) {
  if (!(await allow(`orb:track:${clientIp(request)}`, 240, 3600))) return json({ ok: false }, 429);
  const body = await request.json().catch(() => ({}));

  if (body.type === "event") {
    const conv = await loadConv(body.convId);
    if (!conv) return json({ ok: false });
    addEvents(conv, [String(body.event)]);
    await saveConv(conv);
    return json({ ok: true });
  }

  if (body.type === "voice") {
    const msgs = (Array.isArray(body.messages) ? body.messages : []).slice(-60)
      .map((m) => ({ role: m.role === "orb" ? "orb" : "user", text: clip(m.text, 1500) })).filter((m) => m.text);
    if (!msgs.some((m) => m.role === "user")) return json({ ok: false });
    let conv = await loadConv(body.convId);
    if (!conv || conv.mode !== "voice") {
      const source = cleanSource(body.source);
      conv = { id: newId(), mode: "voice", startedAt: new Date().toISOString(), messages: [], name: "", source, channel: sourceLabel(source) };
    }
    if (msgs.length >= conv.messages.length) conv.messages = msgs.map((m) => ({ ...m, at: Date.now() }));
    if (body.name && !conv.name) conv.name = clip(body.name, 60);
    addEvents(conv, Array.isArray(body.events) ? body.events.map(String) : []);
    await saveConv(conv);
    // link each ElevenLabs call to this conversation, so its webhook lands here
    for (const id of (Array.isArray(body.callIds) ? body.callIds : []).slice(0, 10)) await linkCall(String(id), conv.id);
    return json({ ok: true, convId: conv.id });
  }

  return json({ ok: false }, 400);
}
