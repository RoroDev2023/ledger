# Failures log

One entry per failure: input, what broke, the fix, did it help (measured on dev).

## 11:33 · plan parsing · one-bed-railroad (Elmir)
- **Input:** listing-style image of a 3-room railroad plan (31'6" wide), Argon via the parsePlan prompt and schema.
- **What broke:** Argon returned 2 of 3 rooms and 3 of 5 openings, and our scale came out NaN.
- **Cause 1 (ours):** macOS Quick Look makes square thumbnails, so the PNG of the wide plan was cropped and the bedroom was not in the image at all. Argon read what it was given correctly.
- **Cause 2 (ours):** with only two dimension labels that disagree by >15%, the outlier filter dropped both and took the median of nothing.
- **Fix:** draw plans on a square canvas; when every label disagrees, use the longest label and warn.
- **Did it help:** live re-run, all 3 plans: rooms 7/7, doors and windows 13/13, median room-dimension error 0.1-3.2%. Small set of clean drawings we made ourselves; not a benchmark.
