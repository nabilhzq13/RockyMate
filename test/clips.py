"""Recorded clips of other walls, read the way a user would (Python Playwright).

    bash test/make_media.sh      # builds clip1, clip5, clip11, clip17 and their photos
    python build.py
    python test/clips.py

For each wall: the photo alone (pick the colour from its chip), then a fresh
page with only the clip (each one moves the camera differently: zoom, drift,
an unsteady hand, a vertical pan). In the clip the colour is chosen from the
chips the app suggests while it plays. Reports holds found, whether the plan
reaches the top, scans per second, how often the set of followed holds
changes (flicker), how often the plan changed, the frame rate while the moves
play, and what a frozen frame gives. Screenshots go to test/out/clips.
"""
import asyncio, json, socket, statistics, subprocess, sys, time
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
MEDIA = ROOT / "test" / "media"
OUT = ROOT / "test" / "out" / "clips"
OUT.mkdir(parents=True, exist_ok=True)
# wall, route colour, the chip names that colour may get (golden yellow can read as orange), camera movement
WALLS = [("1", "blue", ("blue",), "zoom in"), ("5", "yellow", ("yellow", "orange"), "diagonal drift"),
         ("11", "green", ("green", "dark green"), "unsteady hand"), ("17", "blue", ("blue",), "vertical pan")]

STATE = """()=>{const S=window.__betaLens,mv=S.src&&(S.src.kind==='video'||S.src.kind==='live');
  const hs=mv?S.tracks.filter(t=>t.hits>=3&&t.miss<=2):S.holds,act=hs.filter(h=>!h.removed&&(h.manual||h.userOk||h.status==='hold'));
  return {kind:S.src.kind,model:S.model&&S.model.name,active:act.length,ids:act.map(h=>h.id).sort((a,b)=>a-b).join(','),
    beta:S.beta?{ok:S.beta.ok,moves:S.beta.steps.length-1,smear:!!S.beta.res.autoSmear}:null,live:document.querySelector('#liveTxt').textContent,
    chips:[...document.querySelectorAll('#chips .chip')].map(c=>c.textContent)}}"""

async def pick_chip(pg, names, timeout=20):
    t0 = time.time()
    while time.time() - t0 < timeout:
        chips = await pg.query_selector_all("#chips .chip")
        for c in chips:
            txt = (await c.text_content() or "").strip().lower()
            if any(txt.split("·")[0].strip() == n for n in names):
                await c.click()
                return txt
        await pg.wait_for_timeout(400)
    return None

