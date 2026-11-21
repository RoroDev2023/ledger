# AGENTS.md — read this first (all AI tools: Claude Code, Codex, Cursor, Copilot, Gemini)

There are 3 of us, each with our own AI, building one project for the **Gemini 4 NYC Hackathon** (Cerebral Valley, Sat Nov 21 2026). Hacking runs **10:30 AM → 5:00 PM**, so we have about 6.5 hours. Read "Scope tiers" before you build anything.

## What we're building

**LEDGER — "Carfax for apartments."** The owner uploads a 2D floor plan and films the unit. LEDGER turns the plan into a 3D model, pins every video frame to a surface (wall, floor, fixture), and flags the damage that's already there. The tenant confirms that baseline at move-in. At move-out the unit is filmed again, and LEDGER compares it surface by surface (new damage, wear, moved, already there, not visible), then writes an itemized deposit statement with measured area, cost and before/after frames. NY context: the landlord has 14 days after move-out to send an itemized statement or forfeits the deposit.

The core idea: **we never compare video to video.** Both walkthroughs get pinned to the same floor plan, and the plan is the shared reference.

Track: **Problem Statement One (5 Sigma)**, so we must show reliability against a baseline. Judging (round 1): Live demo 35% · Proof it works 25% · Creativity 20% · Gemini 4 + Decisions API use 20%.

Read in order: this file → `docs/proposal.md` (product doc) → `docs/decisions.md` → `docs/demo-script.md` → your lane below.

## Pipeline (who calls which model)

```
2D plan ──Argon──▶ FloorPlan JSON ──plain code──▶ 3D model + surface IDs + top-down SVG
                                                        │
videos ──ffmpeg──▶ frames ──sharpness/dedupe──▶ keyframes
        keyframes ──Decisions API──▶ room per frame ──HMM smoothing──▶ surface per frame
                  ──Hydrogen──▶ landmark captions (door, window, sink...) used as hints
        surface frames ──Decisions API──▶ damage checklist (+ calibrated confidence)
        unsure (0.3–0.7) ──Carbon──▶ second look, bbox, reason
baseline findings vs move-out findings ──Decisions API (before|after pairs)──▶ DiffItems
DiffItems ──deterministic pricing──▶ Statement + 3D damage map
```

| Model | ID (env var) | Job |
|---|---|---|
| Gemini 4 Argon | `gemini-4-argon` (`MODEL_PLAN`) | Parse the 2D plan into rooms, walls, openings and dimension labels |
| Gemini 4 Neon | `gemini-4-neon` (`MODEL_BASELINE`) | Eval baseline. Ask “what changed?” in one call with the plan and both full videos. Optional separate coverage check for walls that never appear on camera. |
| Gemini 4 Hydrogen | `gemini-4-hydrogen` (`MODEL_FAST`) | Per-keyframe landmark captions and object lists (furniture, for "moved" detection) |
| Decisions API | `gemini-decision-1` (`MODEL_DECIDE`) | Room and surface classification, damage checklist, before/after change questions. Returns probabilities, not text |
| Gemini 4 Carbon | `gemini-4-carbon` (`MODEL_DEEP`) | Uncertain calls, plan repair, damage bboxes, the written reason per deduction. **Code does the money math, never Carbon** |

Decisions supports `noul` (yes/no), `choice` (2–255 options) and `score` (2–255 ordered level descriptions). One shared input accepts multiple images or direct video. The 262,144-token context covers the input and all questions together.

For the Nov 21 eval, standard paid prices in USD per million input/output tokens are Argon and Carbon $2/$10 through Nov 30, Neon $3/$15, Hydrogen $1.50/$7.50, and Decision 1 $0.10 per million input tokens with zero output tokens. Argon, Carbon and Neon require paid-tier API access. Hydrogen and Decision 1 also have a free tier. See `docs/vendor/pricing.md`.

