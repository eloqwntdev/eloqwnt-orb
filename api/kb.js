// The knowledge base: one Redis hash, one JSON value per node.
import { isAuthed, json, redis, redisConfigured } from "../lib/server.js";
import seed from "../lib/seed.js";
import { hasCaseFacts, withCaseFacts } from "../lib/case-facts.js";

const HASH = "kb:nodes";
const TYPES = ["company", "service", "case", "process", "sector", "policy", "contact"];
const ID = /^[a-z0-9][a-z0-9-]{0,79}$/;

const clip = (v, n) => String(v ?? "").slice(0, n);

function clean(id, body) {
  return {
    id,
    type: TYPES.includes(body.type) ? body.type : "policy",
    title: clip(body.title, 120).trim() || id,
    summary: clip(body.summary, 1000),
    facts: (Array.isArray(body.facts) ? body.facts : [])
      .slice(0, 60)
      .map((f) => ({ k: clip(f && f.k, 80).trim(), v: clip(f && f.v, 600).trim() }))
      .filter((f) => f.k),
    links: [...new Set((Array.isArray(body.links) ? body.links : []).map(String).filter((l) => ID.test(l) && l !== id))].slice(0, 40),
    updatedAt: new Date().toISOString(),
  };
}

async function guard(request) {
  if (!(await isAuthed(request))) return json({ error: "Sign in to use the knowledge base." }, 401);
  if (!redisConfigured()) return json({ error: "Storage isn’t connected yet. Add an Upstash Redis database to this project in Vercel." }, 503);
  return null;
}

export async function GET(request) {
  const denied = await guard(request);
  if (denied) return denied;
  let flat = await redis("HGETALL", HASH);
  if ((!flat || flat.length === 0) && !(await redis("GET", "kb:seeded"))) {
    const args = seed.flatMap((n) => [n.id, JSON.stringify(clean(n.id, n))]);
    await redis("HSET", HASH, ...args);
    await redis("SET", "kb:seeded", "1");
    flat = await redis("HGETALL", HASH);
  }
  let nodes = [];
  for (let i = 0; i < (flat || []).length; i += 2) {
    try { nodes.push(JSON.parse(flat[i + 1])); } catch { /* skip a damaged row */ }
  }

  // One-time upgrade: give every case study the standard facts, keeping existing values.
  if (!(await redis("GET", "kb:casefacts:v1"))) {
    const titles = new Map(nodes.map((n) => [n.id, n.title]));
    const sectors = new Set(nodes.filter((n) => n.type === "sector").map((n) => n.id));
    const changed = [];
    nodes = nodes.map((n) => {
      if (n.type !== "case" || hasCaseFacts(n)) return n;
      const up = withCaseFacts(n, (n.links || []).filter((l) => sectors.has(l)).map((l) => titles.get(l)));
      changed.push(up);
      return up;
    });
    if (changed.length) await redis("HSET", HASH, ...changed.flatMap((n) => [n.id, JSON.stringify(n)]));
    await redis("SET", "kb:casefacts:v1", "1");
  }
  return json({ nodes });
}

export async function PUT(request) {
  const denied = await guard(request);
  if (denied) return denied;
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!ID.test(id)) return json({ error: "That node id isn’t valid." }, 400);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return json({ error: "Send the node as JSON." }, 400);
  const count = await redis("HLEN", HASH);
  if (count >= 2000 && !(await redis("HEXISTS", HASH, id))) return json({ error: "The knowledge base is full." }, 413);
  const node = clean(id, body);
  await redis("HSET", HASH, id, JSON.stringify(node));
  return json({ node });
}

export async function DELETE(request) {
  const denied = await guard(request);
  if (denied) return denied;
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!ID.test(id)) return json({ error: "That node id isn’t valid." }, 400);
  await redis("HDEL", HASH, id);
  return json({ ok: true });
}
