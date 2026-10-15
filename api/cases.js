// Public list of case studies from the knowledge base, for the "Related work" grid on the site.
import { json } from "../lib/server.js";
import { caseCard, loadContext } from "../lib/orb-context.js";

export async function GET() {
  try {
    const ctx = await loadContext();
    const cases = ctx.nodes.filter((n) => n.type === "case").map((n) => caseCard(n, ctx.byId)).filter(Boolean);
    return json({ cases }, 200, { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" });
  } catch (e) {
    return json({ cases: [] }, 200);
  }
}
