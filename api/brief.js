// The brief: Claude turns a conversation with the orb into a short plan.
// POST makes it and returns the preview part. GET returns the full brief once the visitor asked for it by email.
import { allow, clientIp, json } from "../lib/server.js";
import { getBrief, loadConv, putBrief, saveConv } from "../lib/conv.js";
import { caseCard, claude, cleanSource, loadContext, newId, sourceLabel } from "../lib/orb-context.js";

const clip = (v, n) => String(v ?? "").slice(0, n).trim();
const strs = (v, max, n) => (Array.isArray(v) ? v : []).map((x) => clip(x, n)).filter(Boolean).slice(0, max);
const STR = { type: "string" }, LIST = (d) => ({ type: "array", items: STR, description: d });
const BRIEF_TOOL = {
  name: "write_brief",
  description: "The project brief for the visitor.",
  input_schema: {
    type: "object",
    properties: {
      company: { type: "string", description: "The visitor's company name if they said it, else empty." },
      headline: { type: "string", description: "One sentence, at most 14 words: what Eloqwnt would make and the outcome for them." },
      told: LIST("2 to 4 short points: their situation and goal, in their terms."),
      approach: { type: "string", description: "2 sentences: how Eloqwnt would approach it." },
      recommendation: { type: "string", description: "2 to 3 sentences: the recommended path and why it fits." },
      phases: { type: "array", items: { type: "object", properties: { name: STR, weeks: { type: "string", description: "e.g. Weeks 1–3" }, items: LIST("2 to 3 deliverables") }, required: ["name", "weeks", "items"] } },
      prices: { type: "array", description: "Only services and starting prices that are in the knowledge base.", items: { type: "object", properties: { service: STR, price: STR }, required: ["service", "price"] } },
      case_ids: LIST("Up to 3 ids of the most relevant cases from the knowledge base."),
      prep: LIST("3 things to bring to the call."),
      quick_wins: LIST("3 specific, practical things they can do this week on their own, without hiring anyone. Tailored to their situation, each one sentence with a concrete action."),
      references: { type: "array", description: "2 to 3 well-known real brands (any sector) worth studying for their direction, with why. Never imply Eloqwnt worked with them.", items: { type: "object", properties: { brand: STR, why: { type: "string", description: "One sentence: what to learn from them for this project." } }, required: ["brand", "why"] } },
      pitfalls: LIST("3 common mistakes companies in their situation make, each with how to avoid it, one sentence each."),
      agency_questions: LIST("4 sharp questions to ask any agency they talk to (including us), so they can compare fairly. Not self-serving."),
    },
    required: ["company", "headline", "told", "approach", "recommendation", "phases", "prices", "case_ids", "prep", "quick_wins", "references", "pitfalls", "agency_questions"],
  },
};
const LOCKED = ["Plan with weeks and starting prices", "3 quick wins for this week", "Brands worth studying, and why", "Mistakes to avoid", "Questions to ask any agency", "Matching case studies"];

function prompt(ctx, conv) {
  const talk = conv.messages.filter((m) => !m.kind || m.kind === "text").map((m) => (m.role === "user" ? "Visitor: " : "Orb: ") + m.text).join("\n");
  return `You write a short project brief for a website visitor of Eloqwnt, a brand and web design agency, from their conversation with the agency's assistant (the orb).

Use only what the visitor said and facts from the knowledge base. Never invent clients, results, prices or timelines that aren't in the knowledge base. If the visitor didn't say something, leave it out rather than guess. Write in plain, confident English, second person ("you"), no jargon.

The brief must be worth their time even if they never hire Eloqwnt: the quick wins, brands to study, mistakes to avoid and questions for agencies should be genuinely useful, specific to their situation, and honest. Quick wins and pitfalls may use general professional knowledge; facts about Eloqwnt (prices, cases, timelines) must come from the knowledge base.

<knowledge_base>
${ctx.knowledge}
</knowledge_base>

<conversation>
${talk}
</conversation>

Answer with the write_brief tool.`;
}

