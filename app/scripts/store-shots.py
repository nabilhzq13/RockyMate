"""Screenshots and graphics for the App Store and Google Play listings.

    cd app && npm install && npm run web     # builds app/www/index.html
    python app/scripts/store-shots.py

Writes app/store/:
  ios/NN-name.png      1320 x 2868, the 6.9-inch iPhone size App Store Connect asks for
  android/NN-name.png  1080 x 1920, phone screenshots (9:16) for Google Play
  feature-graphic.png  1024 x 500, Google Play's feature graphic
  icon-512.png         512 x 512, Google Play's icon (from app/assets/icon-only.png)
  iap-review.png       the Rocksane Pro sheet, for App Review's in-app purchase screenshot

The app runs in Chromium at iPhone size on the built-in sample wall, with a
stand-in for the native bridge that says Rocksane Pro is owned, so each
picture is the real app; a caption is set above it. RAW=1 also keeps the
plain screenshots in app/store/raw/.
"""
import asyncio, os, socket, subprocess, sys, time
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
WWW = ROOT / "app" / "www"
OUT = ROOT / "app" / "store"
RAW = OUT / "raw"
VIEW = {"width": 393, "height": 852}   # iPhone 16 / 17 points; captured at 3x

FAKE = """<script>
window.RocksaneNative={platform:'ios',
  haptics:{selection(){},impact(){},notify(){}},
  purchases:{async product(){return {price:'$4.99',title:'Rocksane Pro'}},async buy(){return {ok:true}},
    async restore(){return {owned:%(owned)s}},async owned(){return %(owned)s}},
  statusBar(){},onBack(){},onResume(){},open(){},ready(){}};
try{localStorage.setItem('betalens:pro','%(owned)s')}catch(e){}
</script>
<style>#badge{display:none!important}</style>
"""

# name, caption (the words in *stars* get the yellow tape)
SCENES = [
    ("wall", "Tap one hold. Get *every move* to the top"),
    ("moves", "Hand and foot moves, *with coaching tips*"),
    ("types", "Jug, crimp, sloper: *tell it the hold*"),
    ("example", "See *how to use* each kind of hold"),
    ("size", "A climber *your real size*"),
    ("learn", "New to bouldering? *Learn the basics*"),
]

def page_with_fake(owned):
    html = (WWW / "index.html").read_text(encoding="utf-8")
    i = html.index("<script>"); j = html.index("</script>", i) + len("</script>")
    assert "RocksaneNative" in html[i:j], "the first script should be the bridge"
    out = WWW / f"_store_{'pro' if owned else 'free'}.html"
    out.write_text(html[:i] + FAKE % {"owned": "true" if owned else "false"} + html[j:], encoding="utf-8")
    return out

async def settle(pg, ms=500):
    await pg.wait_for_function("!window.__betaLens.anim", timeout=15000)
    await pg.wait_for_timeout(ms)

async def detent(pg, want):
    for _ in range(4):
        if await pg.evaluate("document.querySelector('#bsheet').dataset.detent") == want:
            break
        await pg.click("#bsGrab"); await pg.wait_for_timeout(700)
    await pg.wait_for_timeout(400)

async def step(pg, i):
    await pg.evaluate("(i)=>document.querySelectorAll('#moves li button')[i].click()", i)
    await settle(pg)

async def tap_hold(pg, k):
    h = await pg.evaluate("""(k)=>{const S=window.__betaLens;
      const A=S.holds.filter(h=>!h.removed&&(h.manual||h.userOk||h.status==='hold')).sort((p,q)=>q.v-p.v);
      const h=A[k<0?A.length+k:k];return {u:h.u,v:h.v}}""", k)
    box = await pg.evaluate('()=>{const r=document.querySelector("#cv").getBoundingClientRect();return [r.left,r.top,r.width,r.height]}')
    await pg.mouse.click(box[0] + h["u"] * box[2], box[1] + h["v"] * box[3])