Quotas are shared per project. Decision 1 standard RPM / input TPM / RPD are 200 / 50,000 / 10,000 on Free, 1,500 / 1M / 50,000 on Tier 1, 5,000 / 4M / unlimited on Tier 2, and 15,000 / 10M / unlimited on Tier 3. Check the event project's active per-model limits in AI Studio. See `docs/vendor/gemini-rate-limits.md`.

## Repo layout & ownership

| Path | Owner | Notes |
|---|---|---|
| `packages/gemini` | **RoroDev** | The ONLY place that calls Gemini. Client, Decisions wrapper, mock/record/replay, cache, call log |
| `packages/pipeline` | **RoroDev** | Frames, room + surface localization, damage findings, diff, pricing, `run:pair` CLI |
| `packages/shared` | **Elmir** | The contract (TS types + zod schemas). Every change goes through a PR reviewed by RoroDev |
| `packages/plan` | **Elmir** | `parsePlan` (Argon), geometry cleanup, scale, surface IDs, plan SVG |
| `packages/eval` | **Elmir** | Labels, baseline system, metrics, `pnpm eval` → `eval/results.md` |
| `packages/viewer` | **Alex** | React Three Fiber `<UnitModel />`: walls from the plan, pins, picking |
| `apps/api` | **Alex** | HTTP routes, jobs + progress events, `.data/` storage, statement HTML/PDF |
| `apps/web` | **Alex** | Owner/tenant flows, phone capture page, statement page, `/demo` control room |
| root config, CI, README | **Elmir** | |
| `docs/` | everyone | Ideas go in `docs/ideas/<short-name>.md` (one file per idea, no merge conflicts) |

**Stay inside your directories.** If you need a change in someone else's package, open an issue or PR and ping them.

## The contract (`packages/shared/src/types.ts`)

Each type gets a matching zod schema (`FloorPlanSchema`, ...) so every model JSON is validated at runtime. Frozen by 11:15. After that, changes are additive only (new optional fields) unless all 3 agree.

```ts
export type SurfaceKind = 'wall' | 'floor' | 'ceiling' | 'door' | 'window' | 'fixture';
export interface Opening { id: string; kind: 'door' | 'window'; wallId: string; offsetM: number; widthM: number }
export interface Room    { id: string; name: string; polygon: [number, number][] }          // meters, plan coords, y = north
export interface Surface { id: string; roomId: string; kind: SurfaceKind; label: string;     // id e.g. "bedroom-1.wall-n"
                           segment?: [[number, number], [number, number]];                   // walls only
                           areaM2?: number; neighbors?: string[]; landmarks?: string[] }      // landmarks e.g. ["window", "radiator"]
export interface FloorPlan { unitId: string; ceilingHeightM: number; metersPerPixel: number;
                             scaleSource: 'labels' | 'known-measurement' | 'assumed';
                             rooms: Room[]; surfaces: Surface[]; openings: Opening[]; warnings: string[] }

export type WalkthroughKind = 'baseline' | 'tenant-addendum' | 'move-out';
export interface Walkthrough { id: string; unitId: string; kind: WalkthroughKind; videoPath: string; capturedAt: string }
export interface Frame { id: string; walkthroughId: string; tMs: number; path: string; sharpness: number; phash: string }
export interface Localization { frameId: string; roomId: string; surfaceId: string | 'none';
                                confidence: number; visible: Record<string, number> }         // surfaceId → P(visible)

export type IssueType = 'crack' | 'stain' | 'hole' | 'scuff' | 'missing-fixture' | 'other';
export interface Finding { id: string; walkthroughId: string; surfaceId: string; type: IssueType;
                           confidence: number; severity: 1 | 2 | 3 | 4 | 5; frameIds: string[];
                           bbox?: [number, number, number, number];                           // [ymin, xmin, ymax, xmax], normalized 0–1 on frameIds[0]
                           decidedBy: 'decisions-api' | 'carbon'; note?: string }

export type Verdict = 'new-damage' | 'pre-existing' | 'wear' | 'moved' | 'not-visible' | 'no-change';
export interface DiffItem { surfaceId: string; verdict: Verdict; issueType?: IssueType; reason: string;
                            beforeFrameId?: string; afterFrameId?: string; areaM2?: number; costUsd?: number;
                            leaseClause?: string; confidence: number }
export interface Statement { unitId: string; moveOutDate: string; dueBy: string;   // dueBy = moveOut + 14 days
                             items: DiffItem[]; totalUsd: number; disclaimer: string }
```

