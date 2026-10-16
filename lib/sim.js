// Script simulator: synthetic visitors (built from profiles) talk to the real orb, one play at a time,
// so you can compare scripts before real visitors see them. Everything is stored in Redis:
//   sim:profiles            hash  id → profile
//   sim:runs                zset  run ids by time
//   sim:run:<id>            run (settings, progress, people, results, insights)
//   sim:c:<id>              hash  conversation key → simulated conversation
import { redis } from "./server.js";
import { caseCard, claude, compilePlaybook, loadContext, newId } from "./orb-context.js";
import { REPLY_TOOL, STAGES, orbSystem } from "./orb-chat.js";

const clip = (v, n) => String(v ?? "").slice(0, n).trim();
const parse = (raw) => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } };
const VISITOR_MODEL = () => process.env.ORB_SIM_MODEL || process.env.ORB_MODEL || "claude-sonnet-5-5";
export const MAX_VISITOR_TURNS = 8;
export const PARALLEL = 6;

/* ---------- profiles ---------- */
const PROFILE_FIELDS = {
  title: { type: "string", description: "Short name for this kind of client, e.g. Fintech CFO after Series A." },
  who: { type: "string", description: "One sentence: company type, size, situation." },
  cares: { type: "string", description: "What they care about most, a few words." },
  worried: { type: "string", description: "Their main worry about hiring an agency, a few words." },
  attitude: { type: "string", enum: ["skeptical", "curious", "ready"], description: "skeptical = needs proof, curious = exploring, ready = wants to start." },
  mode: { type: "string", enum: ["chat", "voice"], description: "How they'd most likely talk to the orb." },
};
const PROFILE_TOOL = { name: "profile", description: "A client profile for the simulator.", input_schema: { type: "object", properties: PROFILE_FIELDS, required: Object.keys(PROFILE_FIELDS) } };
const PROFILES_TOOL = {
  name: "profiles", description: "Client profiles found in real conversations.",
  input_schema: { type: "object", properties: { profiles: { type: "array", items: { type: "object", properties: { ...PROFILE_FIELDS, matches: { type: "integer", description: "How many of the real conversations fit this profile." } }, required: [...Object.keys(PROFILE_FIELDS), "matches"] } } }, required: ["profiles"] },
};
export const cleanProfile = (p, origin) => ({
  id: p.id || newId(), title: clip(p.title, 80) || "Untitled profile", who: clip(p.who, 240), cares: clip(p.cares, 140), worried: clip(p.worried, 140),
  attitude: ["skeptical", "curious", "ready"].includes(p.attitude) ? p.attitude : "curious", mode: p.mode === "voice" ? "voice" : "chat",
  origin: origin || p.origin || { kind: "you" }, createdAt: p.createdAt || new Date().toISOString(),
});
export async function listProfiles() {
  const flat = (await redis("HGETALL", "sim:profiles")) || [];
  const out = []; for (let i = 1; i < flat.length; i += 2) { const p = parse(flat[i]); if (p) out.push(p); }
  return out.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}
export const saveProfile = (p) => redis("HSET", "sim:profiles", p.id, JSON.stringify(p));

export async function profileFromText(text, usage) {
  const out = await claude({
    system: "You turn a short description of a client type into a profile for testing a sales chat. Keep each field short and concrete. Don't invent anything the description contradicts.",
    messages: [{ role: "user", content: `Description:\n${clip(text, 1500)}\n\nAnswer with the profile tool.` }], tool: PROFILE_TOOL, usage,
  });
  return cleanProfile(out, { kind: "you" });
}

/** Group real conversations into 2–4 profiles. `real` = [{first, told, mode, channel}] */
export async function profilesFromReal(real, usage) {
  const lines = real.slice(0, 120).map((r, i) => `${i + 1}. [${r.mode}] ${clip(r.first, 200)}${r.told ? " | brief: " + clip(r.told, 300) : ""}`).join("\n");
  const out = await claude({
    system: "You group real website conversations of a brand and web design agency into the kinds of clients who come. Only make a profile that several conversations fit.",
    messages: [{ role: "user", content: `Real conversations (first message, and what the brief said they told us):\n${lines}\n\nFind 2 to 4 distinct profiles. Answer with the profiles tool.` }], tool: PROFILES_TOOL, maxTokens: 3000, usage,
  });
  return (out.profiles || []).slice(0, 4).map((p) => cleanProfile(p, { kind: "leads", count: Math.max(1, Number(p.matches) || 1) }));
}

