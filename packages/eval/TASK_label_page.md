# Task: static labelling page for LEDGER eval (packages/eval/label.html)

Build ONE self-contained file `packages/eval/label.html` (inline CSS + JS, no build step, no CDN, no network). Write nothing else.

Purpose: a teammate labels frames from a walkthrough with the true surface they show, and records ground-truth changes for a pair, producing JSON we commit to `data/labels/<pair>.json`.

Inputs (chosen by the user with <input type="file">):
1. A plan JSON (FloorPlan shape: `{ unitId, rooms:[{id,name,polygon:[[x,y],...]}], surfaces:[{id, roomId, kind, label, segment?:[[x,y],[x,y]]}], openings:[...] }`, meters, y = north). Example: packages/shared/fixtures/plans/demo-table.json.
2. A folder or multi-select of frame images (jpg/png) from one walkthrough.

UI:
- Left: the current frame, large. Keyboard: left/right arrows to move between frames.
- Right: a top-down SVG drawn from the plan (flip y so north is up; walls as thick clickable lines labelled with their surface id, floors as clickable polygons). Clicking a wall/floor sets the true surface for the current frame. A "none / can't tell" button.
- Below: a "pair changes" form: add rows of { surfaceId (dropdown of plan surfaces), issueType (crack|stain|hole|scuff|missing-fixture|other), kind (new-damage | pre-existing) }, rows of moved objects { object (text), fromSurfaceId?, toSurfaceId? }, a pairId text box, split dropdown (dev|test), checkbox cleanReshoot.
- "Download JSON" button producing:
  `{ "pairId", "split", "newDamage":[{surfaceId,issueType}], "preExisting":[{surfaceId,issueType}], "moved":[{object,fromSurfaceId?,toSurfaceId?}], "cleanReshoot": bool, "frames": { "<frame filename>": "<surfaceId or 'none'>" } }`
- Autosave progress in localStorage keyed by pairId; restore on reload.

Done means: opens by double-click in Chrome, loads demo-table.json, draws 2 rooms with clickable walls, labels a few frames, downloads valid JSON. Report what you tested.
