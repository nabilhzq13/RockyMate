# Rocksane

A single-page web app for bouldering. The user points a phone at a gym wall (photo, recorded clip, or live camera), taps one hold of their route, and the app finds every hold of that colour, checks each one really is a hold and not the wall, then plans the hand and foot sequence to the top. It shows an animated climber (a white mannequin seen from behind), a numbered move list with coaching tips, and a "Learn to climb" tab for beginners.

## Two builds from one source

`python build.py` writes:

| File | Where it runs | Camera |
|---|---|---|
| `dist/beta-lens.html` | Published as a Claude artifact (private): https://claude.ai/artifact/LeTvV14xrrch1tJLjDtFeU | No live camera. The artifact viewer blocks camera APIs, so it uses file inputs: Take photo, Record video (`accept="video/*" capture`), Upload. |
| `dist/beta-lens-live.html` | localhost (`serve.bat` on Windows) or any https host | Live camera via `getUserMedia` (button "Live camera"). Browsers only allow the camera on https or localhost. |
| `docs/index.html` | GitHub Pages: https://nabilhzq13.github.io/RockyMate/ | Same as the live build. |

`build.py` inlines `src/vision.js` + `src/solver.js` + `src/app.js` into `src/page.html` at `<!--SCRIPTS-->` and swaps `const STANDALONE=false;` for the live build. Elements with `data-only="standalone"` or `data-only="artifact"` are shown or hidden at runtime. The standalone file also gets a full `<head>` with the web app manifest and home-screen icons from `web/`, which are copied into `dist/` and `docs/`. To update the Claude artifact, give the new `dist/beta-lens.html` to Claude in the Claude app and ask it to republish that artifact URL.

## Repository and deploy

- GitHub: https://github.com/nabilhzq13/RockyMate (public). GitHub Pages serves the `docs/` folder of `main`.
- To deploy a change: edit `src/`, run `python build.py`, run the tests, then commit everything including `docs/` and push to `main`. Pages redeploys in about a minute.
- On iPhone: open the Pages link in Safari, tap Live camera and allow the camera; Share → Add to Home Screen opens it like an app.

## Source layout

- `src/vision.js` - `VisionCore()`: all image analysis. Must stay self-contained (no references outside the function) because `app.js` stringifies it into a Web Worker.
- `src/solver.js` - `solveBeta()` (move search, also stringified into a worker), `holdKind()` and `buildBeta()` (captions and tips, main thread).
- `src/app.js` - UI, sources, workers, video tracking, wall marks, drawing, move player, speech, the optional "Ask Claude" coach.
- `src/page.html` - CSS tokens (light and dark), markup, Learn-tab content.
- `test/` - Node detection benchmark, Node planner and figure check, and Python Playwright end-to-end checks (see Commands).

## How detection works (src/vision.js)

1. `prepare(rgba,w,h)`: sRGB to CIELAB. Local wall model: grid cells of about 1/18 of the long side; each cell's wall colour is the mode of a coarse Lab histogram refined by 3 mean passes; cells that differ from their 3x3 neighbourhood median by more than 11 are replaced (a big hold filling a cell). Bilinear per-pixel wall map. `dfg` = distance from the local wall (L weighted 0.5). `Tfg` = clamp(2.8 x median(dfg) + 5, 9, 24) adapts to wall texture. `gRef` = median colour gradient.
2. `pick(I,x,y)`: from the tapped point, grow the hold region (pixels that differ from the wall and are close to the seed colour). Build the colour model from **core** pixels only (not the rim, which mixes hold and wall colour, and only pixels with dfg >= 1.3 Tfg). Model = Lab mean + covariance, chroma-weighted hue mean and spread, chroma, L range, plus the wall colour in a ring around the tapped hold.
3. `classify(I,model,tol,{mask,pxPerCm})`, tol 1-10 (UI slider, default 5):
   - Gates: hue within clamp(3 x hueSd, 10, 28) x (0.5 + 0.1 tol) degrees, chroma >= max(8, Cm x (0.55 - 0.025 tol)); achromatic models (chroma < 11: black, white, grey) gate on low chroma and L range instead. Then Mahalanobis <= (2 + 0.35 tol)^2.
   - Wall test per pixel: must differ from the local wall by more than Tfg AND be closer to the route model (in its sigma) than to the wall (sigma = Tfg/3). Pixel classes: 1 route, 2 right colour but wall.
   - Morphology: close then open, radius about long side / 420.
   - Blob scoring: contrast vs the ring of wall around the blob, edge strength at the boundary vs `gRef`, shape (fill vs ellipse, elongation), ring similar to the tapped hold's wall, inside the wall region (grid cells similar to that wall colour, largest connected parts, dilated), not the edge of a painted area of the same colour (ring share of class 2 > 0.25), size 2-110 cm when a scale is known. conf >= 0.5 hold, >= 0.33 unsure (dashed amber, user can keep it), else rejected with a reason string.
   - With `mask:true` it returns per-pixel classes for the "Show what matched" view: 1 kept, 2 wall look-alike (red), 3 rejected blob (pink), 4 unsure (amber).
