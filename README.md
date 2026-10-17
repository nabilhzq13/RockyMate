# Rocksane

Point your phone at a bouldering wall, tap one hold of your route, and Rocksane finds the rest of that colour and shows the hand and foot moves to the top, on a climber drawn at your real size.

**Try it free in your browser:** https://nabilhzq13.github.io/RockyMate/
The iPhone and Android app is on its way to the App Store and Google Play (see `PUBLISHING.md`).

## On your phone

1. Open the link above in Safari (iPhone) or Chrome (Android).
2. Tap the camera icon, then **Take photo**. Stand back so the whole route fits, from the mats to the top of the wall.
3. Tap one hold of your route. The moves appear; tap **Play moves**, or the arrows to step through them.
4. To keep it on your home screen: Share → **Add to Home Screen**.

## Free and Pro

- **Free, everywhere:** photos, the colour reader, real-size planning, every move with tips, the Learn guide, and three technique examples (jug, crimp, sloper).
- **Rocksane Pro** (in the app, one purchase, no subscription): the live camera, recorded video, the Hold type tool and all nine technique examples. In the browser these buttons point to the app.

## Tips

- **Size:** Rocksane finds the floor and the top of the wall to draw the climber at your real size. If a photo is unusual, tap **Size** and drag the two lines onto the floor and the top of the wall.
- After picking the colour, choose **Add**, **Remove**, **Type**, **Start** or **Top**, then tap a hold. Tap **Colour** to pick a different route.
- **Show what matched** (pull up the sheet under the wall, Route colour) shows what was kept as a hold, what was the wall, and what was rejected.
- Set your height, **arm span**, the wall's height and its **angle** (slab or overhang) in Settings (on a computer: the About you box).
- **Hold type** (Pro): tap a hold and say what it is (jug, crimp, sloper, pinch, pocket, sidepull, gaston, undercling, volume). The plan and the tips change, and **Show how** plays an animated example. Every type is also in **Learn to climb**.

## Files

- `docs/` is the site GitHub Pages serves: the free web demo, plus the privacy, terms and support pages.
- `dist/beta-lens-live.html` is the full version (everything unlocked) for running locally: on Windows double-click `serve.bat`, then open http://localhost:8000/beta-lens-live.html.
- `dist/beta-lens.html` is the version that runs inside Claude (photo and recorded clip, no live camera).
- `app/` is the iPhone and Android app (`app/README.md`), and `PUBLISHING.md` is the step-by-step guide to both stores.

## Working on it

See `CLAUDE.md` for the architecture, commands and tests. In short: edit files in `src/`, run `python build.py`, run the tests, then commit and push.
