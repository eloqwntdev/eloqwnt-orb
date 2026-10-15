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
  if (redisConfigured()) {
    const prev = parse(await redis("HGET", "bookings", p.invitee));
    await redis("HSET", "bookings", p.invitee, JSON.stringify({ ...prev, ...row, bookedAt: prev?.bookedAt || (p.canceled ? "" : at) }));
  }
  if (conv) { addEvent(conv, p.canceled ? "booking_canceled" : "booked", { start: p.start }); await saveConv(conv); }
  if (lead) {
    lead.booking = { ...(lead.booking || { clicks: [] }), status: row.status, start: p.start, [p.canceled ? "canceledAt" : "bookedAt"]: at };
    await saveLead(lead);
    if (ghlConfigured() && lead.ghl?.contactId) {
      await markBooked({ contactId: lead.ghl.contactId, opportunityId: lead.ghl.opportunityId, start: p.start, canceled: p.canceled }).catch((e) => console.error("ghl booking", e.message));
    }
  }
  return { matched: !!(lead || conv) };
}
