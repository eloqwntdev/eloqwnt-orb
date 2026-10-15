// Setup for notifications (signed-in only).
// GET  → what's connected; with only TELEGRAM_BOT_TOKEN set, lists the chats that messaged the bot so you can copy the chat id.
// POST (or GET ?test=1) → sends a test message to every connected channel.
import { isAuthed, json } from "../lib/server.js";
import { notify, slackConfigured, telegramConfigured } from "../lib/notify.js";

export async function GET(request) {
  if (!(await isAuthed(request))) return json({ error: "Sign in first." }, 401);
  if (new URL(request.url).searchParams.get("test")) return POST(request);
  const out = { telegram: telegramConfigured(), slack: slackConfigured() };
  if (process.env.TELEGRAM_BOT_TOKEN) {
    try {
      const me = await (await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`)).json();
      out.bot = me.ok ? "@" + me.result.username : me.description;
      const up = await (await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getUpdates`)).json();
      if (!up.ok) out.updatesError = up.description; // e.g. the bot already has a webhook used by another service
      const chats = new Map();
      for (const u of up.result || []) { const c = (u.message || u.channel_post || u.my_chat_member || {}).chat; if (c) chats.set(c.id, { TELEGRAM_CHAT_ID: String(c.id), name: c.title || [c.first_name, c.last_name].filter(Boolean).join(" ") || c.username, type: c.type }); }
      out.chats = [...chats.values()];
      if (!out.telegram) out.next = out.chats.length ? "Copy the TELEGRAM_CHAT_ID of your chat into Vercel, redeploy, then POST here (or press Send test in the dashboard)." : `Open ${out.bot} in Telegram and send it any message (or add it to a group and write there), then reload this page.`;
    } catch (e) { out.error = e.message; }
  }
  return json(out);
}

export async function POST(request) {
  if (!(await isAuthed(request))) return json({ error: "Sign in first." }, 401);
  const r = await notify("test", { title: "✅ Eloqwnt Vision is connected", lines: ["New leads and booked calls will show up here."] });
  return json(r, r.sent ? 200 : 502);
}
