# Plan parsing: live Gemini 4 Argon on the test plans

Plans and ground truth come from `apps/api/scripts/make-test-plan.py`. Each run is graded by
`pnpm --filter @ledger/api check-plan apps/api/test/plans/<plan>.pdf` (room count, each room's area within 5%,
total area, door and window counts and widths, and every door/window within 30 cm of its true position).
All runs on 2026-11-21 with `GEMINI_CACHE=0` (fresh Argon calls).

| Plan | What it tests | Prompt: trace the **inside** of walls (2 runs) | Prompt: trace the wall **center line** (1 run) |
|---|---|---|---|
| unit-4b | 4 rooms, L-shaped unit | 6/10, 6/11 checks · small rooms 14–17% too small | **11/11** · openings within 7 cm |
| studio-ft | feet-and-inch labels | 6/9, 6/10 · small rooms ~10% too small | **10/10** · within 3 cm |
| two-bed-hall | 6 rooms, hallway, 6 doors | 12/12, 13/13 | **13/13** · within 4 cm |
| l-living | non-rectangular L room | 9/9, 6/10 · rooms 5–9% too small | **10/10** · within 2 cm |
| scan-2b | crooked, noisy, blurred scan | 11/12, 12/13 · hall 13% too big | 6/13 · rooms ~6% too big, hall 17.5% |

**Fix kept:** the dimension labels (the scale) measure wall center lines, so rooms traced along the inside of the
walls lost half a wall on every side, worst for small rooms. Asking for center lines fixed every clean plan.

**Still fails:** the scanned plan. Its scale is right (within 0.7% of the clean plan), but on blurred thick walls Argon
traces slightly outside the center line, rooms come out ~6% large and their corners don't meet exactly. The
1.2 m hall is worst because a few centimeters of tracing is a large share of its width. Door and window positions
stay within 16 cm on the scan in every run.

**Also seen:** the same PDF can parse differently between runs (unit-4b: 100% in one earlier run, 14–17% off on
small rooms in the next two), so each plan needs more than one run to judge.
