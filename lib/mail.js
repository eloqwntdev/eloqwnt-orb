// The brief email: built from the brief itself and sent from Eloqwnt's own domain through Resend.
// Settings: RESEND_API_KEY, and optionally MAIL_FROM ("Eloqwnt Vision <brief@notify.eloqwnt.com>"),
// MAIL_REPLY_TO (hi@eloqwnt.com) and MAIL_BCC (a copy of every brief, e.g. for yourself).

export const mailConfigured = () => Boolean(process.env.RESEND_API_KEY);
const CAL = "https://calendly.com/eloqwnt/discovery-call";
const ASSETS = "https://vision.eloqwnt.com";
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const F = "'Zalando Sans',Helvetica,Arial,sans-serif";

/** What this particular brief holds, in short lines for the email. */
function inside(b) {
  const out = [];
  if (b.told?.length) out.push("What you told us, in a few lines");
  if (b.phases?.length) out.push(`A ${b.phases.length}-phase plan: ${b.phases.map((p) => p.name).join(" → ")}`);
  if (b.prices?.length) out.push(b.prices.length > 1 ? "Starting prices for each part" : `Starting price for ${b.prices[0].service.toLowerCase()}`);
  if (b.quickWins?.length) out.push(b.quickWins.length === 1 ? "A quick win you can do this week" : `${b.quickWins.length} quick wins you can do this week`);
  if (b.references?.length) out.push("Brands worth studying: " + b.references.map((r) => r.brand).join(", "));
  if (b.pitfalls?.length) out.push("Mistakes to avoid");
  if (b.agencyQuestions?.length) out.push("Questions to ask any agency, us included");
  if (b.cases?.length) out.push("Similar work: " + b.cases.map((c) => c.title).join(", "));
  return out.slice(0, 6);
}

export function briefEmail({ name, brief: b, briefUrl }) {
  const first = String(name || "").trim().split(/\s+/)[0];
  // booking goes through our /book/<brief> redirect so clicks and real bookings are tied to this lead
  const book = briefUrl ? briefUrl.replace(/\/brief\/([a-z0-9]+).*$/, "/book/$1?from=email") : CAL;
  const dot = `<td width="18" valign="top" style="padding-top:9px;"><div style="width:6px;height:6px;border-radius:3px;background:#a6e46a;font-size:0;line-height:0;">&nbsp;</div></td>`;
  const items = inside(b).map((t) => `<tr>${dot}<td style="font-size:15px;line-height:24px;color:#2a3248;padding-bottom:4px;">${esc(t)}</td></tr>`).join("");
  const win = b.quickWins?.[0];
  const subject = b.company ? `Your brief for ${b.company}` : "Your brief from Eloqwnt";
  const pre = "Everything we discussed, in one page";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(subject)}</title>
