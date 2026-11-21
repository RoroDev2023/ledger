# time · who · what · why

pre-event · RoroDev · planning docs prepared before the event · give all three teammates a shared scope and demo plan for kickoff
10:58 · Elmir · zod 3.25, vitest 3, tsx, eslint 9 + typescript-eslint · contract validation, tests and scripts as AGENTS.md specifies
10:58 · Elmir · plan fixtures are hand-made shapes, labelled as fixtures · unblock pipeline and viewer before Argon parsing exists
11:01 · Elmir · Argon returns coordinates on a 0-1000 grid, code converts with the real image size · Gemini models point on this grid natively; pixels are computed, not guessed
11:10 · Elmir (proposed), Alex (logged) · charge new damage only with ≥2 agreeing same-region before/after pairs, else not provable $0; judge's card instead of judge's sketch; outsider-staged test set (~12 change + 6 clean); cut sign-off, depreciation, PDF, Shopify, phone capture · stronger proof story, avoids staged-demo and image-analyzer optics, protects the 15:00 checkpoint
11:35 · RoroDev · `sharp` 0.34 in @ledger/pipeline for frame decode (Laplacian sharpness, dHash); ffmpeg via execFile, frame IDs `<walkthroughId>.f<00042>` · AGENTS.md R2 names sharp; IDs must be unique across walkthroughs for before/after pairs
11:40 · Rahim · packages/gemini calls the REST endpoints with fetch (no @google/genai); adds p-limit and zod-to-json-schema · shapes taken from docs/vendor; fewer moving parts, and a local fake server tests the live path
11:40 · Rahim · decide() re-keys questions to q0..qN on the wire and maps answers back; record/replay in .data/recordings, dev cache in .data/cache · callers can key by surface ID; the demo fallback is a folder you can copy
11:40 · Rahim · calls.jsonl rows carry `questions` (AGENTS.md, read by eval) plus a `questionCount` alias and `source` (live/cache/replay/mock) · eval and the demo panel can separate paid live calls from cache hits and replays
11:50 · Rahim · uploadFile() uses the Files API resumable upload from docs/vendor/files-api.md (official page saved as Markdown) and waits for ACTIVE · walkthrough videos exceed the 100 MB inline cap; the PROCESSING state was observed live, not guessed
11:59 · Rahim · R3 HMM states = room surfaces + `none` (catch-all "other" option); floor/ceiling adjacent to every wall; Carbon capped at 12 calls/walkthrough, confidence stays the HMM posterior; Hydrogen landmark match boosts a choice prob ×1.2 · contract unchanged (Carbon reasons live in localization.json), cost bounded, thresholds in one config file
12:19 · Rahim · R4 asks one severity `score` per issue type (11 Decisions questions per frame), not one per frame · a faint scuff and a big hole on the same wall must get different severities; questions are cheap
12:19 · Rahim · R4 Carbon calls capped per walkthrough (MAX_CARBON_CALLS 8, most uncertain first); over the cap or on a Carbon error the issue abstains (no finding) · bounded cost and latency; an agent that will not charge what it cannot prove
12:19 · Rahim · R4 applies the coverage minimum after the visibility gate: < 2 frames passing → surface not-visible · matches the two-pair proof rule downstream
