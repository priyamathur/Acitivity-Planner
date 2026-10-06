# LittleRoam — Product Requirements Document

**Product:** LittleRoam, screen-free **family and kids activities**: ideas by age, places and classes nearby, weekend plans around the kids' classes, an ask-anything assistant, and an MCP server for AI assistants
**Version:** 3.0 (family + kids activities, ask bar, MCP), October 2026
**Owner:** Product / Founder
**Status:** Built and tested. v2.0 refocuses the whole product on the weekend.

> **How to read the numbers.** Every market figure below has a source and a confidence label. **[V]** means I checked it in a search result this session. **[U]** means it came from the brief or a secondary source and I could not confirm it against the primary source. My sandbox blocked access to Pinterest's newsroom, so check the **[U]** figures before you put them in a pitch deck.

---

## 0c. Decision log v3.2: find the school by name; saved ideas that teach the app
- **Linking a school = type its name and the child's grade.** Most parents can't find a downloadable calendar, so the app does the finding:
  1. search schools and preschools by name near home (OpenStreetMap; spacing and an added town are tolerated: "Grandridge elementary issaquah" finds "Grand Ridge Elementary School");
  2. look on the school's website for a calendar feed (iCal / webcal / Google Calendar), checking up to 3 calendar pages;
  3. if there's none, Claude searches the web for the official school or district calendar and reads the dates; the parent checks them before saving.
  The result is cached for the next family at that school (public school data only). The grade filters district calendars to what applies ("No school for kindergarten" only shows for kindergarten).
- **Saved ideas live in Discover → ♥ Saved** (and Profile → Saved ideas), with a Save button inside every idea. Saving now *teaches* the recommendations: saves, completed activities (😍 counts most) and swaps build a taste profile on the phone that lifts similar ideas everywhere (Discover, Plan, weekend plans) and explains itself ("Because you saved Kitchen volcano"). The feed keeps variety and stops showing what's already saved.

## 0b. Decision log v3.1: three tabs and school calendars
- **Three tabs: Plan · Discover · Profile.** *Plan* is Home (Family | Kids, ask bar, the weekend). *Discover* is a Pinterest-style feed matched to the kids' ages, the area, the weather and school days off, with real anonymous "families near you" picks first. *Profile* holds the family, kids and schools, the home area, sharing, past adventures, the MCP connector, backup and Plus. (This replaces v3.0's "no tabs" decision after user feedback.)
- **Visual design** follows the approved Claude Design canvas: white canvas, one green accent, apricot "Plan the weekend" card, Bricolage Grotesque + DM Sans.
- **Linking a school = bringing in its calendar, not its account.** School apps (Skyward, ParentSquare, Brightwheel…) don't offer parent sign-in to outside apps as far as we could find, and we don't want grades or messages anyway. Three ways in: paste the school's calendar link (.ics / webcal, refreshed daily through our server), import a .ics file, or snap the newsletter (Claude reads the dates; the parent checks them before saving). Days off and early release show on Plan, in Discover's *Free days*, and in chat's context. Email forwarding is shown in the design but **not built** (it needs an inbound-mail service).

## 0a. Decision log v3.0: family + kids activities, ask bar, MCP
After testing the weekend-only version, the product widens again, but with a much simpler surface:
- **Home has two sections: 👨‍👩‍👧 Family** (do things together and go out, places, Plan the weekend) **and 🧒 Kids** (play ideas per child and age, classes, find classes nearby). Parents think in these two modes: "what can we do together" and "what can the kids do".
- **No bottom tabs.** Everything starts from Home; other screens open from it and have a "‹ Home" back link.
- **Chat becomes an "Ask anything" bar on Home**, not a tab. Without AI, the same bar searches the library, so it's never a dead end.
- **MCP server:** a public, no-login MCP endpoint lets Claude, ChatGPT, Gemini and other assistants search activities, find places and class venues, get the weather and plan a day. It is a **distribution channel**: parents who already ask a chatbot "what should we do this weekend?" get LittleRoam's curated, safety-checked answers with a link back to the app. Personal tools (reading or editing *your* family's plan from a chatbot) need accounts and sign-in, so they're a later step.
- **Kept from v2:** the weekend timeline, weekday and weekend classes, photos in Past adventures, the AI weekend plan, Popular near you.