/* ---------- people: one profile becomes many different visitors ---------- */
const PEOPLE_TOOL = {
  name: "people", description: "Distinct synthetic visitors.",
  input_schema: { type: "object", properties: { people: { type: "array", items: { type: "object", properties: {
    name: { type: "string" }, age: { type: "integer" }, role: { type: "string", description: "Job title and company, e.g. CFO at a Dubai payments startup, 45 people" },
    style: { type: "string", description: "How they write or talk, one short sentence" }, goal: { type: "string", description: "What they want from an agency right now" },
    worry: { type: "string" }, would_book_if: { type: "string", description: "What would make them book a call" }, patience: { type: "integer", description: "1 (leaves fast) to 5 (very patient). Most real visitors are 1–3." },
  }, required: ["name", "age", "role", "style", "goal", "worry", "would_book_if", "patience"] } } }, required: ["people"] },
};
export async function makePeople(profile, n, usage) {
  const out = await claude({
    system: "You create realistic, varied website visitors for testing a sales chat. Vary age, city, company size, style, patience and what would convince them. Real visitors are busy: most have low patience.",
    messages: [{ role: "user", content: `Profile: ${profile.title}\nWho: ${profile.who}\nCares about: ${profile.cares}\nWorried that: ${profile.worried}\nAttitude: ${profile.attitude}\n\nCreate ${n} different people who fit this profile. Answer with the people tool.` }],
    tool: PEOPLE_TOOL, maxTokens: Math.min(16000, 400 + n * 220), usage, model: VISITOR_MODEL(),
  });
  const people = (out.people || []).slice(0, n).map((p, i) => ({
    i, name: clip(p.name, 40) || `Person ${i + 1}`, age: Number(p.age) || null, role: clip(p.role, 160), style: clip(p.style, 160), goal: clip(p.goal, 200),
    worry: clip(p.worry, 160), wouldBookIf: clip(p.would_book_if, 200), patience: Math.min(5, Math.max(1, Number(p.patience) || 2)),
  }));
  while (people.length < n) people.push({ ...people[people.length % Math.max(1, people.length)], i: people.length }); // the model gave fewer
  return people;
}

/* ---------- one exchange: the visitor speaks, then the orb answers ---------- */
const VISITOR_TOOL = {
  name: "visitor_turn", description: "Your next move as the visitor.",
  input_schema: { type: "object", properties: {
    message: { type: "string", description: "What you type (or say) next. Empty only when you leave without a word." },
    action: { type: "string", enum: ["continue", "leave", "accept_brief", "book_call"], description: "continue = keep talking; leave = close the tab now; accept_brief = press 'Get my brief' and give your email; book_call = open the calendar and book a call." },
    reason: { type: "string", description: "Only for leave, accept_brief or book_call: why, in one short sentence, in your own words." },
  }, required: ["message", "action", "reason"] },
};
function visitorSystem(person, profile, mode) {
  return `You are role-playing one real person visiting the website of Eloqwnt, a brand and web design agency, and talking to the site's assistant (the orb). Stay in character; never say you are an AI or a simulation.

Who you are: ${person.name}, ${person.age || ""}, ${person.role}.
Kind of client: ${profile.title}. ${profile.who}
What you want: ${person.goal}
What worries you: ${person.worry}
You'd book a call if: ${person.wouldBookIf}
How you ${mode === "voice" ? "talk" : "write"}: ${person.style}
Patience: ${person.patience} of 5.

Behave like a busy real person, not a polite tester:
- ${mode === "voice" ? "You are speaking out loud: short spoken sentences." : "You type short messages, 1 or 2 sentences."}
- Say what you came for in your own words; don't recite all of the above at once.
- Leave (action "leave") as soon as a real person with your patience would close the tab: the orb dodges your question, shows proof that doesn't fit you, asks too many questions, or can't tell you what you need.
- When the site shows the "Get my brief" button, accept it (action "accept_brief") only if it seems worth giving your email for.
- When the orb suggests a call and you are convinced enough, book it (action "book_call"). Don't book just to be nice.
- If the orb asks your name, give your first name.
Answer with the visitor_turn tool.`;
}
/** What the visitor sees of an orb message, including what the site shows under it. */
function orbAsSeen(m) {
  const extra = [m.case ? `[A case study card is shown: ${m.case}]` : "", m.offerBrief ? "[A “Get my brief” button appears: a short plan, starting prices and matching work, sent to your email]" : "", m.bookCall ? "[The site opens a calendar to book a 20-minute call]" : ""].filter(Boolean).join(" ");
  return clip(String(m.text || "").replace(/<\/?m>/g, ""), 1500) + (extra ? "\n" + extra : "");
}