`not-visible` is never `no-change`. If a surface is hidden in either video, we say so.

## API (`apps/api`)

| Route | Does |
|---|---|
| `POST /units` (plan image/PDF) | `parsePlan` → `FloorPlan` |
| `PATCH /units/:id/plan` | Owner fixes ceiling height / scale / room names |
| `POST /units/:id/walkthroughs` (video + kind) | Store, start job → `{ jobId }` |
| `GET /jobs/:id/events` (SSE) | Pipeline stage + progress, live in the UI |
| `POST /units/:id/baseline/confirm` | Tenant sign-off |
| `GET /units/:id/findings?walkthrough=` | `Finding[]` |
| `GET /units/:id/diff` | `DiffItem[]` |
| `GET /units/:id/statement(.pdf)` | `Statement` as HTML or PDF |

Storage: `.data/units/<unitId>/{plan.json, plan.svg, walkthroughs/<wid>/{video.mp4, frames/, localization.json, findings.json}, diff.json, statement.json}`. No database.

## Scope tiers (cut from the bottom when behind)

**Must:** plan → 3D walls with surface IDs · both videos → localization → findings · diff with `moved` / `new-damage` / `pre-existing` · statement with before/after frames · 3D pins → frames · eval vs the single-call baseline on pairs we didn't prepare

**Should:** tenant sign-off · Carbon escalation visible in the UI · bboxes on frames · depreciation pricing · `not-visible`

**Could:** shop.dev cart for the tenant fix list (Shopify bonus prize) · PDF export · lease-clause linking

## Lanes in detail

Mirror each numbered item to a GitHub Issue at kickoff (Issues = source of truth, one owner each, assign yourself before starting).

### RoroDev — `packages/gemini` + `packages/pipeline`

**R1 · Gemini client (`packages/gemini`)** — mock by 11:45
- `generate<T>({ model, parts, schema, tag })` uses the **Interactions API** via `ai.interactions.create` with `input` and `response_format: { type: 'text', mime_type: 'application/json', schema }`. Parse `interaction.output_text` and validate with Zod. On a parse or validation error, retry once with the error appended.
- `decide({ input, questions, tag })` uses `@google/genai` 3.2 or later. Initialize `new GoogleGenAI({ apiVersion: 'v1beta' })` and call `ai.decisions.create({ model, input, questions })`. The REST equivalent is `POST https://generativelanguage.googleapis.com/v1beta/decisions` with `x-goog-api-key`. Key the question map by our IDs. Each question carries its type and full text instructions. For `choice`, supply an option-to-description map. For `score`, supply an ordered array of descriptions.
- Validate and return the native `{ answers, usage }` shape with answers under the original question keys. Preserve each answer's type and confidence, the `noul` value, the winning `choice` and probabilities, or the `score`, probabilities and legend, as applicable. Add an encode/decode helper that assigns each (surface ID, question purpose) pair a compact key such as `q17` and retains a bidirectional lookup for the whole call. Keys must match `^[A-Za-z0-9_-]{1,64}$` and round-trip even for long IDs or IDs differing only by punctuation.
- Split requests against **both** limits. Each chunk has 1–1,000 questions and at most 262,144 tokens including the repeated shared input, question text, criteria and formatting. If even one question plus its input exceeds the budget, report it to the caller. Across chunks, merge answers by key and sum native usage counts, including per-modality counts for repeated input.
- Modes via `GEMINI_MODE`: `live` · `mock` (deterministic stubs from `fixtures/gemini/`) · `record` (live + save each response keyed by `sha256(model + inputs)`) · `replay` (serve recorded responses only). Record/replay makes eval runs reproducible and gives the demo a fallback.
- Disk cache in `.data/cache/` with the same key, so dev runs don't pay twice. `p-limit(4)` concurrency, exponential backoff on 429/5xx (3 tries).
- Call log `.data/calls.jsonl`: `{ ts, model, tag, latencyMs, inTokens, outTokens, cached }`. The eval reads it for cost/time per walkthrough.

