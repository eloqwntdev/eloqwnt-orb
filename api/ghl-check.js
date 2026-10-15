// For setup: is GoHighLevel connected, and what are the pipeline and stage ids? Signed-in editors only.
import { isAuthed, json } from "../lib/server.js";
import { ghlConfigured } from "../lib/ghl.js";

export async function GET(request) {
  if (!(await isAuthed(request))) return json({ error: "Sign in to the knowledge base first: /knowledge-base" }, 401);
  const env = {
    GHL_TOKEN: Boolean(process.env.GHL_TOKEN), GHL_LOCATION_ID: process.env.GHL_LOCATION_ID || null,
    GHL_PIPELINE_ID: process.env.GHL_PIPELINE_ID || null, GHL_STAGE_ID: process.env.GHL_STAGE_ID || null,
  };
  if (!ghlConfigured()) return json({ connected: false, env, next: "Add GHL_TOKEN and GHL_LOCATION_ID in Vercel, then redeploy." });
  const res = await fetch(`https://services.leadconnectorhq.com/opportunities/pipelines?locationId=${encodeURIComponent(process.env.GHL_LOCATION_ID)}`, {
    headers: { Authorization: `Bearer ${process.env.GHL_TOKEN}`, Version: "2021-07-28", Accept: "application/json" },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return json({ connected: false, env, status: res.status, error: body?.message || "GHL refused the token", hint: res.status === 401 || res.status === 403 ? "Check the token and that it has the opportunities.readonly scope, and that GHL_LOCATION_ID is the sub-account id." : undefined }, 200);
  const pipelines = (body.pipelines || []).map((p) => ({ name: p.name, GHL_PIPELINE_ID: p.id, stages: (p.stages || []).map((s) => ({ name: s.name, GHL_STAGE_ID: s.id })) }));
  return json({ connected: true, env, pipelines, next: pipelines.length ? "Copy the pipeline id and its first stage id into Vercel if you want an opportunity per brief." : "No pipelines yet. Create one (e.g. \"Orb leads\") in Opportunities → Pipelines, then reload." });
}
