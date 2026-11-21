# Alex — agent handoff

Owns the 3D viewer, API, and web app (`packages/viewer`, `apps/api`, and `apps/web`, A1–A5).

## 2026-11-21 16:22 ET · More pairs when one misses; processing view 3D left / progress right; Shopify cart fixed locally

- Spot check: on the new short videos (video/1.mp4, 2.mp4, unit-80c87d70) one pair scored same-spot 0.67 (< 0.7) and the paper came out "not provable". Now, when the first two pairs don't give an independent proof, it tries up to 2 more confirmed move-out views × their top move-in frames (≤ 6 extra pairs) and charges only on two agreeing pairs that share no frame (`independentPair`). Result: $85, proof frames checked by eye (move-in 6/5 without the paper, move-out 7/5 with it). New test for the near miss.
- Processing view: full screen, 3D big on the left, progress on the right (move-in and move-out).
- Shopify "Find fixes" failed at the cart step on this laptop: Playwright's Chromium was never installed. Ran `pnpm --filter @ledger/cart-agent exec playwright install chromium` (local machine setup, nothing in git). Then via the API all 3 carts filled (Wynn USA $9.42, TouchUp.com $19.99, All Marine World $4.59), no checkout. Note for Rahim: `.env` has no SHOP_MODE, so it runs in mock (closest recorded search), which is why "adhesive remover" picked a floor cleaner.

## 2026-11-21 16:04 ET · Live 3D while a video is processed

- `apps/web/components/LiveModel.tsx`: on the move-in and move-out upload screens the apartment's 3D sits above the progress (drag/zoom), a label follows the running step and a highlight walks the walls; when the job is done the real results drop in as pins (move-out also shows the total) and a button continues (no auto-redirect). `JobProgress` gained `onChange` and `hold`; other users (fix kit) keep the old behaviour.
- Verified: a real move-out upload of IMG_0023.MOV in Chrome on a copy unit (`unit-livetest`, local only) finished in 41 s, pins and $85 shown, no browser errors. The highlight shows the step, not the exact wall being read (that would need per-frame events from the pipeline).

## 2026-11-21 15:40 ET · New visual design for the web app

- New type and colour system (`apps/web/app/globals.css`, `layout.tsx`): Bricolage Grotesque headlines, Hanken Grotesk body, JetBrains Mono for money; off-white, near-black, one receipt orange for charged money. Dropped the italic serif and spaced-caps labels.
- Landing rebuilt: masked headline reveal, a statement receipt that prints line by line and gets stamped, parallax 3D, a marquee strip, hover rows for the steps, the proof rule in a dark block.
- Verdict labels are coloured tags. Checked every page in Chrome after scrolling: no browser errors.

## 2026-11-21 15:25 ET · Front end in plain words, page animations, pins on the item

- Rewrote every on-screen line in plain language (landing, new unit, plan check, uploads, progress, unit page, statement, statement reasons from the spot check).
- Page transitions (`app/template.tsx`), loading skeletons instead of "Loading…", a "done" moment when a video finishes.
- Pins land on the exact spot, for any surface: the spot check's `spot.where` asks what the damage is on (a plan fixture, a wall or the floor), what it's next to (fixtures, doors, windows), which side of that item (asked by its name) and how high (bands → probability-weighted meters). Stored in a new optional `DiffItem.spot { heightM, nearId }` (additive contract field; Elmir/Rahim please note). The viewer's `spotAnchor` puts the pin on that item or wall at that height beside that thing; pins draw on top so items never hide them. Checked on unit-460c3358: column mark on the column at 0.65 m, paper at 1.46 m to the right of the portrait.
- Verified: all tests, typecheck, lint; every page loads with no browser errors.
## 2026-11-21 15:45 ET · From Rahim: "Find fixes on Shopify" on the statement page (branch `rahim/shopify-button`)

- **New:** `apps/web/components/FixKitPanel.tsx`, rendered at the bottom of `/units/:id/statement` only when the statement has a `new-damage` item. One primary button, "Find fixes on Shopify":
  1. `POST /units/:id/fixkit` → live feed of the job's `fixkit` SSE lines (query written, searching, picked … (confidence), checkout …) plus the Decisions call/question count.
  2. `GET /units/:id/fixkit` → kit table (need, product link, options, confidence, seller, qty × price, line total) under the big line **"Fix it yourself: $X vs $Y deduction"**.
  3. After 1.2 s, automatically `POST /units/:id/fixkit/cart` → `cart` feed lines (opening <store> → product page → added → cart verified), with the latest agent screenshot beside the feed.
  4. Done → one card per seller: verified badge, lines, subtotal, cart screenshot, **"Open cart"** (`cartUrl`) and, if the seller failed, "Shop checkout link" (`fallbackUrl`).
  - A kit/cart from an earlier run is shown on reload; the button then reads "Find fixes on Shopify again".
