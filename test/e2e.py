"""End-to-end checks in headless Chromium (Python Playwright).

    pip install playwright && playwright install chromium
    bash test/make_media.sh      # once, fetches photos and builds the clip and camera feed
    python build.py
    python test/e2e.py

A: the artifact build (dist/beta-lens.html): sample wall, mask view, photo
   upload + tap, wall marks, the tap tools (add, remove, start, top; off until
   a colour is picked), wall angle and arm span, recorded clip, freeze frame.
B: the standalone build (dist/beta-lens-live.html) with Chromium's fake camera
   playing test/media/cam13.y4m; a start hold chosen in live mode must stay.
Screenshots go to test/out/e2e. Exits non-zero if any check fails.
"""
import asyncio, json, socket, subprocess, sys, time
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
MEDIA = ROOT / "test" / "media"
OUT = ROOT / "test" / "out" / "e2e"
OUT.mkdir(parents=True, exist_ok=True)

STATE = """()=>{const S=window.__betaLens,mv=S.src&&(S.src.kind==='video'||S.src.kind==='live'),hs=mv?S.tracks:S.holds;
 return {kind:S.src&&S.src.kind,model:S.model&&S.model.name,
 active:hs.filter(h=>!h.removed&&(h.manual||h.userOk||h.status==='hold')).length,
 beta:S.beta?{ok:S.beta.ok,steps:S.beta.steps.length}:null,cal:S.cal,
 chips:[...document.querySelectorAll('#chips .chip')].map(c=>c.textContent),
 live:document.querySelector('#liveTxt').textContent}}"""

failures = []
def check(name, ok, info=""):
    print(("PASS " if ok else "FAIL ") + name + (f"  {info}" if info else ""))
    if not ok:
        failures.append(name)

async def tap(pg, u, v):
    box = await pg.evaluate('()=>{const r=document.querySelector("#cv").getBoundingClientRect();return [r.left,r.top,r.width,r.height]}')
    await pg.mouse.click(box[0] + u * box[2], box[1] + v * box[3])

# Active route holds, lowest first; index k picks one (negative from the top).
HOLD = '''(k)=>{const S=window.__betaLens,mv=S.src&&(S.src.kind==='video'||S.src.kind==='live');
  const A=(mv?S.tracks.filter(t=>t.hits>=3&&t.miss<=2):S.holds).filter(h=>!h.removed&&(h.manual||h.userOk||h.status==='hold')&&h.v<=S.cal.floor).sort((p,q)=>q.v-p.v);
  const h=A[k<0?A.length+k:k];return h?{id:h.id,u:h.u,v:h.v}:null}'''
# Edits, and the positions of the holds the plan starts on.
EDITS = '''()=>{const S=window.__betaLens,E=S.edits,b=S.beta,s0=b&&b.res.steps[0],mv=S.src&&(S.src.kind==='video'||S.src.kind==='live');
  const hs=mv?S.tracks:S.holds,at=id=>{const h=hs.find(x=>x.id===id);return h?[h.u,h.v]:null};
  return {mode:S.mode,model:S.model&&S.model.name,start:E.start.length,startT:E.startT.slice(),top:!!E.top,removed:E.removed.length,
    active:hs.filter(h=>!h.removed&&(h.manual||h.userOk||h.status==='hold')).length,
    startAt:s0?[at(b.res.pts[s0.lh].id),at(b.res.pts[s0.rh].id)]:[],startIds:s0?[b.res.pts[s0.lh].id,b.res.pts[s0.rh].id]:[],
    tools:[...document.querySelectorAll('#tools button')].map(x=>x.disabled),angle:b&&b.res.angle,arm:b&&Math.round(b.res.ARM)}}'''
near = lambda p, h: p is not None and abs(p[0] - h['u']) < 0.03 and abs(p[1] - h['v']) < 0.03

def watch(pg, errs, tag):
    pg.on("pageerror", lambda e: errs.append(f"{tag} pageerror: {e}"))
    pg.on("console", lambda m: errs.append(f"{tag} console: {m.text}")
          if m.type == "error" and "Failed to load resource" not in m.text else None)