**R2 · Frames (`pipeline/frames.ts`)**
- `ffmpeg -i in.mp4 -vf fps=2,scale=1280:-2 frames/%05d.jpg`; `tMs` from the index.
- Sharpness = variance of the Laplacian on grayscale (via `sharp` raw pixels). Drop frames under the 30th percentile of that video.
- Dedupe: 64-bit dHash, drop if Hamming distance ≤ 5 to the last kept frame. Target ~40–80 keyframes per minute of video.
- Hydrogen pass on keyframes in batches of 8: JSON `{ frameIdx, landmarks: string[], objects: string[] }`. Landmarks (door, window, radiator, sink, closet) feed localization; objects feed `moved` detection.

**R3 · Localization (`pipeline/localize.ts`)**
- **Room:** per keyframe, Decisions API `choice` over room names from the plan (+ "hallway/other"). Smooth over time: a room change needs ≥ 3 consecutive frames agreeing.
- **Surface:** per keyframe, candidates = surfaces of that room. Option text is generated from the plan, never hand-written, e.g. `"north wall: has the window, 3.2 m wide, door at its left end"` (from `Surface.landmarks`, `openings`, `neighbors`). Ask one `choice` ("which wall fills most of the frame?") plus one `noul` per candidate ("is <surface> visible?"). Store each answer's `noul`, the probability of yes, in `Localization.visible`.
- **HMM smoothing:** states = surfaces in the room; emissions = Decisions API probabilities; transitions favor staying put or moving to an adjacent wall (`neighbors`), e.g. self 0.8, neighbor 0.15, other 0.05. Run Viterbi per room segment. Walkthroughs are continuous pans, so this fixes most single-frame flips.
- Posterior < 0.6 → Carbon with the frame, the top-3 candidates and `plan.svg` (top-down plan with surface labels) → `{ surfaceId, reason }`.
- Coverage per surface = number of keyframes with `visible > 0.7`. Under 2 → that surface is `not-visible` for this walkthrough.

**R4 · Findings (`pipeline/findings.ts`)**
- Per surface, take the 3 sharpest frames with the highest `visible` probability.
- For each selected frame, send the visibility gate (“is this surface clearly visible and unobstructed?”), one damage question per issue type, and the corresponding severity questions in the **same Decisions request**. Use `noul` for visibility and damage. Each question names its surface and issue explicitly because questions are evaluated independently. In code, discard the frame's checklist and severity answers when the visibility gate fails. Apply the R3 coverage minimum to the surviving evidence.
- For each issue's `score`, supply five ordered descriptions: faint cosmetic trace, minor localized mark, clearly visible moderate damage, extensive damage or impaired use, severe damage or loss of use. In one shared conversion function validate the finite score in [0, 4] and return `Math.round(score) + 1` for our integer severity.
- Combine the damage `noul` values from accepted frames with noisy-OR: `P = 1 − Π(1 − p_i)`. ≥ 0.7 → finding (`decidedBy: 'decisions-api'`); ≤ 0.3 → none; in between → Carbon with the accepted frames → `{ present, type, severity, bbox, note }` (`decidedBy: 'carbon'`).
- Our bbox contract uses normalized `[ymin, xmin, ymax, xmax]` on `frameIds[0]`. Request that order from Carbon and enforce four finite values in [0, 1] with `ymin < ymax` and `xmin < xmax` in the shared Zod schema. **TODO before the demo:** run one known-box image through Carbon and the viewer and verify that the overlay lands on the marked region.
- Thresholds are tuned on the **dev** split only (see E4). Never tune on test.

