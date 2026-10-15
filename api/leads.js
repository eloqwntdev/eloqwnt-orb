// Leads and conversations for the dashboard (signed-in only).
// GET            → recent leads (people who asked for the brief by email)
// GET ?view=convs → recent conversations with the orb, with or without a lead
// GET ?id=<lead> or ?conv=<conv> → one lead or conversation with its brief and transcript
// DELETE ?id=<lead> → remove a test lead from the list (the GHL contact stays in GHL)
import { isAuthed, json, redis, redisConfigured } from "../lib/server.js";
import { getBrief, loadConv } from "../lib/conv.js";

const ID = /^[a-z0-9]{8,20}$/;
const parse = (raw) => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } };

async function guard(request) {
  if (!(await isAuthed(request))) return json({ error: "Sign in to see leads." }, 401);
  if (!redisConfigured()) return json({ error: "Storage isn’t connected yet." }, 503);
  return null;
}

const ghlUrl = (contactId) => process.env.GHL_LOCATION_ID && contactId
  ? `https://app.gohighlevel.com/v2/location/${process.env.GHL_LOCATION_ID}/contacts/detail/${contactId}` : "";

const userTurns = (c) => (c?.messages || []).filter((m) => m.role === "user" && (!m.kind || m.kind === "text"));
const firstAsk = (c) => (userTurns(c)[0]?.text || "").slice(0, 160);

function leadRow(l, brief) {
  return {
    id: l.id, createdAt: l.createdAt, name: l.name || "", email: l.email, company: l.company || "",
    mode: l.mode, channel: l.channel || "direct", headline: brief?.headline || "",
    mail: l.mail?.status || (l.ghl?.status === "sent" ? "ghl" : "off"), ghl: l.ghl?.status || "off",
  };
}

function convRow(c) {
  return {
    id: c.id, startedAt: c.startedAt, updatedAt: c.updatedAt, name: c.name || "", mode: c.mode, channel: c.channel || "direct",
    turns: userTurns(c).length, first: firstAsk(c), brief: !!c.briefId, leadId: c.leadId || "",
  };
}

function transcript(c) {
  return (c?.messages || []).map((m) => ({ role: m.role, text: m.text, at: m.at || null, kind: m.kind || "", play: m.play || "", stage: m.stage || "" }));
}

async function many(prefix, ids) {
  if (!ids.length) return [];
  const raws = await redis("MGET", ...ids.map((id) => prefix + id));
  return (raws || []).map(parse);
}

export async function GET(request) {
  const denied = await guard(request);
  if (denied) return denied;
  const u = new URL(request.url);
  const id = u.searchParams.get("id"), convId = u.searchParams.get("conv");

  if (id) {
    if (!ID.test(id)) return json({ error: "That id isn’t valid." }, 400);
    const lead = parse(await redis("GET", "lead:" + id));
    if (!lead) return json({ error: "This lead doesn’t exist any more." }, 404);
    const [brief, conv] = await Promise.all([getBrief(lead.briefId), loadConv(lead.convId)]);
    return json({
      lead: { ...lead, ghlUrl: ghlUrl(lead.ghl?.contactId) },
      brief: brief ? { ...brief, convId: undefined, contactId: undefined } : null,
      conv: conv ? { id: conv.id, mode: conv.mode, startedAt: conv.startedAt, source: conv.source || {}, channel: conv.channel, messages: transcript(conv), events: conv.events || [] } : null,
    });
  }

  if (convId) {
    if (!ID.test(convId)) return json({ error: "That id isn’t valid." }, 400);
    const conv = await loadConv(convId);
    if (!conv) return json({ error: "This conversation has expired." }, 404);
    const brief = conv.briefId ? await getBrief(conv.briefId) : null;
    return json({
      conv: { ...convRow(conv), source: conv.source || {}, messages: transcript(conv), events: conv.events || [] },
      brief: brief ? { ...brief, convId: undefined, contactId: undefined } : null,
    });
  }

  if (u.searchParams.get("view") === "convs") {
    const ids = await redis("ZREVRANGE", "convs", 0, 149);
    const convs = (await many("conv:", ids || [])).filter(Boolean);
    // expired conversations drop out of Redis but stay in the index; tidy the index as we go
    const gone = (ids || []).filter((x, i) => !convs.some((c) => c.id === x));
    if (gone.length) redis("ZREM", "convs", ...gone).catch(() => {});
    return json({ convs: convs.filter((c) => userTurns(c).length).map(convRow) });
  }

  const ids = await redis("ZREVRANGE", "leads", 0, 199);
  const leads = (await many("lead:", ids || [])).filter(Boolean);
  const briefs = await many("brief:", leads.map((l) => l.briefId));
  return json({ leads: leads.map((l, i) => leadRow(l, briefs[i])) });
}

export async function DELETE(request) {
  const denied = await guard(request);
  if (denied) return denied;
  const id = new URL(request.url).searchParams.get("id");
  if (!ID.test(String(id || ""))) return json({ error: "That id isn’t valid." }, 400);
  const lead = parse(await redis("GET", "lead:" + id));
  await redis("DEL", "lead:" + id);
  await redis("ZREM", "leads", id);
  if (lead?.email && (await redis("HGET", "leads:byEmail", lead.email)) === id) await redis("HDEL", "leads:byEmail", lead.email);
  return json({ ok: true });
}
