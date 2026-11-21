# Rahim (RoroDev) — agent handoff

Owns the Gemini client and walkthrough pipeline (`packages/gemini` and `packages/pipeline`, R1–R5).

## 2026-11-21 11:59 ET · R3 localization (branch `rahim/r3-localize`)

- **Ready:** `localizeWalkthrough(plan, frames, { captions?, planSvg? | planSvgPath?, outPath?, onProgress?, config?, deps? })` in `@ledger/pipeline` returns `{ localizations: Localization[], coverage, notVisible, carbon, trace }`.
  - **Rooms:** each keyframe gets one `decide` call (`localize.room`) with a `choice` over the plan's rooms plus `other`. A room only changes when at least 3 consecutive frames agree on the new room.
  - **Surfaces:** each keyframe gets one `decide` call (`localize.surface`) with one `choice` (which surface fills the frame, or `other` → `'none'`) plus one `noul` per candidate surface (visible?). Keys come from `QuestionKeys`, and option keys are the surface IDs.
  - **Smoothing:** Viterbi plus forward–backward per room segment. Transitions are self 0.8, neighbor 0.15, other 0.05.
  - **Carbon** (`localize.carbon`): runs when a frame's posterior is below 0.6, at most 12 calls per walkthrough, lowest posterior first. The input is the frame, the top-3 candidates and the plan SVG rendered to PNG by sharp, or room text if there is no SVG. Carbon's confidence is the HMM posterior of its pick. Reasons are in `result.carbon`.
  - **Coverage:** frames with P(visible) > 0.7 per surface. Fewer than 2 → `notVisible`.
  - All tunables are in `src/localizeConfig.ts`. Option text is generated from the plan in `src/describe.ts`: width, openings at left/center/right as seen from the room center, doors found on the other side of shared walls, fixtures and neighbors.
- **CLI:** `pnpm --filter @ledger/pipeline localize <plan.json> <video> [--unit id] [--wid id] [--seconds n]`. It picks up the plan's sibling `.svg` automatically, prints a per-frame table and a coverage table, and writes `.data/units/<unit>/walkthroughs/<wid>/localization.json`.
- **Verified:** 19 new tests, run in mock mode against the demo-table plan:
  - room smoothing
  - the HMM fixing a one-frame flip to the opposite wall
  - Carbon triggering, its 12-call cap, the text fallback, and rejecting picks that aren't candidates
  - coverage marking surfaces `not-visible`
  - landmark hints boosting a match
  - default askers running through gemini mock, with calls.jsonl question counts of 1 per room request and candidates+1 per surface request

  Repo-wide: typecheck, 143 tests and lint all pass on Node 22.

  **Live:** I ran the CLI on a synthetic 10 s clip. Decisions answered `other` for all 14 frames with P 0.80–0.93, at about 1.7 s per request. I also sent one surface request on a frame directly: it was accepted (dotted option keys work) and answered in 555 ms. One Carbon call with the plan PNG answered `none` with a sensible reason.

  **Not verified:** real walkthrough footage. `data/pairs/pair-01` did not exist yet.
- **For Alex:** `onProgress('rooms' | 'surfaces', done, total)` matches your SSE stages. `progress.ts` now exports `Stage` and `OnProgress`.
- **Next:** run the CLI live on pair-01 once it is filmed, and tune `CARBON_BELOW` and `LANDMARK_BOOST` on dev pairs only. Then build R4 findings on top of `coverage` and `localizations`.

## 2026-11-21 11:50 ET · Files API upload (branch `rahim/r1-files-upload`, stacked on PR #14)

- **Ready:** `uploadFile(path, mimeType, { displayName?, env? })` in `@ledger/gemini` returns `{ uri, mime_type }`, so `{ type: 'video', ...file }` drops into both Interactions and Decisions input. It follows the resumable protocol in the new `docs/vendor/files-api.md`, the official page fetched as Markdown. The upload is streamed, not buffered, with 3 tries on 429/5xx. It polls `GET /v1beta/<name>` until the file is `ACTIVE`; a live probe showed videos arrive `PROCESSING` and turn `ACTIVE` about 1.5 s later. Identical bytes plus MIME type reuse the upload for 47 h (files expire at 48 h). Mock returns a fake `.../files/mock-<sha>` URI, and replay serves recorded uploads only. Every upload is logged to `calls.jsonl` with `tag: "upload"`, `model: "files-api"` and `endpoint: "files"`.
- **Verified:** 5 new tests against a local fake Files API cover the headers, body bytes, PROCESSING→ACTIVE polling, cache reuse, 503 retry, no retry on 403, FAILED state, and record/replay. All 31 gemini tests, `pnpm -r typecheck` and lint pass. Live: a 2 s synthetic test-pattern mp4 uploaded in 4.4 s, and `decide` on `{ type: 'video', ...file }` answered (231 input tokens).
- **Next:** R2 frames and Hydrogen landmarks.

