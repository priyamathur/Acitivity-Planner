# 🌱 LittleRoam: Family & Kids Activities

LittleRoam helps families find screen-free things to do. It's an installable web app (PWA) with no login and no ads, and your data stays on your device.

- **Home has two sections:**
  - **👨‍👩‍👧 Family** — things to do together and outings, plus places near you, popular-near-you and **Plan the weekend**: a timeline that fits activities around the classes you've added, taking the weather into account.
  - **🧒 Kids** — play ideas by child and age, filtered by time and indoors/outdoors, plus the kids' **classes** (small **+** to add one) and **Find classes nearby** (swimming, dance, martial arts, music, art, sports and community venues).
- **✨ Ask bar on Home:** ask in plain words ("rainy Sunday ideas for a 5-year-old", "there's a pumpkin festival on Saturday, let's go"). With AI switched on, Claude answers and updates your plan; it can look events up on the web. Without AI, the bar searches the idea library.
- **58 activities**, each with steps, materials, what kids learn and safety tips.
- **Past adventures:** a private journal with photos chosen from your phone's Photos.
- **🔌 MCP server:** other AI assistants can use LittleRoam too (see below).

📄 Product strategy, market research and pricing: [docs/PRD.md](docs/PRD.md)

## Run locally
```bash
npm start            # serves on http://localhost:8080 (needs python3)
npm test             # unit tests
npm run test:e2e     # browser tests, static (needs Playwright + Chromium)
npm run test:api     # runs the Worker locally (wrangler dev) against a mock Claude API
npm run test:e2e-ai  # browser tests of AI + Popular near you against the local Worker
npm run test:e2e-chat # browser tests of the chat (tool calls, web search, limits) against the local Worker
npm run test:mcp     # official MCP client against the local Worker's /mcp (all 5 tools)
(cd worker && npm install && npm run dev)   # full app locally; put ANTHROPIC_API_KEY in worker/.dev.vars
```
No build step. The app is plain HTML, CSS and ES modules.

## Deploy

There are two ways to host it. Both deploy automatically on every push to `main` (`.github/workflows/deploy.yml`).

### A. Full app with AI and Popular near you: Cloudflare Workers (recommended)
`worker/` serves the app and a small API (`/api/ai`, `/api/share`, `/api/trends`). Data is stored in a Durable Object, which has SQLite built in. One-time setup:

1. Create a free Cloudflare account. In **My Profile → API Tokens**, create a token from the **"Edit Cloudflare Workers"** template. Copy your **Account ID** from the Workers dashboard.
2. Create an Anthropic API key at console.anthropic.com. It needs billing set up.
3. In GitHub, go to **Settings → Secrets and variables → Actions → New repository secret** and add `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and `ANTHROPIC_API_KEY`.
4. Re-run the latest workflow, or push to `main`. The app goes live at `https://littleroam.<your-subdomain>.workers.dev`.

Settings live in `worker/wrangler.toml`:
- `AI_MODEL` (default `claude-haiku-5-5`, the cheapest model)
- `AI_DAILY_LIMIT` (free AI suggestions per family per day)
- `MIN_FAMILIES` (the anonymity threshold)

### B. Static app without AI: GitHub Pages
One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**. The site goes live at `https://<user>.github.io/<repo>/`. The AI and community features switch themselves off when no server is present.

## Security headers
`_headers` sets a Content-Security-Policy (scripts only from the app itself), `nosniff`, `X-Frame-Options: DENY`, and referrer and permissions policies. Cloudflare serves it; GitHub Pages ignores it, which is one more reason to prefer the Cloudflare deploy.

## School calendars
Profile → a child → **Link school** → type the school's name and the child's grade → pick it from the list. LittleRoam reads only dates (days off, early release, events), never grades, messages or logins.
- **Automatic (needs the Worker):** `/api/schools` finds the school on OpenStreetMap; `/api/school-calendar` then (1) reuses what another family found, (2) looks for a calendar feed on the school's website, or (3) asks Claude (web search) for the official calendar and returns the dates for the parent to check. Results are cached in the Durable Object, keyed on the school name, area, website, town and district, so one request can't change another family's result. Uses the `AI_DAILY_LIMIT`.
- On GitHub Pages the search still works (straight from OpenStreetMap), but finding the calendar falls back to the options below.