## 0. Decision log: why only the weekend (v2.0)
v1 tried to cover every moment: daily ideas, weekly plans, bucket lists, life skills and traditions. v2 narrows to **one job: "What are we doing this weekend?"** The reasons:
- **The pain peaks at the weekend.** The Thursday-night scramble (problem 3 below) and "things to do with kids near me" searches cluster around the weekend. A product that owns one recurring, painful moment is easier to explain, remember and recommend than a toolbox.
- **Weekends are already half-booked.** Swimming at 9, football at 11, a birthday party at 2. No planning tool we looked at combines a family's existing class schedule with ideas for the free time. Generic idea apps ignore the schedule, and calendars don't suggest anything. So **classes are first-class in v2**: parents add them once, and the planner fills only the real free windows, with travel buffers and lunch.
- **A natural weekly habit.** One plan a week gives a clear retention metric (planned weekends) and a natural notification moment ("Your weekend is free from 10:15, want a plan?").
- **Removed in v2:** the daily planner bot and quick picks, the 8-day planner, seasonal bucket lists, the life-skills ladder and traditions. The idea library stays as the source for the weekend, Near me stays because weekends are when families go out, and Memories stays because weekends are when the memories happen.

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
| **Family calendars (Google/Apple Calendar, Cozi-style apps)** | Holding the class schedule | Free / subscription (not verified) | They store what's booked but never suggest how to use the free time. |

**The gap LittleRoam fills:** in the products above, I found none that plans a family's **weekend around the classes they already have**. LittleRoam closes the **plan → do → remember** loop for **ages 2–12**, combining:
1. **The real schedule:** the kids' classes and one-off plans, with travel buffers and lunch
2. Personalised screen-free ideas for each free window (age × window length × weather forecast × vibe)
3. **Free** local places nearby, and what families with kids the same age enjoyed nearby
4. A **private, non-social** memory journal: no likes, no followers, no streak-shaming

Calendars know the schedule but don't suggest anything. Idea apps suggest things but ignore the schedule. Development apps stop at age 3–4, and Pinterest doesn't personalise or follow through. This is based on a limited scan, so do a deeper competitor check before fundraising.

## 4. Target users

### Primary persona: "The Intentional Weekend Planner"
- **Who:** A parent aged 28–42 with 1–3 kids aged **2–10**. Urban or suburban, often dual-income. The kids have 1–3 weekend classes (sport, music, faith, tutoring).
- **Behaviour:** Uses Pinterest and Instagram for ideas. Searches "things to do with kids near me" most weekends. Juggles the class schedule in their head or in a shared calendar. Feels guilty about screen time, and is short on time and energy.
- **Job to be done:** *"Every week, help me plan a weekend around the classes we already have, filling the gaps with something meaningful the kids will love that fits the weather, without scrolling for 30 minutes."*
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

## 6. Scope (built, v2.0)

