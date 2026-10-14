# Beta Lens

A single-page web app for bouldering. The user points a phone at a gym wall (photo, recorded clip, or live camera), taps one hold of their route, and the app finds every hold of that colour, checks each one really is a hold and not the wall, then plans the hand and foot sequence to the top. It shows an animated stick climber, a numbered move list with coaching tips, and a "Learn to climb" tab for beginners.

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
- `test/` - Node detection benchmark and Python Playwright end-to-end checks (see Commands).

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

- Units: cm, Y up from the floor. Body from height H: arm reach 0.5H from a shoulder point TORSO = 0.3H above the hip, leg reach 0.56H. A pose is feasible if the hip fits inside the intersection of the reach disks (candidates: ideal hip, projections onto each disk, pairwise circle intersections). Pose cost = distance from the ideal hip + 10 x sum of (stretch - 0.75)^2 over limbs.
- A* over states (left hand, right hand, left foot, right foot) as point indices; a foot can be -1 (flag) or on floor points at the start. Starts: pairs among the 6 lowest holds between 0.35H and 1.3H, or the user's Set start holds. Both feet must leave the floor before a hand moves. Costs: foot 0.5 + 0.8 (d/LEG)^2 (+ smear, foot swap, high step, step down, crossed feet), flag 1.8, hand 1 + 0.6 (d/ARM)^2 (+ match, downward, cross-through) + pose cost. Heuristic = remaining height / 0.42H, weight 1.4 (1.8 with open feet). Max 26k expansions (16k open feet). Goal: both hands on the top hold. Top = highest hold you can chain to from the low holds within 1.1H (so a stray match on the ceiling is never the top), or the user's Set top. Returns the best partial path when stuck.
- `buildBeta()` numbers holds by first use, writes captions ("Right hand → hold 7 · 45 cm up"), tips (barn door and flag, long reach, cross-through, match, rest, high step, smear, first step off the mat, footwork), and marks the crux (costliest hand move).

## App behaviour (src/app.js)

- Coordinates: holds are normalized (`u` = x / width, `v` = y / height, `rho` = radius / height). Wall marks `S.cal = {floor, top, marked}` in v units plus wall height in metres give `kU()` = height units per cm.
- Workers: a vision worker (`VisionCore` + `visionHandler`, messages `frame` / `classify` / `pick`, tagged with the source token so stale results are dropped) and a solver worker. Both fall back to running in the page if a Worker can't start.
- Photo: analysed at 640 px long side. User edits (removed, kept, added, start, top) are stored as normalized positions so they survive re-detection.
- Clip and live: requestAnimationFrame draws every frame; frames at 400 px go to the worker at most every 70 ms once a colour is chosen. Tracking matches blobs to tracks by nearest neighbour (gate max(0.03, 2.2 rho)) with a median-shift prediction and running averages; a track is shown after 3 hits. The beta is re-solved when the set of holds has been stable for 0.8 s and the player is not playing; the climber drawing follows camera drift. Freeze frame turns the current frame into a photo and carries edits and marks over.
- "Ask Claude" uses `window.claude.use('sample')` with an image; it only exists inside Claude and is hidden elsewhere. Call-outs use `speechSynthesis`. Height, wall height and feet rule persist in `localStorage`.

## Commands

The owner works on Windows: use `python` (not `python3`); run `.sh` scripts in Git Bash.

```bash
python build.py                       # writes dist/beta-lens.html and dist/beta-lens-live.html
npm install                           # sharp, for the Node benchmark
bash test/make_media.sh               # once: clones the public test photos, builds test/media (needs git + ffmpeg with libvpx)
node test/eval.js                     # detection benchmark (new matcher)
npm run eval:old                      # same benchmark with the v1 hue-only matcher
node test/inspect.js img13 red        # explain every blob for one photo and colour
pip install playwright && python -m playwright install chromium
python test/e2e.py                    # end-to-end checks on both builds, screenshots in test/out/e2e
```

To try the live camera locally: double-click `serve.bat` (or `cd dist && python -m http.server 8000`), then open http://localhost:8000/beta-lens-live.html (localhost counts as secure). On a phone use the GitHub Pages link, since phones need https.

## Status at handoff

- Benchmark (18 real gym photos, 35 tapped routes, tol 5): new matcher finds 66% of labelled route holds (old 61%); 84% of its holds are the right colour (old 74%); wrong-colour picks 11 (old 21); wall or background picks 32 (old 50). The photos have grey walls; the bigger gain is on painted or coloured walls (the sample wall's green panel is now rejected).
- `test/e2e.py`: all checks pass, no console errors; live mode with the fake camera runs about 12 scans per second on a desktop CPU.
- Not yet verified: a real phone camera, iOS Safari, and whether claude.ai's viewer plays recorded clips (the clip uses a `blob:` video source).

## Constraints to keep

- One self-contained HTML file per build. The artifact viewer blocks camera, microphone, `alert/confirm/prompt`, downloads, `window.print`, and network requests to other hosts; scripts may only load from cdnjs, jsdelivr, unpkg, cdn.tailwindcss.com or code.jquery.com; stylesheets only from Google Fonts. Toggle visibility with the `hidden` attribute.
- Keep `VisionCore` and `solveBeta` free of outside references (they run inside workers via `toString()`).
- Colours come from CSS tokens on `:root` with the two dark-mode blocks; don't add literal colours to components.
- UI copy: plain words, active voice, short sentences; errors say what happened and what to do.
- After any detection change, run `node test/eval.js` and compare with the numbers above; after any UI change, run `python test/e2e.py`.

## Known gaps and next ideas

- Holds the same colour as the wall cannot be separated by colour alone; dual-colour holds, heavy chalk and busy spray walls are weak spots.
- Wall marks are manual and ignore camera tilt; next: detect the mat line, and a 4-point perspective correction from the marks.
- Start tags (tape) are not detected; auto start = lowest reachable holds.
- Tracking has no zoom or rotation compensation; fast pans reset tracks.
- The solver ignores wall angle, hold quality, dynos, heel and toe hooks.
- Ideas: detect start and finish tags; save routes per gym (artifact `db` capability); pose tracking of a climber in the standalone build (for example MediaPipe Pose) to call out the next move while they climb; a PWA manifest so the standalone page installs on a phone.

Test photos come from the public KastnerRG/cse145-sp22-CSE237D_Rock_Climbing_Coach repository; they are fetched by `test/make_media.sh` and are not part of this project.
