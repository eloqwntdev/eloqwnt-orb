// Calendly webhook: a discovery call was booked or cancelled. Signed with a key derived from CALENDLY_TOKEN.
import { json } from "../lib/server.js";
import { calendlyConfigured, logDelivery, recordBooking, verifySignature } from "../lib/booking.js";

export async function POST(request) {
  if (!calendlyConfigured()) return json({ error: "Calendly isn’t connected." }, 503);
  const raw = await request.text();
  const sig = request.headers.get("calendly-webhook-signature");
  if (!(await verifySignature(sig, raw))) {
    await logDelivery({ ok: false, why: sig ? "signature didn’t match" : "no signature" }).catch(() => {});
    return json({ error: "Bad signature." }, 401);
  }
  let body; try { body = JSON.parse(raw); } catch { return json({ error: "Bad body." }, 400); }
  const ev = body.event, p = body.payload || {};
  if (ev !== "invitee.created" && ev !== "invitee.canceled") return json({ ok: true, ignored: ev });
  if (ev === "invitee.canceled" && p.rescheduled) return json({ ok: true, rescheduled: true }); // the new booking arrives as invitee.created
  const t = p.tracking || {};
  try {
    const r = await recordBooking({
      invitee: String(p.uri || p.email || Date.now()), email: String(p.email || "").toLowerCase(), name: String(p.name || "").slice(0, 80),
      start: p.scheduled_event?.start_time || "", canceled: ev === "invitee.canceled",
      ref: t.utm_content || "", from: t.utm_source === "vision" ? t.utm_medium || "" : "",
    });
    await logDelivery({ ok: true, event: ev, email: p.email, ref: t.utm_content || "", matched: r.matched }).catch(() => {});
    return json({ ok: true, ...r });
  } catch (e) {
    await logDelivery({ ok: false, event: ev, why: e.message }).catch(() => {});
    throw e;
  }
}
