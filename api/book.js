// "Book a call" links from the email, the brief page and the site go through here:
// /book/<briefId>?from=email  or  /api/book?c=<conversationId>&from=chat
// We note the click on the lead, then send them to Calendly with their name and email filled in and a tag
// (utm_content) so the booking Calendly reports back can be matched to this lead.
import { allow, clientIp } from "../lib/server.js";
import { CALENDLY_PAGE, recordClick } from "../lib/booking.js";

const ID = /^[a-z0-9]{8,20}$/;
const FROM = ["email", "page", "chat", "voice", "site"];

export async function GET(request) {
  const u = new URL(request.url);
  const b = u.searchParams.get("b"), c = u.searchParams.get("c");
  const from = FROM.includes(u.searchParams.get("from")) ? u.searchParams.get("from") : "site";
  const ref = ID.test(b || "") ? "b_" + b : ID.test(c || "") ? "c_" + c : "";
  const out = new URL(CALENDLY_PAGE);
  out.searchParams.set("utm_source", "vision");
  out.searchParams.set("utm_medium", from);
  out.searchParams.set("utm_campaign", "orb");
  // link scanners in mail apps open links before people do; skip counting obvious bots
  const bot = /bot|crawler|spider|preview|scanner|safelinks|proofpoint|mimecast|barracuda/i.test(request.headers.get("user-agent") || "") || request.method === "HEAD";
  if (ref) {
    out.searchParams.set("utm_content", ref);
    try {
      if (!bot && (await allow(`orb:book:${clientIp(request)}`, 60, 3600))) {
        const who = await recordClick({ ref, from });
        if (who.name) out.searchParams.set("name", who.name);
        if (who.email) out.searchParams.set("email", who.email);
      }
    } catch (e) { console.error("book click", e.message); }
  }
  return new Response(null, { status: 302, headers: { Location: out.toString(), "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}