- **Small edits in your files:** `lib/api.ts` (Stage + `fixkit`/`cart`, the two JobEvent variants, `FixKit`/`CartSummary` types, `buildFixKit`/`fixKit`/`fillCarts`/`carts`/`apiUrl`, and `followJob` now also listens to `fixkit` and `cart`); `JobProgress.tsx` only changes its last `else` to `else if (e.type === 'error')` so the new event types can't be mistaken for errors; statement `page.tsx` +2 lines.
- **Cart tabs stay open:** `packages/cart-agent/src/held.ts` holds the Playwright browser at module level. It is closed only by the next run's launch, `POST …/fixkit/cart/close`, or API exit (Playwright's own signal handlers).
- Note: "Open cart" opens the store's /cart in the viewer's own browser, which has its own cookies, so the cart there may look empty. The filled carts are the tabs in the agent's Chromium window.

## 2026-11-21 15:22 ET · From Rahim: cart agent API, `POST /units/:id/fixkit/cart` (branch `rahim/cart-agent`)

- **Button (fix kit panel, after the kit is built):** "Watch the agent fill the carts". It POSTs `/units/:id/fixkit/cart`. A visible Chromium opens **on the laptop running the API**. For each seller it shows the store, the product page, adds the picked variant and stops on that store's `/cart` page (one tab per seller, left open). It never checks out.
- `POST /units/:id/fixkit/cart` → `202 { jobId, events }`. Use the same `EventSource` as the other jobs. `?wait=1` runs inline → `200 { carts }`. `409` = no fixkit.json yet, or a run is already going. Optional JSON body `{ sellers?: string[], maxSellers?: number }`. A new run closes the previous run's window.
- **SSE events on that job:**
  - `progress` `{ stage:'cart', done, total }` (done = sellers finished).
  - `cart` `{ type:'cart', text, event }`. `text` is a ready-made feed line, e.g. `opening Painters Solutions` → `product page: Hyde 02250 …` → `added Hyde 02250 … ×1 (store button)` → `cart verified at Painters Solutions, 1 item, $4.20`. `event.step` is `start | opening | product | popup | added | add-failed | cart | cart-verified | seller-failed | done`. `product` and `cart-verified` carry `screenshot`: a URL you can put in an `<img>` (`/units/:id/fixkit/cart/shots/<file>.png`).
  - `done` `{ result:{ carts } }`, or `error`.
