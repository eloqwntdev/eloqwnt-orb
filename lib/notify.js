// Instant notifications to the team: a new lead, a call booked or cancelled.
// Telegram: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (several ids separated by commas).
// Slack: SLACK_WEBHOOK_URL (an incoming webhook). Either or both. NOTIFY_TZ sets the time zone (default Asia/Dubai).

const tz = () => process.env.NOTIFY_TZ || "Asia/Dubai";
export const telegramConfigured = () => Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
export const slackConfigured = () => Boolean(process.env.SLACK_WEBHOOK_URL);
export const notifyConfigured = () => telegramConfigured() || slackConfigured();

const h = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const when = (iso) => {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString("en-GB", { timeZone: tz(), weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return iso; }
};

/** Build one message as lines of {text, link?, bold?} so it renders in both Telegram (HTML) and Slack (mrkdwn). */
function message(kind, d) {
  const who = [d.name || (d.email ? d.email.split("@")[0] : "") || "A visitor", d.company].filter(Boolean).join(" · ");
  const src = [d.channel, d.mode].filter(Boolean).join(" · ");
  if (kind === "lead") return {
    title: `🟢 New lead — ${who}`,
    lines: [d.headline && `“${d.headline}”`, d.email, src && `Came from ${src}`, d.booked && `📅 Already booked a call: ${when(d.booked)}`],
    links: [["Open the lead", d.leadUrl], ["Brief", d.briefUrl]],
  };
  if (kind === "booked") return {
    title: `📅 Call booked — ${who}`,
    lines: [d.start && when(d.start) + ` (${tz().split("/").pop().replace("_", " ")})`, d.email, d.headline && `“${d.headline}”`],
    links: [["Open the lead", d.leadUrl], ["Brief", d.briefUrl]],
  };
  if (kind === "canceled") return {
    title: `✖️ Call cancelled — ${who}`,
    lines: [d.start && `Was ${when(d.start)}`, d.email],
    links: [["Open the lead", d.leadUrl]],
  };
  return { title: d.title || "Eloqwnt Vision", lines: d.lines || [], links: [] };
}

async function toTelegram(m) {
  const text = [`<b>${h(m.title)}</b>`, ...m.lines.filter(Boolean).map(h), m.links.filter((l) => l[1]).map(([t, u]) => `<a href="${h(u)}">${h(t)}</a>`).join("  ·  ")].filter(Boolean).join("\n");
  const ids = String(process.env.TELEGRAM_CHAT_ID).split(",").map((s) => s.trim()).filter(Boolean);
  await Promise.all(ids.map(async (chat_id) => {
    const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    if (!r.ok) throw new Error("Telegram: " + ((await r.json().catch(() => ({}))).description || r.status));
  }));
}

async function toSlack(m) {
  const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const text = [`*${esc(m.title)}*`, ...m.lines.filter(Boolean).map(esc), m.links.filter((l) => l[1]).map(([t, u]) => `<${u}|${esc(t)}>`).join("  ·  ")].filter(Boolean).join("\n");
  const r = await fetch(process.env.SLACK_WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, unfurl_links: false }) });
  if (!r.ok) throw new Error("Slack: " + r.status);
}

/** Send to every connected channel. Never throws, and gives up after a few seconds so a slow chat app can't hold a visitor up. */
export async function notify(kind, data) {
  if (!notifyConfigured()) return { sent: false };
  const m = message(kind, data);
  const jobs = [telegramConfigured() && toTelegram(m), slackConfigured() && toSlack(m)].filter(Boolean);
  const timeout = new Promise((r) => setTimeout(() => r("timeout"), 4000));
  const res = await Promise.race([Promise.allSettled(jobs), timeout]);
  if (res === "timeout") { console.error("notify timeout"); return { sent: false, error: "timeout" }; }
  const errs = res.filter((x) => x.status === "rejected").map((x) => x.reason?.message);
  if (errs.length) console.error("notify", errs.join("; "));
  return { sent: errs.length < jobs.length, errors: errs };
}