async function visitorTurn(c, ctxRun, usage) {
  const msgs = [{ role: "user", content: "(You just opened the chat on the site. Write your first message.)" }];
  for (const m of c.messages) {
    if (m.role === "visitor") msgs.push({ role: "assistant", content: m.text || "(silence)" });
    else if (m.role === "orb") msgs.push({ role: "user", content: orbAsSeen(m) });
    else if (m.role === "note") msgs.push({ role: "user", content: m.text });
  }
  // keep roles alternating (notes may follow orb messages)
  const merged = []; for (const m of msgs) { const last = merged[merged.length - 1]; if (last && last.role === m.role) last.content += "\n" + m.content; else merged.push({ ...m }); }
  try {
    return await claude({ system: visitorSystem(c.person, ctxRun.profile, ctxRun.profile.mode), messages: merged, maxTokens: 600, model: VISITOR_MODEL(), tool: VISITOR_TOOL, usage });
  } catch (e) {
    if (process.env.ORB_SIM_MODEL && /model/i.test(e.message)) return claude({ system: visitorSystem(c.person, ctxRun.profile, ctxRun.profile.mode), messages: merged, maxTokens: 600, tool: VISITOR_TOOL, usage });
    throw e;
  }
}

async function orbTurn(c, ctx, sales, usage) {
  const conv = {
    messages: c.messages.filter((m) => m.role !== "note" || m.forOrb).map((m) => ({ role: m.role === "orb" ? "orb" : "user", text: m.role === "note" ? m.text : m.text })),
    name: c.named ? c.person.name : "", askedName: c.askedName, offeredBrief: c.offeredBrief,
  };
  const msgs = []; for (const m of conv.messages) { const role = m.role === "orb" ? "assistant" : "user"; const last = msgs[msgs.length - 1]; if (last && last.role === role) last.content += "\n" + m.text; else msgs.push({ role, content: m.text || "…" }); }
  const out = await claude({ system: orbSystem(ctx, conv, sales), messages: msgs, maxTokens: 1000, model: process.env.ORB_CHAT_MODEL, tool: REPLY_TOOL, usage });
  const card = out.case_id ? caseCard(ctx.byId.get(String(out.case_id)), ctx.byId) : null;
  return {
    role: "orb", text: clip(String(out.reply || "").replace(/,?\s*"?(case_id|ask_name|offer_brief|book_call|play|stage)"?\s*:[\s\S]*$/, ""), 1200) || "…",
    stage: STAGES.includes(out.stage) ? out.stage : "answering", play: clip(out.play, 120), case: card ? card.title || card.client || card.id : "", caseId: card?.id || "",
    offerBrief: !!out.offer_brief, bookCall: !!out.book_call, askName: !!out.ask_name,
  };
}

