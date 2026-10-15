// For setup: can the server reach Claude for the public chat? Signed-in editors only.
import { isAuthed, json } from "../lib/server.js";
import { claude } from "../lib/orb-context.js";

export async function GET(request) {
  if (!(await isAuthed(request))) return json({ error: "Sign in to the knowledge base first: /knowledge-base" }, 401);
  const model = process.env.ORB_CHAT_MODEL || process.env.ORB_MODEL || "claude-sonnet-5-5";
  const out = { key: Boolean(process.env.ANTHROPIC_API_KEY), model };
  const tool = { name: "orb_reply", description: "Reply.", input_schema: { type: "object", properties: { reply: { type: "string" } }, required: ["reply"] } };
  try { out.text = (await claude({ system: "Say hi in three words.", messages: [{ role: "user", content: "Hi" }], maxTokens: 50, model })) || "(empty)"; }
  catch (e) { out.textError = `${e.status || ""} ${e.message}`; }
  try { out.tool = (await claude({ system: "Say hi in three words.", messages: [{ role: "user", content: "Hi" }], maxTokens: 100, model, tool })).reply; }
  catch (e) { out.toolError = `${e.status || ""} ${e.message}`; }
  return json(out);
}
