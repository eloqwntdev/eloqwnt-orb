// Dashboard: is Calendly connected (GET), connect it (POST), or pull recent bookings (POST ?action=sync). Signed-in only.
import { isAuthed, json, redis, redisConfigured } from "../lib/server.js";
import { cal, calendlyConfigured, signingKey, syncBookings } from "../lib/booking.js";

const API = "https://api.calendly.com";
async function state(request) {
  const me = (await cal("/users/me")).resource;
  const hook = new URL("/api/calendly", request.url).toString();
  const subs = (await cal(`/webhook_subscriptions?organization=${encodeURIComponent(me.current_organization)}&user=${encodeURIComponent(me.uri)}&scope=user&count=100`)).collection || [];
  return { me, hook, mine: subs.filter((s) => s.callback_url === hook) };
}
const parse = (raw) => { try { return JSON.parse(raw); } catch { return raw; } };

export async function GET(request) {
  if (!(await isAuthed(request))) return json({ error: "Sign in first." }, 401);
  if (new URL(request.url).searchParams.get("action") === "ping") return POST(request);
  if (!calendlyConfigured()) return json({ token: false, connected: false });
  try {
    const s = await state(request);
    const log = redisConfigured() ? ((await redis("LRANGE", "calendly:log", 0, 9)) || []).map(parse) : [];
    const synced = redisConfigured() ? await redis("GET", "calendly:synced") : null;
    return json({
      token: true, connected: s.mine.some((x) => x.state === "active"), account: s.me.email, user: s.me.name,
      webhook: s.mine.map((x) => ({ url: x.callback_url, state: x.state, scope: x.scope, events: x.events, since: x.created_at })),
      deliveries: log, lastSync: synced,
    });
  } catch (e) { return json({ token: true, connected: false, error: e.status === 401 ? "The Calendly token was rejected. Make a new one." : e.message }); }
}

export async function POST(request) {
  if (!(await isAuthed(request))) return json({ error: "Sign in first." }, 401);
  if (!calendlyConfigured()) return json({ error: "Add CALENDLY_TOKEN in Vercel first." }, 400);
  if (new URL(request.url).searchParams.get("action") === "ping") {
    // call our own public webhook address from outside the function, the way Calendly would
    const url = new URL("/api/calendly", request.url).toString();
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "Calendly-Webhook-Test" }, body: "{}" });
      const text = (await r.text()).slice(0, 300);
      return json({ url, status: r.status, server: r.headers.get("server"), vercelMitigated: r.headers.get("x-vercel-mitigated") || "", body: text, verdict: r.status === 401 && /signature/i.test(text) ? "Reachable: the webhook address answers. If Calendly still sends nothing, the problem is on Calendly’s side." : "Not reachable as expected: something in front of the function (Vercel Firewall, protection) answered instead." });
    } catch (e) { return json({ url, error: e.message }, 502); }
  }
  if (new URL(request.url).searchParams.get("action") === "sync") {
    try { return json({ ok: true, ...(await syncBookings()) }); }
    catch (e) { return json({ error: e.message }, 502); }
  }
  try {
    const s = await state(request);
    for (const x of s.mine) await cal(x.uri.replace(API, ""), "DELETE").catch(() => {}); // recreate so the signing key matches
    await cal("/webhook_subscriptions", "POST", {
      url: s.hook, events: ["invitee.created", "invitee.canceled"], organization: s.me.current_organization, user: s.me.uri, scope: "user", signing_key: await signingKey(),
    });
    const sync = await syncBookings().catch(() => null);
    return json({ ok: true, connected: true, account: s.me.email, sync });
  } catch (e) { return json({ error: e.status === 403 ? "Calendly says this plan can’t use webhooks." : e.message }, 502); }
}
