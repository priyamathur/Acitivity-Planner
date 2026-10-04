# LittleRoam — Product Requirements Document

**Product:** LittleRoam, a family activity planner (screen-free ideas, near-me adventures, family memories)
**Version:** 1.0 (MVP), October 2026
**Owner:** Product / Founder
**Status:** MVP live-ready. v1.1 adds the AI planner and Popular near you.

> **How to read the numbers.** Every market figure below has a source and a confidence label. **[V]** means I checked it in a search result this session. **[U]** means it came from the brief or a secondary source and I could not confirm it against the primary source. My sandbox blocked access to Pinterest's newsroom, so check the **[U]** figures before you put them in a pitch deck.

---

## 1. Problem

Parents want their kids to have an intentional, experience-rich childhood that is mostly offline. Planning one is still painful:

1. **Idea overload, not idea shortage.** Pinterest and Instagram have endless inspiration. None of it filters for *my* kids' ages, the time I have, today's weather, or what's within 5 km of me.
2. **"Things to do near me" is broken.** Search results are full of paid attractions, SEO listicles and out-of-date events. The free places, like the playground with toilets, the library story-time or the easy trail, are hard to find.
3. **Planning is a weekly chore.** Thursday night's "what are we doing this weekend?" scramble repeats every week.
4. **Memories are scattered and performative.** Photos end up in a camera roll of thousands. Sharing to social media brings the comparison anxiety parents say they want to avoid.
5. **Long-term intent gets lost.** "Teach them to tie shoes", "start a family tradition" and "do a summer bucket list" have no home.

## 2. Market signal

| Signal | Figure | Source | Confidence |
|---|---|---|---|
| "Educational activities for kids" searches | +280% YoY | Pinterest Parenting Trend Report 2026 (via secondary coverage) | [V] in search snippets |
| "Sensory play ideas" | +1,070% | same | [V] in search snippets |
| "Screen free activities" | +200% | same | [V] in search snippets |
| "Family traditions ideas" | +200% | same | [V] in search snippets |
| "No phone summer" | +340% | same | [V] in search snippets |
| "Outdoor learning" | +65% | same | [V] in search snippets |
| "Movement activities for toddlers" | +145% | same | [V] in search snippets |
| "DIY kids playgrounds" | +630% | same | [V] in search snippets |
| "Life skills activities" | +100% | from the brief | [U] |
| "Plan little adventures" without comparison anxiety | qualitative | from the brief | [U] |

Pinterest describes the overall theme as "thoughtful parenting": raising screen-smart kids who look for real-world adventure. The time window and regions behind these percentages were not visible to me. Check them on the primary source: https://newsroom.pinterest.com/news/parenting-trend-report-2026/

**What the market signal means for the product:**
- Demand is for **ideas and planning**, not more content to scroll.
- The fastest-growing terms (sensory, educational, life skills, traditions) map onto **activity categories**. They became the app's taxonomy.
- "No phone summer" and "digital detox" set a design constraint: **the app has to get parents off their phones quickly.** The target is a planned activity in under 60 seconds.

## 3. Competitive landscape and the gap

| Product | What it does well | Price (as found; verify) | Gap |
|---|---|---|---|
| **Pinterest** | Infinite inspiration | Free, ad-funded | No personalisation by age, time, weather or location. No plan, no follow-through, no memories. Feeds comparison. |
| **Winnie** | Childcare search; family-friendly places | Free for parents; providers pay | Built around childcare. Not an activity planner. |
| **Kinedu** | Daily development activities, 0–4 years | ~$7/mo [V, approx.] | Ages 0–4 only, all at home, no local places, no memories. |
| **Lovevery app** | Montessori-style stage-based play, 0–3 years | ~$12/mo app-only [V, approx.] | Ages 0–3, tied to a physical toy-kit subscription ($80–120/kit). |
| **Tinybeans / FamilyAlbum** | Private photo sharing | Tinybeans+ ~$7.99/mo or $74.99/yr [V, approx.] | Memories only. No ideas or planning. |
| **Google Maps / Yelp** | Places | Free | Not kid-aware. Paid attractions and ads dominate. |
| **Local "mommy blogs"/ event sites** | Hyper-local events | Free, ad-heavy | Fragmented, often stale, not personalised. |

**The gap LittleRoam fills:** no single product closes the **plan → do → remember** loop for **ages 2–12**, combining:
1. Personalised screen-free ideas (age × time × place × energy × weather)
2. **Free** local places nearby, paired with an activity that turns a playground trip into an adventure
3. Short-term plans (today, this weekend) **and** long-term ones (seasonal bucket lists, life-skills ladders, traditions)
4. A **private, non-social** memory journal: no likes, no followers, no streak-shaming

Development apps stop at age 3–4, photo apps don't plan, and Pinterest doesn't personalise or follow through. LittleRoam is the connective tissue between them.