export async function POST(request) {
  if (!process.env.ANTHROPIC_API_KEY) return json({ error: "Briefs aren’t connected yet.", code: "not_configured" }, 503);
  if (!(await allow(`orb:brief:${clientIp(request)}`, 8, 3600))) return json({ error: "Too many briefs this hour. Try again later.", code: "rate_limited" }, 429);
  const body = await request.json().catch(() => ({}));

  let conv = await loadConv(body.convId);
  if (!conv) {
    // Voice conversations (and local preview) arrive from the page.
    const msgs = (Array.isArray(body.messages) ? body.messages : []).slice(-40)
      .map((m) => ({ role: m.role === "orb" ? "orb" : "user", text: clip(m.text, 1500), at: Date.now() })).filter((m) => m.text);
    const source = cleanSource(body.source);
    conv = { id: newId(), mode: body.mode === "voice" ? "voice" : "chat", startedAt: new Date().toISOString(), messages: msgs, name: clip(body.name, 60), source, channel: sourceLabel(source) };
  }
  if (body.name && !conv.name) conv.name = clip(body.name, 60);
  const said = conv.messages.filter((m) => m.role === "user" && (!m.kind || m.kind === "text"));
  if (said.length < 2 || said.reduce((n, m) => n + m.text.length, 0) < 40) {
    return json({ error: "Tell the orb a little about your project first, then I can write the brief.", code: "too_short" }, 400);
  }

  let ctx, out;
  try {
    ctx = await loadContext();
    out = await claude({ system: "You write concise, accurate project briefs.", messages: [{ role: "user", content: prompt(ctx, conv) }], maxTokens: 2500, model: process.env.ORB_BRIEF_MODEL, tool: BRIEF_TOOL });
    if (!out || !out.headline) throw new Error("Unreadable brief");
  } catch (e) {
    console.error("brief", e);
    return json({ error: "The brief didn’t come together. Try again.", code: "upstream_error" }, 502);
  }

  const cases = strs(out.case_ids, 3, 80).map((id) => caseCard(ctx.byId.get(id), ctx.byId)).filter(Boolean);
  const brief = {
    id: newId(), convId: conv.id, createdAt: new Date().toISOString(), unlocked: false,
    name: conv.name || "", company: clip(out.company, 80),
    headline: clip(out.headline, 160), told: strs(out.told, 4, 220),
    approach: clip(out.approach, 500), recommendation: clip(out.recommendation, 700),
    phases: (Array.isArray(out.phases) ? out.phases : []).slice(0, 3).map((p) => ({ name: clip(p?.name, 80), weeks: clip(p?.weeks, 40), items: strs(p?.items, 4, 160) })).filter((p) => p.name),
    prices: (Array.isArray(out.prices) ? out.prices : []).slice(0, 4).map((p) => ({ service: clip(p?.service, 80), price: clip(p?.price, 60) })).filter((p) => p.service && p.price),
    cases, prep: strs(out.prep, 3, 200),
    quickWins: strs(out.quick_wins, 3, 260),
    references: (Array.isArray(out.references) ? out.references : []).slice(0, 3).map((r) => ({ brand: clip(r?.brand, 60), why: clip(r?.why, 240) })).filter((r) => r.brand && r.why),
    pitfalls: strs(out.pitfalls, 3, 260),
    agencyQuestions: strs(out.agency_questions, 4, 220),
  };
  await putBrief(brief);
  conv.briefId = brief.id;
  conv.events = [...(conv.events || []), { type: "brief_preview", at: Date.now() }];
  await saveConv(conv).catch((e) => console.error("conv save", e));

  return json({ briefId: brief.id, convId: conv.id, preview: { name: brief.name, company: brief.company, headline: brief.headline, told: brief.told, approach: brief.approach, teaser: brief.phases.map((p) => `${p.name} · ${p.weeks}. ${p.items.join(", ")}.`).join(" "), locked: LOCKED, freebie: brief.quickWins[0] || "" } });
}

export async function GET(request) {
  const id = new URL(request.url).searchParams.get("id");
  const b = await getBrief(id);
  if (!b) return json({ error: "This brief doesn’t exist or has expired." }, 404);
  if (!b.unlocked) return json({ error: "This brief hasn’t been sent yet." }, 403);
  const { convId, contactId, leadId, email, ...pub } = b;
  return json(pub);
}
