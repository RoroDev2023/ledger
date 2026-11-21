# LEDGER — “Carfax for apartments”

## The Vision

Give tenants and owners a shared record of an apartment's condition. Either person should be able to select a deduction and see the same wall, floor or fixture at move-in and move-out.

## The Problem We Are Solving (Problem Statement One: 5 Sigma)

A walkthrough records what the camera saw, but a second walkthrough rarely follows the same path. A changed angle, a chair against a wall or a stain that predates the lease can lead to a mistaken charge. In New York, the 14-day deadline for an itemized deposit statement leaves little time to find the original evidence. Our reliability question is how often the system identifies genuine new damage on the correct surface.

## How It Works (flow)

1. The owner uploads a 2D plan. Code turns the parsed geometry into a 3D model with a stable ID for each surface.
2. The owner films move-in. We locate sharp keyframes on the plan and record visible issues. The move-in findings form the baseline. Tenant sign-off is deferred until the core walkthrough works.
3. At move-out we locate the new frames on the same plan. For each covered surface, the system compares labeled before/after images and distinguishes new damage, pre-existing marks, wear, moved objects and no change. Each comparison starts by asking whether the images show the same region. If the answer is uncertain, compare 2×2 crops to locate the spot and obtain a rough box. Skip pairs whose regions cannot be matched.

## The Gemini 4 Multi-Model Pipeline

Argon reads rooms, openings and dimensions from the plan. Hydrogen identifies landmarks and movable objects in keyframes. Decisions classifies rooms and surfaces, checks visibility and damage, and compares paired images. Carbon reviews uncertain findings and supplies an evidence box and explanation. Neon provides the independent single-call evaluation baseline using the plan and both full videos.

## The Action

The system writes an itemized draft deposit statement with before/after frames, measured area where applicable, the repair calculation, total and due date. A deduction requires two distinct before/after frame pairs that independently show the same spot and the same chargeable change. A crop or retry of one pair still counts as one pair. If the evidence falls short, the statement shows “Not provable”, the reason and $0. Code prices supported deductions using a flat fee or an area rate. A chair that moved, an old mark or a hidden wall carries no deduction. The 3D pins let either party inspect the evidence for each line.

## Proof and Demo

Use a premade plan of the set or a judge-selected listing plan with matching walkthroughs. After move-in, the judge privately stages changes and records them on a card before move-out filming. Keep the card hidden from both models and reveal it beside the verdicts. The live screen shows Decisions question counts and response times.

Elmir’s held-out eval targets about 12 changed walkthrough pairs and six clean re-shoots staged and labeled by outsiders. Neon gets the same plan and both full videos in one call. Lead with the number of clean re-shoots that incurred any charge and the dollars attributed to the moved chair. Report missed damage alongside those figures so a system that always charges $0 gets no credit for detecting changes.