Other ways:
- **Paste a calendar link** (`https://…` or `webcal://…`, usually from a “Subscribe” / “iCal” button). With the Worker deployed, `/api/school-feed` fetches it (school sites usually block browsers from reading feeds directly) and the app refreshes it daily. It only fetches public hostnames and only passes back real calendar files. Limit: `SCHOOL_FEED_DAILY_LIMIT` per network (default 60).
- **Import a .ics file.** Works on GitHub Pages too.
- **Snap the newsletter.** `/api/school-photo` sends the photo to Claude, which lists the dates; the parent checks them before saving. Shares the `AI_DAILY_LIMIT`.

## MCP server (for Claude, ChatGPT, Gemini and other AI assistants)
The Worker also serves a **public, no-login MCP server** at `https://<your-worker>/mcp`. It uses Streamable HTTP and is stateless, so it stores nothing. It has 5 read-only tools:

| Tool | What it does |
|---|---|
| `littleroam_search_activities` | Search the 58 activities: family or kids, ages, minutes, indoors/out, rain, energy, category, keyword |
| `littleroam_get_activity` | Materials, steps, skills and safety tips for one activity |
| `littleroam_find_places` | Family places (parks, playgrounds, museums…) and **kids' class venues** (swimming, dance, martial arts, music, art, sports) near a place name or coordinates, from OpenStreetMap |
| `littleroam_get_weather` | Daily forecast for a location and date |
| `littleroam_plan_day` | A 09:00–18:00 plan around things already booked (classes, parties), using the forecast |

**Connecting it.** These steps reflect my understanding as of late 2026; menus and plan requirements change, so check each product's current docs.
- **Claude (claude.ai / desktop):** Settings → Connectors → *Add custom connector* → paste the `/mcp` URL.
- **Claude Code:** `claude mcp add --transport http littleroam https://<your-worker>/mcp`
- **ChatGPT:** add it as a custom connector / MCP server (developer mode); availability depends on your plan.
- **Gemini CLI:** in `~/.gemini/settings.json` add `"mcpServers": { "littleroam": { "httpUrl": "https://<your-worker>/mcp" } }`

The MCP server needs only the Cloudflare deploy, not the Anthropic key. Requests are limited per network per day (`MCP_DAILY_LIMIT`, default 1000).

## Configure
- `js/app.js` → `WAITLIST_URL`: set this to a form link (e.g. Tally or Google Forms) to collect sign-ups for LittleRoam Plus.
- `sw.js` → bump `VERSION` whenever you change app files, so installed apps pick up the update.

## Privacy design
- No accounts. Plans, memories and photos stay on the device.
- **Popular near you** is opt-in each time a memory is saved. It sends only the activity id, the kids' age bands and a coarse ~5 km grid cell. The app never sends coordinates, names, notes or photos. The server only shows an activity once `MIN_FAMILIES` distinct families have shared it.
- **AI** receives the optional note, the kids' ages, the vibe, the free windows, **class types and times only** (e.g. "Swimming 09:00–10:00", never the class title or a child's name), the weather, up to 10 nearby place names and the area's anonymous trend counts. Every response is checked on the server:
  - unknown activity ids, unknown windows and activities too long for their window are dropped
  - places the app didn't provide are removed
  - popularity claims not backed by real data are removed
  - AI-written ideas are clamped to safe ranges and labelled "AI idea"

- **Plus waitlist** (optional): if a parent joins it, the server stores their email and how many kids they listed, nothing else. There's no public way to read it; the owner downloads it with the `ADMIN_TOKEN` secret (see below). No payment is taken.

- **Chat** sends what you type plus your family plan to Claude: kids' nicknames and ages, classes and events, and both weekends' free slots. It may search the web for events you mention. It never sends photos, memories or coordinates. The tools run on your phone, and each one is checked before it changes anything.

## Reading the Plus waitlist
1. Make a long random password (for example from a password manager) and add it as a GitHub repository secret named `ADMIN_TOKEN` (Settings → Secrets and variables → Actions). Never put it in the code or paste it in chat.
2. The next deploy sends it to the Worker.
3. Download the list as a spreadsheet:
   `curl -H "Authorization: Bearer YOUR_TOKEN" "https://littleroam.mathurpriya19.workers.dev/api/waitlist?format=csv" -o waitlist.csv`

Without `ADMIN_TOKEN` the list can still be joined, but nobody (including you) can read it until the secret is added.

Test coverage and results: [docs/TESTING.md](docs/TESTING.md)

## Data and attribution
Place data © OpenStreetMap contributors (ODbL), via the Overpass API and Nominatim. Weather comes from Open-Meteo. All three are free public services with fair-use limits. Plan for caching or a paid tier before you scale.
