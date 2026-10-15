# Eloqwnt Vision — orb

Voice-first prototype of the Eloqwnt site, deployed on Vercel.

- `/` — the orb (`index.html`): WebGL orb wired to an ElevenLabs agent. Override the agent with `?agent=agent_xxx`, or open `?agent=off` for the scripted demo.
- Chat: the Voice / Chat switch in the header. Chat uses the live knowledge base and plays (no export needed), asks the visitor's name, shows cases, and offers a brief.
- `/brief/<id>` — the full brief (`brief.html`). It opens only after the visitor asked for it by email.
- `/knowledge-base` — password-protected editor for what the orb knows: a graph, a Claude interview that fills gaps, an import that reads links, files (PDF, Word, images, text) and pasted notes and suggests changes, a private sales Playbook (upload sales know-how; Claude builds plays linked to cases, sectors and services; role-play test), and exports for the ElevenLabs knowledge base and system prompt.

## Settings (Vercel → Project → Settings → Environment Variables)

| Name | What it is |
| --- | --- |
| `KB_PASSWORD` | Password for `/knowledge-base`. Changing it signs everyone out. |
| `ANTHROPIC_API_KEY` | Claude API key for the interview and import. Without it, editing still works. |
| `GHL_TOKEN` | GoHighLevel Private Integration token (scopes: contacts, opportunities). Without it, leads are still saved and the brief opens on screen. |
| `GHL_LOCATION_ID` | The GHL sub-account (location) id. |
| `GHL_PIPELINE_ID`, `GHL_STAGE_ID` | Optional. Each brief request opens an opportunity in this pipeline stage. |
| `GHL_BRIEF_FIELD` | Optional. Key of the contact custom field that gets the brief link. Default `brief_link`. |
| `ORB_MODEL`, `ORB_CHAT_MODEL`, `ORB_BRIEF_MODEL` | Optional model overrides. Default `claude-sonnet-5-5`. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Added automatically when an Upstash Redis database is connected to the project (Storage tab). |

## Files

- `middleware.js` — locks `/knowledge-base`; shows `kb-login.html` until signed in.
- `kb-login.html` — sign-in: one slot per password character, unlocks on its own at the last one.
- `knowledge-base/` — the editor: `index.html` (shell), `app.js` (views: map, gaps, interview, import, node editor, playbook, export; hash routes like `#/node/<id>`), `app.css` (layout).
- `kb-assets/` — shared design system (`kb.css`: tokens, Vertus glass, light/dark, motion), Aspekta fonts, orb images.
- `api/login.js`, `api/logout.js` — password session (HttpOnly cookie, 30 days, rate-limited sign-in).
- `api/kb.js` — read, save and delete nodes in Redis; seeds from `lib/seed.js` the first time.
- `api/ask.js` — calls Claude for the interview and import; fetches import links server-side (public addresses only, via `lib/fetch-page.js`). The key stays on the server.
- `api/playbook.js` — private sales sources and plays (Redis hashes `pb:sources`, `pb:plays`). Never included in the knowledge-base export.

## Leads and the brief email (GoHighLevel)

1. In GHL: Settings → Private Integrations → create a token with contacts and opportunities access. Add `GHL_TOKEN` and `GHL_LOCATION_ID` in Vercel.
2. Settings → Custom Fields → add a contact field **Brief link** (single line). Its key should be `brief_link`.
3. Automation → new workflow. Trigger: *Contact Tag Added* = `orb-brief`. Action: *Send Email* using `ghl/brief-email.html` (merge fields `{{contact.first_name}}`, `{{contact.brief_link}}`).
4. Optional: a pipeline "Orb leads"; put its id and first stage id in `GHL_PIPELINE_ID` / `GHL_STAGE_ID`.

Every request for the brief: upserts the contact, re-adds the `orb-brief` tag (so the workflow fires), adds tags `orb-lead`, `orb-chat`/`orb-voice`, `src-<source>` and `newsletter` when ticked, leaves a note with the summary, source and transcript, and opens an opportunity.

Redis also keeps everything for the dashboard: `conv:<id>` (90 days, with the play and stage of each orb reply), `brief:<id>` (1 year), `lead:<id>`, and the sorted sets `convs` and `leads`.

## Voice agent (ElevenLabs) — two optional client tools

Add these in the agent's Tools as *client* tools so voice visitors get the same flow:
- `save_name` with one string parameter `name`: "Call after the visitor tells you their name."
- `offer_brief` (no parameters): "Call when the visitor agrees to get a short brief from the conversation by email."

Without them, voice visitors still see "Get a brief from our talk" after a conversation.

## New files

- `api/chat.js`, `api/brief.js`, `api/lead.js` — chat, the brief, and the lead (+ GHL).
- `lib/orb-context.js` (knowledge base and plays as prompt text, Claude call), `lib/conv.js` (conversations and briefs in Redis), `lib/ghl.js`.
- `vision-assets/lead.css`, `vision-assets/lead.js` — chat mode, name, brief sheet and email form on the site.
- `ghl/brief-email.html` — the email for the GHL workflow (not deployed).
