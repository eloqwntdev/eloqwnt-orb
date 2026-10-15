// Discovery-call bookings: clicks on "Book a call" (site, email, brief page) and real bookings reported by Calendly.
// Settings: CALENDLY_TOKEN (personal access token). Optional GHL_BOOKED_STAGE_ID moves the GHL opportunity on booking.
import { redis, redisConfigured } from "./server.js";
import { getBrief, loadConv, saveConv } from "./conv.js";
import { ghlConfigured, markBooked } from "./ghl.js";

export const CALENDLY_PAGE = "https://calendly.com/eloqwnt/discovery-call";
export const calendlyConfigured = () => Boolean(process.env.CALENDLY_TOKEN);

const enc = new TextEncoder();
async function hmacHex(key, msg) {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(msg)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
/** The webhook signing key is derived from the token, so there is only one setting to manage. */
export const signingKey = () => hmacHex(process.env.CALENDLY_TOKEN, "eloqwnt-calendly-webhook:v1");

/** Calendly-Webhook-Signature: "t=<unix>,v1=<hex>" signed over "<t>.<raw body>". */
export async function verifySignature(header, raw) {
  const parts = Object.fromEntries(String(header || "").split(",").map((p) => p.trim().split("=")));
  if (!parts.t || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 60 * 10) return false; // stale or replayed
  const want = await hmacHex(await signingKey(), `${parts.t}.${raw}`);
  if (want.length !== parts.v1.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ parts.v1.charCodeAt(i);
  return diff === 0;
}

const parse = (raw) => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } };
export const loadLead = async (id) => (id && redisConfigured() ? parse(await redis("GET", "lead:" + id)) : null);
export const saveLead = (l) => redis("SET", "lead:" + l.id, JSON.stringify(l));

function addEvent(conv, type, extra = {}) {
  conv.events = conv.events || [];
  if (type === "book_click" && conv.events.some((e) => e.type === type)) return;
  conv.events.push({ type, at: Date.now(), ...extra });
}

/** Who a booking link or a Calendly booking belongs to: "b_<brief>" or "c_<conversation>" in utm_content, else the email. */
export async function resolve({ ref, email }) {
  let brief = null, conv = null, lead = null;
  const [kind, id] = String(ref || "").split("_");
  if (kind === "b") { brief = await getBrief(id); conv = brief ? await loadConv(brief.convId) : null; lead = await loadLead(brief?.leadId); }
  if (kind === "c") { conv = await loadConv(id); lead = await loadLead(conv?.leadId); }
  if (!lead && email && redisConfigured()) lead = await loadLead(await redis("HGET", "leads:byEmail", String(email).toLowerCase()));
  if (lead && !conv) conv = await loadConv(lead.convId);
  if (lead && !brief) brief = await getBrief(lead.briefId);
  return { brief, conv, lead };
}

export async function recordClick({ ref, from }) {
  const { brief, conv, lead } = await resolve({ ref });
  if (conv) { addEvent(conv, "book_click", { from }); await saveConv(conv); }
  if (lead) {
    lead.booking = lead.booking || { status: "", clicks: [] };
    lead.booking.clicks = [...(lead.booking.clicks || []), { from, at: new Date().toISOString() }].slice(-20);
    await saveLead(lead);
  }
  return { name: lead?.name || brief?.name || conv?.name || "", email: lead?.email || brief?.email || "" };
}