- `carts[]`: `{ seller, shop, cartUrl, verified, itemCount, subtotal, currency, lines[{ title, quantity, via?, error? }], screenshot?, error?, fallbackUrl? }`. `verified` = every picked variant is in the store's `/cart.js` at the right quantity. `subtotal` is the store's, before tax and shipping.
- **When a seller fails** (`verified:false`, 30 s timebox), show `fallbackUrl` as a link: it is the Shop checkout `continue_url` (an access key, so don't log it).
- `GET /units/:id/fixkit/cart` = the last run. `POST /units/:id/fixkit/cart/close` closes the agent's window.
- **Layout idea:** the live feed with the cart screenshots next to the real browser window. Then "Open cart at <seller>" buttons (`cartUrl`) and the line "Nothing was bought".
- Files: new `apps/api/src/routes/cart.ts`, 2 lines in `app.ts`, additive types in `events.ts` (`Stage` + `'cart'`, a `cart` JobEvent, `CartSummary`, `done.result` may be `{ carts }`), test `apps/api/test/cart.test.ts` (fake browser).
- Needs Chromium once on the demo laptop: `pnpm --filter @ledger/cart-agent exec playwright install chromium`. `CART_AGENT_HEADLESS=1` hides the window (CI).

## 2026-11-21 14:54 ET · Spot check finds the change on our videos, with the right proof frames

- `apps/api/src/spotCheck.ts` is the move-out comparison by default (DIFF_MODE=pipeline for R4/R5): screen every move-out frame → events → confirm a second move-out view shows the same item → search every move-in frame in batches for the same spot (surroundings tell identical fixtures apart) → two independent "is this new?" pairs → merge repeated sightings of the same item.
- Live on unit-3b3c637b (conference room): paper on the wall light next to the portrait → **new, $85**; yellow column mark → **pre-existing, $0**. Proof frames checked by eye. Full history in `apps/api/test/plans/RESULTS.md` (v1 wrong proof frames, v2 identical lights confused). Tuned on this one pair: needs held-out pairs.
- `pnpm --filter @ledger/api exec tsx scripts/spot-run.ts <unit> [--write]` re-runs just the comparison on processed walkthroughs.

## 2026-11-21 14:31 ET · Damage checked on both walkthroughs (default)

- Move-in checks damage again (the record of what was already there), with Argon second opinions (max 3); move-out checks damage and runs the diff with Carbon. `MOVEIN_DAMAGE=off` skips the move-in damage check for a faster wall-only record (the diff can still call a mark pre-existing from two unchanged before/after pairs). Briefly made move-out-only in `18cffe5`, reverted here at Alex's request.

## 2026-11-21 14:29 ET · Furniture in the 3D model

- Contract (additive, optional): `Surface.at` and `Surface.footprint` for fixtures. Argon now returns fixture positions and drawn outlines (`at`, `box`); `buildPlan` stores them.
- Viewer: `placement.ts` (pure, tested) turns fixtures into pieces: art and wall lights hang on the nearest wall facing into the room, columns are floor to ceiling, tables/cabinets use their drawn outline, a table brings chairs on both long sides (drawn chairs next to a table are skipped). `Furniture.tsx` draws them: painted portrait canvas in a dark frame with a picture light, walnut cabinet with brass pulls, white-topped table with a wood rim, terracotta chairs on chrome sleds, concrete column, brass sconces. Wall items hide with their cut-away wall. The camera starts on the side the art faces.
- Live: conference-room.pdf → cabinet, table, portrait, column, chair with positions; rendered in 3D and plan view. Lab sample `furnished`.
- Note: placement.ts (not furniture.ts) because macOS treats furniture.ts and Furniture.tsx as the same import.

## 2026-11-21 14:24 ET · Faster and hands-free: landmarks from the plan, Argon on move-in, timeouts

- Freeze found: Gemini requests had no timeout; one hung Carbon call froze a whole job. `packages/gemini` now has a per-request timeout (GEMINI_TIMEOUT_MS, retried like a network error) and GEMINI_CONCURRENCY (default 4; my .env uses 12) so second opinions run in one round.
- Wall landmarks without typing: `ArgonPlanSchema.fixtures` has an optional `at` point and `attachWallLandmarks()` puts each drawn item on the nearest wall of its room (≤ 1 m). Live on conference-room.pdf: north = window, cabinet; east = portrait; south = door; west = column (8 s). The review boxes are pre-filled, for corrections only. (Elmir's package: prompt + schema + new function + test.)
- Second opinions: Argon (MODEL_PLAN) on the move-in, Carbon only on the move-out and diff (`secondOpinionEnv`, SECOND_OPINION_MOVE_IN=carbon to undo). Not yet measured whether Argon is faster on these prompts.
- Progress panel: running clock and a "second opinion" line when no event for 6 s.
- API is stopped; Alex reruns by hand.

## 2026-11-21 14:15 ET · Real pipeline behind the app; first live run on our own videos

- Branch `alex/conference-room-plan` (main merged in). `apps/api/src/realPipeline.ts` runs R2–R5 like `run:pair`: keyframes → Hydrogen → localize → findings, evidence.json per walkthrough, then `diffWalkthroughs`. `PIPELINE=real` switches it on (needs `FFMPEG_PATH` if ffmpeg isn't on PATH). Decisions stats stream from calls.jsonl. Frames route serves the pipeline's real JPEGs (ids like `<wid>.f00042`). `GET /units/:id/evidence` serves diff-evidence.json; the statement shows both proving pairs on a charge.
- Speed: Carbon takes ~60 s per call (measured), so the app caps it (6 for localization, 3 for findings; `PIPELINE_SPEED=thorough` for Rahim's defaults). A cap of 0 for localization was tried and was wrong.
- Live result on video/IMG_0022 → IMG_0023 (conference room, plan `apps/api/test/plans/conference-room.pdf`): **missed the change**. Move-out frames 1.5–31.5 s were nearly all placed on the west wall: the Argon plan had no landmarks on the east/west walls (both described as "plain, no door or window") and Carbon was off. Findings looked at the wrong frames and found nothing.
- Ground truth from the frames: yellow column mark is in BOTH videos (pre-existing); the new thing in the move-out is a sheet of paper on the wall light by the door, which isn't damage in the R4 checklist.
- Fix: plan review step has "What's on each wall?" (saved via `PATCH /plan` `landmarks`), so walls can be told apart; Carbon cap back to 6. Re-run by Alex pending. For a charge test, film a move-out with something that looks like damage on a wall.
- Note: `pnpm --filter @ledger/web e2e` uploads dummy videos, so run it against an API with the mock pipeline (no `PIPELINE=real`).

## 2026-11-21 13:26 ET · High-end front end: design system, motion, copy

- Branch `alex/frontend-polish` (stacked on #30). New design system in `apps/web/app/globals.css` (warm paper, ink, one signal red for charges, brass accents, paper grain) with Instrument Serif headlines, Geist text, Geist Mono numbers (self-hosted via `next/font`). Motion (`motion` package) for staggered reveals, count-up totals, step pills, page-step slides, drop zones and live progress shimmer.
- Landing page rebuilt: headline, live auto-rotating 3D unit (`HERO` sample in `@ledger/viewer/samples`), how it works, "No proof, no charge." Every page restyled (new unit, review, move-out, unit, statement, evidence panel).
- Viewer: camera fly-in, pins drop in one by one with a bounce, charged pins pulse, tags appear after the drop, optional autorotate.
- Copy rewritten in one brand voice (short, concrete, no model jargon in headlines). Parser warnings are reworded for people; the "Not provable:" marker is hidden from displayed reasons (`displayReason`). Pin labels: "Moved", "Not enough evidence".
- Verified: `pnpm --filter @ledger/web e2e` passes with zero browser errors; 271 tests, typecheck and lint clean.

## 2026-11-21 13:05 ET · A3 web flows built and clicked through end to end

- Branch `alex/a3-web-flows` (stacked on #25). Pages: `/owner/new` (plan PDF/image → Argon reads it → review with 3D plan preview, room areas, warnings, rename rooms, fix ceiling height → move-in video with live progress → unit page), `/units/<id>/moveout` (upload, live progress → statement), `/units/<id>/statement` (send-by date, total, charged lines first, $0 lines kept, before/after frames with the damage box, link to each line in 3D, printable version). The unit page got the header and a next-step button. `/confirm` removed (tenant sign-off is cut). Shared components: PlanUpload, PlanReview, VideoUpload (XHR upload progress), JobProgress (stage bars + Decisions counters), StatementView, Header.
- The viewer's room names and pin tags are now our own DOM overlay projected each frame; drei `<Html>` dropped its first label and threw `removeChild` errors when a 3D view unmounted (seen in the flow). The sacrificial `<Html>` workaround is gone.
- `PLAN_PARSER=argon` in my `.env` (documented in `.env.example`): uploads from the web app are read by live Argon.
- `pnpm --filter @ledger/web e2e <plan.pdf>` drives real Chrome (puppeteer-core, devDependency) through the whole flow; it passed on unit-4b, studio-ft, two-bed-hall and l-living with **zero browser errors**.
- Videos still use the mock pipeline until Rahim's R3–R5 land.
- Next step: plug Rahim's pipeline into the API adapter when #19/#21/#22 merge; `/demo` after that.

## 2026-11-21 12:43 ET · Built walls: no more doubled or overlapping walls

- Branch `alex/viewer-openings` (PR #25). The viewer now draws one wall per wall line (`physicalWalls()`), centered on the line and shared by the rooms on both sides, instead of one slab per room. That removes the doubled walls between rooms, the tall-wall-plus-stub combos in the cut-away, and the slivers at corners. Each side face wears its room's color (selected / charged), and a click picks the room on the side you hit. Room edges within 35 cm and 3° count as one wall (scans put the two sides ~30 cm apart). Only exterior walls are lowered in the cut-away. Wall shadows removed (they drew dark shapes on floors).
- 102 viewer tests, including no-overlap and every-wall-covered checks on all samples; mutation-checked. Screenshots of all 5 Argon-parsed plans look like their PDFs; the scan keeps few-cm steps from tracing error.
- Next step: `/demo` page (A4).

## 2026-11-21 12:40 ET · 3D openings fixed, 5 test plans checked live with Argon

- (Correction: my entries stamped 12:45 and 13:05 were really ~12:10 and ~12:20; I had guessed the time.)
- Branch `alex/viewer-openings` (stacked on #24 → #23). Viewer: a door attached to one room's wall now also cuts the other room's slab of a shared wall (`openingsForWall`); cut-away and top-down walls are door-only stubs (windows no longer squash into slits); stubs cast no shadow. 86 viewer tests.
- 5 test plans in `apps/api/test/plans/` (unit-4b, studio-ft in feet, two-bed-hall, l-living, scan-2b) with truth; `check-plan` now also grades door/window positions (30 cm).
- **Proposed prompt change in Elmir's `PLAN_PROMPT`:** trace rooms along wall center lines instead of the inside. Inside tracing made small rooms 10–17% too small because the scale comes from center-line dimensions. With center lines, all 4 clean plans pass every check (openings within 2–7 cm). The scan still fails (rooms ~6% large). Details in `apps/api/test/plans/RESULTS.md`.
- Next step: `/demo` page (A4) for the 13:00 checkpoint.

## 2026-11-21 14:40 ET · From Rahim: tenant fix kit API, `POST/GET /units/:id/fixkit` (branch `rahim/fixkit-shop`)

- Small addition to your app: new `apps/api/src/routes/fixkit.ts`, 2 lines in `app.ts`, and additive types in `events.ts` (`Stage` gains `'fixkit'`, a new `fixkit` JobEvent, and `done.result` may be `{ fixkit: FixKitSummary }`). No existing route changed. Tests: `apps/api/test/fixkit.test.ts`.
- **Button (statement page, tenant view):** "Fix it yourself: $X vs $Y deduction", where X = `diyTotal`, Y = `deductionTotal`, and the saving = `savings` (negative means DIY costs more). Show it once a diff exists.
- `POST /units/:id/fixkit` → `202 { jobId, events: "/jobs/<jobId>/events" }`. Use the same `EventSource` as the walkthrough jobs. `409` = no diff yet. `?wait=1` runs inline and returns the kit (`200`).
  - Optional JSON body `{ checkout?: boolean, choices?: { [item.key]: variantId } }`. With `choices`, the stored kit swaps an unsure pick for the chosen alternative and rebuilds only the checkouts (no new search or model call).
- **SSE events on that job (in order):**
  - `progress` `{ type:'progress', stage:'fixkit', done, total }`. `total` grows once the number of sellers is known.
  - `fixkit` `{ type:'fixkit', text, event }`. `text` is a ready-made feed line, e.g. `picked “Zep Foaming Wall Cleaner” from Hartville Hardware · $6.27 (82%)`. `event.step` is one of:
    - `rules` `{ diffItems, needs, uncovered }`
    - `query` `{ key, need, query, colorHint?, finish?, fallback }`
    - `searching` `{ key, need, query }`
    - `picked` `{ key, need, product, seller, price, confidence, needsChoice, candidates }`
    - `missing` `{ key, need, reason }`
    - `checkout` `{ seller, shop, lines }` ("building checkout for <seller>")
    - `checkout-ready` `{ seller, shop, ok, subtotal, status?, error? }`
    - `done` `{ diyTotal, deductionTotal, savings, complete }`
    - Every event also carries `done` and `total`.
  - `decisions` `{ type:'decisions', stats:{ calls, questions, lastLatencyMs, avgLatencyMs } }` after each pick (Decisions calls of this job only).
  - `done` `{ type:'done', result:{ fixkit:{ items, checkouts, diyTotal, deductionTotal, savings, complete } } }`, or `error` `{ message }`.
- `GET /units/:id/fixkit` → the kit (`FixKitSchema` exported from `@ledger/pipeline`), `404` until built. Its parts:
  - `items[]`: `{ key, needLabel, quantity, product.title, seller.name, price, lineTotal, url, confidence, needsChoice, alternatives[], forDiffItem.surfaceId }`.
  - `checkouts[]`: `{ seller, subtotal, continue_url?, status, messages[], error? }`.
  - Also `missing[]`, `uncovered[]`, `warnings[]`, `complete`.
- **UI notes:**
  - Link each product to `url` exactly as returned.
  - Give one "Checkout at <seller>" button per `checkouts[].continue_url`. It opens the merchant's page, and the tenant pays there. We never place orders.
  - `continue_url` carries an access key: don't log it or put it in analytics.
  - Show `checkouts[].messages` (e.g. "A destination address is required"). The live checkout is `incomplete` until the tenant adds an address on the merchant page.
  - For `needsChoice` items, show both options. Post `choices` to swap.
  - `subtotal` is before tax and shipping.
- Mock: `SHOP_MODE=mock` (default) serves real recorded catalog results for the rule queries. Checkout links point to `https://checkout.mock.invalid/...`.

## 2026-11-21 13:00 ET · From Rahim: `POST /units/:id/scan` added to the API (branch `rahim/scan-to-plan`)

- Small addition to your app: new file `apps/api/src/routes/scan.ts`, plus 2 lines in `app.ts` (import + `app.route('/units', scanRoutes(deps))`). No existing route changed. Tests: `apps/api/test/scan.test.ts`.
- multipart `room` (RoomPlan CapturedRoom JSON, required) + `usdz` (optional) → `scanToPlan` → saves `scan.json`, `scan.usdz`, `plan.json`, `plan.svg`, `unit.json` → `201 { unit, plan }`, the same as `POST /units`. A re-scan is allowed until the first walkthrough, then 409. `unit.planFile = 'scan.json'`.
- If you want it in the web flow: an "Upload LiDAR scan" option on `/owner/new` that posts both files, then the same confirm step. Your call.

## 2026-11-21 13:05 ET · Live Argon works on the test PDF (2 fixes in review)

- `.env` now holds the event key (record mode). Rahim's smoke: all 5 models answer live (3.7–6.6 s).
- **PR #23 (Rahim's package):** live plan parsing always failed with `HTTP 400 Invalid JSON payload` because `z.tuple` became draft-07 `items: [a, b]`. `toResponseSchema` now rewrites it. With it, Argon parsed `unit-4b.pdf` in 11.6 s: 4 rooms within 0.3–0.8%, 4/4 doors, 4/4 windows within 1 cm, scale from labels.
- **PR #24 (Elmir's package, stacked on #23):** Argon returned "KITCHEΝ" with a Greek capital Nu, so the room id became `kitche`. `cleanName()` maps Greek/Cyrillic look-alikes to Latin and sentence-cases ALL-CAPS labels before ids are built. The live answer is recorded in `.data/recordings`, so the re-run used the same reading. Also fixed my truth file (no fixtures are drawn; Argon correctly found none).
- Result: `pnpm --filter @ledger/api check-plan apps/api/test/plans/unit-4b.pdf` → all checks pass, unit `unit-4b-argon` viewable in 3D.
- Next step: `/demo` page (A4).

## 2026-11-21 12:45 ET · Real plan parsing wired in, checked on a drawn PDF

- Branch `alex/plan-pdf-check` (viewer branch + main). `apps/api/test/plans/unit-4b.{pdf,png,truth.json}`: a listing-style 4-room L-shaped plan (46.5 m², 4 doors, 4 windows, dimension labels, north arrow) drawn by `apps/api/scripts/make-test-plan.py`, with the true geometry and a perfect Argon reading on the 0-1000 grid.
- `apps/api/src/planParser.ts`: PDF -> PNG (pdftoppm, or macOS `sips` when poppler is missing) -> Elmir's `parsePlan` with Rahim's `gemini` client. `PLAN_PARSER=argon` makes `POST /units` use it. API server and scripts now load `<repo>/.env`.
- `pnpm --filter @ledger/api check-plan <pdf> [--truth]` parses and grades against `*.truth.json`, then saves the unit so `/units/<id>` shows it in 3D. With `--truth` (no key): 4/4 rooms within 0.3%, 4/4 doors, 4/4 windows, scale from labels. **Live Argon not run yet: no GEMINI_API_KEY on this machine.**
- Viewer bugs found on this real plan and fixed: (1) camera aimed at (0,0,0) when OrbitControls mounted after the effect, so plans not starting at the origin were off-center and top-down was blank; target now passed at creation, 3/3 fresh runs correct. (2) drei `<Html>` drops the first overlay it creates (first room label always missing); an empty first `<Html>` takes the hit, verified by screenshot.
- For Elmir: `loadPlanImage` uses pdftoppm only (absent on our Macs) and maps `.webp` to `image/jpeg`.
- Next step: live Argon run on unit-4b.pdf once we have a key, then `/demo`.

## 2026-11-21 12:20 ET · Viewer tested on tricky plans

- Branch `alex/a2-viewer`. Added `packages/viewer/src/samples.ts`: 11 synthetic plans (every verdict, 6 pins on one wall, L shape, angled bay, building rotated 30°, coordinates at 120/80 m, 1 × 1.2 m closet, 18 × 11 m loft with 6 windows, doors at wall ends and overlapping openings, clean unit, unknown surface ids). 77 viewer tests now. `/lab?case=<id>&view=top&select=<surfaceId>` renders any of them. The unit page also takes `?view=top&select=<surfaceId>`.
- Screenshotted every case with headless Chrome and fixed what looked wrong: inward walls now use a point-in-polygon probe (the centroid method can point the wrong way in concave rooms); pins spread by wall length with alternating height; text tags only on charged, selected or hovered pins, plus a color legend; the camera frame is at least 3.5 m so it stays outside small rooms; top-down is a near-orthographic plan view with low walls.
- Not done: a production `next build` (dev only so far). The red "Issues" badge in dev is drei `<Html>` double-mounting under React strict mode.
- Next step: `/demo` page (A4).

## 2026-11-21 12:00 ET · A2 3D viewer (WIP on `alex/a2-viewer`)

- `packages/viewer`: `geometry.ts` (plan -> wall boxes split around doors/windows, floors, pin anchors, cutaway test) with 21 tests across all fixtures; `colors.ts` (verdict -> pin color/label, "Not provable" overrides the verdict); `<UnitModel plan items selected onSelect view />` in React Three Fiber with an architect's cutaway (walls between camera and room drop to stubs), pins with cost tags, click to select, and a 3D / top-down toggle.
- `apps/web` is now a real Next.js 16 app (`pnpm --filter @ledger/web dev`, port 3000, webpack mode because the workspace packages use `.js` import paths). `/units/<id>` shows the 3D map next to the evidence panel (verdict, reason, cost, before/after frames with the damage box). Before move-out it shows the move-in record.
- API: `GET /units/:id/frames/:frameId` serves real frames from `walkthroughs/<wid>/frames/` or a labeled placeholder SVG.
- Repo: `.next/` gitignored and excluded from eslint; `agentRules: false` stops `next dev` from writing an AGENTS.md into apps/web.
- Verified: viewer 21 + API 49 tests, repo typecheck and lint; headless-Chrome screenshot of `/units/demo-3d` shows walls, door/window gaps, cutaway and all 4 pins.
- For Rahim: write keyframes to `walkthroughs/<wid>/frames/<frameId>.jpg` with frame ids starting `<wid>-` and the panel shows them with no other change.
- Next step: `/demo` page (A4) using `<UnitModel>`, SSE progress and the Decisions panel.

## 2026-11-21 11:55 ET · A1 merged (PR #10)

- Merged `alex/a1-api` into `main` after CI passed. Includes the API, 48 API tests, the hand-test script and the browser test page at `http://localhost:3001/` (`pnpm --filter @ledger/api dev`).
- Fixed a flaky CI test: two simultaneous uploads have no guaranteed arrival order. Tests now check that uploads sent one after another run in that order, and that four simultaneous uploads never run at the same time.
- Next step: A2 viewer + A4 `/demo` page for the 13:00 mock end-to-end.

## 2026-11-21 11:40 ET · API tests + hand-test script

- Branch `alex/a1-api` (PR #10). Added `apps/api/test/scenarios.test.ts` (46 API tests in total): 3 floor plans, upload validation, re-filmed baseline, tenant addendum, serial job order, SSE replay, pipeline crashes, Decisions totals and the statement charging rules. Mutation-checked: 9 deliberate breaks, all caught except a redundant cent-rounding step.
- **Fixes found by the tests:** the API now validates pipeline findings and diffs against the shared contract *before* saving them (it used to save bad data, e.g. severity 9). Statement lines are rounded to cents so they always add up to the total. The Decisions counter keeps growing across a job.
- `pnpm --filter @ledger/api try` runs every scenario against a running API and prints a ✓/✗ report. In mock mode a plan file named after a fixture (`studio-l.png`, `one-bed-railroad.pdf`) loads that plan.
- For Rahim: `PipelineAdapter.parsePlan` takes an optional `originalName` (mock only, safe to ignore). Bad pipeline output now fails the job with `pipeline returned invalid findings: 0.severity ...`.
- Next step: A2 viewer + A4 `/demo` page.

## 2026-11-21 11:20 ET · A1 API server with mock pipeline

- Branch `alex/a1-api`. `apps/api` is a working Hono server: `pnpm --filter @ledger/api dev` (PORT 3001, data in `<repo>/.data`).
  - `POST /units` (multipart `plan`, optional `unitId`) -> `{ unit, plan }` · `GET /units/:id` · `GET|PATCH /units/:id/plan` (ceilingHeightM, roomNames)
  - `POST /units/:id/walkthroughs` (multipart `video`, `kind`, optional `capturedAt`) -> `{ jobId, walkthroughId }`. A move-out upload also runs the diff and writes the statement.
  - `GET /jobs/:id/events` SSE: `progress {stage, done, total}`, `decisions {calls, questions, lastLatencyMs, avgLatencyMs}`, `done`, `error`. Past events replay on reconnect.
  - `GET /units/:id/findings?kind=baseline|move-out` · `/diff` · `/statement` · `/statement.html`
- **Pipeline adapter** (`apps/api/src/pipeline.ts`): `PipelineAdapter { parsePlan, runWalkthrough, runDiff }` with `onProgress` / `onDecisions` hooks. `mockPipeline()` is the default: plan from a fixture (`MOCK_PLAN`, default `demo-table`), deterministic findings and a diff with one charged stain, one pre-existing scuff, one not-provable hole and a moved chair.
- **Statement** (`statement/build.ts`): charges only `new-damage` that isn't "Not provable:" and has cost > 0. Everything else is listed at $0. Totals are summed in cents. `dueBy` comes from `statementDueBy`.
- Verified: 5 vitest tests (full mock flow over SSE, bad ids, PATCH, charging rules), a curl smoke test against the live server, repo-wide typecheck and lint.
- **Requests:** Rahim, please export `runWalkthrough` / `runDiff` matching `PipelineAdapter` (or tell me your signatures) and call the hooks per stage and per Decisions call. Elmir, I'll wire `parsePlan` + `renderPlanSvg` once PR #7 merges.
- Next step: A2 viewer + A4 `/demo` page on the mock API for the 13:00 checkpoint.

## 2026-11-21 11:12 ET · Team review adopted

- Applied Elmir's review to `AGENTS.md` and `docs/demo-script.md` on `main` (`59f6dfe`): the 2-pair proof rule (otherwise not provable, $0), the same-region check with a 2×2 split, Decisions question counts and latency in `calls.jsonl`, a premade or real listing plan instead of the judge's sketch, the judge's card shown next to the verdicts, an outsider-staged test set (~12 change pairs + 6 clean re-shoots), and the scope cuts. Logged in `docs/decisions.md` on this branch.
- **New for my lane:** a Decisions panel on `/demo` (questions asked, response times) fed from SSE, a slot for the judge's card photo on the compare step, and not-provable pins showing $0 and the reason. Cut: phone capture page, tenant confirm page, PDF.
- Request for Rahim: add `questions` to each `calls.jsonl` row and emit not provable as `not-visible` with a reason starting "Not provable:" until we agree on a contract change.
- Next step: A1 in `apps/api`.

## 2026-11-21 11:15 ET · Full repo skeleton

- Branch `alex/project-structure`, stacked on Elmir's `elmir/e1-scaffold-contract` (PR #4). Adds stub packages `gemini`, `pipeline`, `viewer`, `apps/api` and `apps/web`, the missing `plan`/`eval` files, `eval/results.md`, `eval/failures.md` and [docs/structure.md](docs/structure.md). Each stub starts with `// [Owner] purpose`, so the owners fill in the code.
- Verified: `pnpm install`, `pnpm -r typecheck` (8 packages), `pnpm -r test`, `pnpm lint` all pass. The lockfile change only adds workspace links, no third-party packages.
- Requests: Rahim and Elmir, the stubs in your folders are placeholders, so rename or delete freely. Merge PR #4 first, then this one.
- Next step: A1 in `apps/api` (Hono, upload routes, job queue, SSE) against `demo-table.json`, using a stub pipeline until Rahim's mock lands.

## 2026-11-21 10:54 ET · Hackathon rules added

- Added [docs/hackathon-guide.md](docs/hackathon-guide.md) to `main` in `bfd0b41`. It condenses the official rules, judging weights, schedule and submission checklist. If it disagrees with AGENTS.md, the guide wins. PR #3 was closed unmerged because the file went straight to `main`.
- Verified by pushing to `main` and confirming the commit there. No code changed.
- Requests for the team: the guide bans evaluations made up entirely of examples the team wrote to pass, so Elmir's test split needs pairs staged and labeled by people outside the team. Submission needs a 1-minute video, a public repo, and all three of us on the form by 17:00.
- Next step: A1 upload and job routes in `apps/api` toward the 13:00 mock end-to-end.

## 2026-11-21 10:47 ET · Kickoff context

- The [demo script](docs/demo-script.md) describes the judge's walkthrough from plan upload to the draft statement. At `main` commit `92dc57f`, the API, viewer, and web app were still planned deliverables.
- Next planned checkpoint is the 13:00 mock end-to-end demo. Start with A1's upload and job routes. Use Elmir's floor-plan fixture for the viewer and Rahim's mock pipeline output for the statement.
- Coordinate the fixture path with Elmir and the callable mock entry point with Rahim. Record the first working route and how to exercise it here.