async def capture(base):
    shots = {}
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport=VIEW, device_scale_factor=3, has_touch=True, is_mobile=True, color_scheme="light")
        pg = await ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto(f"{base}/app/www/_store_pro.html")
        await pg.wait_for_function("window.__betaLens&&window.__betaLens.beta&&window.__betaLens.pro", timeout=30000)
        await pg.wait_for_timeout(800)

        async def snap(name):
            path = RAW / f"{name}.png"
            await pg.screenshot(path=str(path))
            shots[name] = path

        # the wall, part way up the route
        await step(pg, 7)
        await snap("wall")
        # the move list and the tips (half height)
        await step(pg, 4)
        await detent(pg, "half")
        await pg.evaluate("document.querySelector('#bsBody').scrollTop=0")
        await snap("moves")
        await detent(pg, "peek")
        # the hold type picker on a hold
        await step(pg, 0)
        await pg.click("#pTools [data-mode=type]"); await pg.wait_for_timeout(500)
        await tap_hold(pg, -6); await pg.wait_for_timeout(700)
        await snap("types")
        await pg.click("#tpClose"); await pg.wait_for_timeout(300)
        await pg.click("#pTools [data-mode=type]"); await pg.wait_for_timeout(300)
        # a technique example: the sloper
        await pg.click("#abLearn"); await pg.wait_for_timeout(900)
        await pg.evaluate("""()=>{const b=[...document.querySelectorAll('#holdGuide .hg')].find(r=>/sloper/i.test(r.textContent));b.querySelector('button').click()}""")
        await pg.wait_for_timeout(2600)
        await snap("example")
        await pg.keyboard.press("Escape"); await pg.wait_for_timeout(700)
        await pg.keyboard.press("Escape"); await pg.wait_for_timeout(700)
        # real size: the floor and top lines with the standing figure
        await pg.click("#pTools [data-mode=size]"); await pg.wait_for_timeout(900)
        await snap("size")
        await pg.click("#pTools [data-mode=size]"); await pg.wait_for_timeout(400)
        # Learn
        await pg.click("#abLearn"); await pg.wait_for_timeout(900)
        await snap("learn")
        await ctx.close()
        # the paywall, for App Review's in-app purchase screenshot
        ctx = await b.new_context(viewport=VIEW, device_scale_factor=3, has_touch=True, is_mobile=True, color_scheme="light")
        pg = await ctx.new_page()
        await pg.goto(f"{base}/app/www/_store_free.html")
        await pg.wait_for_function("window.__betaLens&&window.__betaLens.beta", timeout=30000)
        await pg.wait_for_timeout(600)
        await pg.click("#abNew"); await pg.wait_for_timeout(800)
        await pg.click("#goLive"); await pg.wait_for_timeout(1200)
        await pg.screenshot(path=str(OUT / "iap-review.png"))
        await b.close()
        if errs:
            print("page errors:", errs[:3])
    return shots

def caption_html(text):
    out, on = [], False
    for part in text.split("*"):
        if part:
            out.append(f"<b>{part}</b>" if on else part)
        on = not on
    return "".join(out)

COMPOSE = """<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{{font-family:"Barlow Condensed";font-weight:700;src:url(/app/www/fonts/barlow-condensed-latin-700-normal.woff2) format("woff2")}}
@font-face{{font-family:"Permanent Marker";src:url(/app/www/fonts/permanent-marker-latin-400-normal.woff2) format("woff2")}}
html,body{{margin:0;width:{W}px;height:{H}px;overflow:hidden;background:#14181c}}
body{{background:radial-gradient(120% 60% at 50% 0%,#252c33 0%,#14181c 70%)}}
.cap{{position:absolute;left:{pad}px;right:{pad}px;top:{ctop}px;height:{ch}px;display:flex;align-items:center;justify-content:center;text-align:center;
  color:#fff;font:700 {fs}px/1.06 "Barlow Condensed",sans-serif;text-transform:uppercase;letter-spacing:.01em}}
.cap b{{color:#14181c;background:#ffd43b;padding:0 .16em;margin:0 .04em;-webkit-box-decoration-break:clone;box-decoration-break:clone;border-radius:.06em}}
.shot{{position:absolute;left:50%;top:{stop}px;width:{sw}px;height:{sh}px;transform:translateX(-50%);border-radius:{rad}px;overflow:hidden;
  box-shadow:0 0 0 {bw}px #39424b,0 {sy}px {sb}px rgba(0,0,0,.55)}}
.shot img{{width:100%;height:100%;display:block}}
</style></head><body><div class="cap"><span>{cap}</span></div><div class="shot"><img src="{img}"></div></body></html>"""