**R5 · Diff + pricing (`pipeline/diff.ts`, `pipeline/price.ts`)**
- Per surface: baseline (+ tenant addendum) findings vs move-out findings.
- For each covered surface with a move-out finding, send one Decisions input in this order: text “BEFORE”, best baseline image block, text “AFTER”, best move-out image block. Ask whether AFTER shows new damage, whether existing damage worsened, and whether only an object moved. A labeled side-by-side composite is the fallback only.
- Verdict rules: new and damage → `new-damage`; same type at both → `pre-existing` (or `new-damage` if severity went up by ≥ 2); scuff or nail-hole class at severity ≤ 2 → `wear`; Hydrogen object present in both walkthroughs but in a different room or wall → `moved` (never charged); not covered in either → `not-visible`.
- Pricing is deterministic code: `pricing.json` with a rate per issue type (paint $/m², patch flat fee, cleaning flat fee) × area (wall length × ceiling height − openings) × depreciation `max(0, 1 − ageYears / usefulLifeYears)`. Rates and useful-life numbers are **placeholders to confirm**, so keep them in one file. Carbon writes the one-sentence `reason` from the computed numbers.
- `pnpm --filter @ledger/pipeline run:pair <plan> <baseline.mp4> <moveout.mp4>` prints the diff table and writes all JSON to `.data/`.
- Keep `eval/failures.md` as you go (input, what broke, fix, did it help). It feeds the "where it breaks" part of the pitch.

### Elmir — `packages/shared` + `packages/plan` + `packages/eval` + scaffold

**E1 · Scaffold + contract** — by 11:15
- pnpm workspace, `tsconfig.base.json` (strict, ESM, NodeNext), `tsx` for scripts, `vitest`, `eslint`, GitHub Actions (typecheck + test on PR).
- `.env.example`: `GEMINI_API_KEY=fake`, `GEMINI_MODE=mock`, `MODEL_PLAN`, `MODEL_FAST`, `MODEL_DEEP`, `MODEL_DECIDE`, `MODEL_BASELINE`, `DATA_DIR=.data`.
- `packages/shared`: types above + zod schemas + `fixtures/` loaders.

**E2 · Plan parsing (`packages/plan`)**
- PDF → PNG at 200 dpi (`pdftoppm`), images pass through.
- Argon with a response schema, everything in **pixel** coordinates: rooms (name, polygon), wall segments, openings (kind, wall, endpoints), dimension labels (text, endpoints of the dimension line), north arrow if present.
- Scale: each dimension label gives `meters / pixelLength`. Take the median, drop labels > 15% off it. No labels → ask the owner for one known measurement (e.g. a door width); none → assume and add a warning.
- Geometry cleanup in code: merge endpoints within 5 px, snap walls within ±3° of an axis to the axis, close room polygons, attach each opening to its nearest wall.
- Surface IDs: `<room-slug>.wall-<n|e|s|w>` (compass from the north arrow, else plan-up = north), plus `.floor` and fixtures. Fill `neighbors` (walls sharing a corner) and `landmarks` (openings on that wall plus fixtures Argon saw).
- Validate: polygons closed, every opening on a wall, room areas sum within 15% of any total area printed on the plan. Fail → Carbon repair loop with the image + the validation errors (max 2 rounds), then return with `warnings`.
- Emit `plan.svg`: top-down render with surface labels. RoroDev's Carbon localization and Alex's minimap both use it.

**E3 · Fixtures** — by 12:00
- `fixtures/plans/*.json` for 3 real listing plans + our demo-table plan, so RoroDev and Alex can build on real shapes before parsing is done.
- Data layout: `data/pairs/<id>/{plan.png, baseline.mp4, moveout.mp4}` (gitignored, shared drive).

