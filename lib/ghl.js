// GoHighLevel (LeadConnector API v2): add or update the contact, tag it so a GHL workflow emails the brief,
// leave a note with the conversation summary, and open an opportunity in the pipeline.
// Settings: GHL_TOKEN (Private Integration token), GHL_LOCATION_ID, and optionally
// GHL_PIPELINE_ID + GHL_STAGE_ID, GHL_BRIEF_FIELD (custom field key, default "brief_link").

const BASE = "https://services.leadconnectorhq.com";
const TAG = "orb-brief";

export const ghlConfigured = () => Boolean(process.env.GHL_TOKEN && process.env.GHL_LOCATION_ID);

async function call(path, method, body) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 9000);
  try {
    const res = await fetch(BASE + path, {
      method,
      signal: ctl.signal,
      headers: { Authorization: `Bearer ${process.env.GHL_TOKEN}`, Version: "2021-07-28", "Content-Type": "application/json", Accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data?.message ? [].concat(data.message).join("; ") : `GHL ${res.status}`); e.status = res.status; throw e; }
    return data;
  } finally { clearTimeout(t); }
}

const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

/**
 * lead: { name, email, company, newsletter, mode, channel, source, briefUrl, brief, transcript }
 * Returns { contactId, opportunityId }.
 */
export async function pushLead(lead) {
  const loc = process.env.GHL_LOCATION_ID;
  const [firstName, ...rest] = String(lead.name || "").trim().split(/\s+/);
  const contact = { locationId: loc, email: lead.email, source: "Eloqwnt Vision orb" };
  if (firstName) { contact.firstName = firstName; if (rest.length) contact.lastName = rest.join(" "); }
  if (lead.company) contact.companyName = lead.company;
  const field = process.env.GHL_BRIEF_FIELD || "brief_link";

  let up;
  try {
    up = await call("/contacts/upsert", "POST", { ...contact, customFields: [{ key: field, field_value: lead.briefUrl }] });
  } catch (e) {
    if (e.status !== 400 && e.status !== 422) throw e;
    up = await call("/contacts/upsert", "POST", contact); // the custom field doesn't exist yet
  }
  const contactId = up?.contact?.id || up?.id;
  if (!contactId) throw new Error("GHL didn’t return a contact");

  // Re-adding the tag starts the "send the brief" workflow again, also for people who asked before.
  await call(`/contacts/${contactId}/tags`, "DELETE", { tags: [TAG] }).catch(() => {});
  const tags = [TAG, "orb-lead", `orb-${lead.mode === "voice" ? "voice" : "chat"}`, `src-${slug(lead.channel) || "direct"}`];
  if (lead.newsletter) tags.push("newsletter");
  await call(`/contacts/${contactId}/tags`, "POST", { tags });

  const s = lead.source || {};
  const b = lead.brief || {};
  const note = [
    `Brief from the orb (${lead.mode}) · ${b.headline || ""}`,
    `Open the brief: ${lead.briefUrl}`,
    "",
    "What they told us:", ...(b.told || []).map((t) => "• " + t),
    "",
    `Source: ${lead.channel}` + (s.utm_campaign ? ` · campaign ${s.utm_campaign}` : "") + (s.landing ? ` · landed on ${s.landing}` : "") + (s.referrer ? ` · from ${s.referrer}` : ""),
    "",
    "Conversation:", String(lead.transcript || "").slice(0, 6000),
  ].join("\n");
  await call(`/contacts/${contactId}/notes`, "POST", { body: note }).catch((e) => console.error("ghl note", e.message));

  let opportunityId = null;
  if (process.env.GHL_PIPELINE_ID && process.env.GHL_STAGE_ID) {
    try {
      const o = await call("/opportunities/", "POST", {
        locationId: loc, pipelineId: process.env.GHL_PIPELINE_ID, pipelineStageId: process.env.GHL_STAGE_ID,
        name: [lead.company || lead.name || lead.email, b.headline ? "· " + b.headline : ""].join(" ").slice(0, 120),
        status: "open", contactId, source: "Eloqwnt Vision orb",
      });
      opportunityId = o?.opportunity?.id || o?.id || null;
    } catch (e) { console.error("ghl opportunity", e.message); }
  }
  return { contactId, opportunityId };
}

/** Send the brief again: remove and re-add the tag so the workflow fires once more. */
export async function resendBrief(contactId) {
  await call(`/contacts/${contactId}/tags`, "DELETE", { tags: [TAG] }).catch(() => {});
  await call(`/contacts/${contactId}/tags`, "POST", { tags: [TAG] });
}
