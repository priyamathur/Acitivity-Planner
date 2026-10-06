# LittleRoam: test report

**Last run:** 7 Oct 2026 (the browser tests pin the date to Wednesday 7 Oct 2026, so this weekend is 10–11 Oct)
**Result:** ✅ all suites pass: 26 unit tests, 5 end-to-end suites. CI runs every suite on every PR and on every push to `main`.

| Suite | Command | What it runs | Result |
|---|---|---|---|
| Unit | `npm test` | Planning engine, privacy helpers, AI output validation, school calendar parsing (Node) | ✅ 26 / 26 |
| API | `npm run test:api` | The real server (Cloudflare Worker via `wrangler dev`) with a mock Claude API | ✅ |
| Browser, no server | `npm run test:e2e` | Full app in Chromium, as hosted on GitHub Pages (no AI) | ✅ |
| Browser, AI planning | `npm run test:e2e-ai` | App + server + mock Claude: AI weekend plan, Popular near you | ✅ |
| Browser, chat | `npm run test:e2e-chat` | App + server + scripted mock Claude: the chat loop editing the app, started from the Home ask bar | ✅ |
| MCP | `npm run test:mcp` | The official MCP client connects to the Worker's `/mcp` and calls all 5 tools (map, geocoding and weather use local fixtures) | ✅ |

> **What is mocked.** My build environment can't reach the internet, so these services are replaced with fakes that return realistic data: OpenStreetMap places, Open-Meteo weather and the **Claude API**. Every message *we send* to Claude is checked (model, tools, safety settings, privacy). Claude's *answers* in these tests are scripted. **Run the "Live checks" list at the end once the app is deployed with a real key.**

## Use cases covered

### Tabs, Discover, Profile (v3.1)
- [x] Three tabs (Plan · Discover · Profile); every screen highlights the right one (Weekend, Ideas and Places → Plan; Past adventures → Profile); chat hides the tab bar
- [x] Discover: 8+ ideas, no repeats, all suit the kids' ages (5 and 8); *Rainy day* has no dry-weather or outdoor-only ideas; *This weekend* has no at-home ideas; *Free days* lists school days off and bigger ideas (1 h+); "Show me different ideas" changes the feed; hearts save; tapping opens details
- [x] With the server: real "N families near you did this" picks lead the feed and aren't repeated
- [x] Profile: family, kids, share toggle saved, MCP address (or an explanation on static hosting), backup, Plus
- [x] No sideways scrolling on Home, Discover, Profile, Weekend, Ideas, Past adventures; dark mode screenshots

### School calendars
- [x] Grand Ridge Elementary via calendar link: missing school name, not-a-link, a web page instead of a calendar, a site that blocks browsers (→ suggests importing the file), then a `webcal://` link that works (stored as https)
- [x] All-day end dates handled (a one-day "No School" stays one day); early release recognised; "Holiday Concert", "Picture Day", "Book fair before winter break" are *not* days off; cancelled and long-past events dropped
- [x] Synergy Learning Academy via .ics file (a .txt is refused); imported files can't be "refreshed"
- [x] Day off shows on Plan ("No school Fri 9 Oct for Leo · Grand Ridge Elementary"), opens Discover → Free days; Kids → "School this week" shows only this week
- [x] Removing a child keeps the other child's school and classes attached to the right child
- [x] Unlink removes the school and the notice
- [x] With the server: a newsletter photo is compressed, sent to Claude as JPEG without the child's name, the impossible date is dropped, the parent unticks one date before saving; a second photo adds dates without duplicates; daily limit shared with AI plans
- [x] Server refuses localhost, private IPs, odd ports, credentials in links and non-calendar pages; an unreachable host gives a clear error
- [x] Chat's context includes upcoming days off (not ordinary school events)

### Home (Family | Kids)
- [x] Greeting, today's weather, Ask bar, Family/Kids switch
- [x] Family shows 5 together/outing ideas and Plan the weekend; Kids shows 5 different play ideas
- [x] Per-child filter (e.g. Leo, 8): every idea suits that age; time filter (≤ 30 min) respected
- [x] Kids: this week's classes, a small + to add a class, Find classes nearby
- [x] "See all kids ideas" opens All ideas with the Kids filter on; place chips open Places with that type selected
- [x] Ask bar without AI searches the library ("volcano" → Kitchen volcano); with AI it opens Ask LittleRoam and sends the message

### MCP server
- [x] An MCP client connects (`initialize`) and lists 5 tools, each with a description, input schema and `readOnlyHint`
- [x] Search: kids-only, ≤ 30 min, rain-friendly; family + outings; keyword; no results → a helpful error; age 99 rejected by the schema
- [x] Get activity: full steps and materials; unknown id → points to the search tool
- [x] Find places by place name (geocoded, sends an identifying User-Agent as Nominatim requires) and by coordinates; class venues (swimming pools); missing or unknown location → a clear error
- [x] Weather for a date (rain chance, "wet")
- [x] Plan a day around swimming 9–10 and a party 2–4 on a rainy day: the right free slots, rain-friendly activities that fit their slots, no repeats; no free time → error; bad date → rejected
- [x] CORS preflight for browser-based clients