## 2026-11-21 11:43 ET · Hydrogen captions on @ledger/gemini (branch `rahim/r2-captions`, stacked on #13 + #14)

- **Correction:** R1 was not merged to main at the time of this run. [PR #14](https://github.com/RoroDev2023/ledger/pull/14) is still open. I rebased `rahim/r2-frames` (#13) onto main (`fceccce`, after A1). This branch is #13 plus a merge of `rahim/r1-gemini-client`, plus the caption switch. Merge #14 and #13 first. This PR's own change is then only `landmarks.ts` and its test.
- **Ready:** `captionFrames(frames, { batchSize?, env? })` calls `generate({ model: modelId('fast'), tag: 'hydrogen.captions', schema: HydrogenBatchSchema })`. Each batch has 8 frames, and each frame is sent as a `Frame <id>:` text part followed by a base64 JPEG. The response is `{ frames: [{ frameId, landmarks[], objects[] }] }`, validated with zod. Entries are matched back by `frameId` (unknown IDs are ignored, missing frames get empty lists) and terms are lowercased and deduped. I removed the local mock and the TODO. Mock, record and replay modes, the cache and `calls.jsonl` now come from packages/gemini.
- **Mock behaviour:** if there is no `fixtures/generate/hydrogen.captions.json`, the synthesized output has no matching frame IDs, so every caption is empty (no fake hints). Tests point `GEMINI_FIXTURES_DIR` at a temporary fixture.
- **Verified:** pipeline has 14 tests. In mock mode, 19 frames make 3 calls on MODEL_FAST in the call log; entries map by ID; bad JSON raises `GenerateValidationError`; output is deterministic. `pnpm -r typecheck`, `pnpm -r test` (119) and `pnpm lint` are green on Node 22. **Not verified:** a live Hydrogen call on real frames.
- **Next:** one live `record` run of captions on a dev pair, then R3 localization on `decide`.

## 2026-11-21 11:45 ET · R1 Gemini client (branch `rahim/r1-gemini-client`)

- **Ready:** `@ledger/gemini` exports `generate<T>({ model, input | parts, schema, tag })` (POST `/v1beta/interactions`, JSON `response_format`, zod-validated, one retry with the error appended) and `decide({ input, questions, tag })` (POST `/v1beta/decisions`). `decide` returns the native `{ answers, usage }` under the caller's keys (any string: surface IDs work). On the wire it uses `q0..qN`. Requests split at 1,000 questions and ~262,144 estimated tokens, usage is summed per modality, and a 400 context overflow halves the chunk. `QuestionKeys` maps (surfaceId, purpose) to `q17` and back. `gemini = { generate, decide }` fits Elmir's `PlanModel` and `BaselineModel`.
- **Modes:** `GEMINI_MODE` live / mock / record / replay, keyed by `sha256(model + body)`. Disk cache in `.data/cache` (`GEMINI_CACHE=0` turns it off). Recordings go to `.data/recordings` (`GEMINI_RECORDINGS_DIR`), and a replay miss throws, never calls live. Requests run under p-limit(4) with backoff on 429/5xx, 3 tries. Mock reads `fixtures/{generate,decide}/<tag>.json`, otherwise it builds a value from the zod schema or hash-derived probabilities (see `packages/gemini/fixtures/README.md`). Model IDs come only from `MODEL_*`. In mock mode an unset variable becomes `mock:MODEL_X`.
- **Call log:** each request (after chunking) appends `{ ts, model, tag, latencyMs, inTokens, outTokens, cached, questions, questionCount, source, endpoint, ok }` to `.data/calls.jsonl`. For Alex: `readCallStats({ decisions: true, since })` returns `{ calls, questions, lastLatencyMs, avgLatencyMs, ... }`, which matches `DecisionsStat`. `onCall(fn)` pushes each row live for SSE.
- **Verified:** 26 new tests (mock, plus a local fake HTTP server for the live, cache, record/replay, backoff and retry paths). `pnpm -r typecheck`, `pnpm -r test` (105 total) and `pnpm lint` are green on Node 22. The live smoke run `pnpm --filter @ledger/gemini smoke` returned 200 from Hydrogen, Argon, Carbon, Neon and Decision 1 in 4–6 s each.
- **Gotchas:** the main checkout's `.env` only has `GEMINI_API_KEY`. The smoke script falls back to `.env.example` for `MODEL_*`, but other scripts need those lines in `.env`. Token estimates for video, audio and PDF are conservative constants; pass `inputTokens` when you know the real count. A Files API upload helper (needed by the Neon baseline's video URIs) is not built yet. Use Node 22 (`/opt/homebrew/opt/node@22/bin`); the default `node` on this laptop is 20.
- **Next:** R2 frames and Hydrogen landmarks, then R3 localization on `decide`. Add a Files API upload helper for Elmir's baseline.

## 2026-11-21 11:35 ET · R2 frames + Hydrogen caption interface (branch `rahim/r2-frames`)

