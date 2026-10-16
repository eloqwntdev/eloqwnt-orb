// Public data for the site's extra pages: GET /api/page?p=process|packages
import { json } from "../lib/server.js";
import { loadContext } from "../lib/orb-context.js";
import { packagesPage, processPage } from "../lib/pages.js";

export async function GET(request) {
  const p = new URL(request.url).searchParams.get("p");
  const ctx = await loadContext();
  const data = p === "process" ? processPage(ctx) : p === "packages" ? packagesPage(ctx) : null;
  if (!data) return json({ error: "Unknown page." }, 404);
  return json(data, 200, { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600" });
}
