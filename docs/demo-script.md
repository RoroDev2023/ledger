# Three-minute live demo

Set out the table setup, a printed premade plan of the set (plus 2–3 real listing plans the judge can pick instead), a phone, a movable chair, two removable marks to stand in for a scratch and a stain, and a blank card and pen for the judge. Open `/demo`. Before presenting, fill the proof slide from `eval/results.md` and choose one documented fix from `eval/failures.md`.

The judge does **not** sketch our table: a sketch of our own set looks staged.

| Time | On stage | What to say |
|---|---|---|
| 0:00–0:20 | Show the premade plan of the set, or let the judge pick a real listing plan. Upload it and point out one wall on the plan and the same wall in 3D. | “At move-out, a tenant can ask a simple question: can you show me this spot on the day I moved in? The plan gives us a fixed place to look.” |
| 0:20–0:45 | Film the baseline with a slow pan. Upload it and show the move-in findings arriving, with the Decisions panel counting questions and response times. | “Every frame gets pinned to a wall by the Decisions API. These are probabilities, not guesses in prose.” |
| 0:45–1:05 | Turn away. The judge places the scratch and stain wherever they choose, moves the chair, and **writes what they changed on the card**, face down. | “Write down what you did. At the end we'll put your card next to our verdicts.” |
| 1:05–1:30 | Film the move-out from another corner and upload it. Show live progress and the Decisions panel. | “This pass takes a different path. We never compare video to video. Both passes are pinned to the same plan.” |
| 1:30–2:25 | Open the 3D pins. Select a charged line and show its before/after pairs: “same region” passed on at least 2 pairs, and both agree it changed. Show the chair as moved, $0. Show any *not provable* surface, $0, and why. Turn over the judge's card next to the verdicts and check every item, including any miss. Open the draft statement and trace one line from evidence to charge. | “LEDGER won't charge what it can't prove. A charge needs two before/after pairs of the same spot that agree. A moved chair is $0. A wall it couldn't see twice is $0.” |
| 2:25–3:00 | Proof slide: false charges on the clean re-shoots and dollars charged for the moved chair, ours vs the Neon baseline (which also got the plan). Then correct, false and missed damage counts. Show one failure, the fix and its effect. | “Outsiders staged these changes, not us. Both systems saw the same pairs and the same scorer. Here's what still goes wrong.” |

If venue Wi-Fi fails and the team uses replay, announce the switch and identify the recorded pair before showing its results.

## Five likely judge questions

1. **Why build a floor plan if Neon can take both videos?** The plan gives both passes stable surface IDs. Our baseline is one Neon call with the plan and both full videos, so the plan alone isn't the difference. The proof slide shows the measured gap, mainly in false charges.
2. **What if the chair hides the scratch?** Each before/after pair must first pass “same region?”. If fewer than two good pairs exist, the surface is *not provable* and the statement charges $0 for it.
3. **Who decides what a repair costs?** Code applies a configured flat fee or a per-area rate. The demo rates are placeholders. The owner reviews the calculation and supporting frames before using the draft.
4. **How often does it charge for nothing?** We filmed clean re-shoots where nothing changed. False charges on those is our headline number, next to the baseline's.
5. **How do you know it generalizes beyond this table?** About 12 change pairs and 6 clean re-shoots, changes made by people outside the team, thresholds tuned on dev only, test run once. We report counts next to percentages so judges can see the sample size.
