# Eloqwnt Vision — orb

Voice-first prototype of the Eloqwnt site, deployed on Vercel.

- `/` — the orb (`index.html`): WebGL orb wired to an ElevenLabs agent. Override the agent with `?agent=agent_xxx`, or open `?agent=off` for the scripted demo.
- `/knowledge-base` — password-protected editor for what the orb knows: a graph, a Claude interview that fills gaps, an import that reads links, files (PDF, Word, images, text) and pasted notes and suggests changes, a private sales Playbook (upload sales know-how; Claude builds plays linked to cases, sectors and services; role-play test), and exports for the ElevenLabs knowledge base and system prompt.

## Settings (Vercel → Project → Settings → Environment Variables)

| Name | What it is |
| --- | --- |
| `KB_PASSWORD` | Password for `/knowledge-base`. Changing it signs everyone out. |
| `ANTHROPIC_API_KEY` | Claude API key for the interview and import. Without it, editing still works. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Added automatically when an Upstash Redis database is connected to the project (Storage tab). |

## Files

- `middleware.js` — locks `/knowledge-base`; shows `kb-login.html` until signed in.
- `api/login.js`, `api/logout.js` — password session (HttpOnly cookie, 30 days, rate-limited sign-in).
- `api/kb.js` — read, save and delete nodes in Redis; seeds from `lib/seed.js` the first time.
- `api/ask.js` — calls Claude for the interview and import; fetches import links server-side (public addresses only, via `lib/fetch-page.js`). The key stays on the server.
- `api/playbook.js` — private sales sources and plays (Redis hashes `pb:sources`, `pb:plays`). Never included in the knowledge-base export.
