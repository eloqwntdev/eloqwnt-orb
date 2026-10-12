// Locks /knowledge-base behind the password. Visitors without a valid session see the sign-in page instead.
import { next, rewrite } from "@vercel/functions";
import { isAuthed } from "./lib/server.js";

export const config = {
  runtime: "nodejs",
  matcher: ["/knowledge-base", "/knowledge-base/:path*"],
};

export default async function middleware(request) {
  if (await isAuthed(request)) return next({ headers: { "Cache-Control": "no-store" } });
  return rewrite(new URL("/kb-login.html", request.url), { headers: { "Cache-Control": "no-store" } });
}