| # | Feature | Status |
|---|---|---|
| F1 | **Weekend tab (home):** this weekend or next weekend. On a Sunday, Saturday shows as over. | ✅ |
| F2 | **Kids' classes and one-off plans:** title, which child (or everyone), Saturday or Sunday, start and end time, place. Repeats weekly or "this weekend only". Weekly classes can be skipped for one date (holidays). An emoji and type are assigned automatically (🏊 Swimming, ⚽ Football, 🩰 Dance, 🎉 Party…). | ✅ |
| F3 | **Free-window engine:** 09:00–18:00 days, with 15-minute travel buffers around classes and a 12:30–13:30 lunch break. Windows under 45 minutes are dropped. | ✅ |
| F4 | **Plan our weekend:** pick a vibe (🗺️ Big adventure / ⚖️ A bit of both / 🛋️ Cosy & slow). Each free window gets one activity that fits its length, the day's forecast (rain → indoor or rain-friendly) and the kids' ages, with no repeats across the weekend. | ✅ |
| F5 | **Timeline per day:** classes, lunch and planned activities in time order, with the weather forecast. Per slot: ✅ We did it (saves a memory dated that day), 🔄 Swap, ✕ Remove, "add something" for an empty window. | ✅ |
| F6 | **Send to my partner:** the whole weekend as a text (native share sheet or clipboard). | ✅ |
| F7 | **✨ AI weekend planning** (with server): Claude fills the windows given the bookings around them, the weather, the vibe, nearby places, local trends and an optional note ("Grandma visits Sunday lunch"). Empty windows fall back to the on-device engine. | ✅ |
| F8 | **👨‍👩‍👧 Popular with families near you** (with server): anonymous, opt-in, k-anonymous | ✅ |
| F9 | **Near me:** free playgrounds, parks, trails, libraries and more (OpenStreetMap). Named places feed the AI plan. | ✅ |
| F10 | **Idea library:** 58 activities. "Add to our weekend" picks a free slot this weekend or next. | ✅ |
| F11 | **Memories:** private journal with photos, a "weekends with an adventure" count and a yearly recap | ✅ |
| F12 | **Installable PWA**, shareable activity links, backup export/import | ✅ |
| F13 | **Plus pricing page** (interest only, no payments) | ✅ (stub) |
| F14 | **💬 Chat: "just talk":** natural-language requests ("there's an event I'm exploring, let's do it"). Claude uses web search to look up event details, then edits the app through 8 tools (add / update / remove / skip calendar items, plan a weekend, set or clear a slot, find places). Each change shows as a receipt. Tool inputs are validated on the device, and a failed tool changes nothing. Daily message limit; tool steps are free. | ✅ |

### Not built yet (next)
- **Calendar sync:** import classes from, and export the plan to, Google or Apple Calendar (Plus)
- **Per-child plans:** today a class blocks the whole family's time. Next, let a parent take one child to football while the other parent does something with the sibling.
- Thursday-evening reminder ("Your weekend has 4 free slots, want a plan?")
- Cloud accounts, sync and a shared family plan
- Popular *places* nearby, not just activities. This needs extra privacy review, because place visits are location traces.
- Local **events** (story-times, festivals). Needs licensed event feeds or partnerships.
- Printable memory book
- Native Play Store and App Store builds

## 6a. AI weekend planning and "Popular near you"

### Why AI here, and how it differs from a general chatbot
The AI is grounded in three things a chatbot doesn't have:
1. The **curated library**. The model picks library ids, and any idea it writes is labelled.
2. **Real nearby places** from the app's map search.
3. **Real anonymous local trends**.

The server validates every answer:
- It drops activity ids that don't exist and places it wasn't given.
- It removes popularity claims the data doesn't support.
- It clamps AI-written ideas to safe ranges.

The app works out the free windows itself, so the AI only decides **what goes in each one**. The server rejects any pick for a window it wasn't given, and any activity that doesn't fit its window. Class titles are reduced to a generic type ("Swimming 09:00–10:00") before anything is sent, so a child's name in a title never reaches the AI.

Parents never write a prompt: choose a vibe and tap. The optional note covers the long tail ("Grandma visits Sunday lunch", "Mia has a broken arm"), which the rules engine couldn't handle.

### Privacy and anti-comparison design
Showing "what others are doing" sits in tension with principle 2 (no comparison anxiety). The design resolves it like this:
- **Inspiration, not ranking.** We show *activities* other families enjoyed. Families are never shown, ranked or followed, and there are no likes or profiles.
- **k-anonymity.** An activity appears only after ≥ `MIN_FAMILIES` distinct families (default 3) in the area and age band shared it. Totals below the threshold are hidden too.
- **Data minimisation.** Each share contains only an activity id, age bands and a coarse grid cell (0.05° ≈ 5 km). Raw coordinates, names, notes and photos never leave the device. Device ids are hashed on the server.
- **Opt-in at the moment of sharing.** A checkbox on the memory form explains exactly what is sent. AI-written ideas are never shared.
- **Honest cold start.** When a neighbourhood has too little data, the app says so. We never show seeded or fake "families near you" data.