## 4. Target users

### Primary persona: "The Intentional Weekend Planner"
- **Who:** A parent aged 28–42 with 1–3 kids aged **2–8**. Urban or suburban, often dual-income.
- **Behaviour:** Uses Pinterest and Instagram for ideas. Searches "things to do with kids near me" most weekends. Feels guilty about screen time, and is short on time and energy.
- **Job to be done:** *"When I have a free afternoon or weekend, help me pick something meaningful my kids will love, that fits our time and the weather, without scrolling for 30 minutes."*
- **Success:** They get a plan in under a minute, get off the phone, and save a memory afterwards.

### Secondary personas
- **Grandparents and caregivers:** they have time but run low on age-appropriate ideas. They'll be the main reason the shared-family feature exists (Plus).
- **Homeschool and "worldschool" families:** heavy users of life-skills and nature content. Potential power users.
- **Nannies and childminders:** need a daily rotation of ideas. Later: a B2B "caregiver" plan.

### Explicitly not targeting (v1)
- Parents of babies under 18 months (Kinedu and Lovevery serve them well)
- Teens (different motivations and autonomy)
- Paid-attraction booking (would compromise the "free and nearby" promise)

## 5. Product principles
1. **Off the phone fast.** Every core flow ends in an offline action within 60 seconds.
2. **Private by default.** Local-first storage. No social feed, no public profiles, no comparison metrics.
3. **Free things first.** Near-me results come from open map data with no sponsored ranking. Any future partner listing will be clearly labelled and never outrank organic results.
4. **Gentle, not gamified.** Progress bars yes, streak guilt no. Every empty state reassures ("Free day, leave room for boredom").
5. **Safety woven in.** Supervision notes on water, heat and choking-risk activities.

## 6. MVP scope (built)

| # | Feature | Short or long term | Status |
|---|---|---|---|
| F1 | **Planner bot (Today):** 3 tap-only questions (time, place, energy), then 3 diverse ideas scored by kids' ages, live weather, freshness and favourites. "Show me others" reshuffles. | Short | ✅ |
| F2 | **Quick picks:** rainy-day rescue, 15 minutes before dinner, plan my weekend, near me | Short | ✅ |
| F3 | **Near me:** GPS or city/postcode. 10 categories: playgrounds, parks, nature and trails, libraries, museums, zoos and aquariums, beaches and splash pads, picnic spots, farms and markets, ice cream. Shows distance, free entry, toilets and accessibility where tagged. Directions link. Each category is paired with an activity. | Short | ✅ |
| F4 | **Idea library:** 58 activities across 7 categories (sensory, nature, life skills, STEM, art, movement, connection). Each has materials, steps, skills learned, mess level and safety tips. Search, filters, favourites. | Both | ✅ |
| F5 | **Weekly plan:** 8-day planner. Auto-plan the weekend. Add any idea to a day. Mark done to save a memory. | Short | ✅ |
| F6 | **Seasonal bucket lists:** 4 seasons × 10 items with progress | Long | ✅ |
| F7 | **Life-skills ladder:** 4 age bands, 27 skills, opens to your kids' ages | Long | ✅ |
| F8 | **Family traditions:** 6 traditions you can adopt (weekly, monthly, seasonal, yearly) | Long | ✅ |
| F9 | **Memories:** title, date, mood, note, "something they said", and a photo (compressed, stored on the device). Monthly timeline, stats, "Our year so far" recap. | Long | ✅ |
| F10 | **Shareable activity links** (`#a/<id>`) with native share. This is the viral loop. | Growth | ✅ |
| F11 | **Installable PWA:** works offline (except live maps and weather), home-screen icon, shortcuts | Platform | ✅ |
| F12 | **Backup:** JSON export and import. Erase all. | Trust | ✅ |
| F13 | **Plus pricing page:** shows planned pricing and captures interest. **No payments yet.** | Monetisation | ✅ (stub) |

| F14 | **✨ AI planner (v1.1):** Claude chooses from the curated library using kids' ages, time, place, energy, weather, nearby places and local trends. Each pick comes with a "why". Parents can also ask free-form questions; for those, AI may write up to 3 new ideas. If AI is unavailable, the app falls back to the on-device engine. | Both | ✅ |
| F15 | **👨‍👩‍👧 Popular with families near you (v1.1):** anonymous, opt-in counts of what families with kids in the same age band did within ~15 km over the last 30 days | Short | ✅ |

### Not in MVP (next)
- Cloud accounts, sync and family sharing
- Popular *places* nearby, not just activities. This needs extra privacy review, because place visits are location traces.
- Local **events** (story-times, festivals). Needs licensed event feeds or partnerships.
- Printable memory book, push reminders ("Saturday looks sunny, want a plan?")
- Native Play Store and App Store builds

