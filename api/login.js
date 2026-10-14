import { allow, checkPassword, clientIp, json, passwordConfigured, sessionCookie, sessionToken } from "../lib/server.js";

// The sign-in page shows one slot per character and unlocks on its own at the last one, so it needs the length (not the password).
export async function GET() {
  if (!passwordConfigured()) return json({ error: "The knowledge base password isn’t set up yet. Add KB_PASSWORD in Vercel." }, 503);
  return json({ length: [...process.env.KB_PASSWORD].length });
}

export async function POST(request) {
  if (!passwordConfigured()) return json({ error: "The knowledge base password isn’t set up yet. Add KB_PASSWORD in Vercel." }, 503);

  if (!(await allow(`kb:login:${clientIp(request)}`, 10, 600))) {
    return json({ error: "Too many attempts. Wait 10 minutes, then try again." }, 429);
  }

  const { password } = await request.json().catch(() => ({}));
  const ok = await checkPassword(password);
  await new Promise((r) => setTimeout(r, ok ? 0 : 600)); // slow down guessing

  if (!ok) return json({ error: "That password isn’t right." }, 401);
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(await sessionToken()) });
}
