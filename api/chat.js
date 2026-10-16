// Text chat with the orb for site visitors. Uses the live knowledge base and sales plays.
// The conversation is kept on the server (Redis) so the brief and analytics can read it later.
import { allow, clientIp, json, redisConfigured } from "../lib/server.js";
import { loadConv, saveConv } from "../lib/conv.js";
import { caseCard, claude, cleanSource, loadContext, newId, sourceLabel } from "../lib/orb-context.js";
import { REPLY_TOOL, STAGES, orbSystem as system } from "../lib/orb-chat.js";

const MAX_TURNS = 40;
const clip = (v, n) => String(v ?? "").slice(0, n).trim();

export async function POST(request) {
  if (!process.env.ANTHROPIC_API_KEY) return json({ error: "Chat isn’t connected yet.", code: "not_configured" }, 503);
  const ip = clientIp(request);
  const day = new Date().toISOString().slice(0, 10);
  if (!(await allow(`orb:chat:${ip}`, 60, 3600)) || !(await allow(`orb:chat:${day}`, 4000, 86400))) {
    return json({ error: "Lots of messages right now. Try again in a little while, or email hi@eloqwnt.com.", code: "rate_limited" }, 429);
  }
  const body = await request.json().catch(() => ({}));
  const text = clip(body.text, 1500);
  if (!text) return json({ error: "Type a message first.", code: "invalid_request" }, 400);
  const viewing = ["process", "packages"].includes(body.viewing) ? body.viewing : "";
  const kind = body.kind === "name" ? "name" : body.kind === "skip_name" ? "skip_name" : "text";

  let conv = await loadConv(body.convId);
  if (!conv) {
    conv = { id: newId(), mode: "chat", startedAt: new Date().toISOString(), messages: [], name: "", source: cleanSource(body.source), channel: "" };
    conv.channel = sourceLabel(conv.source);
    // Without storage, carry what the page remembers so the orb keeps context.
    if (!redisConfigured() && Array.isArray(body.history)) {
      conv.messages = body.history.slice(-30).map((m) => ({ role: m.role === "orb" ? "orb" : "user", text: clip(m.text, 1500) })).filter((m) => m.text);
      conv.name = clip(body.name, 60);
      conv.askedName = !!body.askedName; conv.offeredBrief = !!body.offeredBrief;
    }
  }
  if (conv.messages.filter((m) => m.role === "user").length >= MAX_TURNS) {
    return json({ convId: conv.id, reply: "We’ve covered a lot. The best next step is a short call with the team, or I can send you a brief by email.", offerBrief: true, bookCall: false });
  }

  if (kind === "name") {
    conv.name = clip(text.replace(/^(?:i'?m|it'?s|my name is|call me)\s+/i, "").replace(/[.!]+$/, ""), 60);
    conv.messages.push({ role: "user", text: `My name is ${conv.name}.`, kind, at: Date.now() });
  } else if (kind === "skip_name") {
    conv.askedName = true;
    conv.messages.push({ role: "user", text: "(The visitor chose not to share their name. Carry on without it.)", kind, at: Date.now() });
  } else {
    conv.messages.push({ role: "user", text, at: Date.now() });
  }

  let ctx, out;
  try {
    ctx = await loadContext();
    const msgs = conv.messages.map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.text }));
    try {
      out = await claude({ system: system(ctx, { ...conv, viewing }), messages: msgs, maxTokens: 1000, model: process.env.ORB_CHAT_MODEL, tool: REPLY_TOOL });
    } catch (e) {
      console.error("chat tool call failed, falling back to text", e.status, e.message);
      const text = e.text || await claude({ system: system(ctx, { ...conv, viewing }) + "\n\n(Reply with just your message to the visitor, as plain text.)", messages: msgs, maxTokens: 800, model: process.env.ORB_CHAT_MODEL });
      out = { reply: text };
    }
  } catch (e) {
    console.error("chat", e);
    conv.messages.pop();
    return json({ error: "The orb didn’t answer. Try again.", code: e.status === 429 ? "rate_limited" : "upstream_error" }, 502);
  }

  const reply = clip(String(out.reply || "").replace(/,?\s*"?(case_id|ask_name|offer_brief|book_call|play|stage)"?\s*:[\s\S]*$/, ""), 1200) || "Sorry, could you say that another way?";
  const card = out.case_id ? caseCard(ctx.byId.get(String(out.case_id)), ctx.byId) : null;
  const page = ["process", "packages"].includes(out.show_page) ? out.show_page : "";
  const askName = !!out.ask_name && !conv.name && !conv.askedName;
  const offerBrief = !!out.offer_brief;
  if (askName) conv.askedName = true;
  if (offerBrief) conv.offeredBrief = true;
  conv.messages.push({
    role: "orb", text: reply, at: Date.now(),
    stage: STAGES.includes(out.stage) ? out.stage : "answering",
    play: out.play && out.play !== "null" ? clip(out.play, 120) : null,
    caseId: card?.id || null,
  });
  await saveConv(conv).catch((e) => console.error("conv save", e));

  return json({ convId: conv.id, reply, case: card, page, askName, offerBrief, bookCall: !!out.book_call, name: conv.name || "" });
}
