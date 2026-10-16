"""End-to-end checks in headless Chromium (Python Playwright).

    pip install playwright && playwright install chromium
    bash test/make_media.sh      # once, fetches photos and builds the clip and camera feed
    python build.py
    python test/e2e.py

A: the artifact build (dist/beta-lens.html): sample wall, the move's "How to
   use" button and the technique example, mask view, photo upload + tap, wall
   marks, the tap tools (add, remove, hold type, start, top; off until a
   colour is picked), wall angle and arm span, recorded clip, a hold type set
   on the clip carried into a frozen frame, the Learn tab hold guide.
B: the standalone build (dist/beta-lens-live.html) with Chromium's fake camera
   playing test/media/cam13.y4m; a start hold and a hold type chosen in live
   mode must stay.
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
# The hold types the user set, and the types the planner was given.
TYPES = '''()=>{const S=window.__betaLens,mv=S.src&&(S.src.kind==='video'||S.src.kind==='live'),hs=mv?S.tracks:S.holds,b=S.beta;
  return {edits:S.edits.types.map(t=>t.type),holds:hs.filter(h=>h.type).map(h=>[h.id,h.type]),
    planned:b?b.res.pts.filter(p=>p.type).map(p=>[p.id,p.type]):[],picker:!document.querySelector('#typePick').hidden}}'''
# The technique example: open?, its title, and how much of the canvas is the white climber.
DEMO = '''()=>{const d=document.querySelector('#demo'),c=document.querySelector('#demoCv');let n=0;
  if(!d.hidden&&c.width){const px=c.getContext('2d').getImageData(0,0,c.width,c.height).data;for(let i=0;i<px.length;i+=64) if(px[i]>236&&px[i+1]>236&&px[i+2]>230) n++;}
  return {open:!d.hidden,title:document.querySelector('#demoTitle').textContent,cap:document.querySelector('#demoCap').textContent,white:n,focus:document.activeElement&&document.activeElement.id}}'''

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
        # each move offers an example for its hold type
        how = []
        for _ in range(8):
            await pg.click("#next"); await pg.wait_for_timeout(300)
            how = await pg.evaluate('[...document.querySelectorAll("#capHow button")].map(b=>b.textContent)')
            if how: break
        await pg.click("#capHow button"); await pg.wait_for_timeout(1600)
        d = await pg.evaluate(DEMO)
        check("move: How to use opens the technique example", bool(how) and d["open"] and d["white"] > 40 and bool(d["cap"]), f"{how} -> {d['title']}, {d['white']} climber samples")
        await pg.screenshot(path=str(OUT / "a_demo.png"))
        await pg.keyboard.press("Escape"); await pg.wait_for_timeout(200)
        d = await pg.evaluate(DEMO)
        check("example: Escape closes it and returns focus", not d["open"] and d["focus"] != "demoClose")
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
        # Hold type: tap a hold, choose sloper; the planner gets it
        await pg.click("[data-mode=type]"); h4 = await pg.evaluate(HOLD, 3)
        await tap(pg, h4["u"], h4["v"]); await pg.wait_for_timeout(400)
        t0 = await pg.evaluate(TYPES)
        await pg.screenshot(path=str(OUT / "a_type_picker.png"))
        await pg.click("#tpGrid [data-type=sloper]"); await pg.wait_for_timeout(1800)
        t1 = await pg.evaluate(TYPES)
        check("hold type: picker opens and sloper reaches the planner", t0["picker"] and t1["edits"] == ["sloper"] and ["sloper"] == [t for _, t in t1["holds"]] and any(t == "sloper" for _, t in t1["planned"]), json.dumps(t1))
        await pg.click("#tpShow"); await pg.wait_for_timeout(1200)
        d = await pg.evaluate(DEMO)
        check("hold type: Show how plays the sloper example", d["open"] and "Slopers" in d["title"] and d["white"] > 40, d["title"])
        await pg.click("#demoClose"); await pg.wait_for_timeout(200)
        await pg.click("[data-mode=pick]"); await tap(pg, h2["u"], h2["v"]); await pg.wait_for_timeout(2500)
        t2 = await pg.evaluate(TYPES)
        check("hold type: kept when the same colour is picked again", t2["edits"] == ["sloper"] and any(t == "sloper" for _, t in t2["planned"]), json.dumps(t2["planned"]))
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
        await pg.click("[data-mode=type]"); h5 = await pg.evaluate(HOLD, 2)
        await tap(pg, h5["u"], h5["v"]); await pg.wait_for_timeout(300)
        await pg.click("#tpGrid [data-type=crimp]"); await pg.wait_for_timeout(500)
        await pg.click("#vFreeze")
        await pg.wait_for_function('window.__betaLens.src.kind==="photo"&&window.__betaLens.beta', timeout=20000)
        t3 = await pg.evaluate(TYPES)
        check("clip: freeze frame keeps colour and the hold type", (await pg.evaluate(STATE))["model"] == "red" and t3["edits"] == ["crimp"] and ["crimp"] == [t for _, t in t3["holds"]], json.dumps(t3["edits"]))
        # Learn tab: one row per hold type, each opens its example
        await pg.click("#tab-learn"); await pg.wait_for_timeout(300)
        rows = await pg.evaluate('document.querySelectorAll("#holdGuide .hg").length')
        await pg.click('#holdGuide .hg:nth-child(8) button'); await pg.wait_for_timeout(1500)
        d = await pg.evaluate(DEMO)
        check("learn: hold guide has 9 types and Show me plays one", rows == 9 and d["open"] and "Underclings" in d["title"] and d["white"] > 40, f"{rows} rows, {d['title']}")
        await pg.screenshot(path=str(OUT / "a_learn_demo.png"))
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
        await pg.click("[data-mode=type]")
        await pg.evaluate('document.querySelector("#cv").scrollIntoView({block:"start"})'); await pg.wait_for_timeout(300)
        h6 = await pg.evaluate(HOLD, -2)
        await tap(pg, h6["u"], h6["v"]); await pg.wait_for_timeout(300)
        await pg.click("#tpGrid [data-type=jug]")
        kept = True
        for _ in range(10):
            await pg.wait_for_timeout(500)
            t = await pg.evaluate(TYPES)
            kept = kept and [h6["id"], "jug"] in t["holds"]
        check("live: a hold type stays on the followed hold", kept and [h6["id"], "jug"] in t["planned"], json.dumps(t["holds"]))
        await pg.click("[data-mode=type]")
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
