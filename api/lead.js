// The visitor asks for the full brief by email: save the lead, unlock the brief page, and hand the contact to GoHighLevel,
// where a workflow sends the email. Works without GHL too (the lead is saved and the brief opens on screen).
import { allow, clientIp, json, redis, redisConfigured } from "../lib/server.js";
import { getBrief, loadConv, putBrief, saveConv } from "../lib/conv.js";
import { cleanSource, newId, sourceLabel } from "../lib/orb-context.js";
import { ghlConfigured, pushLead, resendBrief } from "../lib/ghl.js";

const clip = (v, n) => String(v ?? "").slice(0, n).trim();
const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i;

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  if (body.website) return json({ ok: true }); // the hidden field only bots fill in
  if (!(await allow(`orb:lead:${clientIp(request)}`, 10, 3600))) return json({ error: "Too many requests. Try again later, or email hi@eloqwnt.com.", code: "rate_limited" }, 429);

  const brief = await getBrief(body.briefId);
  if (!brief) return json({ error: "That brief has expired. Ask the orb for a new one.", code: "not_found" }, 404);
  const origin = new URL(request.url).origin;
  const briefUrl = `${origin}/brief/${brief.id}`;

  if (body.resend) {
    if (!brief.contactId || !ghlConfigured()) return json({ ok: true, briefUrl, emailed: false });
    try { await resendBrief(brief.contactId); return json({ ok: true, briefUrl, emailed: true }); }
    catch (e) { console.error("ghl resend", e.message); return json({ error: "Couldn’t resend just now. Open the brief below instead.", code: "upstream_error" }, 502); }
  }

  const email = clip(body.email, 200).toLowerCase();
  if (!EMAIL.test(email)) return json({ error: "That email doesn’t look right.", code: "invalid_email", field: "email" }, 400);
  if (!body.consent) return json({ error: "Tick the box so we can send the brief.", code: "consent", field: "consent" }, 400);
  const name = clip(body.name, 80) || brief.name;
  const company = clip(body.company, 120) || brief.company;

  const conv = await loadConv(brief.convId);
  const source = conv?.source && Object.keys(conv.source).length ? conv.source : cleanSource(body.source);
  const channel = conv?.channel || sourceLabel(source);
  const mode = conv?.mode || (body.mode === "voice" ? "voice" : "chat");
  const transcript = (conv?.messages || []).filter((m) => !m.kind || m.kind === "text").map((m) => (m.role === "user" ? "Visitor: " : "Orb: ") + m.text).join("\n");

  const lead = {
    id: newId(), createdAt: new Date().toISOString(), name, email, company, newsletter: !!body.newsletter,
    briefId: brief.id, convId: brief.convId, mode, channel, source, ghl: { status: ghlConfigured() ? "pending" : "off" },
  };

  Object.assign(brief, { unlocked: true, name, company: company || brief.company, leadId: lead.id, sentAt: new Date().toISOString() });

  let emailed = false;
  if (ghlConfigured()) {
    try {
      const r = await pushLead({ ...lead, briefUrl, brief, transcript });
      lead.ghl = { status: "sent", ...r };
      brief.contactId = r.contactId;
      emailed = true;
    } catch (e) {
      console.error("ghl", e.message);
      lead.ghl = { status: "failed", error: clip(e.message, 300) };
    }
  }

  await putBrief(brief);
  if (redisConfigured()) {
    await redis("SET", "lead:" + lead.id, JSON.stringify(lead));
    await redis("ZADD", "leads", Date.now(), lead.id);
    await redis("HSET", "leads:byEmail", email, lead.id);
  }
  if (conv) {
    conv.name = conv.name || name;
    conv.leadId = lead.id;
    conv.events = [...(conv.events || []), { type: "lead", at: Date.now() }];
    await saveConv(conv).catch(() => {});
  }
  return json({ ok: true, briefUrl, emailed, name: name.split(/\s+/)[0] || "" });
}