## 6a. AI planner and "Popular near you" (v1.1)

### Why AI here, and how it differs from a general chatbot
The AI is grounded in three things a chatbot doesn't have:
1. The **curated library**. The model picks library ids, and any idea it writes is labelled.
2. **Real nearby places** from the app's map search.
3. **Real anonymous local trends**.

The server validates every answer:
- It drops activity ids that don't exist and places it wasn't given.
- It removes popularity claims the data doesn't support.
- It clamps AI-written ideas to safe ranges.

Parents never write a prompt; three taps are enough. Free-form "Ask" covers the long tail ("a calm idea for a 4-year-old with a broken arm"). This is the gap the rules engine couldn't fill.

### Privacy and anti-comparison design
Showing "what others are doing" sits in tension with principle 2 (no comparison anxiety). The design resolves it like this:
- **Inspiration, not ranking.** We show *activities* other families enjoyed. Families are never shown, ranked or followed, and there are no likes or profiles.
- **k-anonymity.** An activity appears only after ≥ `MIN_FAMILIES` distinct families (default 3) in the area and age band shared it. Totals below the threshold are hidden too.
- **Data minimisation.** Each share contains only an activity id, age bands and a coarse grid cell (0.05° ≈ 5 km). Raw coordinates, names, notes and photos never leave the device. Device ids are hashed on the server.
- **Opt-in at the moment of sharing.** A checkbox on the memory form explains exactly what is sent. AI-written ideas are never shared.
- **Honest cold start.** When a neighbourhood has too little data, the app says so. We never show seeded or fake "families near you" data.

### Cost and pricing implications
These figures are estimates; check them against `usage` in production. Each suggestion sends roughly 3k input tokens (the system prompt with the 58-item catalogue, plus context) and gets back about 0.5–1.5k output tokens. With Claude Opus 5.5 ($4 / $20 per million tokens), that is about **$0.02–0.04 per suggestion**.

At 1,000 families using AI twice a day, that comes to roughly $40–80/day. For that reason:
- Free users get a small daily allowance (`AI_DAILY_LIMIT`, default 5). Unlimited AI is a core **Plus** feature.
- The model is one setting (`AI_MODEL`). Cheaper models (Claude Sonnet 5.5 at $2 / $10, Claude Haiku 4.5 at $1 / $5) can be tested against an eval set before switching.
- The cold-start problem for Popular near you is real. Launch city by city (parent groups, libraries) so neighbourhoods cross the threshold quickly.

### Architecture
Cloudflare Worker (static app + `/api/*`) → Durable Object with SQLite (anonymous events, AI rate limits) → Claude API using structured JSON output, low effort, and server-side refusal fallback. The API key exists only as a Worker secret.

## 7. Platform decision: web app (PWA) first, Play Store second

**Decision: ship as an installable PWA on GitHub Pages today, then wrap it for the Play Store.**

| | PWA (chosen) | Play Store native |
|---|---|---|
| Time to live | Minutes after merge | Days to weeks. Google requires new personal developer accounts to run a closed test with a minimum number of testers for about 14 days before production. I recall 12 testers, but the policy has changed before, so verify it in the Play Console. |
| Reach | iOS **and** Android **and** desktop from one link | Android only |
| Sharing | Any link opens straight into an activity (viral loop) | Needs install first |
| Cost | $0 | One-off developer fee (approx. $25; verify) |
| Discovery | SEO, Pinterest pins that link to activities | Play Store search |