/** Advance one simulated conversation by one exchange. Mutates and returns c. */
export async function advance(c, ctx, script, profile, usage) {
  const v = await visitorTurn(c, { profile }, usage);
  const text = clip(v.message, 1000);
  const askedBefore = c.askedName;
  if (text) c.messages.push({ role: "visitor", text });
  c.turns = (c.turns || 0) + 1;
  if (askedBefore && !c.named && text) c.named = true;
  const action = ["leave", "accept_brief", "book_call"].includes(v.action) ? v.action : "continue";
  if (action === "accept_brief" && !c.email) {
    c.email = true; c.emailReason = clip(v.reason, 200);
    c.messages.push({ role: "note", text: "(You pressed “Get my brief” and left your email. The brief is on its way. Carry on, or leave.)", forOrb: false });
  }
  if (action === "book_call") { c.booked = true; c.state = "done"; c.end = { how: "booked", reason: clip(v.reason, 240), stage: lastStage(c) }; return c; }
  if (action === "leave") { c.state = "done"; c.end = { how: c.email ? "email" : "left", reason: clip(v.reason, 240), stage: lastStage(c) }; return c; }
  if (c.turns >= MAX_VISITOR_TURNS) { c.state = "done"; c.end = { how: c.email ? "email" : "left", reason: "Still talking after many messages without a next step.", stage: lastStage(c) }; return c; }
  const o = await orbTurn(c, ctx, script.sales, usage);
  c.messages.push(o);
  if (o.askName) c.askedName = true;
  if (o.offerBrief) c.offeredBrief = true;
  if (o.case) c.caseShown = true;
  return c;
}
const lastStage = (c) => [...c.messages].reverse().find((m) => m.role === "orb")?.stage || "opening";

/* ---------- scripts (plays) ---------- */
export async function scriptsFor(ids) {
  const ctx = await loadContext();
  const all = [{ id: "live", title: "Live playbook (all plays)", sales: ctx.sales }, ...ctx.plays.map((p) => ({ id: p.id, title: p.title, sales: compilePlaybook(ctx.nodes, [p], ctx.byId) }))];
  return { ctx, scripts: ids ? all.filter((s) => ids.includes(s.id)) : all };
}

/* ---------- results ---------- */
export function summarise(run, convs) {
  const cells = {};
  for (const c of convs) {
    const k = c.scriptId + "|" + c.profileId;
    const cell = cells[k] || (cells[k] = { scriptId: c.scriptId, profileId: c.profileId, n: 0, booked: 0, email: 0, caseShown: 0, offered: 0, stops: {}, reasons: [] });
    cell.n++; if (c.booked) cell.booked++; if (c.email) cell.email++; if (c.caseShown) cell.caseShown++; if (c.offeredBrief) cell.offered++;
    if (c.end && c.end.how === "left") { cell.stops[c.end.stage] = (cell.stops[c.end.stage] || 0) + 1; if (cell.reasons.length < 12 && c.end.reason) cell.reasons.push(c.end.reason); }
  }
  return Object.values(cells).map((c) => ({ ...c, bookedPer100: c.n ? Math.round(c.booked * 100 / c.n) : 0, emailPer100: c.n ? Math.round(c.email * 100 / c.n) : 0 }));
}

const INSIGHTS_TOOL = { name: "insights", description: "What the run shows.", input_schema: { type: "object", properties: { findings: { type: "array", items: { type: "string" }, description: "2 to 4 findings, one sentence each, concrete, with numbers per 100." } }, required: ["findings"] } };
export async function insightsFor(run, cells, usage) {
  const name = (id, list) => (list.find((x) => x.id === id) || {}).title || id;
  const table = cells.map((c) => `${name(c.scriptId, run.scripts)} × ${name(c.profileId, run.profiles)}: ${c.n} people, booked ${c.bookedPer100}/100, email ${c.emailPer100}/100, saw a case ${c.caseShown}, left at: ${Object.entries(c.stops).map(([s, n]) => s + " " + n).join(", ") || "none"}; why they left: ${c.reasons.slice(0, 6).join(" / ")}`).join("\n");
  const out = await claude({
    system: "You read the results of a simulated test of sales chat scripts for a design agency and say what they show. Plain English, no jargon, numbers per 100. Only claim what the data shows. Point out where people leave and why, and which script fits which kind of client.",
    messages: [{ role: "user", content: table + "\n\nAnswer with the insights tool." }], tool: INSIGHTS_TOOL, usage,
  });
  return (out.findings || []).slice(0, 4).map((f) => clip(f, 300));
}