/** A booking (or cancellation) from Calendly. */
export async function recordBooking(p) {
  const { conv, lead } = await resolve({ ref: p.ref, email: p.email });
  const at = new Date().toISOString();
  const row = { invitee: p.invitee, email: p.email, name: p.name, start: p.start, status: p.canceled ? "canceled" : "booked", from: p.from || "", leadId: lead?.id || "", convId: conv?.id || "", at };
  let all = [row];
  if (redisConfigured()) {
    const prev = parse(await redis("HGET", "bookings", p.invitee));
    await redis("HSET", "bookings", p.invitee, JSON.stringify({ ...prev, ...row, bookedAt: prev?.bookedAt || (p.canceled ? "" : at) }));
    const flat = (await redis("HGETALL", "bookings")) || [];
    all = [];
    for (let i = 1; i < flat.length; i += 2) { const b = parse(flat[i]); if (b) all.push(b); }
  }
  // One person can book, cancel and book again: the lead counts as booked while any of their bookings is still on.
  const state = (match) => {
    const mine = all.filter(match);
    const active = mine.filter((b) => b.status === "booked").sort((a, b) => String(a.start).localeCompare(String(b.start)));
    const upcoming = active.find((b) => new Date(b.start) > Date.now()) || active[active.length - 1];
    return active.length ? { status: "booked", start: upcoming?.start || p.start } : { status: "canceled", start: mine.map((b) => b.start).sort().pop() || p.start };
  };
  if (conv) {
    const s = state((b) => b.convId === conv.id);
    const last = [...(conv.events || [])].reverse().find((e) => e.type === "booked" || e.type === "booking_canceled");
    if (!last || last.type !== (s.status === "booked" ? "booked" : "booking_canceled") || last.start !== s.start) {
      (conv.events = conv.events || []).push({ type: s.status === "booked" ? "booked" : "booking_canceled", at: Date.now(), start: s.start });
      await saveConv(conv);
    }
  }
  if (lead) {
    const before = lead.booking?.status;
    const s = state((b) => b.leadId === lead.id);
    lead.booking = { ...(lead.booking || { clicks: [] }), status: s.status, start: s.start, [p.canceled ? "canceledAt" : "bookedAt"]: at };
    await saveLead(lead);
    // tell GHL only when the overall state changes (a second booking or one of two cancellations changes nothing there)
    if (ghlConfigured() && lead.ghl?.contactId && before !== s.status) {
      await markBooked({ contactId: lead.ghl.contactId, opportunityId: lead.ghl.opportunityId, start: s.start, canceled: s.status !== "booked" }).catch((e) => console.error("ghl booking", e.message));
    }
  }
  return { matched: !!(lead || conv) };
}

/* ---------- Calendly API: pull recent bookings (backs up the webhook) ---------- */
const CAL_API = "https://api.calendly.com";
export async function cal(path, method = "GET", body) {
  const r = await fetch(path.startsWith("http") ? path : CAL_API + path, { method, headers: { Authorization: `Bearer ${process.env.CALENDLY_TOKEN}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d.message || d.title || `Calendly ${r.status}`); e.status = r.status; throw e; }
  return d;
}

/** Note what each webhook delivery did, for the setup check. */
export async function logDelivery(entry) {
  if (!redisConfigured()) return;
  await redis("LPUSH", "calendly:log", JSON.stringify({ at: new Date().toISOString(), ...entry }));
  await redis("LTRIM", "calendly:log", 0, 19);
}

/** Read bookings made in Calendly over the last weeks and record any we haven't seen (or whose status changed). */
export async function syncBookings() {
  const me = (await cal("/users/me")).resource;
  const min = new Date(Date.now() - 45 * 864e5).toISOString();
  let list;
  try { list = await cal(`/scheduled_events?organization=${encodeURIComponent(me.current_organization)}&min_start_time=${min}&count=100&sort=start_time:desc`); }
  catch { list = await cal(`/scheduled_events?user=${encodeURIComponent(me.uri)}&min_start_time=${min}&count=100&sort=start_time:desc`); }
  let checked = 0, recorded = 0;
  for (const ev of list.collection || []) {
    const inv = await cal(`${ev.uri}/invitees?count=50`).catch(() => ({ collection: [] }));
    for (const p of inv.collection || []) {
      checked++;
      const canceled = p.status === "canceled" || ev.status === "canceled";
      const prev = parse(await redis("HGET", "bookings", p.uri));
      if (prev && prev.status === (canceled ? "canceled" : "booked")) continue;
      if (canceled && p.rescheduled) continue;
      const t = p.tracking || {};
      await recordBooking({
        invitee: p.uri, email: String(p.email || "").toLowerCase(), name: String(p.name || "").slice(0, 80), start: ev.start_time, canceled,
        ref: t.utm_content || "", from: t.utm_source === "vision" ? t.utm_medium || "" : "",
      });
      recorded++;
    }
  }
  if (redisConfigured()) await redis("SET", "calendly:synced", new Date().toISOString());
  return { checked, recorded };
}
