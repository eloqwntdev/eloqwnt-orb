// The private sales playbook: uploaded sales know-how ("sources") and the plays built from it.
// Never part of the public knowledge-base export; only signed-in editors can read it.
import { isAuthed, json, redis, redisConfigured } from "../lib/server.js";

const HASH = { source: "pb:sources", play: "pb:plays" };
const ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const LIMIT = { source: 40, play: 40 };

const str = (v, n) => String(v ?? "").slice(0, n).trim();
const list = (v, max, fn) => (Array.isArray(v) ? v : []).slice(0, max).map(fn).filter(Boolean);
const now = () => new Date().toISOString();

function cleanSource(id, b) {
  const text = str(b.text, 40000);
  if (!text) return null;
  return { id, name: str(b.name, 160) || "Sales notes", text, kind: str(b.kind, 20) || "text", addedAt: str(b.addedAt, 40) || now() };
}

function cleanPlay(id, b) {
  const title = str(b.title, 120);
  if (!title) return null;
  return {
    id,
    title,
    audience: str(b.audience, 400),
    recognise: str(b.recognise, 600),
    goal: str(b.goal, 400),
    opener: str(b.opener, 600),
    questions: list(b.questions, 8, (q) => str(q, 300)),
    proofs: list(b.proofs, 6, (p) => (p && typeof p === "object" && str(p.line, 400) ? { nodeId: ID.test(String(p.nodeId)) ? String(p.nodeId) : "", line: str(p.line, 400) } : null)),
    objections: list(b.objections, 8, (o) => (o && typeof o === "object" && str(o.q, 300) && str(o.a, 600) ? { q: str(o.q, 300), a: str(o.a, 600) } : null)),
    close: str(b.close, 600),
    links: [...new Set(list(b.links, 20, (l) => (ID.test(String(l)) ? String(l) : null)))],
    updatedAt: now(),
  };
}

async function guard(request) {
  if (!(await isAuthed(request))) return json({ error: "Sign in to use the playbook." }, 401);
  if (!redisConfigured()) return json({ error: "Storage isn’t connected yet." }, 503);
  return null;
}

function target(request) {
  const u = new URL(request.url);
  const kind = u.searchParams.get("kind");
  const id = u.searchParams.get("id") || "";
  if (!HASH[kind]) return { error: json({ error: "Unknown kind." }, 400) };
  if (!ID.test(id)) return { error: json({ error: "That id isn’t valid." }, 400) };
  return { kind, id };
}

const rows = (flat) => {
  const out = [];
  for (let i = 0; i < (flat || []).length; i += 2) { try { out.push(JSON.parse(flat[i + 1])); } catch { /* skip */ } }
  return out;
};

export async function GET(request) {
  const denied = await guard(request);
  if (denied) return denied;
  const [s, p] = await Promise.all([redis("HGETALL", HASH.source), redis("HGETALL", HASH.play)]);
  return json({
    sources: rows(s).sort((a, b) => String(a.addedAt).localeCompare(String(b.addedAt))),
    plays: rows(p).sort((a, b) => a.title.localeCompare(b.title)),
  });
}

export async function PUT(request) {
  const denied = await guard(request);
  if (denied) return denied;
  const t = target(request);
  if (t.error) return t.error;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return json({ error: "Send it as JSON." }, 400);
  const item = t.kind === "source" ? cleanSource(t.id, body) : cleanPlay(t.id, body);
  if (!item) return json({ error: t.kind === "source" ? "That source has no text." : "A play needs a title." }, 400);
  const count = await redis("HLEN", HASH[t.kind]);
  if (count >= LIMIT[t.kind] && !(await redis("HEXISTS", HASH[t.kind], t.id))) return json({ error: `You can keep up to ${LIMIT[t.kind]} ${t.kind}s.` }, 413);
  await redis("HSET", HASH[t.kind], t.id, JSON.stringify(item));
  return json({ item });
}

export async function DELETE(request) {
  const denied = await guard(request);
  if (denied) return denied;
  const t = target(request);
  if (t.error) return t.error;
  await redis("HDEL", HASH[t.kind], t.id);
  return json({ ok: true });
}