- **Ready:** `extractFrames(videoPath, walkthroughId, { workDir? | unitId?, dataDir?, onProgress? }) → Frame[]` in `@ledger/pipeline`. ffmpeg `fps=2,scale=1280:-2` into `<workDir>/frames/` (Alex: pass the walkthrough dir you already give `runWalkthrough`), else `.data/units/<unitId>/walkthroughs/<wid>/frames/`. `tMs = (index−1)·500`. Sharpness = Laplacian variance on grayscale via `sharp`; drops frames strictly below the video's p30. dHash 64-bit (16 hex chars in `Frame.phash`); drops a frame within Hamming ≤ 5 of the last kept one. Rejected JPEGs are deleted unless `keepRejected`. Frame IDs: `<wid>.f00042`. `extractKeyframes()` also returns raw frames, reject reasons and the threshold (for eval/failures.md).
- **Hydrogen:** `captionFrames(frames, { captioner? }) → { frameId, landmarks[], objects[] }[]`, batches of 8, zod-validated (`HydrogenBatchSchema`), terms lowercased/deduped, skipped frames get empty lists. **Runs on a local deterministic mock** (`mockCaptioner`). TODO in `landmarks.ts`: swap in `generate({ model: MODEL_FAST, schema: HydrogenBatchSchema, ... })` once R1 merges. In non-mock mode without a captioner it returns empty captions + a warning (no fake hints).
- **Verified:** 14 pipeline tests (pure helpers + 5 s `testsrc2`/blurred/still videos made by ffmpeg in the test: 10 frames, 1280×720, tMs, 3 blurry dropped from the blurred segment, still video dedupes to 1), `pnpm -r typecheck`, `pnpm lint`, all package tests on Node 22.
- **For Elmir:** the ffmpeg tests `skipIf` ffmpeg is missing. Please add `sudo apt-get install -y ffmpeg` to CI so they run there. Added `sharp`, `zod` deps (lockfile touched by me).
- **Next:** R1 mock client in `packages/gemini`, then wire `captionFrames` to it; then R3 localization.

## 2026-11-21 11:16 ET · Integrating team branches

Merged the E4 eval into its E2 parent branch and the E1 handoff into main. Incorporated Alex’s project-structure follow-up into PR #8 and reconciled both handoff histories. Next for Rahim is R1 mock telemetry.

## 2026-11-21 11:13 ET · Repository status

Fetched origin and inspected main at `59f6dfe`. The revised proof and demo rules are in AGENTS.md and the script. PR #8 aligns the proposal; PR #7 contains plan parsing and PR #9 stacks eval on it. Alex's follow-up `c1e1820` is on his branch. The diff and call-log modules on main are still placeholders. Next for Rahim is the mock client with per-call telemetry.

## 2026-11-21 11:09 ET · Two-pair proof and demo plan

On `rorodev/proof-plan`, reconciled the proposal and implementation notes with Alex's merged plan at `59f6dfe`. Two crops of one comparison count as one pair. Keep both supporting frame pairs for Alex’s evidence panel and log each Decisions request after chunking. The two-room demo fixture is on main. These are planning changes; Rahim’s next implementation step is the R1 mock client and call log. Elmir owns the held-out eval.

## 2026-11-21 11:04 ET · Shared contract review

Requested changes on [PR #4 at fecfd48](https://github.com/RoroDev2023/ledger/pull/4#pullrequestreview-6006440292). Typecheck, 15 tests, and lint passed locally on Node 22. Additional checks confirmed that a statement can charge for a moved chair, a door can reference a floor, and an impossible move-out date produces a deadline. Elmir owns the fixes; Rahim should recheck these cases on the updated head.

## 2026-11-21 11:01 ET · Elmir's E1 branch

Inspected [PR #4](https://github.com/RoroDev2023/ledger/pull/4) at `fecfd48`. CI passed typecheck, tests and lint. The shared schemas, severity helper and three synthetic plan fixtures are available on that branch for R1 and the viewer. The eval runner currently lists labels; the Neon comparison and Argon parser are pending. Next for Rahim is the shared-contract review before merge.

## 2026-11-21 10:50 ET · Merge check

Fetched the project branches and checked the open PRs. [PR #2](https://github.com/RoroDev2023/ledger/pull/2) held the only outstanding changes. The ideation PDF was already on `main`. After the merge, agents can read all three handoffs from `main`. Rahim's next planned task is R1.

## 2026-11-21 10:47 ET · Agent handoffs

- The planning docs and Gemini references are on `main`. The [ideation PDF](docs/ideas/ideating.pdf) landed in [PR #1](https://github.com/RoroDev2023/ledger/pull/1). This run added the three handoffs and their read/update instructions on `rorodev/agent-handoffs`.
- At handoff setup, GitHub listed no open tickets or PRs, and `main` at `92dc57f` contained planning material. The status of any unpublished work is unknown.
- Next planned checkpoint is the R1 mock client by 11:45. Check for an active R1 ticket, coordinate the shared types with Elmir, and give Alex the mock entry point once it works. The live run also needs the event project's access and quotas confirmed.