**E4 · Eval (`packages/eval`)**
- Labels `data/labels/<pair>.json` (committed): per surface, the true issues at baseline and move-out plus moved objects; plus ~50 sampled frames per pair with the true surface ID. Small static labeling page `packages/eval/label.html` (frame + plan.svg, click a surface).
- Splits: **dev** pairs (RoroDev tunes thresholds on these) and **test** pairs (run once at the end, reported as-is).
- Baseline system: upload both full walkthrough videos via the Files API (inline cap is 100 MB per request). Make one Neon Interactions call via `packages/gemini` using `MODEL_BASELINE`, the plan with surface IDs, and the two video URIs labeled move-in and move-out. Ask “What changed?” and request verdicts and issue types keyed to the plan's surfaces. Validate the output and use the same held-out pairs and scorer for both systems. Any optional whole-video coverage check runs separately from this single-call comparison.
- Metrics: plan (room count, opening recall, median dimension error %), localization top-1 accuracy, change detection precision / recall / F1 at (surface, issue type), verdict confusion matrix, $ and seconds per pair from `calls.jsonl`. Small n, so report raw counts next to percentages.
- `pnpm eval` → `eval/results.md`: one table, ours vs baseline, plus links to the failure frames.

**E5 · Pitch** — after 15:00, once numbers exist
- 3-minute deck + `docs/demo-script.md`. The proof slide = the `eval/results.md` table + one failure we fixed.

### Alex — `packages/viewer` + `apps/api` + `apps/web`

**A1 · API (`apps/api`)** — mock end-to-end by 13:00
- Hono on Node; multipart uploads streamed to disk (up to ~500 MB); in-process job queue (`p-queue`, concurrency 1) calling `@ledger/pipeline`.
- `GET /jobs/:id/events` (SSE) emits `{ stage: 'frames' | 'rooms' | 'surfaces' | 'findings' | 'diff', done, total }`, so the demo shows live progress.
- Statement: built from `DiffItem[]` in code (no model). `dueBy = moveOutDate + 14 days`. Disclaimer: "Draft for review, not legal advice." HTML template; PDF via Playwright `page.pdf()` if time allows.

**A2 · 3D viewer (`packages/viewer`)**
- React Three Fiber + drei. Each wall segment → box mesh (length × `ceilingHeightM` × 0.1 m) at the segment midpoint, rotated by `atan2(dy, dx)`. Split walls into pieces around openings (simpler than CSG). Floor = `ShapeGeometry` from the room polygon.
- `mesh.userData.surfaceId` on everything, raycast on click → `onSelect(surfaceId)`.
- Pins: one sprite per `DiffItem` at the surface center. Color by verdict: new-damage red, pre-existing blue, wear gray, moved yellow, not-visible hatched.
- Dollhouse view: hide walls whose normal faces the camera. Top-down toggle uses `plan.svg` as a minimap. `OrbitControls`.
- Side panel: before/after frames with the `bbox` drawn on them, verdict, reason, cost.

**A3 · Web flows (`apps/web`)**
- Next.js App Router; data only through `lib/api.ts` (typed with `@ledger/shared`).
- `/owner/new`: upload plan → show the parsed plan + warnings → confirm ceiling height and scale → `/units/:id`.
- `/units/:id`: 3D + baseline findings. `/units/:id/confirm`: tenant reviews the findings, agrees or adds an addendum video. `/units/:id/moveout`: record or upload. `/units/:id/statement`.

