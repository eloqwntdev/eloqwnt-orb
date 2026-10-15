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
  const said = (c.messages || []).filter((m) => m.role === "user" && (!m.kind || m.kind === "text"));
  return {
    id: c.id, startedAt: c.startedAt, updatedAt: c.updatedAt || c.startedAt, name: c.name || "", mode: c.mode || "chat",
    channel: c.channel || "direct", source: c.source || {}, turns: said.length, first: (said[0]?.text || "").slice(0, 160),
    brief: !!c.briefId, briefId: c.briefId || "", leadId: c.leadId || "",
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
