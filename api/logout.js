import { clearedCookie, json } from "../lib/server.js";

export async function POST() {
  return json({ ok: true }, 200, { "Set-Cookie": clearedCookie() });
}
