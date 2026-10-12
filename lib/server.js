// Shared server helpers: the knowledge-base password session, Upstash Redis over REST, JSON responses.

const COOKIE = "kb_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

const enc = new TextEncoder();

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function passwordConfigured() {
  return Boolean(process.env.KB_PASSWORD);
}

/** The session token is derived from the password, so changing KB_PASSWORD signs everyone out. */
export async function sessionToken() {
  return hmac(process.env.KB_PASSWORD, "eloqwnt-kb-session:v1");
}

export function readCookie(request, name = COOKIE) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export async function isAuthed(request) {
  if (!passwordConfigured()) return false;
  const got = readCookie(request);
  if (!got) return false;
  return safeEqual(got, await sessionToken());
}

export async function checkPassword(input) {
  if (!passwordConfigured() || typeof input !== "string") return false;
  // Compare HMACs so the check takes the same time whatever was typed.
  const [a, b] = await Promise.all([hmac("eloqwnt-kb-compare", input), hmac("eloqwnt-kb-compare", process.env.KB_PASSWORD)]);
  return safeEqual(a, b);
}

export function sessionCookie(value) {
  return `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${MAX_AGE}`;
}

export function clearedCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

/* ---------- Upstash Redis (REST) ---------- */

const REDIS_URL = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export function redisConfigured() {
  return Boolean(REDIS_URL() && REDIS_TOKEN());
}

export async function redis(...command) {
  const res = await fetch(REDIS_URL(), {
    method: "POST",
    headers: { Authorization: `Bearer ${REDIS_TOKEN()}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(body.error || `Redis error ${res.status}`);
  return body.result;
}

/** Simple fixed-window limit per key. Returns true when the call is allowed. */
export async function allow(key, max, windowSeconds) {
  if (!redisConfigured()) return true;
  const n = await redis("INCR", key);
  if (n === 1) await redis("EXPIRE", key, windowSeconds);
  return n <= max;
}

export function clientIp(request) {
  return (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
}
