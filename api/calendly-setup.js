// Dashboard: is Calendly connected, and connect it (create the webhook subscription). Signed-in only.
import { isAuthed, json } from "../lib/server.js";
import { calendlyConfigured, signingKey } from "../lib/booking.js";

const API = "https://api.calendly.com";
async function cal(path, method = "GET", body) {
  const r = await fetch(API + path, { method, headers: { Authorization: `Bearer ${process.env.CALENDLY_TOKEN}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d.message || d.title || `Calendly ${r.status}`); e.status = r.status; throw e; }
  return d;
}
async function state(request) {
  const me = (await cal("/users/me")).resource;
  const hook = new URL("/api/calendly", request.url).toString();
  const subs = (await cal(`/webhook_subscriptions?organization=${encodeURIComponent(me.current_organization)}&user=${encodeURIComponent(me.uri)}&scope=user&count=100`)).collection || [];
  return { me, hook, mine: subs.filter((s) => s.callback_url === hook) };
}

export async function GET(request) {
  if (!(await isAuthed(request))) return json({ error: "Sign in first." }, 401);
  if (!calendlyConfigured()) return json({ token: false, connected: false });
  try { const s = await state(request); return json({ token: true, connected: s.mine.some((x) => x.state === "active"), account: s.me.email }); }
  catch (e) { return json({ token: true, connected: false, error: e.status === 401 ? "The Calendly token was rejected. Make a new one." : e.message }); }
}

export async function POST(request) {
  if (!(await isAuthed(request))) return json({ error: "Sign in first." }, 401);
  if (!calendlyConfigured()) return json({ error: "Add CALENDLY_TOKEN in Vercel first." }, 400);
  try {
    const s = await state(request);
    for (const x of s.mine) await cal(x.uri.replace(API, ""), "DELETE").catch(() => {}); // recreate so the signing key matches
    await cal("/webhook_subscriptions", "POST", {
      url: s.hook, events: ["invitee.created", "invitee.canceled"], organization: s.me.current_organization, user: s.me.uri, scope: "user", signing_key: await signingKey(),
    });
    return json({ ok: true, connected: true, account: s.me.email });
  } catch (e) { return json({ error: e.status === 403 ? "Calendly says this plan can’t use webhooks." : e.message }, 502); }
}
