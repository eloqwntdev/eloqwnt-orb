// Script simulator API (signed-in only). The dashboard drives a run by calling run.step until it's done,
// so a run pauses when the tab is closed and continues when it's opened again.
import { waitUntil } from "@vercel/functions";
import { isAuthed, json, redis, redisConfigured } from "../lib/server.js";
import { newId } from "../lib/orb-context.js";
import {
  PARALLEL, advance, cleanProfile, explain, insightsFor, listProfiles, loadConvs, loadRun, makePeople, profileFromText,
  profilesFromReal, saveConvs, saveProfile, saveRun, scriptsFor, summarise,
} from "../lib/sim.js";

const ID = /^[a-z0-9-]{1,80}$/;
const MAX_TOTAL = 300;
const parse = (raw) => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } };

/* ---------- runs keep going on the server, tab open or not ----------
   Each step asks for the next one (a call to this same endpoint, signed with a key only the server knows).
   The dashboard only watches; if the chain ever stops, it gives it a nudge. */
const enc = new TextEncoder();
async function bgKey(id) {
  const k = await crypto.subtle.importKey("raw", enc.encode(process.env.KB_PASSWORD || "x"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode("sim-bg:" + id)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function kick(request, id) {
  const url = new URL("/api/sim", request.url).toString();
  const key = await bgKey(id);
  const ctl = new AbortController();
  // fire the next step and let it run on its own; don't hold this function open waiting for it
  const p = fetch(url, { method: "POST", signal: ctl.signal, headers: { "Content-Type": "application/json", "x-sim-bg": key }, body: JSON.stringify({ action: "run.step", id }) }).catch(() => {});
  setTimeout(() => ctl.abort(), 2500);
  waitUntil(Promise.race([p, new Promise((r) => setTimeout(r, 3000))]));
}

async function guard(request, body) {
  if (body && body.action === "run.step" && request.headers.get("x-sim-bg") && request.headers.get("x-sim-bg") === (await bgKey(String(body.id || "")))) return null;
  if (!(await isAuthed(request))) return json({ error: "Sign in to use the simulator." }, 401);
  if (!redisConfigured()) return json({ error: "Storage isn’t connected yet." }, 503);
  if (!process.env.ANTHROPIC_API_KEY) return json({ error: "Claude isn’t connected. Add ANTHROPIC_API_KEY in Vercel." }, 503);
  return null;
}

/** How each play did with real visitors: conversations, leads and booked calls per 100. */
async function realStats() {
  const flat = (await redis("HGETALL", "convsums")) || [];
  const sums = []; for (let i = 1; i < flat.length; i += 2) { const s = parse(flat[i]); if (s && s.turns) sums.push(s); }
  const by = {};
  const add = (k, s) => { const r = by[k] || (by[k] = { n: 0, leads: 0, booked: 0 }); r.n++; if (s.leadId) r.leads++; if (s.bookedCall) r.booked++; };
  for (const s of sums) { add("live", s); for (const p of s.plays || []) add("t:" + p, s); }
  return { by, sums };
}

function progress(run) {
  const { scripts, people, ...rest } = run;
  return { ...rest, scripts: scripts.map(({ sales, ...s }) => s) };
}

export async function GET(request) {
  const denied = await guard(request);
  if (denied) return denied;
  const u = new URL(request.url), view = u.searchParams.get("view") || "home";

  if (view === "home") {
    const [profiles, { scripts }, { by }, ids] = await Promise.all([listProfiles(), scriptsFor(), realStats(), redis("ZREVRANGE", "sim:runs", 0, 19)]);
    const runs = ((ids && ids.length ? await redis("MGET", ...ids.map((id) => "sim:run:" + id)) : []) || []).map(parse).filter(Boolean).map(progress);
    return json({
      profiles,
      scripts: scripts.map((s) => { const r = by[s.id === "live" ? "live" : "t:" + s.title] || { n: 0, leads: 0, booked: 0 }; return { id: s.id, title: s.title, real: r }; }),
      runs,
    });
  }

  if (view === "active") {
    // the running run (or one that finished in the last 30 minutes) for the progress island
    const ids = (await redis("ZREVRANGE", "sim:runs", 0, 4)) || [];
    const runs = (ids.length ? await redis("MGET", ...ids.map((id) => "sim:run:" + id)) : []).map(parse).filter(Boolean);
    const run = runs.find((r) => r.status === "running") || runs.find((r) => r.finishedAt && Date.now() - new Date(r.finishedAt).getTime() < 30 * 60e3);
    return json({ run: run ? progress(run) : null });
  }

  if (view === "run") {
    const run = await loadRun(u.searchParams.get("id"));
    if (!run) return json({ error: "This run doesn’t exist any more." }, 404);
    const convs = run.status === "done" ? await loadConvs(run.id) : [];
    const { by } = await realStats();
    return json({
      run: progress(run),
      real: Object.fromEntries(run.scripts.map((s) => [s.id, by[s.id === "live" ? "live" : "t:" + s.title] || { n: 0, leads: 0, booked: 0 }])),
      convs: convs.map((c) => ({ key: c.key, scriptId: c.scriptId, profileId: c.profileId, name: c.person.name, role: c.person.role, how: c.end?.how || "", stage: c.end?.stage || "", turns: c.turns || 0, reason: c.end?.reason || "" })),
    });
  }

  if (view === "conv") {
    const run = await loadRun(u.searchParams.get("id"));
    const key = u.searchParams.get("key");
    if (!run || !key) return json({ error: "Not found." }, 404);
    const [c] = await loadConvs(run.id, [key]);
    if (!c) return json({ error: "Not found." }, 404);
    const all = run.status === "done" ? await loadConvs(run.id) : [];
    const same = all.filter((x) => x.scriptId === c.scriptId && x.profileId === c.profileId);
    const sameStop = c.end?.how === "left" ? same.filter((x) => x.end?.how === "left" && x.end?.stage === c.end.stage).length : 0;
    const order = same.map((x) => x.key);
    const i = order.indexOf(c.key);
    return json({
      conv: c, profile: run.profiles.find((p) => p.id === c.profileId), script: progress(run).scripts.find((s) => s.id === c.scriptId),
      sameStop, cellSize: same.length, prev: order[i - 1] || "", next: order[i + 1] || "", runAt: run.createdAt,
    });
  }
  return json({ error: "Unknown view." }, 400);
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const denied = await guard(request, body);
  if (denied) return denied;
  const a = body.action;
  const usage = {};
  try {
    if (a === "profile.create") {
      if (!String(body.text || "").trim()) return json({ error: "Describe the client first." }, 400);
      const p = await profileFromText(body.text, usage);
      await saveProfile(p);
      return json({ profile: p });
    }
    if (a === "profile.fromReal") {
      const { sums } = await realStats();
      const briefs = await Promise.all(sums.slice(0, 120).map((s) => (s.briefId ? redis("GET", "brief:" + s.briefId).then(parse) : null)));
      const real = sums.slice(0, 120).map((s, i) => ({ first: s.first, mode: s.mode, told: (briefs[i]?.told || []).join("; ") })).filter((r) => r.first);
      if (real.length < 5) return json({ error: `Only ${real.length} real conversations so far. Profiles from real visitors need at least 5.` }, 400);
      const ps = await profilesFromReal(real, usage);
      for (const p of ps) await saveProfile(p);
      return json({ profiles: ps, used: real.length });
    }
    if (a === "profile.save") {
      if (!body.profile || !ID.test(String(body.profile.id || ""))) return json({ error: "That profile isn’t valid." }, 400);
      const old = parse(await redis("HGET", "sim:profiles", body.profile.id));
      const p = cleanProfile({ ...old, ...body.profile }, old?.origin);
      await saveProfile(p);
      return json({ profile: p });
    }
    if (a === "profile.delete") {
      await redis("HDEL", "sim:profiles", String(body.id || ""));
      return json({ ok: true });
    }

    if (a === "run.create") {
      const per = [5, 10, 25].includes(Number(body.per)) ? Number(body.per) : 10;
      const { scripts } = await scriptsFor(Array.isArray(body.scripts) ? body.scripts.map(String) : []);
      const all = await listProfiles();
      const profiles = all.filter((p) => (body.profiles || []).includes(p.id));
      if (!scripts.length) return json({ error: "Pick at least one script." }, 400);
      if (!profiles.length) return json({ error: "Pick at least one profile." }, 400);
      const total = scripts.length * profiles.length * per;
      if (total > MAX_TOTAL) return json({ error: `That’s ${total} conversations. Keep a run under ${MAX_TOTAL}: fewer scripts, profiles or people.` }, 400);
      const run = {
        id: newId(), createdAt: new Date().toISOString(), status: "running", per, total, done: 0,
        scripts: scripts.map((s) => ({ id: s.id, title: s.title, sales: s.sales })), profiles, people: {}, active: [], peopleReady: false, usage: {}, errors: 0,
      };
      await saveRun(run);
      await redis("ZADD", "sim:runs", Date.now(), run.id);
      await kick(request, run.id);
      return json({ run: progress(run) });
    }

    if (a === "run.step") {
      const run = await loadRun(body.id);
      if (!run) return json({ error: "This run doesn’t exist any more." }, 404);
      if (run.status !== "running") return json({ run: progress(run) });
      // one step at a time per run, even with two tabs open
      const got = await redis("SET", "sim:lock:" + run.id, "1", "NX", "EX", 90);
      const events = [];
      if (got !== "OK") return json({ run: progress(run), busy: true });
      try {
        if (!run.peopleReady) {
          await Promise.all(run.profiles.filter((p) => !run.people[p.id]).map(async (p) => { run.people[p.id] = await makePeople(p, run.per, usage); }));
          const convs = [];
          for (const s of run.scripts) for (const p of run.profiles) for (const person of run.people[p.id]) {
            convs.push({ key: `${s.id}~${p.id}~${person.i}`, scriptId: s.id, profileId: p.id, person, messages: [], state: "active", turns: 0 });
          }
          await saveConvs(run.id, convs);
          run.active = convs.map((c) => c.key);
          run.peopleReady = true;
          // a light per-conversation state for the live view in the dashboard
          run.dots = Object.fromEntries(convs.map((c) => [c.key, { n: c.person.name, p: run.profiles.findIndex((p) => p.id === c.profileId), s: "", h: "", t: 0 }]));
        } else {
          const { ctx } = await scriptsFor([]);
          const batch = run.active.slice(0, PARALLEL);
          const convs = await loadConvs(run.id, batch);
          await Promise.all(convs.map(async (c) => {
            const script = run.scripts.find((s) => s.id === c.scriptId), profile = run.profiles.find((p) => p.id === c.profileId);
            try { await advance(c, ctx, script, profile, usage); }
            catch (e) {
              console.error("sim step", e.message);
              c.errors = (c.errors || 0) + 1; run.errors = (run.errors || 0) + 1;
              if (c.errors >= 2) { c.state = "done"; c.end = { how: "error", reason: e.message.slice(0, 200), stage: "" }; }
            }
          }));
          await saveConvs(run.id, convs);
          run.dots = run.dots || {};
          for (const c of convs) {
            const lastOrb = [...c.messages].reverse().find((m) => m.role === "orb"), lastVis = [...c.messages].reverse().find((m) => m.role === "visitor");
            run.dots[c.key] = { n: c.person.name, p: run.profiles.findIndex((p) => p.id === c.profileId), s: lastOrb?.stage || "", h: c.state === "done" ? c.end?.how || "" : "", t: c.turns || 0 };
            events.push({ k: c.key, n: c.person.name, s: lastOrb?.stage || "", h: c.state === "done" ? c.end?.how || "" : "", v: String(lastVis?.text || "").slice(0, 90), o: String(lastOrb?.text || "").replace(/<\/?m>/g, "").slice(0, 90), r: c.state === "done" ? String(c.end?.reason || "").slice(0, 90) : "" });
          }
          const finished = new Set(convs.filter((c) => c.state === "done").map((c) => c.key));
          // finished ones leave the queue; the rest go to the back so every conversation moves along
          run.active = [...run.active.slice(batch.length), ...batch.filter((k) => !finished.has(k))];
          run.done = run.total - run.active.length;
          if (!run.active.length) {
            const all = await loadConvs(run.id);
            run.cells = summarise(run, all.filter((c) => c.end?.how !== "error"));
            run.insights = await insightsFor(run, run.cells, usage).catch(() => []);
            run.status = "done"; run.finishedAt = new Date().toISOString();
          }
        }
        for (const k of Object.keys(usage)) run.usage[k] = (run.usage[k] || 0) + usage[k];
        run.events = [...events.map((e) => ({ ...e, at: Date.now() })), ...(run.events || [])].slice(0, 40);
        run.lastStepAt = Date.now();
        await saveRun(run);
        if (run.status === "running") await kick(request, run.id);
        return json({ run: progress(run), events });
      } finally { await redis("DEL", "sim:lock:" + run.id); }
    }

    if (a === "run.stop" || a === "run.delete") {
      const run = await loadRun(body.id);
      if (!run) return json({ ok: true });
      if (a === "run.delete") { await redis("DEL", "sim:run:" + run.id); await redis("DEL", "sim:c:" + run.id); await redis("ZREM", "sim:runs", run.id); return json({ ok: true }); }
      // stopping keeps what's finished and scores it
      const all = (await loadConvs(run.id)).filter((c) => c.state === "done" && c.end?.how !== "error");
      run.status = "done"; run.stopped = true; run.active = []; run.finishedAt = new Date().toISOString();
      run.cells = summarise(run, all);
      run.insights = all.length ? await insightsFor(run, run.cells, usage).catch(() => []) : [];
      await saveRun(run);
      return json({ run: progress(run) });
    }

    if (a === "conv.explain") {
      const run = await loadRun(body.id);
      if (!run) return json({ error: "Not found." }, 404);
      const [c] = await loadConvs(run.id, [String(body.key || "")]);
      if (!c) return json({ error: "Not found." }, 404);
      if (!c.help) {
        const { ctx } = await scriptsFor([]);
        c.help = await explain(c, run.profiles.find((p) => p.id === c.profileId), ctx, usage);
        if (c.help.node_id && !ctx.byId.has(c.help.node_id)) c.help.node_id = "";
        await saveConvs(run.id, [c]);
      }
      return json({ help: c.help });
    }
    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    console.error("sim", a, e);
    return json({ error: e.message || "Something went wrong." }, 502);
  }
}
