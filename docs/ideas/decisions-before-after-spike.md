# Decisions API on BEFORE/AFTER pairs: first live spike (11:39, Elmir)

**Synthetic images, small set: a check of request shape and question wording, not our eval number.**

Setup: Nano Banana generated 3 apartment-wall photos (plain white + outlet, grey + poster, beige + window/radiator). Code made the move-out view: perspective shift, slight zoom, 18% darker. "Scratch" pairs add a dark ~1 cm-looking line in the middle third. Each pair went to `gemini-decision-1` exactly as AGENTS.md R5 says: text "BEFORE", image, text "AFTER", image, `noul` questions. Latency 0.4-1.3 s per request.

## New-damage question: wording matters a lot

| Pair | v1 generic | **v2 concrete** | v3 short | 2x2 max (v2) | truth |
|---|---|---|---|---|---|
| wall0 scratch | 0.495 | **0.845** | 0.748 | 0.830 | changed |
| wall0 clean | 0.094 | **0.164** | 0.222 | 0.272 | none |
| wall1 scratch | 0.283 | **0.557** | 0.517 | 0.533 | changed |
| wall1 clean | 0.166 | **0.181** | 0.247 | 0.237 | none |
| wall2 scratch | 0.325 | **0.868** | 0.553 | 0.896 | changed |
| wall2 clean | 0.146 | **0.130** | 0.255 | 0.243 | none |

- v1: "Does the AFTER photo show new damage on the wall (a scratch, stain, hole or crack) that is not in the BEFORE photo?" -> 3/6 at 0.5 (misses every scratch).
- **v2: "Is there a dark mark, scratch, line, stain or hole on the wall in the AFTER photo that is not present anywhere in the BEFORE photo? Ignore differences in camera angle and lighting."** -> 6/6 at 0.5, clean re-shoots 0.13-0.18.
- v3: "Compare the wall surface only. Does a new visible mark appear in AFTER?" -> 6/6 but closer to 0.5.
- 2x2 quadrant crops did not add separation here (useful for the rough box, not for detection).

**Suggestion for R4/R5:** use v2-style concrete wording (name what a mark looks like, tell it to ignore angle and light). Tune the threshold on dev pairs; the scratch with the lowest score (0.557) was on the grey wall with a poster.

## Same-region question: confuses similar plain walls

| Pair | same_region | truth |
|---|---|---|
| wall0 vs wall0 shifted | 0.73-0.82 | same |
| wall1 vs wall1 shifted | 0.78-0.86 | same |
| wall2 vs wall2 shifted | 0.81-0.82 | same |
| wall0 (white+outlet) vs wall1 (grey+poster) | **0.828** | different (WRONG) |
| wall1 vs wall2 | 0.139 | different |
| wall2 vs wall0 | 0.487 | different (barely) |

**Suggestion:** "same region?" alone is not a reliable gate between plain walls. Give every wall on the set one distinct landmark (the plan's `Surface.landmarks`) and put it in the question, e.g. "Do BEFORE and AFTER both show the <surface label> (the wall with the <landmark>)?". Plan-based localization should do most of the pairing; this check is a second guard.

Spike scripts (outside the repo, exploration only): `gemini4-nyc/spike/decisions_pairs.py`, `decisions_variants.py`. Next: the same test on real footage (dev-01).