async def main(base):
    errs = []
    async with async_playwright() as p:
        # ---------- A: artifact build ----------
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width": 1280, "height": 900})
        watch(pg, errs, "A")
        await pg.goto(base + "/beta-lens.html")
        await pg.wait_for_function("window.__betaLens&&window.__betaLens.beta", timeout=30000)
        st = await pg.evaluate(STATE)
        check("sample: 15 green holds", st["model"] == "green" and st["active"] == 15, json.dumps(st["active"]))
        check("sample: beta reaches the top", bool(st["beta"] and st["beta"]["ok"]))
        await pg.click("#showMask"); await pg.wait_for_timeout(1200)
        await pg.screenshot(path=str(OUT / "a_sample_mask.png"))
        await pg.click("#showMask"); await pg.wait_for_timeout(400)

        await pg.set_input_files("#fileUp", str(MEDIA / "wall13.jpg"))
        await pg.wait_for_function('window.__betaLens.src.kind==="photo"&&window.__betaLens.suggest.length>0', timeout=30000)
        st = await pg.evaluate(STATE)
        check("photo: colour chips suggested", len(st["chips"]) >= 2, ", ".join(st["chips"]))
        check("tools: off until a colour is picked", all((await pg.evaluate(EDITS))["tools"]))
        await tap(pg, 0.374, 0.534)
        await pg.wait_for_function("window.__betaLens.model&&window.__betaLens.beta", timeout=30000)
        st = await pg.evaluate(STATE)
        check("photo: tapped red hold gives red holds + beta", st["model"] == "red" and st["active"] >= 5, f"{st['active']} holds")
        await pg.click("#markWall"); await pg.wait_for_timeout(300)
        await tap(pg, 0.5, 0.745); await pg.wait_for_timeout(200)
        await tap(pg, 0.5, 0.03); await pg.wait_for_timeout(1200)
        st = await pg.evaluate(STATE)
        check("photo: wall marks saved", st["cal"]["marked"] and abs(st["cal"]["floor"] - 0.745) < 0.02, json.dumps(st["cal"]))
        check("photo: beta after marks", bool(st["beta"] and st["beta"]["ok"]))
        await pg.click("#play"); await pg.wait_for_timeout(3000); await pg.click("#play")
        await pg.screenshot(path=str(OUT / "a_photo_marked.png"))

        # the tap tools
        e0 = await pg.evaluate(EDITS)
        check("tools: on once a colour is picked", not any(e0["tools"]) and e0["mode"] == "none")
        h = await pg.evaluate(HOLD, 2)
        await tap(pg, h["u"], h["v"]); await pg.wait_for_timeout(600)
        e1 = await pg.evaluate(EDITS)
        check("tools: a tap with no tool chosen changes nothing", e1["model"] == "red" and e1["start"] == 0 and e1["removed"] == 0)
        await pg.click("[data-mode=start]"); await tap(pg, h["u"], h["v"]); await pg.wait_for_timeout(1800)
        e2 = await pg.evaluate(EDITS)
        check("tools: Set start fixes the start hold", e2["start"] == 1 and any(near(p, h) for p in e2["startAt"]), json.dumps(e2["startAt"]))
        await pg.click("[data-mode=pick]"); h2 = await pg.evaluate(HOLD, -1)
        await tap(pg, h2["u"], h2["v"]); await pg.wait_for_timeout(2500)
        e3 = await pg.evaluate(EDITS)
        check("tools: picking the same colour again keeps the start", e3["model"] == "red" and e3["start"] == 1 and any(near(p, h) for p in e3["startAt"]))
        await pg.click("[data-mode=remove]"); h3 = await pg.evaluate(HOLD, -2)
        await tap(pg, h3["u"], h3["v"]); await pg.wait_for_timeout(1500)
        e4 = await pg.evaluate(EDITS)
        await pg.click("[data-mode=add]"); await tap(pg, h3["u"], h3["v"]); await pg.wait_for_timeout(1500)
        e5 = await pg.evaluate(EDITS)
        check("tools: Remove hold, then Add hold puts it back", e4["removed"] == 1 and e4["active"] == e3["active"] - 1 and e5["removed"] == 0 and e5["active"] == e3["active"])
        await pg.click("[data-mode=add]")
        await pg.select_option("#angle", "30"); await pg.fill("#span", "190"); await pg.dispatch_event("#span", "change"); await pg.wait_for_timeout(2000)
        e6 = await pg.evaluate(EDITS)
        check("wall angle and arm span reach the planner", e6["angle"] == 30 and e6["arm"] == 95, f"angle {e6['angle']}, arm {e6['arm']} cm")
        await pg.select_option("#angle", "0"); await pg.fill("#span", ""); await pg.dispatch_event("#span", "change"); await pg.wait_for_timeout(1500)
        await pg.click("[data-mode=pick]"); await tap(pg, 0.374, 0.534); await pg.wait_for_timeout(2000)   # back to the first red model for the clip

        await pg.set_input_files("#fileUp", str(MEDIA / "clip13.webm"))
        await pg.wait_for_function('window.__betaLens.src.kind==="video"', timeout=15000)
        await pg.wait_for_function("window.__betaLens.beta", timeout=25000)
        await pg.wait_for_timeout(1500)
        st = await pg.evaluate(STATE)
        check("clip: holds tracked + beta", st["active"] >= 5 and bool(st["beta"]), f"{st['active']} holds, {st['live']}")
        await pg.screenshot(path=str(OUT / "a_clip.png"))
        await pg.click("#vFreeze")
        await pg.wait_for_function('window.__betaLens.src.kind==="photo"&&window.__betaLens.beta', timeout=20000)
        check("clip: freeze frame keeps colour", (await pg.evaluate(STATE))["model"] == "red")
        await b.close()

        # ---------- B: standalone build with a fake camera ----------
        b = await p.chromium.launch(args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
                                          "--use-file-for-fake-video-capture=" + str(MEDIA / "cam13.y4m")])
        ctx = await b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, permissions=["camera"])
        pg = await ctx.new_page()
        watch(pg, errs, "B")
        await pg.goto(base + "/beta-lens-live.html")
        await pg.wait_for_function("window.__betaLens&&window.__betaLens.beta", timeout=30000)
        await pg.click("#goLive")
        await pg.wait_for_function('window.__betaLens.src.kind==="live"', timeout=15000)
        await pg.wait_for_timeout(1500)
        await tap(pg, 0.374, 0.535)
        try:
            await pg.wait_for_function('window.__betaLens.model&&window.__betaLens.model.name==="red"&&window.__betaLens.beta', timeout=25000)
        except Exception:
            pass
        await pg.wait_for_timeout(1200)
        st = await pg.evaluate(STATE)
        check("live: red holds tracked + beta", st["model"] == "red" and st["active"] >= 5 and bool(st["beta"]), f"{st['active']} holds, {st['live']}")
        await pg.click("[data-mode=start]")
        await pg.evaluate('document.querySelector("#cv").scrollIntoView({block:"start"})'); await pg.wait_for_timeout(300)
        h = await pg.evaluate(HOLD, 1)
        await tap(pg, h["u"], h["v"])
        kept = True
        for _ in range(12):
            await pg.wait_for_timeout(500)
            e = await pg.evaluate(EDITS)
            kept = kept and h["id"] in e["startT"]
        check("live: a chosen start hold stays chosen", kept and h["id"] in e["startIds"], f"start {e['startT']}, plan starts on {e['startIds']}")
        await pg.click("[data-mode=start]")
        await pg.click("#play"); await pg.wait_for_timeout(2300)
        await pg.screenshot(path=str(OUT / "b_live.png"))
        await b.close()
    check("no page or console errors", not errs, "; ".join(errs[:5]))
    check("docs/index.html matches the live build",
          (ROOT / "docs" / "index.html").read_bytes() == (ROOT / "dist" / "beta-lens-live.html").read_bytes())

if __name__ == "__main__":
    for f in ("wall13.jpg", "clip13.webm", "cam13.y4m"):
        if not (MEDIA / f).exists():
            sys.exit(f"Missing test/media/{f}. Run: bash test/make_media.sh")
    s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"],
                           cwd=ROOT / "dist", stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    try:
        asyncio.run(main(f"http://127.0.0.1:{port}"))
    finally:
        srv.terminate()
    print(f"\n{len(failures)} failed" if failures else "\nAll checks passed")
    sys.exit(1 if failures else 0)
