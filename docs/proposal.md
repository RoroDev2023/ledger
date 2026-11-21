# LEDGER — “Carfax for apartments”

## The Vision

Give tenants and owners a shared record of an apartment's condition. Either person should be able to select a deduction and see the same wall, floor or fixture at move-in and move-out.

## The Problem We Are Solving (Problem Statement One: 5 Sigma)

A walkthrough records what the camera saw, but a second walkthrough rarely follows the same path. A changed angle, a chair against a wall or a stain that predates the lease can lead to a mistaken charge. In New York, the 14-day deadline for an itemized deposit statement leaves little time to find the original evidence. Our reliability question is how often the system identifies genuine new damage on the correct surface.

## How It Works (flow)

1. The owner uploads a 2D plan. Code turns the parsed geometry into a 3D model with a stable ID for each surface.
2. The owner films move-in. We locate sharp keyframes on the plan and record visible issues. The tenant reviews the baseline and can add evidence.
3. At move-out we locate the new frames on the same plan. For each covered surface, the system compares labeled before/after images and distinguishes new damage, pre-existing marks, wear, moved objects and no change. Inadequate coverage gets its own verdict.

## The Gemini 4 Multi-Model Pipeline

Argon reads rooms, openings and dimensions from the plan. Hydrogen identifies landmarks and movable objects in keyframes. Decisions classifies rooms and surfaces, checks visibility and damage, and compares paired images. Carbon reviews uncertain findings and supplies an evidence box and explanation. Neon provides the independent single-call evaluation baseline using the plan and both full videos.

## The Action

The system writes an itemized draft deposit statement with before/after frames, measured area where applicable, the repair calculation, total and due date. Code computes the amounts from configured rates and depreciation. A chair that moved, an old mark or a hidden wall carries no deduction. The 3D pins let either party inspect the evidence for each line.

## Proof and Demo

A judge sketches our table setup, privately adds a scratch and stain, and moves a chair between walkthroughs filmed from different angles. We compare their changes with the live statement. On separate held-out pairs, we score the pipeline and Neon against the same surface and issue labels, report precision, recall and F1 with raw counts, and show one failure we fixed during development.
