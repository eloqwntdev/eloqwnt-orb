// Text chat with the orb for site visitors. Uses the live knowledge base and sales plays.
// The conversation is kept on the server (Redis) so the brief and analytics can read it later.
import { allow, clientIp, json, redisConfigured } from "../lib/server.js";
import { loadConv, saveConv } from "../lib/conv.js";
import { caseCard, claude, cleanSource, loadContext, newId, sourceLabel } from "../lib/orb-context.js";

const MAX_TURNS = 40;
const REPLY_TOOL = {
  name: "orb_reply",
  description: "Send the orb's next chat message to the visitor, plus what the site should show with it.",
  input_schema: {
    type: "object",
    properties: {
      reply: { type: "string", description: "What the orb says to the visitor. Plain text; the closing question may be wrapped in <m></m>." },
      case_id: { type: "string", description: "Id of a knowledge-base case to show as a card, or an empty string." },
      ask_name: { type: "boolean", description: "True only in the reply that asks the visitor's name." },
      offer_brief: { type: "boolean", description: "True in the reply that offers the brief." },
      book_call: { type: "boolean", description: "True when the visitor agreed to a call." },
      play: { type: "string", description: "Title of the sales play being followed, or an empty string." },
      stage: { type: "string", description: "One of: opening, discovery, proof, objection, close, answering." },
    },
    required: ["reply", "case_id", "ask_name", "offer_brief", "book_call", "play", "stage"],
  },
};
const STAGES = ["opening", "discovery", "proof", "objection", "close", "answering"];
const clip = (v, n) => String(v ?? "").slice(0, n).trim();

function system(ctx, conv) {
  const userTurns = conv.messages.filter((m) => m.role === "user").length;
  return `You are "the orb", the assistant on the website of Eloqwnt, a brand and web design agency. A visitor is typing to you in a chat on the site.

Write like a thoughtful person in a chat: short (1 to 3 sentences), warm, plain words, no lists, no markdown, no links, no emoji. Ask at most one question per reply. You may wrap your closing question in <m> and </m>; the site shows it a little lighter.

Follow the private sales instructions. Answer only from the knowledge base. If something isn't in it, say the team will follow up.

<sales_instructions>
${ctx.sales}
</sales_instructions>

<knowledge_base>
${ctx.knowledge}
</knowledge_base>

What the site can do for you (set the matching field in orb_reply):
- Show a case card under your message: set "case_id" to the id of a case from the knowledge base when you mention a case and the visitor wants to see it, or when it clearly answers them. Otherwise null.
- Ask the visitor's name: ${conv.name ? `you know it already: ${conv.name}. Use it now and then, never in every reply.` : conv.askedName ? "you already asked; don't ask again." : userTurns >= 2 ? "you don't know it yet. Ask once, at a natural moment soon, as the last sentence of your reply, for example \"One quick thing before we go on: what should I call you?\" and set \"ask_name\": true in that reply." : "not yet; wait until the visitor has told you a bit more."}
- Offer a brief: the site makes the brief itself, in a few seconds, when the visitor presses the "Get my brief" button that appears under your message whenever you set "offer_brief": true. ${conv.offeredBrief ? "You already offered it once; don't push it again on your own." : "Once you understand what they need, offer a short brief from this chat (a plan, starting prices and matching work) and set \"offer_brief\": true."} Whenever the visitor asks for the brief, says yes to it, or asks where it is, set "offer_brief": true again and tell them to press "Get my brief" just below. Never say you will send or make the brief yourself, never promise it will appear on its own, and never send them to email for it.
- Book a call: when the visitor agrees to a call, set "book_call": true. The site opens the calendar; never read out web addresses.

Always answer with the orb_reply tool. Put only what the visitor should read in "reply".`;
}

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
      out = await claude({ system: system(ctx, conv), messages: msgs, maxTokens: 1000, model: process.env.ORB_CHAT_MODEL, tool: REPLY_TOOL });
    } catch (e) {
      console.error("chat tool call failed, falling back to text", e.status, e.message);
      const text = e.text || await claude({ system: system(ctx, conv) + "\n\n(Reply with just your message to the visitor, as plain text.)", messages: msgs, maxTokens: 800, model: process.env.ORB_CHAT_MODEL });
      out = { reply: text };
    }
  } catch (e) {
    console.error("chat", e);
    conv.messages.pop();
    return json({ error: "The orb didn’t answer. Try again.", code: e.status === 429 ? "rate_limited" : "upstream_error" }, 502);
  }

  const reply = clip(String(out.reply || "").replace(/,?\s*"?(case_id|ask_name|offer_brief|book_call|play|stage)"?\s*:[\s\S]*$/, ""), 1200) || "Sorry, could you say that another way?";
  const card = out.case_id ? caseCard(ctx.byId.get(String(out.case_id)), ctx.byId) : null;
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

  return json({ convId: conv.id, reply, case: card, askName, offerBrief, bookCall: !!out.book_call, name: conv.name || "" });
}