const KEEP_TOOL = { name: "what_would_help", description: "What would have kept this visitor.", input_schema: { type: "object", properties: { kept_by: { type: "string", description: "One sentence: what would have kept them or got them to book." }, fix: { type: "string", description: "One sentence: the concrete change to make (a fact to add to the knowledge base, or a change to the script)." }, node_id: { type: "string", description: "Id of the knowledge base node to fill or fix, if the fix is there; else empty." } }, required: ["kept_by", "fix", "node_id"] } };
export async function explain(c, profile, ctx, usage) {
  const talk = c.messages.filter((m) => m.role !== "note").map((m) => (m.role === "visitor" ? "Visitor: " : "Orb: ") + String(m.text).replace(/<\/?m>/g, "")).join("\n");
  const gaps = ctx.nodes.map((n) => { const miss = (n.facts || []).filter((f) => !String(f.v || "").trim() || /^\[.*\]$/.test(String(f.v).trim())).map((f) => f.k); return miss.length ? `${n.id} (${n.title}): missing ${miss.join(", ")}` : ""; }).filter(Boolean).slice(0, 60).join("\n");
  return claude({
    system: "You look at one simulated sales chat for a design agency and say, briefly and concretely, what would have kept the visitor. Prefer fixes the team can make: a missing fact in the knowledge base (name the node id) or a change in how the orb answers.",
    messages: [{ role: "user", content: `Visitor: ${c.person.name}, ${c.person.role}. Wanted: ${c.person.goal}. Would book if: ${c.person.wouldBookIf}.\nOutcome: ${c.end?.how} at ${c.end?.stage}. Their reason: ${c.end?.reason}\n\nConversation:\n${talk}\n\nKnowledge base gaps:\n${gaps || "none"}\n\nAnswer with the what_would_help tool.` }],
    tool: KEEP_TOOL, usage,
  });
}

/* ---------- storage ---------- */
export const loadRun = async (id) => parse(await redis("GET", "sim:run:" + id));
export const saveRun = (r) => redis("SET", "sim:run:" + r.id, JSON.stringify(r));
export async function loadConvs(runId, keys) {
  if (keys) { if (!keys.length) return []; return ((await redis("HMGET", "sim:c:" + runId, ...keys)) || []).map(parse).filter(Boolean); }
  const flat = (await redis("HGETALL", "sim:c:" + runId)) || [];
  const out = []; for (let i = 1; i < flat.length; i += 2) { const c = parse(flat[i]); if (c) out.push(c); }
  return out;
}
export const saveConvs = (runId, list) => list.length ? redis("HSET", "sim:c:" + runId, ...list.flatMap((c) => [c.key, JSON.stringify(c)])) : null;