<link href="https://fonts.googleapis.com/css2?family=Besley:wght@400&family=Zalando+Sans:wght@300;400;500&display=swap" rel="stylesheet">
<style>body{margin:0;padding:0;background:#eef1f5}a{text-decoration:none}@media (max-width:620px){.card{width:100%!important;border-radius:20px!important}.pad{padding-left:24px!important;padding-right:24px!important}.h1{font-size:21px!important;line-height:28px!important}}</style></head>
<body style="margin:0;padding:0;background:#eef1f5;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(pre)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef1f5;"><tr><td align="center" style="padding:28px 12px 36px;">
<table role="presentation" class="card" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:24px;overflow:hidden;border:1px solid #e4e7ee;font-family:${F};color:#0b1020;">
<tr><td style="padding:0;line-height:0;font-size:0;background:#0f2532;"><a href="${esc(briefUrl)}" target="_blank"><img src="${ASSETS}/vision-assets/email/hero-compact.jpg" width="600" alt="Eloqwnt Vision · Your brief is ready" style="display:block;width:100%;max-width:600px;height:auto;border:0;"></a></td></tr>
<tr><td class="pad" style="padding:36px 44px 0;">
  <p style="margin:0 0 12px;font-size:15px;line-height:20px;color:#6b7489;">${first ? `Hi ${esc(first)},` : "Hi,"} here’s the brief from your conversation with our orb.</p>
  <h1 class="h1" style="margin:0;font-family:${F};font-weight:300;font-size:24px;line-height:31px;letter-spacing:-0.015em;color:#0b1020;">${esc(b.headline || "Everything we discussed, in one page.")}</h1>
</td></tr>
${items ? `<tr><td class="pad" style="padding:24px 44px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f8fc;border:1px solid #e4e7ee;border-radius:16px;"><tr><td style="padding:18px 20px 14px;">
  <p style="margin:0 0 10px;font-size:12px;line-height:16px;letter-spacing:0.08em;text-transform:uppercase;color:#6b7489;">Inside your brief</p>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0">${items}</table>
</td></tr></table></td></tr>` : ""}
${win ? `<tr><td class="pad" style="padding:20px 44px 0;"><p style="margin:0 0 6px;font-size:12px;line-height:16px;letter-spacing:0.08em;text-transform:uppercase;color:#6b7489;">One to start with</p><p style="margin:0;font-size:16px;line-height:25px;color:#2a3248;">${esc(win)}</p></td></tr>` : ""}
<tr><td class="pad" style="padding:26px 44px 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#0b1020" style="border-radius:999px;background:#0b1020;"><a href="${esc(briefUrl)}" target="_blank" style="display:inline-block;padding:15px 28px;font-family:${F};font-size:16px;line-height:20px;font-weight:500;color:#ffffff;border-radius:999px;">Open your brief&nbsp;&nbsp;&rarr;</a></td></tr></table></td></tr>
<tr><td class="pad" style="padding:22px 44px 0;"><p style="margin:0;font-size:15px;line-height:24px;color:#4a5268;">Prefer to talk it through? <a href="${esc(book)}" target="_blank" style="color:#0b1020;text-decoration:underline;white-space:nowrap;">Book a 20-minute call&nbsp;&rarr;</a></p></td></tr>
<tr><td class="pad" style="padding:28px 44px 32px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #eef1f5;"><tr><td style="padding-top:20px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
  <td width="50" valign="middle"><img src="${ASSETS}/kb-assets/orb-logo.png" width="38" height="38" alt="" style="display:block;border-radius:19px;border:0;"></td>
  <td valign="middle" style="font-size:15px;line-height:20px;color:#0b1020;">Vision<br><span style="color:#6b7489;">Eloqwnt</span></td>
</tr></table></td></tr></table></td></tr>
</table>
<table role="presentation" class="card" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;font-family:${F};"><tr><td class="pad" style="padding:20px 44px 0;font-size:12px;line-height:18px;color:#6b7489;">You’re getting this because you asked for your brief on <a href="${ASSETS}" style="color:#4a5268;text-decoration:underline;">vision.eloqwnt.com</a>. Questions? Just reply.<br><span style="font-family:Besley,Georgia,serif;color:#4a5268;">Eloqwnt</span> · <a href="mailto:hi@eloqwnt.com" style="color:#4a5268;">hi@eloqwnt.com</a></td></tr></table>
</td></tr></table></body></html>`;
  const text = [`${first ? `Hi ${first},` : "Hi,"} here’s the brief from your conversation with our orb.`, "", b.headline || "", "", "Inside your brief:", ...inside(b).map((t) => "- " + t), ...(win ? ["", "One to start with: " + win] : []), "", "Open your brief: " + briefUrl, "", "Prefer to talk it through? Book a call: " + book, "", "Vision · Eloqwnt"].join("\n");
  return { subject, html, text };
}

export async function sendBriefEmail({ to, name, brief, briefUrl }) {
  const { subject, html, text } = briefEmail({ name, brief, briefUrl });
  const body = {
    from: process.env.MAIL_FROM || "Eloqwnt Vision <brief@notify.eloqwnt.com>",
    to: [to], subject, html, text,
    reply_to: process.env.MAIL_REPLY_TO || "hi@eloqwnt.com",
    ...(process.env.MAIL_BCC ? { bcc: [process.env.MAIL_BCC] } : {}),
  };
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 9000);
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST", signal: ctl.signal,
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data?.message || `Resend ${res.status}`); e.status = res.status; throw e; }
    return data.id;
  } finally { clearTimeout(t); }
}
