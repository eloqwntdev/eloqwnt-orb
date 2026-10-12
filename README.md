# Eloqwnt Vision — orb

Voice-first prototype of the Eloqwnt site, deployed on Vercel.

- `/` — the orb (`index.html`): WebGL orb wired to an ElevenLabs agent. Override the agent with `?agent=agent_xxx`, or open `?agent=off` for the scripted demo.
- `/knowledge-base` — password-protected editor for what the orb knows: a graph, a Claude interview that fills gaps, and an export for the ElevenLabs knowledge base.

## Settings (Vercel → Project → Settings → Environment Variables)

| Name | What it is |
| --- | --- |
| `KB_PASSWORD` | Password for `/knowledge-base`. Changing it signs everyone out. |
| `ANTHROPIC_API_KEY` | Claude API key for the interview. Without it, editing still works. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Added automatically when an Upstash Redis database is connected to the project (Storage tab). |

## Files

- `middleware.js` — locks `/knowledge-base`; shows `kb-login.html` until signed in.
- `api/login.js`, `api/logout.js` — password session (HttpOnly cookie, 30 days, rate-limited sign-in).
- `api/kb.js` — read, save and delete nodes in Redis; seeds from `lib/seed.js` the first time.
- `api/ask.js` — calls Claude for the interview; the key stays on the server.