/* ---------- recommendations: what to change in each playbook ---------- */
const AREAS = ["opener", "questions", "proof", "objections", "close", "offer", "knowledge_base"];
const RECS_TOOL = {
  name: "recommendations", description: "Where each playbook loses people and what to change.",
  input_schema: { type: "object", properties: {
    playbooks: { type: "array", items: { type: "object", properties: {
      script_id: { type: "string" },
      verdict: { type: "string", description: "One sentence: how this playbook did overall, with numbers per 100." },
      bottleneck: { type: "object", properties: { stage: { type: "string", enum: STAGES }, share: { type: "integer", description: "Percent of the people who left that left at this stage." }, why: { type: "string", description: "Why people leave here, from their own reasons. One or two sentences." } }, required: ["stage", "share", "why"] },
      works_best_for: { type: "array", items: { type: "object", properties: { profile: { type: "string" }, why: { type: "string" } }, required: ["profile", "why"] } },
      struggles_with: { type: "array", items: { type: "object", properties: { profile: { type: "string" }, why: { type: "string" } }, required: ["profile", "why"] } },
      changes: { type: "array", description: "2 to 5 concrete changes, most impactful first.", items: { type: "object", properties: {
        area: { type: "string", enum: AREAS }, change: { type: "string", description: "Exactly what to change, concrete enough to paste in (a new opener line, a question to drop, which case to show)." },
        why: { type: "string", description: "Which result or reason this fixes." }, node_id: { type: "string", description: "For knowledge_base changes: the id of the node to fill or fix; else empty." },
      }, required: ["area", "change", "why", "node_id"] } },
    }, required: ["script_id", "verdict", "bottleneck", "works_best_for", "struggles_with", "changes"] } },
    next_test: { type: "string", description: "One sentence: the most useful next simulation to run." },
  }, required: ["playbooks", "next_test"] },
};
export async function recommendFor(run, cells, convs, ctx, usage) {
  const pname = (id) => (run.profiles.find((p) => p.id === id) || {}).title || id;
  const blocks = run.scripts.map((s) => {
    const mine = cells.filter((c) => c.scriptId === s.id);
    const rows = mine.map((c) => `- ${pname(c.profileId)}: ${c.n} people · booked ${c.bookedPer100}/100 · email ${c.emailPer100}/100 · left at: ${Object.entries(c.stops).map(([k, n]) => k + " " + n).join(", ") || "none"} · why they left: ${c.reasons.slice(0, 6).join(" / ") || "—"}`).join("\n");
    const samples = convs.filter((c) => c.scriptId === s.id && c.end?.how === "left").slice(0, 2).map((c) => c.messages.filter((m) => m.role !== "note").slice(-6).map((m) => (m.role === "visitor" ? "Visitor: " : `Orb (${m.stage || ""}): `) + String(m.text).replace(/<\/?m>/g, "").slice(0, 220)).join("\n")).join("\n---\n");
    return `## Playbook "${s.title}" (script_id: ${s.id})\nThe instructions the orb followed:\n${String(s.sales || "").slice(0, 3500)}\n\nResults by profile:\n${rows}\n\nEnd of two conversations where the visitor left:\n${samples || "none"}`;
  }).join("\n\n");
  const gaps = ctx.nodes.map((n) => { const miss = (n.facts || []).filter((f) => !String(f.v || "").trim() || /^\[.*\]$/.test(String(f.v).trim())).map((f) => f.k); return miss.length ? `${n.id} (${n.title}): missing ${miss.slice(0, 6).join(", ")}` : ""; }).filter(Boolean).slice(0, 50).join("\n");
  const out = await claude({
    system: "You are a sales-conversation analyst for a brand and web design agency. You read simulated test results of the agency's chat playbooks and tell the team, plainly and concretely, where each playbook loses people, who it works for and what to change. Use numbers per 100. Base every claim on the data given. Changes must be specific enough to apply today: quote new lines, name the case to show, name the knowledge base node to fill.",
    messages: [{ role: "user", content: `${blocks}\n\nKnowledge base gaps (facts the orb doesn't know):\n${gaps || "none"}\n\nAnswer with the recommendations tool, one entry per playbook.` }],
    tool: RECS_TOOL, maxTokens: 6000, usage,
  });
  const ids = new Set(ctx.nodes.map((n) => n.id));
  return {
    at: new Date().toISOString(), next: clip(out.next_test, 300),
    playbooks: (out.playbooks || []).filter((p) => run.scripts.some((s) => s.id === p.script_id)).map((p) => ({
      scriptId: p.script_id, verdict: clip(p.verdict, 300),
      bottleneck: { stage: STAGES.includes(p.bottleneck?.stage) ? p.bottleneck.stage : "", share: Math.max(0, Math.min(100, Number(p.bottleneck?.share) || 0)), why: clip(p.bottleneck?.why, 400) },
      best: (p.works_best_for || []).slice(0, 4).map((x) => ({ profile: clip(x.profile, 100), why: clip(x.why, 240) })),
      worst: (p.struggles_with || []).slice(0, 4).map((x) => ({ profile: clip(x.profile, 100), why: clip(x.why, 240) })),
      changes: (p.changes || []).slice(0, 5).map((x) => ({ area: AREAS.includes(x.area) ? x.area : "questions", change: clip(x.change, 500), why: clip(x.why, 300), nodeId: ids.has(x.node_id) ? x.node_id : "" })),
    })),
  };
}