async def run(base):
    rows, errs = [], []
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for n, colour, names, motion in WALLS:
            # the photo
            pg = await b.new_page(viewport={"width": 1280, "height": 900})
            pg.on("pageerror", lambda e: errs.append(str(e)))
            await pg.goto(base + "/beta-lens.html")
            await pg.wait_for_function("window.__betaLens&&window.__betaLens.beta", timeout=30000)
            await pg.set_input_files("#fileUp", str(MEDIA / f"wall{n}.jpg"))
            await pg.wait_for_function('window.__betaLens.src.kind==="photo"&&window.__betaLens.suggest.length>0', timeout=30000)
            chip = await pick_chip(pg, names)
            await pg.wait_for_timeout(2500)
            ph = await pg.evaluate(STATE)
            await pg.screenshot(path=str(OUT / f"wall{n}_photo.png"))
            await pg.close()
            # the clip, on a fresh page
            pg = await b.new_page(viewport={"width": 1280, "height": 900})
            pg.on("pageerror", lambda e: errs.append(str(e)))
            await pg.goto(base + "/beta-lens.html")
            await pg.wait_for_function("window.__betaLens&&window.__betaLens.beta", timeout=30000)
            await pg.set_input_files("#fileUp", str(MEDIA / f"clip{n}.webm"))
            await pg.wait_for_function('window.__betaLens.src.kind==="video"', timeout=15000)
            t0 = time.time()
            chip2 = await pick_chip(pg, names)
            first = None
            try:
                await pg.wait_for_function("window.__betaLens.beta", timeout=25000)
                first = round(time.time() - t0, 1)
            except Exception:
                pass
            # watch for 6 s: followed holds, flicker, plan changes
            await pg.evaluate("window.__plans=0;window.__lastBeta=window.__betaLens.beta;window.__pt=setInterval(()=>{if(window.__betaLens.beta!==window.__lastBeta){window.__plans++;window.__lastBeta=window.__betaLens.beta;}},50)")
            seen, changes, last = [], 0, None
            for _ in range(24):
                await pg.wait_for_timeout(250)
                s = await pg.evaluate(STATE)
                seen.append(s)
                if last is not None and s["ids"] != last: changes += 1
                last = s["ids"]
            plans = await pg.evaluate("window.__plans")
            mid = seen[-1]
            await pg.screenshot(path=str(OUT / f"clip{n}.png"))
            # play the moves and count drawn frames
            fps = None
            if mid["beta"]:
                await pg.click("#play")
                fps = await pg.evaluate("new Promise(r=>{let n=0;const t0=performance.now();(function f(){n++;if(performance.now()-t0<3000)requestAnimationFrame(f);else r(Math.round(n*1000/(performance.now()-t0)));})();})")
                await pg.screenshot(path=str(OUT / f"clip{n}_playing.png"))
                await pg.click("#play")
            await pg.click("#vFreeze")
            try:
                await pg.wait_for_function('window.__betaLens.src.kind==="photo"&&window.__betaLens.beta', timeout=20000)
            except Exception:
                pass
            await pg.wait_for_timeout(1000)
            fz = await pg.evaluate(STATE)
            await pg.screenshot(path=str(OUT / f"clip{n}_frozen.png"))
            await pg.close()
            rows.append(dict(wall=f"img{n}", colour=colour, motion=motion, chip_photo=chip, chip_clip=chip2,
                             photo_holds=ph["active"], photo_plan=ph["beta"], first_plan_s=first,
                             clip_holds=statistics.median(s["active"] for s in seen), flicker=changes, replans=plans,
                             clip_plan=mid["beta"], scans=mid["live"], play_fps=fps, frozen_holds=fz["active"], frozen_plan=fz["beta"]))
        await b.close()
    return rows, errs

def plan_txt(b):
    if not b: return "none"
    return ("top" if b["ok"] else "stuck") + f", {b['moves']} moves" + (", smears" if b["smear"] else "")

if __name__ == "__main__":
    for n, *_ in WALLS:
        for f in (f"wall{n}.jpg", f"clip{n}.webm"):
            if not (MEDIA / f).exists():
                sys.exit(f"Missing test/media/{f}. Run: bash test/make_media.sh")
    s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"],
                           cwd=ROOT / "dist", stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    try:
        rows, errs = asyncio.run(run(f"http://127.0.0.1:{port}"))
    finally:
        srv.terminate()
    print(f"{'wall':6} {'colour':7} {'camera':15} {'photo':>6} {'photo plan':20} {'clip':>5} {'first plan':>10} {'flicker':>7} {'replans':>7} {'clip plan':20} {'scans':18} {'play fps':>8} {'frozen':>6} frozen plan")
    for r in rows:
        print(f"{r['wall']:6} {r['colour']:7} {r['motion']:15} {r['photo_holds']:>6} {plan_txt(r['photo_plan']):20} {r['clip_holds']:>5} "
              f"{(str(r['first_plan_s'])+' s') if r['first_plan_s'] is not None else 'none':>10} {r['flicker']:>7} {r['replans']:>7} {plan_txt(r['clip_plan']):20} "
              f"{r['scans']:18} {str(r['play_fps']):>8} {r['frozen_holds']:>6} {plan_txt(r['frozen_plan'])}")
    (OUT / "results.json").write_text(json.dumps(rows, indent=1))
    print("errors:", errs[:5] if errs else "none")
    bad = [r for r in rows if not r["clip_plan"] or not r["chip_clip"]] + (["errors"] if errs else [])
    sys.exit(1 if bad else 0)
