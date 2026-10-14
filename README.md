# Rocksane

Point your phone at a bouldering wall, tap one hold of your route, and Rocksane finds the rest of that colour and shows the hand and foot moves to the top.

**Open it:** https://nabilhzq13.github.io/RockyMate/

## On your phone

1. Open the link above in Safari (iPhone) or Chrome (Android).
2. Tap **Live camera** and allow the camera. Stand back so the whole route and the floor fit in frame.
3. Tap one hold of your route. Hold the phone steady for a second and the moves appear.
4. To keep it on your home screen: Share → **Add to Home Screen**.

## Tips

- Turn on **Show what matched** to see what was kept as a hold, what was the wall, and what was rejected.
- Tap **Mark wall bottom and top**, then tap where the wall meets the mat and the top of the wall, for correctly sized moves.
- **Freeze frame** stops on the current view so you can add or remove holds.

## Files

- `docs/index.html` is the site GitHub Pages serves.
- `dist/beta-lens-live.html` is the same page for running locally: on Windows double-click `serve.bat`, then open http://localhost:8000/beta-lens-live.html.
- `dist/beta-lens.html` is the version that runs inside Claude (photo and recorded clip, no live camera).

## Working on it

See `CLAUDE.md` for the architecture, commands and tests. In short: edit files in `src/`, run `python build.py`, run `python test/e2e.py`, then commit and push.