**A4 · Capture + demo room**
- Phone capture page: `getUserMedia` + `MediaRecorder` at 720p (Safari gives mp4, Chrome webm; the API transcodes with ffmpeg). On-screen guide: "pan slowly, about 5 seconds per wall."
- `/demo`: one screen with big steps (1 plan → 2 baseline → 3 judge's turn, with timer → 4 move-out → 5 compare), live SSE progress, then 3D + statement. Emergency fallback toggle: `GEMINI_MODE=replay` of a recorded run, only if the venue Wi-Fi dies, and we say so on stage.

**A5 · Submission**
- 1-minute video showing only what we built today. README: what it does, how to run it, what was built during the event, eval table.

**Everyone:** record and label test pairs (E4 format). If you're blocked for more than 30 min, say so in the team chat, and whoever is ahead pairs with you.

## Checkpoints (Saturday)

| Time | Must be true |
|---|---|
| 11:15 | Repo up, contract frozen, issues assigned |
| 12:00 | Plan fixtures in, Gemini mock mode working |
| 13:00 | **Mock end-to-end:** upload plan → 3D → upload 2 videos → statement (fake data OK) |
| 15:00 | **Real end-to-end** on one real walkthrough pair |
| 16:00 | Feature freeze. `eval/results.md` done on the test split. Demo rehearsed once with an outsider as the "judge" |
| 16:40 | 1-min video recorded, README done, repo public, all 3 added to submission |
| 16:50 | Submitted (deadline 17:00) |

If a checkpoint slips by 30+ min, cut a tier. Don't push the next checkpoint.

## Commands

```
pnpm install                                   # once, at repo root
pnpm -r typecheck
pnpm -r test
pnpm dev                                       # api + web
GEMINI_MODE=mock pnpm dev                      # no API calls, fixture data
pnpm --filter @ledger/pipeline run:pair <plan> <baseline.mp4> <moveout.mp4>
pnpm eval                                      # writes eval/results.md
```

## Agent setup

`CLAUDE.md` is a symlink to `AGENTS.md`. Use one git worktree per ticket. Worktrees don't get gitignored files, so copy `.env` into each new worktree and give each worktree its own `PORT`. The optional Gemini Docs MCP server is at https://gemini-api-docs-mcp.dev.

## Rules for agents

**Hackathon rules (break these and we're disqualified)**
- Repo is **public**. All code is written **at the event**, today. **Do not copy code from room-remap** or any earlier project.
- The demo shows only what we built today. The README lists what was built during the event.
- Not allowed: Streamlit, a dashboard as the main feature, "image analyzer" framing. LEDGER is an agent that finishes the job (writes the statement), and the 3D map is evidence, not the product.
- The demo must work on **unrehearsed inputs**. Never hardcode demo answers. The eval can't be only examples we made to pass.

**Engineering**
- For any Gemini API detail (model IDs, Decisions API request shape, limits, pricing), read docs/vendor/ first. Never guess from memory: these APIs are newer than your training data.
- Every Gemini call goes through `packages/gemini`. Never hardcode model IDs; read them from `MODEL_*`. Every package must work with `GEMINI_MODE=mock`.
- Models parse and classify; code builds geometry, areas and money. No model output goes into a number on the statement without passing through code.
- Validate every model JSON with zod. Never trust a field you didn't validate.
- TypeScript strict, ESM, Node 22+, pnpm. No new top-level tools without a line in `docs/decisions.md`.
- **Never commit secrets.** `.env` is gitignored; add new vars to `.env.example` with a fake value.
- **Never commit videos or photos of real homes.** They're large and can show faces, addresses and belongings. They live in `data/` (gitignored) and our shared drive. Labels (JSON) can be committed.

**Git and handoffs**
- Branch per task: `<name>/<short-task>`; small PRs into `main`; rebase often.
- **Push at least every ~30 min** or at every working checkpoint, even WIP. Laptops die and AI sessions hit limits; unpushed work doesn't exist.
- Before your AI session ends or hits a limit: push, then comment on the issue with what's done, what's next and any gotchas. Anyone's agent should be able to resume from that.
- Only the person adding a dependency touches `pnpm-lock.yaml`. On conflict, take main's and re-run `pnpm install`.
- Log decisions, including any you made on your own, in `docs/decisions.md` (one line each: time, who, what, why).
- Personal AI preferences (tone, language, commit style) belong in your personal config, not this file.

## Open questions (ask organizers at 10 AM)

- Which project and credits should we use for Argon, Carbon and Neon, and what active per-model quotas will all three teammates share?
- Is filming or labeling held-out test pairs before 10:30 AM allowed?
- Is there an official Carbon bounding-box convention or reference image showing coordinate order and scale?
