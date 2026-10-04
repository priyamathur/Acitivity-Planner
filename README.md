# 🌱 LittleRoam: Family Activity Planner

LittleRoam helps parents plan screen-free activities, find free things to do nearby, and keep a private record of family memories. It's an installable web app (PWA) with no login and no ads, and your data stays on your device.

- **Today:** a planner bot asks 3 tap-only questions and suggests 3 ideas matched to your kids' ages, the time you have and today's weather.
- **Near me:** free playgrounds, parks, trails, libraries, museums and more nearby, using OpenStreetMap data.
- **Ideas:** 58 activities (sensory, nature, life skills, STEM, art, movement, connection).
- **Plans:** this week, seasonal bucket lists, a life-skills ladder by age, and family traditions.
- **Memories:** a private journal with photos, quotes, mood and a yearly recap.
- **✨ AI planner** (needs the server): Claude picks from the library based on your kids' ages, time, weather, nearby places and what's popular nearby. Parents can also ask a free-form question ("a calm idea for a 4-year-old with a cold").
- **👨‍👩‍👧 Popular with families near you** (needs the server): an anonymous, opt-in count of what families with kids the same age did nearby in the last 30 days.

📄 Product strategy, market research and pricing: [docs/PRD.md](docs/PRD.md)

## Run locally
```bash
npm start            # serves on http://localhost:8080 (needs python3)
npm test             # unit tests
npm run test:e2e     # browser tests, static (needs Playwright + Chromium)
npm run test:api     # runs the Worker locally (wrangler dev) against a mock Claude API
npm run test:e2e-ai  # browser tests of AI + Popular near you against the local Worker
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
- `AI_MODEL` (default `claude-opus-5-5`)
- `AI_DAILY_LIMIT` (free AI suggestions per family per day)
- `MIN_FAMILIES` (the anonymity threshold)

### B. Static app without AI: GitHub Pages
One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**. The site goes live at `https://<user>.github.io/<repo>/`. The AI and community features switch themselves off when no server is present.

## Configure
- `js/app.js` → `WAITLIST_URL`: set this to a form link (e.g. Tally or Google Forms) to collect sign-ups for LittleRoam Plus.
- `sw.js` → bump `VERSION` whenever you change app files, so installed apps pick up the update.

## Privacy design
- No accounts. Plans, memories and photos stay on the device.
- **Popular near you** is opt-in each time a memory is saved. It sends only the activity id, the kids' age bands and a coarse ~5 km grid cell. The app never sends coordinates, names, notes or photos. The server only shows an activity once `MIN_FAMILIES` distinct families have shared it.
- **AI** receives the question, the kids' ages, the time, place, energy and weather settings, up to 10 nearby place names, and the area's anonymous trend counts. Every response is checked on the server:
  - unknown activity ids are dropped
  - places the app didn't provide are removed
  - popularity claims not backed by real data are removed
  - AI-written ideas are clamped to safe ranges and labelled "AI idea"

## Data and attribution
Place data © OpenStreetMap contributors (ODbL), via the Overpass API and Nominatim. Weather comes from Open-Meteo. All three are free public services with fair-use limits. Plan for caching or a paid tier before you scale.