Pinterest is where the demand already lives, and pins link to **web pages**. A web-first product turns every activity into a pinnable, shareable landing page, which is the most direct path to wide adoption. Once retention is proven, the same codebase can go to the Play Store as a **Trusted Web Activity** (e.g. with Google's Bubblewrap tool), and to iOS with Capacitor if needed.

## 8. Monetisation and pricing

### Benchmarks (approximate; verify current prices)
- Kinedu: ~$7/mo · Lovevery app: ~$12/mo · Tinybeans+: $7.99/mo or $74.99/yr
- RevenueCat *State of Subscription Apps 2026* (115k apps) [V, from search summary]: hard paywalls convert about 5× better than freemium (10.7% vs 2.1% median download-to-paid). Trials of 17–32 days convert about 70% better than 3-day trials. Source: https://www.revenuecat.com/state-of-subscription-apps

### Recommendation: generous freemium for adoption, Plus for durability
The goal is **wide adoption**, and the core value (ideas, near me, memories on the device) costs almost nothing to serve because it runs client-side on open data. So the free tier stays **genuinely useful**, and the paid tier charges for things that have real ongoing costs: cloud storage and sync, sharing, printing, AI.

| Plan | Price | Includes |
|---|---|---|
| **Free** | $0 | Planner bot, quick picks, near me, full idea library, weekly plan, bucket lists, life skills, traditions, memories on the device, backup export |
| **LittleRoam Plus** | **$4.99/mo or $34.99/yr** (~42% off monthly). **14-day free trial.** One subscription covers the whole family. | Cloud backup and photo sync. Share with a partner and grandparents. Personalised AI planner. Seasonal adventure packs. Local events. Printable memory book and yearly recap. |
| **Founding family** (launch only) | $59 lifetime, first 1,000 families | Everything in Plus, forever. Funds the early runway and rewards evangelists. |
| **Later: Caregiver/Pro** | ~$9.99/mo | Multiple families, daily rotation, printable plans for nannies, childminders and homeschool co-ops |

**Why these prices:**
- Annual at $34.99 is under half of Tinybeans+ ($74.99) and well below Kinedu and Lovevery monthly. That makes it an easy yes for a "nice-to-have" family app.
- The 14-day trial sits close to the 17–32-day band RevenueCat reports converting best, and covers two weekends, which is when the core use happens.
- Family-wide pricing makes grandparents a sharing channel, not an extra seat cost.
- I'm choosing freemium over a hard paywall on purpose, despite the RevenueCat conversion data. The adoption goal and the viral share loop need free users, and the free tier costs close to nothing to serve.

### Secondary revenue (later, principle-guarded)
- **B2B2C:** libraries, pediatric clinics and schools license a co-branded "family adventure" edition.
- **Clearly labelled local partner listings** (museums, farms), never ranked above organic free places.
- **Printed memory books** (fulfilment margin).

## 9. Success metrics

| Stage | Metric | MVP target (hypotheses to validate) |
|---|---|---|
| Activation | % of new users who get a plan in session 1 | > 60% |
| Time to plan | median time from open to 3 ideas | < 45 s |
| Follow-through | % of users who save at least one memory in week 1 | > 20% |
| Retention | W4 retention | > 20% |
| Virality | shares per weekly active user | > 0.3 |
| Monetisation (post-Plus) | free → trial / trial → paid | 5% / 35% |

These are my starting hypotheses, not industry benchmarks. Instrument privacy-friendly analytics (e.g. Plausible) before treating any of them as real.

## 10. Go-to-market (first 90 days)
1. **Pinterest-native SEO:** every activity has a shareable URL. Pin 58 idea cards plus seasonal bucket lists as boards ("Autumn bucket list for toddlers").
2. **Parent communities:** local parent Facebook groups, Reddit r/Parenting and r/toddlers (follow each community's self-promotion rules), school WhatsApp groups. The hook: "free, no-ads, no-login near-me planner".
3. **Libraries and pediatric offices:** a QR poster ("Rainy day? Scan for 58 screen-free ideas").
4. **Seasonal moments:** summer break ("no phone summer"), half-terms, winter holidays.
5. **Referral:** at Plus launch, give a free month for each family invited.

## 11. Risks and mitigations
| Risk | Mitigation |
|---|---|
| Open map data is incomplete in some areas | Show "unnamed" places honestly and allow bigger search radii. Later, let parents add tips. |
| Free Overpass, Nominatim and Open-Meteo services have usage policies and rate limits | Fine at MVP scale. Before scaling, self-host Overpass or use a paid provider, and add caching. |
| Data loss (local-only storage) | Export backup now. Cloud sync is the first Plus feature. |
| Safety of activities | Supervision tips in the content. Later: expert review of all content. |
| The name "LittleRoam" may be trademarked or similar to existing marks | Run a trademark and app-store name search before marketing spend. |
| Plus demand is unproven | The interest button measures intent before building payments. |

## 12. Roadmap
- **Week 1–2:** analytics, waitlist form (set `WAITLIST_URL`), 25 more activities, PWA install prompt
- **Month 1:** Supabase auth and sync. Family sharing. Stripe for Plus. Reminders.
- **Month 2:** Play Store (TWA), AI eval set and model/cost tuning, local events pilot in 1–2 cities
- **Month 3:** printable memory book, B2B library pilot

## 13. Technical architecture (MVP)
- **Stack:** vanilla HTML/CSS/ES modules. No build step and no framework, so it's fast on low-end phones and deploys anywhere static.
- **Data:** `localStorage` for profile and plans. `IndexedDB` for photos, compressed to 1280px JPEG on the device.
- **Live data (free, no API keys):** OpenStreetMap via Overpass (places), Nominatim (place search), Open-Meteo (weather).
- **Offline:** a service worker caches the app shell (stale-while-revalidate).
- **Privacy:** no accounts, no trackers. Kids are stored as birth year plus an optional nickname only.
- **Quality:** unit tests for the recommendation engine and parsing (`npm test`), plus a Playwright end-to-end test of every tab with the external APIs mocked (`npm run test:e2e`). Both run in CI.
- **Deploy:** GitHub Actions → GitHub Pages on every push to `main`.
