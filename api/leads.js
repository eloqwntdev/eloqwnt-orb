// Leads and conversations for the dashboard (signed-in only).
// GET            → recent leads (people who asked for the brief by email)
// GET ?view=convs → recent conversations with the orb, with or without a lead
// GET ?id=<lead> or ?conv=<conv> → one lead or conversation with its brief and transcript
// DELETE ?id=<lead> → remove a test lead from the list (the GHL contact stays in GHL)
import { isAuthed, json, redis, redisConfigured } from "../lib/server.js";
import { convSummary, getBrief, loadConv } from "../lib/conv.js";
import { attachToLead } from "../lib/booking.js";

const ID = /^[a-z0-9]{8,20}$/;
const parse = (raw) => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } };

async function guard(request) {
  if (!(await isAuthed(request))) return json({ error: "Sign in to see leads." }, 401);
  if (!redisConfigured()) return json({ error: "Storage isn’t connected yet." }, 503);
  return null;
}

const ghlUrl = (contactId) => process.env.GHL_LOCATION_ID && contactId
  ? `https://app.gohighlevel.com/v2/location/${process.env.GHL_LOCATION_ID}/contacts/detail/${contactId}` : "";


function leadRow(l, brief) {
  return {
    id: l.id, createdAt: l.createdAt, name: l.name || "", email: l.email, company: l.company || "",
    mode: l.mode, channel: l.channel || "direct", headline: brief?.headline || "",
    mail: l.mail?.status || (l.ghl?.status === "sent" ? "ghl" : "off"), ghl: l.ghl?.status || "off",
    call: l.booking?.status || (l.booking?.clicks?.length ? "clicked" : ""), callAt: l.booking?.start || "",
  };
}

function convRow(sum, expired = false) {
  const { source, briefId, ...row } = sum;
  return { ...row, expired };
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
    if (await attachToLead(lead, conv).catch(() => false)) await redis("SET", "lead:" + lead.id, JSON.stringify(lead)); // repair leads made before the fix
    return json({
      lead: { ...lead, ghlUrl: ghlUrl(lead.ghl?.contactId) },
      brief: brief ? { ...brief, convId: undefined, contactId: undefined } : null,
      conv: conv ? { id: conv.id, mode: conv.mode, startedAt: conv.startedAt, source: conv.source || {}, channel: conv.channel, messages: transcript(conv), events: conv.events || [] } : null,
    });
  }

  if (convId) {
    if (!ID.test(convId)) return json({ error: "That id isn’t valid." }, 400);
    const conv = await loadConv(convId);
    const sum = conv ? convSummary(conv) : parse(await redis("HGET", "convsums", convId));
    if (!sum) return json({ error: "This conversation doesn’t exist any more." }, 404);
    const brief = sum.briefId ? await getBrief(sum.briefId) : null;
    return json({
      conv: { ...convRow(sum, !conv), source: sum.source || {}, messages: conv ? transcript(conv) : [], events: conv?.events || [] },
      brief: brief ? { ...brief, convId: undefined, contactId: undefined } : null,
    });
  }

  if (u.searchParams.get("view") === "convs") {
    const ids = (await redis("ZREVRANGE", "convs", 0, 1999)) || [];
    if (!ids.length) return json({ convs: [] });
    const sums = ((await redis("HMGET", "convsums", ...ids)) || []).map(parse);
    // conversations from before summaries existed: build the summary from the full record while it's still there
    const missing = ids.filter((_, i) => !sums[i] || sums[i].v !== 4);
    if (missing.length) {
      const full = await many("conv:", missing);
      const add = [];
      full.forEach((c) => { if (c) { const s = convSummary(c); sums[ids.indexOf(c.id)] = s; add.push(c.id, JSON.stringify(s)); } });
      if (add.length) await redis("HSET", "convsums", ...add);
    }
    const live = new Set();
    const exists = await Promise.all(ids.map((x, i) => sums[i] && new Date(sums[i].updatedAt) < Date.now() - 85 * 864e5 ? redis("EXISTS", "conv:" + x) : 1));
    ids.forEach((x, i) => { if (exists[i]) live.add(x); });
    return json({ convs: sums.filter((s) => s && s.turns).map((s) => convRow(s, !live.has(s.id))) });
  }

  const ids = await redis("ZREVRANGE", "leads", 0, 999);
  const leads = (await many("lead:", ids || [])).filter(Boolean);
  const briefs = await many("brief:", leads.map((l) => l.briefId));
  return json({ leads: leads.map((l, i) => leadRow(l, briefs[i])) });
}

// DELETE ?id=<lead> or ?conv=<conv>, or a JSON body {leads:[…], convs:[…]} for several at once.
// Removes the lead, its conversation (transcript and the summary used for stats) and its brief, so tests leave no trace
// in the numbers. Contacts already sent to GoHighLevel stay there.
export async function DELETE(request) {
  const denied = await guard(request);
  if (denied) return denied;
  const u = new URL(request.url);
  const body = await request.json().catch(() => ({}));
  const leadIds = [...new Set([u.searchParams.get("id"), ...(Array.isArray(body.leads) ? body.leads : [])].filter((x) => ID.test(String(x || ""))))].slice(0, 500);
  const convIds = new Set([u.searchParams.get("conv"), ...(Array.isArray(body.convs) ? body.convs : [])].filter((x) => ID.test(String(x || ""))));
  if (!leadIds.length && !convIds.size) return json({ error: "Nothing to remove." }, 400);
  const briefIds = new Set();
  for (const id of leadIds) {
    const lead = parse(await redis("GET", "lead:" + id));
    if (lead?.convId) convIds.add(lead.convId);
    if (lead?.briefId) briefIds.add(lead.briefId);
    await redis("DEL", "lead:" + id);
    await redis("ZREM", "leads", id);
    if (lead?.email && (await redis("HGET", "leads:byEmail", lead.email)) === id) await redis("HDEL", "leads:byEmail", lead.email);
  }
  for (const id of [...convIds].slice(0, 1000)) {
    const conv = parse(await redis("GET", "conv:" + id));
    const sum = parse(await redis("HGET", "convsums", id));
    const briefId = conv?.briefId || sum?.briefId;
    if (briefId) briefIds.add(briefId);
    const leadId = conv?.leadId || sum?.leadId;
    if (leadId && !leadIds.includes(leadId)) { await redis("DEL", "lead:" + leadId); await redis("ZREM", "leads", leadId); }
    await redis("DEL", "conv:" + id);
    await redis("ZREM", "convs", id);
    await redis("HDEL", "convsums", id);
  }
  for (const id of briefIds) await redis("DEL", "brief:" + id);
  return json({ ok: true, leads: leadIds.length, convs: convIds.size });
}
