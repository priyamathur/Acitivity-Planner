# 🌱 LittleRoam: Family Activity Planner

LittleRoam helps parents plan screen-free activities, find free things to do nearby, and keep a private record of family memories. It's an installable web app (PWA) with no login and no ads, and your data stays on your device.

- **Today:** a planner bot asks 3 tap-only questions and suggests 3 ideas matched to your kids' ages, the time you have and today's weather.
- **Near me:** free playgrounds, parks, trails, libraries, museums and more nearby, using OpenStreetMap data.
- **Ideas:** 58 activities (sensory, nature, life skills, STEM, art, movement, connection).
- **Plans:** this week, seasonal bucket lists, a life-skills ladder by age, and family traditions.
- **Memories:** a private journal with photos, quotes, mood and a yearly recap.

📄 Product strategy, market research and pricing: [docs/PRD.md](docs/PRD.md)

## Run locally
```bash
npm start            # serves on http://localhost:8080 (needs python3)
npm test             # unit tests
npm run test:e2e     # browser tests (needs Playwright + Chromium)
```
No build step. The app is plain HTML, CSS and ES modules.

## Deploy
Every push to `main` runs the tests and deploys to **GitHub Pages** using `.github/workflows/deploy.yml`.
One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
The site will then be live at `https://<user>.github.io/<repo>/`.

The site is fully static, so it also deploys to Netlify, Vercel or Cloudflare Pages as-is. Publish the `index.html`, `manifest.webmanifest`, `sw.js`, `css/`, `js/` and `icons/` files.

## Configure
- `js/app.js` → `WAITLIST_URL`: set this to a form link (e.g. Tally or Google Forms) to collect sign-ups for LittleRoam Plus.
- `sw.js` → bump `VERSION` whenever you change app files, so installed apps pick up the update.

## Data and attribution
Place data © OpenStreetMap contributors (ODbL), via the Overpass API and Nominatim. Weather comes from Open-Meteo. All three are free public services with fair-use limits. Plan for caching or a paid tier before you scale.
