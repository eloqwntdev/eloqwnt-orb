// ElevenLabs post-call webhook: after every voice call, the transcript, length and summary.
// ElevenLabs-Signature: "t=<unix>,v0=<hex>" = HMAC-SHA256(ELEVENLABS_WEBHOOK_SECRET, "<t>.<raw body>").
import { json, redis, redisConfigured } from "../lib/server.js";
import { upsertCall } from "../lib/voice.js";

const enc = new TextEncoder();
async function verify(header, raw) {
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  if (!secret) return false;
  const parts = Object.fromEntries(String(header || "").split(",").map((p) => p.trim().split("=")));
  if (!parts.t || !parts.v0) return false;
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 60 * 30) return false;
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const want = [...new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(`${parts.t}.${raw}`)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (want.length !== parts.v0.length) return false;
  let diff = 0; for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ parts.v0.charCodeAt(i);
  return diff === 0;
}
async function log(entry) {
  if (!redisConfigured()) return;
  await redis("LPUSH", "eleven:log", JSON.stringify({ at: new Date().toISOString(), ...entry }));
  await redis("LTRIM", "eleven:log", 0, 19);
}

export async function POST(request) {
  const raw = await request.text();
  if (!(await verify(request.headers.get("elevenlabs-signature"), raw))) {
    await log({ ok: false, why: process.env.ELEVENLABS_WEBHOOK_SECRET ? "signature didn’t match" : "ELEVENLABS_WEBHOOK_SECRET isn’t set" }).catch(() => {});
    return json({ error: "Bad signature." }, 401);
  }
  let body; try { body = JSON.parse(raw); } catch { return json({ error: "Bad body." }, 400); }
  if (body.type !== "post_call_transcription") return json({ ok: true, ignored: body.type }); // audio etc.
  try {
    const r = await upsertCall(body.data || {});
    await log({ ok: true, call: body.data?.conversation_id, ...r }).catch(() => {});
    return json(r);
  } catch (e) {
    await log({ ok: false, why: e.message }).catch(() => {});
    return json({ error: e.message }, 500);
  }
}