### Weekend planning (no AI needed)
- [x] Onboarding: add two children with nicknames and birth years
- [x] This weekend / next weekend, with correct dates on a weekday, a Saturday and a Sunday (on Sunday, Saturday shows as over)
- [x] Add a weekly class, a class on several weekdays (Tue + Thu), and a "this week only" event
- [x] Weekday classes appear in the week sheet and the shared text, but never take weekend time
- [x] Free time is worked out around classes (15-minute travel buffer, lunch 12:30–13:30, gaps under 45 minutes dropped)
- [x] Plan with each vibe: one activity per free slot, each fits its slot, no repeats; on a rainy day no outdoor dry-weather-only activities; "cosy" stays near home
- [x] The timeline is in time order, and classes show the child's name
- [x] Swap a slot (always a different activity); remove a slot, then "+ Add something"
- [x] Tap a slot → details → We did it → the memory form defaults to that slot's date → the slot shows as done
- [x] Send to my partner: the whole weekend plus the coming weekday classes; past classes are left out
- [x] Skip a weekly class for one date only; the one-off party doesn't leak into next weekend
- [x] Ideas → Add to our weekend → pick a slot; favourites filter
- [x] Find classes nearby: pick a type (e.g. Martial arts) → the right map query (dojos) → "+ Add as a class" pre-fills the class name and venue; "Ask chat for times" is hidden without AI
- [x] Two tabs only (Weekend, Chat); Places near us, All ideas and Past weekends open from Weekend, keep the Weekend tab highlighted, and have a "‹ Weekend" back link
- [x] Near me: GPS and city search, place list, activity pairing
- [x] Memories: timeline, "weekends with an adventure", yearly recap
- [x] Data survives a page reload; activity deep links (`#a/<id>`) open
- [x] Dark mode and desktop layout; no sideways scrolling on a phone; no JavaScript errors

### AI weekend plan (with server)
- [x] Claude fills the free slots. Unknown slots, unknown activities, too-long activities and made-up places are dropped
- [x] Popularity claims not backed by real data are removed
- [x] Any slot the AI leaves empty is filled from the library
- [x] The optional note is passed on ("Grandma visits Sunday lunch")
- [x] **Privacy:** class titles and children's names are never sent, only the class type and time ("Swimming 09:00–10:00"); no GPS coordinates
- [x] AI-written ideas are labelled "AI", carry a safety note, and can't be shared with the community

### Chat (with server)
- [x] "There's a pumpkin festival this Saturday, let's go": Claude searches the web (including resuming a paused search), shows the source link, adds the event, and confirms. The event then appears on Saturday's timeline at 11:00
- [x] "Leo's football on Thursday moved to 5–6pm": updates the weekly class
- [x] "Rainy Sunday, make it cosy and plan next weekend": plans next weekend, then fine-tunes a slot
- [x] **Edge case found and fixed:** the chat could put the same activity in two slots. It is now moved instead of duplicated
- [x] Bad tool requests (a slot that doesn't exist, a date in the past, end before start, an unknown child) are rejected, Claude is told why, and **nothing in the app changes**
- [x] "Skip swimming next week": skips one date only
- [x] "Find a Saturday swimming class for Mia": Claude uses the class-venue finder and gets venue websites back to look up timetables
- [x] Venue → "Ask chat for times" opens the chat with the venue and its website already in the message box
- [x] Chat history survives switching tabs; "New chat" clears the chat but keeps the plan
- [x] Daily chat limit: the message over the limit is politely refused, and tool steps don't count toward it
- [x] Without a server, the Chat tab explains that it needs AI instead of breaking
- [x] Claude is sent today's date, the kids, the classes (with ids) and both weekends' free slots; all 8 app tools plus web search; strict tool schemas

### Server checks (API suite)
- [x] Popular near you: hidden until ≥ 3 families (≥ 2 in the browser test); the same family counted once; neighbouring areas included; other age bands and far-away areas excluded
- [x] Input validation: bad area codes, unknown activities, malformed slots, and window lengths recalculated on the server
- [x] AI and chat daily limits per family and per network, with refunds when a call fails on our side
- [x] Chat: rejects empty conversations, conversations that don't start with the user, `system` roles from the browser, missing family id, and oversized chats (with a "start a new chat" message)

## Bugs these tests caught (all fixed)
1. A closed bottom sheet still blocked taps on the page
2. On a Sunday, the saved weekend fell outside the planner view
3. "Sam's birthday **party**" was labelled 🎨 Art, because "p**art**y" contains "art"
4. The place name disappeared when the server removed an unsupported popularity claim
5. Chat: the same activity could be planned twice in one weekend
6. Profile: with no family name the avatar showed a broken character (half an emoji)
7. School form: the browser's own "required" check hid the app's clearer message
8. Editing the kids list could have attached a school or class to the wrong child (they're now re-mapped)

## Live checks to run after deploying (needs the real Claude key)
- School link: on the Grand Ridge calendar page (grandridge.isd411.org → Upcoming events → Calendar) look for a Subscribe / iCal option, paste it in Profile → Leo → Link school, and check a known day off. **Not verified yet:** my sandbox can't reach the site, so I don't know if its feed is iCal (works) or only RSS (won't).
- School photo: snap a real newsletter and check every date before saving.
0. MCP: add `https://<worker>/mcp` to Claude, ChatGPT or Gemini, then ask "find a rainy-day activity for a 4-year-old and a swimming pool near Seattle".
1. Chat: "There's a pumpkin festival near [your city] this Saturday, let's go". Check that the date and times match the event's website.
2. Chat: "Mia's swimming moved to 10am" and "Skip football on Thursday". Check the Weekend tab.
3. Chat: something vague like "add a party". It should ask which day and time instead of guessing.
4. Weekend: Plan our weekend with a note. Check that the plan respects the note.
5. Near me on your phone: GPS permission prompt, real places, Directions opens maps.
6. Install it: in the browser menu, choose Add to Home Screen, then open it from the icon.
7. Cost: after a few days, check usage in the Anthropic console. The estimate is about $0.03–0.05 per AI plan and a few cents per chat message, but treat those as guesses until you've seen real usage.