FEATURE = """<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{{font-family:"Barlow Condensed";font-weight:700;src:url(/app/www/fonts/barlow-condensed-latin-700-normal.woff2) format("woff2")}}
@font-face{{font-family:"Barlow";font-weight:500;src:url(/app/www/fonts/barlow-latin-500-normal.woff2) format("woff2")}}
@font-face{{font-family:"Permanent Marker";src:url(/app/www/fonts/permanent-marker-latin-400-normal.woff2) format("woff2")}}
html,body{{margin:0;width:1024px;height:500px;overflow:hidden;background:radial-gradient(90% 120% at 20% 10%,#252c33 0%,#14181c 75%)}}
.col{{position:absolute;left:64px;top:0;bottom:0;width:540px;display:flex;flex-direction:column;justify-content:center;gap:28px}}
.logo{{align-self:flex-start;font:400 58px/1 "Permanent Marker",cursive;text-transform:uppercase;color:#14181c;background:#ffd43b;padding:14px 28px 8px;transform:rotate(-2.5deg);
  clip-path:polygon(0 6%,3% 0,97% 4%,100% 0,99% 94%,96% 100%,2% 96%,0 100%)}}
.tag{{color:#fff;font:700 50px/1.02 "Barlow Condensed",sans-serif;text-transform:uppercase}}
.sub{{color:#b9c2cb;font:500 23px/1.3 "Barlow",sans-serif;max-width:470px}}
.shot{{position:absolute;right:70px;top:38px;width:300px;height:600px;border-radius:30px;overflow:hidden;transform:rotate(4deg);
  box-shadow:0 0 0 6px #39424b,0 24px 60px rgba(0,0,0,.6)}}
.shot img{{width:100%;display:block}}
</style></head><body><div class="col"><div class="logo">Rocksane</div><div class="tag">Tap one hold.<br>Get the moves to the top.</div>
<div class="sub">Hand and foot beta for any colour route, drawn at your real size.</div></div>
<div class="shot"><img src="{img}"></div></body></html>"""

async def compose(base, shots):
    sizes = {
        "ios": dict(W=1320, H=2868, pad=90, ctop=120, ch=330, fs=118, stop=520, rad=74, bw=10, sy=40, sb=90, bottom=110),
        "android": dict(W=1080, H=1920, pad=70, ctop=70, ch=230, fs=80, stop=345, rad=52, bw=7, sy=26, sb=60, bottom=70),
    }
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for kind, s in sizes.items():
            (OUT / kind).mkdir(parents=True, exist_ok=True)
            pg = await b.new_page(viewport={"width": s["W"], "height": s["H"]}, device_scale_factor=1)
            sh = s["H"] - s["stop"] - s["bottom"]
            sw = round(sh * VIEW["width"] / VIEW["height"])
            for n, (name, cap) in enumerate(SCENES, 1):
                html = COMPOSE.format(cap=caption_html(cap), img=f"/app/store/raw/{name}.png", sh=sh, sw=sw, **s)
                f = OUT / f"_compose-{kind}-{name}.html"; f.write_text(html, encoding="utf-8")
                await pg.goto(f"{base}/app/store/{f.name}")
                await pg.wait_for_function("document.fonts.status==='loaded'&&document.images[0].complete")
                await pg.wait_for_timeout(150)
                await pg.screenshot(path=str(OUT / kind / f"{n:02d}-{name}.png"))
            await pg.close()
        pg = await b.new_page(viewport={"width": 1024, "height": 500}, device_scale_factor=1)
        (OUT / "_compose-feature.html").write_text(FEATURE.format(img="/app/store/raw/wall.png"), encoding="utf-8")
        await pg.goto(f"{base}/app/store/_compose-feature.html")
        await pg.wait_for_function("document.fonts.status==='loaded'&&document.images[0].complete")
        await pg.wait_for_timeout(150)
        await pg.screenshot(path=str(OUT / "feature-graphic.png"))
        await b.close()
    for f in OUT.glob("_compose-*.html"):
        f.unlink()

def flatten():
    """The stores want flat RGB images (no alpha channel)."""
    from PIL import Image
    for f in list((OUT / "ios").glob("*.png")) + list((OUT / "android").glob("*.png")) + [OUT / "feature-graphic.png", OUT / "iap-review.png"]:
        Image.open(f).convert("RGB").save(f, optimize=True)

def icon_512():
    from PIL import Image
    im = Image.open(ROOT / "app" / "assets" / "icon-only.png").convert("RGB")
    im.resize((512, 512), Image.LANCZOS).save(OUT / "icon-512.png", optimize=True)

def main():
    if not (WWW / "index.html").exists():
        sys.exit("Missing app/www/index.html. Run: cd app && npm install && npm run web")
    RAW.mkdir(parents=True, exist_ok=True)
    fakes = [page_with_fake(True), page_with_fake(False)]
    s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"],
                           cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    base = f"http://127.0.0.1:{port}"
    try:
        shots = asyncio.run(capture(base))
        asyncio.run(compose(base, shots))
        flatten()
        icon_512()
    finally:
        srv.terminate()
        for f in fakes:
            f.unlink(missing_ok=True)
        if not os.environ.get("RAW"):
            for f in RAW.glob("*.png"):
                f.unlink()
            RAW.rmdir()
    for f in sorted(OUT.rglob("*.png")):
        print(f.relative_to(ROOT), round(f.stat().st_size / 1024), "KB")

if __name__ == "__main__":
    main()
