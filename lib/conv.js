// Conversations with the orb (chat or voice), kept 90 days, and the briefs made from them, kept a year.
import { redis, redisConfigured } from "./server.js";

const KEEP = 60 * 60 * 24 * 90;

export async function loadConv(id) {
  if (!redisConfigured() || !/^[a-z0-9]{8,20}$/.test(String(id || ""))) return null;
  const raw = await redis("GET", "conv:" + id);
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}
export async function saveConv(c) {
  if (!redisConfigured()) return;
  c.updatedAt = new Date().toISOString();
  await redis("SET", "conv:" + c.id, JSON.stringify(c), "EX", KEEP);
  await redis("ZADD", "convs", Date.now(), c.id);
  // A small summary kept for good, so stats stay right after the full conversation expires.
  await redis("HSET", "convsums", c.id, JSON.stringify(convSummary(c)));
}

/** The lasting part of a conversation: when, where from, how far it got. No transcript. */
export function convSummary(c) {
  const msgs = c.messages || [];
  const said = msgs.filter((m) => m.role === "user" && (!m.kind || m.kind === "text"));
  const orb = msgs.filter((m) => m.role === "orb");
  const ev = new Set((c.events || []).map((e) => e.type));
  const lastBooking = [...(c.events || [])].reverse().find((e) => e.type === "booked" || e.type === "booking_canceled");
  const plays = [...new Set(orb.map((m) => m.play).filter(Boolean))].slice(0, 6);
  return {
    v: 3, id: c.id, startedAt: c.startedAt, updatedAt: c.updatedAt || c.startedAt, name: c.name || "", mode: c.mode || "chat",
    channel: c.channel || "direct", source: c.source || {}, turns: said.length, first: (said[0]?.text || "").slice(0, 160),
    brief: !!c.briefId, briefId: c.briefId || "", leadId: c.leadId || "",
    // funnel steps
    named: !!c.name, caseShown: orb.some((m) => m.caseId) || ev.has("case_shown"), offered: !!c.offeredBrief || ev.has("brief_offered"),
    briefOpened: ev.has("brief_open") || !!c.briefId, booked: ev.has("book_click") || ev.has("booked"),
    bookedCall: lastBooking?.type === "booked", callAt: lastBooking?.type === "booked" ? lastBooking.start || "" : "",
    plays, lastStage: [...orb].reverse().find((m) => m.stage)?.stage || "",
  };
}

const BRIEF_KEEP = 60 * 60 * 24 * 365;
const memory = new Map(); // only used when Redis isn't connected (local preview)
export async function getBrief(id) {
  if (!/^[a-z0-9]{8,20}$/.test(String(id || ""))) return null;
  if (!redisConfigured()) return memory.get(id) || null;
  const raw = await redis("GET", "brief:" + id);
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}
export async function putBrief(b) {
  if (!redisConfigured()) { memory.set(b.id, b); return; }
  await redis("SET", "brief:" + b.id, JSON.stringify(b), "EX", BRIEF_KEEP);
}