### Cost and pricing implications
These figures are estimates; check them against `usage` in production. One weekend plan sends roughly 3.5k input tokens (the system prompt with the 58-item catalogue, plus the weekend) and gets back about 1–2k output tokens. With Claude Opus 5.5 ($4 / $20 per million tokens), that is about **$0.03–0.05 per weekend plan**.

The weekend focus helps cost: a family typically needs **one AI plan a week**, not several a day. At 10,000 weekly families that is roughly $300–500 a week. For that reason:
- Free users get a small daily allowance (`AI_DAILY_LIMIT`, default 5). Swaps use the free on-device engine. Unlimited AI re-plans are a **Plus** feature.
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
| **Free** | $0 | Weekend planner around your classes, swaps, near me, full idea library, a few AI plans, Popular near you, memories on the device, backup export |
| **LittleRoam Plus** | **$4.99/mo or $34.99/yr** (~42% off monthly). **14-day free trial.** One subscription covers the whole family. | Unlimited AI weekend plans. Google/Apple Calendar sync for classes. A shared family plan (partner, grandparents). Local weekend events. Cloud backup and photo sync. Printable memory book. |
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
| Activation | % of new users who add a class and plan a weekend in session 1 | > 50% |
| Time to plan | median time from open to a full weekend plan | < 60 s |
| North star | **planned weekends per family per month** | > 2.5 |
| Follow-through | % of users who save at least one memory in week 1 | > 20% |
| Retention | % of families who plan again the following weekend / 4 weeks later | > 40% / > 20% |
| Virality | shares per weekly active user | > 0.3 |
| Monetisation (post-Plus) | free → trial / trial → paid | 5% / 35% |

These are my starting hypotheses, not industry benchmarks. Instrument privacy-friendly analytics (e.g. Plausible) before treating any of them as real.

## 10. Go-to-market (first 90 days)
1. **Own Thursday night:** content and (later) a reminder timed for when weekend planning happens. "Plan your weekend in 60 seconds" is the hook.
2. **Pinterest-native SEO:** every activity has a shareable URL. Pin the 58 idea cards as boards ("Rainy weekend ideas for toddlers").
3. **Parent communities:** local parent Facebook groups, Reddit r/Parenting and r/toddlers (follow each community's self-promotion rules), school WhatsApp groups. The hook: "free, no-ads, no-login near-me planner".
4. **Where weekend classes happen:** QR posters at swimming pools, leisure centres and libraries ("Waiting at swimming? Plan the rest of your weekend"). This is high intent and a natural partnership.
5. **Seasonal moments:** summer break ("no phone summer"), half-terms, winter holidays.
6. **Referral:** at Plus launch, give a free month for each family invited.

## 11. Risks and mitigations
| Risk | Mitigation |
|---|---|
| Open map data is incomplete in some areas | Show "unnamed" places honestly and allow bigger search radii. Later, let parents add tips. |
| Free Overpass, Nominatim and Open-Meteo services have usage policies and rate limits | Fine at MVP scale. Before scaling, self-host Overpass or use a paid provider, and add caching. |
| Data loss (local-only storage) | Export backup now. Cloud sync is the first Plus feature. |
| Safety of activities | Supervision tips in the content. Later: expert review of all content. |
| The name "LittleRoam" may be trademarked or similar to existing marks | Run a trademark and app-store name search before marketing spend. |
| Plus demand is unproven | The interest button measures intent before building payments. |
| Narrowing to weekends shrinks the use case | The weekend is the peak-pain moment. School holidays ("plan the half-term") can reuse the same engine later without losing focus. |

## 12. Roadmap
- **Week 1–2:** analytics, waitlist form (set `WAITLIST_URL`), 25 more activities, PWA install prompt
- **Month 1:** calendar import for classes, Thursday reminder, shared family plan, Stripe for Plus
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