4. `refine()` refits the model from confident holds (photos only). `suggest()` makes the colour chips: k-means on pixels that stand out from the wall, keeps colours that form 2 or more hold blobs, ranks by count.

## How the moves are planned (src/solver.js)

- Units: cm, Y along the wall from the floor (the app divides picture heights by cos(wall angle), since an angled wall is longer than it looks from the floor). Body from height H and arm span (`o.span`, default H): arm reach ARM = 0.5H + (span - H)/2 from a shoulder point TORSO = 0.3H above the hip, leg reach 0.56H. A pose is feasible if the hip fits inside the intersection of the reach disks (candidates: ideal hip, projections onto each disk, pairwise circle intersections). Ideal hip: x between the hands and the feet (feet weighted 1.5), y = average foot + 0.46H, capped so the shoulders are at most 0.04H above the lowest hand.
- Pose cost follows coaching rules (sources: John Baker "Face climbing principles", Philadelphia Rock Gyms "Mastering foot sequencing", climber.co.uk technique tips): distance from the ideal hip, limb stretch beyond 0.78 (arms beyond 0.92 extra), feet close to the hands (gap < 0.7H), feet high under the hips (< 0.3H below the hip), stance wider than 0.42H, hips not over the feet, an arm reaching across the body, and 1.2 per flagged foot (flags are short-term).
- A* over states (left hand, right hand, left foot, right foot); a foot can be -1 (flag) or on floor points at the start. Both feet must leave the floor before a hand moves. Foot move 0.5 + 0.8 (d/LEG)^2 (+ smear, matching feet 2.0 on small holds, stepping down); flag 1.8; hand move 1 + 0.6 (d/ARM)^2 + pose (+ matching 1.5 on small holds, moving down, barn-door penalty when the other hand and the feet don't hold the hips from both sides).
- Hands never cross and feet never cross, in every pass (the owner does not want tangled limbs; on the benchmark this costs no routes).
- Wall angle (`o.angle`, degrees, + overhang, - slab): overhangs lower the preferred foot-to-hand gap (0.7H - 0.2H x steepness, steepness = angle/45) and the feet-under-hips distance, and make hand moves up to 1.5x as costly; slabs (angle/-20) allow higher feet and make hand moves cheaper. `buildBeta()` adds a slab or overhang tip to the start and toe-pull tips on steep walls.
- Strict pass first: feet at least 0.5H below the lowest hand and not above the hip, hands at least 0.45H above the feet. Tried from the 3 most natural starts, sharing one search budget. If none reaches the top, a relaxed pass (feet 0.15H below the hands, high steps allowed but costed by the pose rules, hands 0.12H above the feet) searches from every start pair at once. `res.strict` says which pass won. On real photos footholds are sparse, so the relaxed pass usually decides; the sample wall solves strict.
- Start (no tags): pairs from the 8 lowest holds between 0.35H and 1.3H, scored by closeness to chest height (0.8H), level hands, footholds at least 0.5H below, any foothold at all, and rank; a pair is "natural" (strict may use it) when the hands are within 0.6H of each other and between 0.45H and 1.2H. Or the user's Set start holds. Top = highest hold you can chain to from the low holds within 1.1H, or the user's Set top. Heuristic = remaining height / 0.42H, weight 1.4 (1.8 open feet), max 26k expansions per pass (16k open feet). Returns the best partial path when stuck. If neither pass reaches the top, a last relaxed pass lets a hand go up to 6% past ARM (a deadpoint, steep cost above 1.0 stretch; tip "push hard with your legs and catch the hold as you rise"). `res.stretch` marks it.
- The app (`solveNow`): if the route can't be finished on footholds of the route colour, it solves again with open feet (smears) and keeps that plan if it gets further, with a note in the move panel (`res.autoSmear`). Small footholds are often missed in pictures; this is what turns most "stuck at the start" routes into full plans.
- `buildBeta()` numbers holds by first use, writes captions ("Right hand → hold 7 · 45 cm up"), tips (push through the same-side foot and hang off the other hand, barn door and flag, long reach, match, rest, high step, smear, first step off the mat, footwork), and marks the crux (costliest hand move).

## The climber figure (drawClimber in src/app.js)

- Drawn from behind, facing the wall, as a white mannequin: capsules for limbs, a shaped torso with spine, shoulder blades, waistline and glutes, knee creases, the nape of the head, elbow points, and dark climbing shoes with the toe on the hold and the heel toward the viewer.
- Layer order is arms, then body, then head: seen from behind, the arms reach past the body toward the wall, so the back and head cover them where they overlap (a hand in front of the chest is hidden; its L/R badge still marks the hold).
- `chooseBody()` picks how the planner's pose is drawn: the hips may sink up to 0.15H (0.2H while a foot is on the mat, never closer than 0.22H above the higher foot) and the upper body leans up to 0.5 rad. Cost: lean away from half the angle to the hands, lean beyond 0.3 rad, sinking, a hand beyond arm's length, a hand closer to the head than about 1.25 head radii (more room above the head than beside it; a matched pair counts once), an arm segment overlapping the head (a lot when it crosses behind it, a little when a raised arm passes beside it), and a hand on the wrong side of the head around head height (not for matched hands). For a matched hold near the head this centres the head under it, both arms up in a diamond. Coarse-to-fine grid search, about 1-2 ms, memoized per pose. While a move animates, `bodyFor()` blends lean and sink between the two held positions so the torso never flips.
- The drawn arm is 0.96 x ARM (shoulder to hand centre, so a longer arm span draws longer arms); `reachJoint()` lifts the shoulder up to 0.05H toward a hand at full stretch, so a long reach looks like a reach. On an angled wall, `cmPx()` multiplies heights by cos(angle), so the climber is foreshortened like the wall.
- Elbows pick the outward-and-down solution; knees turn out. `bend3d()` keeps only part of the flat sideways swing (arms 0.55, legs 0.35) because real joints bend toward the wall.
- Each layer is filled, edge-shaded with an inner shadow from an inverted mask, then composited with drop shadows into an offscreen sprite that is only redrawn when the pose or view changes.

## App behaviour (src/app.js)

- Coordinates: holds are normalized (`u` = x / width, `v` = y / height, `rho` = radius / height). Wall marks `S.cal = {floor, top, marked}` in v units plus wall height in metres give `kU()` = height units per cm.
- Workers: a vision worker (`VisionCore` + `visionHandler`, messages `frame` / `classify` / `pick`, tagged with the source token so stale results are dropped) and a solver worker. Both fall back to running in the page if a Worker can't start.
- Tapping the wall: modes `pick` (learn the colour from the tapped hold), `none` (colour picked, no tool: a tap only nudges the tool buttons, so a stray tap can't re-learn the colour and change the path), and the tools `add` (add a missed hold on a still picture, keep a dashed amber one, or put back a crossed-out removed one), `remove`, `start` (one or two holds; tap again to unset), `top` (tap again to unset). The tools are disabled until a colour is picked; tapping the active tool turns it off; marking the wall returns to the previous mode. A new picture starts in `pick`; a frozen frame keeps the colour in `none`.
- Picking the colour again keeps the start, top and hold edits when it is the same route (`sameRoute()`: same colour name, or hue within the model's hue window and chroma ratio 0.55 to 1.8, or brightness for black/white/grey); a different colour clears them with a toast. Choosing a start or top also confirms that hold, so a later re-read can't drop it.
- Photo: analysed at 640 px long side. User edits (removed, kept, added, start, top) are stored as normalized positions so they survive re-detection; start and top match only the hold within 1.5 radii of the saved spot.
- Clip and live: requestAnimationFrame draws every frame; frames at 400 px go to the worker at most every 70 ms once a colour is chosen. Tracking matches blobs to tracks by nearest neighbour (gate max(0.03, 2.2 rho)) with a median-shift prediction and running averages; a track is shown after 3 hits. In live mode edits live on track ids, so: marked tracks (start, top, removed, kept) survive 30 missed scans instead of 7; a start or top stays in the plan through 12 missed scans; a dropped track is remembered for 15 s in `S.lost` (moved with the camera shift) and a blob that reappears there gets its old id and edits back; a dropped marked track hands its id to a new track already following the same hold. The beta is re-solved when the set of holds has been stable for 0.8 s and the player is not playing; the climber drawing follows camera drift. Freeze frame turns the current frame into a photo and carries edits and marks over.
- "Ask Claude" uses `window.claude.use('sample')` with an image; it only exists inside Claude and is hidden elsewhere. Call-outs use `speechSynthesis`. Height, arm span, wall height, wall angle and feet rule persist in `localStorage`.

## Commands

The owner works on Windows: use `python` (not `python3`); run `.sh` scripts in Git Bash.

```bash
python build.py                       # writes dist/beta-lens.html and dist/beta-lens-live.html
npm install                           # sharp, for the Node benchmark
bash test/make_media.sh               # once: clones the public test photos, builds test/media (needs git + ffmpeg with libvpx)
node test/eval.js                     # detection benchmark (new matcher)
npm run eval:old                      # same benchmark with the v1 hue-only matcher
node test/inspect.js img13 red        # explain every blob for one photo and colour
node test/plan.js                     # planner coverage, technique counts and figure checks on the benchmark routes
ANGLE=30 SPAN=180 node test/plan.js   # same on a 30° overhang with a 180 cm arm span (WALL=300, FEET=open also work)
OTHER=old/solver.js node test/plan.js # same, plus another solver.js's top count for comparison
pip install playwright && python -m playwright install chromium
python test/e2e.py                    # end-to-end checks on both builds, screenshots in test/out/e2e
```

To try the live camera locally: double-click `serve.bat` (or `cd dist && python -m http.server 8000`), then open http://localhost:8000/beta-lens-live.html (localhost counts as secure). On a phone use the GitHub Pages link, since phones need https.

## Status at handoff

- Benchmark (18 real gym photos, 35 tapped routes, tol 5): new matcher finds 66% of labelled route holds (old 61%); 84% of its holds are the right colour (old 74%); wrong-colour picks 11 (old 21); wall or background picks 32 (old 50). The photos have grey walls; the bigger gain is on painted or coloured walls (the sample wall's green panel is now rejected).
- Planner (`node test/plan.js`, 34 routes, photo height taken as 4.2 m, 170 cm climber, vertical): reaches the top on 25 (v1 planner 24), and on 33 with the app's smear fallback; over 140 moves 0 crossed hands (v1 7), 0 crossed feet (v1 1), 27 feet above the hips (v1 51), 5 flags (v1 11). With a 3 m scale 33 of 34 (v1 32); with open feet 32 (v1 29); on a 30° overhang 15, or 29 with smears. Figure: 1 lean over 0.45 rad, no arm behind the head, and 5 matched start holds at face height sitting just on top of the head, in 173 held positions.
- `test/e2e.py` (19 checks, including the tap tools, a start kept through a same-colour re-pick, Remove then Add, wall angle and arm span reaching the planner, and a live start hold that stays chosen): all pass, no console errors; live mode with the fake camera runs about 12 scans per second on a desktop CPU. The live camera session draws the same climber; playing the moves in live mode ran at about 33 frames per second in headless Chromium (the previous build: 30).
- Not yet verified: a real phone camera, iOS Safari, and whether claude.ai's viewer plays recorded clips (the clip uses a `blob:` video source).

## Constraints to keep

- One self-contained HTML file per build. The artifact viewer blocks camera, microphone, `alert/confirm/prompt`, downloads, `window.print`, and network requests to other hosts; scripts may only load from cdnjs, jsdelivr, unpkg, cdn.tailwindcss.com or code.jquery.com; stylesheets only from Google Fonts. Toggle visibility with the `hidden` attribute.
- Keep `VisionCore` and `solveBeta` free of outside references (they run inside workers via `toString()`).
- Colours come from CSS tokens on `:root` with the two dark-mode blocks; don't add literal colours to components.
- UI copy: plain words, active voice, short sentences; errors say what happened and what to do.
- After any detection change, run `node test/eval.js` and compare with the numbers above; after any planner or figure change, run `node test/plan.js` (keep the top count at least the v1 planner's); after any UI change, run `python test/e2e.py`.

## Known gaps and next ideas

- Holds the same colour as the wall cannot be separated by colour alone; dual-colour holds, heavy chalk and busy spray walls are weak spots.
- Wall marks are manual and ignore camera tilt; next: detect the mat line, and a 4-point perspective correction from the marks.
- Start tags (tape) are not detected; auto start = lowest reachable holds.
- Tracking has no zoom or rotation compensation; fast pans reset tracks.
- The wall angle is one number for the whole picture (real walls change angle part way up), and the solver still ignores hold quality, dynos beyond a 6% deadpoint, heel and toe hooks.
- Ideas: detect start and finish tags; save routes per gym (artifact `db` capability); pose tracking of a climber in the standalone build (for example MediaPipe Pose) to call out the next move while they climb; a PWA manifest so the standalone page installs on a phone.

Test photos come from the public KastnerRG/cse145-sp22-CSE237D_Rock_Climbing_Coach repository; they are fetched by `test/make_media.sh` and are not part of this project.
