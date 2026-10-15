// For setup: send a sample brief email to yourself. Signed-in editors only. /api/mail-check?to=you@domain.com
import { isAuthed, json } from "../lib/server.js";
import { mailConfigured, sendBriefEmail } from "../lib/mail.js";

const SAMPLE = {
  company: "Sample Co", headline: "A sample brief so you can check how the email looks",
  told: ["One", "Two"], phases: [{ name: "Brand identity", weeks: "Weeks 1–3", items: [] }, { name: "Website", weeks: "Weeks 3–6", items: [] }],
  prices: [{ service: "Brand identity", price: "from $5k" }], quickWins: ["Write one sentence that says who you are for, and put it at the top of your homepage."],
  references: [{ brand: "Stripe", why: "" }], pitfalls: ["x"], agencyQuestions: ["x"], cases: [],
};

export async function GET(request) {
  if (!(await isAuthed(request))) return json({ error: "Sign in to the knowledge base first: /knowledge-base" }, 401);
  const env = { RESEND_API_KEY: mailConfigured(), MAIL_FROM: process.env.MAIL_FROM || "Eloqwnt Vision <brief@notify.eloqwnt.com> (default)", MAIL_REPLY_TO: process.env.MAIL_REPLY_TO || "hi@eloqwnt.com (default)", MAIL_BCC: process.env.MAIL_BCC || null };
  const to = new URL(request.url).searchParams.get("to");
  if (!mailConfigured()) return json({ sent: false, env, next: "Add RESEND_API_KEY in Vercel, then redeploy." });
  if (!to) return json({ sent: false, env, next: "Add ?to=your@email to send a sample." });
  try { const id = await sendBriefEmail({ to, name: "Mirhayot", brief: SAMPLE, briefUrl: new URL("/", request.url).href }); return json({ sent: true, id, env }); }
  catch (e) { return json({ sent: false, env, error: `${e.status || ""} ${e.message}` }); }
}
