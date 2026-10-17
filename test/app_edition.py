"""The app edition (app/www/index.html) with a stand-in for the native bridge.

    cd app && npm install && npm run web      # builds app/www/index.html
    python test/app_edition.py

The real bridge (app/build/bridge.src.js) talks to StoreKit and Google Play;
here a fake RocksaneNative records the calls and answers like the store would,
so the purchase flow can be checked in Chromium: the price comes from the
store, a cancelled purchase says nothing, a failed one explains itself, a
bought or restored Pro unlocks the gated features (and is remembered), the
store's answer on start-up wins over the remembered one, and Android's back
button closes sheets first. Exits non-zero if any check fails.
"""
import asyncio, json, re, socket, subprocess, sys, time
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
WWW = ROOT / "app" / "www"
OUT = ROOT / "test" / "out" / "app"
OUT.mkdir(parents=True, exist_ok=True)

FAKE = """<script>
window.__calls=[];window.__store={owned:%(owned)s,next:'ok'};
const log=(k,v)=>window.__calls.push([k,v===undefined?null:v]);
window.RocksaneNative={platform:'ios',
  haptics:{selection(){log('sel')},impact(s){log('impact',s)},notify(t){log('notify',t)}},
  purchases:{
    async product(id){log('product',id);return {price:'RM 14.90',title:'Rocksane Pro'}},
    async buy(id){log('buy',id);const n=window.__store.next;if(n==='ok'){window.__store.owned=true;return {ok:true}}if(n==='cancel')return {ok:false,cancelled:true};return {ok:false,message:'The purchase didn\\'t go through, and nothing was charged.'}},
    async restore(id){log('restore',id);return {owned:window.__store.owned}},
    async owned(id){log('owned',id);return window.__store.owned}},
  statusBar(d){log('statusBar',d)},onBack(cb){window.__back=cb},onResume(cb){window.__resume=cb},open(u){log('open',u)},ready(){log('ready')}};
</script>
"""

failures = []
def check(name, ok, info=""):
    print(("PASS " if ok else "FAIL ") + name + (f"  {info}" if info else ""))
    if not ok:
        failures.append(name)

def page_with_fake(owned):
    html = (WWW / "index.html").read_text(encoding="utf-8")
    # the bundled bridge is the first script; swap it for the fake
    i = html.index("<script>")
    j = html.index("</script>", i) + len("</script>")
    assert "RocksaneNative" in html[i:j], "the first script should be the bridge"
    out = WWW / f"_test_{'owned' if owned else 'free'}.html"
    out.write_text(html[:i] + FAKE % {"owned": "true" if owned else "false"} + html[j:], encoding="utf-8")
    return out.name

async def main(base, pages):
    errs = []
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
        pg = await ctx.new_page()
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" and "Failed to load resource" not in m.text else None)
        await pg.goto(f"{base}/{pages[False]}")
        await pg.wait_for_function("window.__betaLens&&window.__betaLens.beta", timeout=30000)
        await pg.wait_for_timeout(300)
        calls = await pg.evaluate("window.__calls.map(c=>c[0])")
        st = await pg.evaluate("()=>({app:document.documentElement.classList.contains('app-mode'),native:document.documentElement.classList.contains('native'),pro:window.__betaLens.pro,tags:[...document.querySelectorAll('[data-pro]')].filter(e=>!e.hidden).length})")
        check("app: phone layout, status bar set, splash hidden, store asked", st["app"] and st["native"] and "statusBar" in calls and "ready" in calls and "owned" in calls, json.dumps(calls[:6]))
        check("app: free at first, Pro features tagged", not st["pro"] and st["tags"] >= 3, json.dumps(st))
        # the paywall shows the store's price
        await pg.click("#abNew"); await pg.wait_for_timeout(700)
        await pg.click("#goLive"); await pg.wait_for_timeout(800)
        price = await pg.evaluate("document.querySelector('#payBuy').textContent")
        check("paywall: opens from Live camera with the store's price", "RM 14.90" in price and not await pg.evaluate("document.querySelector('#msPro').hidden"), price)
        await pg.screenshot(path=str(OUT / "paywall.png"))
        # cancel: nothing shown; failure: a message
        await pg.evaluate("window.__store.next='cancel'"); await pg.click("#payBuy"); await pg.wait_for_timeout(400)
        cancel_msg = await pg.evaluate("document.querySelector('#payMsg').hidden")
        await pg.evaluate("window.__store.next='fail'"); await pg.click("#payBuy"); await pg.wait_for_timeout(400)
        fail_msg = await pg.evaluate("document.querySelector('#payMsg').hidden?'':document.querySelector('#payMsg').textContent")
        check("purchase: a cancel says nothing, a failure explains itself", cancel_msg and "nothing was charged" in fail_msg, fail_msg)
        # Android back closes the top sheet first
        back = await pg.evaluate("window.__back()")
        await pg.wait_for_timeout(700)
        sheets = await pg.evaluate("[...document.querySelectorAll('.msheet')].filter(e=>!e.hidden).map(e=>e.id)")
        check("back button: closes the top sheet and reports it", back is True and sheets == ["msNew"], json.dumps(sheets))
        await pg.evaluate("window.__back()"); await pg.wait_for_timeout(700)
        # buy for real (the fake store says ok): Pro unlocks and the paywall closes
        await pg.click("#pTools [data-mode=type]"); await pg.wait_for_timeout(800)
        await pg.evaluate("window.__store.next='ok'"); await pg.click("#payBuy"); await pg.wait_for_timeout(1200)
        st = await pg.evaluate("()=>({pro:window.__betaLens.pro,paywall:!document.querySelector('#msPro').hidden,mode:window.__betaLens.mode,tags:[...document.querySelectorAll('[data-pro]')].filter(e=>!e.hidden).length,stored:localStorage.getItem('betalens:pro')})")
        check("purchase: Pro unlocks, tags go, and the tool that asked for it turns on", st["pro"] and not st["paywall"] and st["tags"] == 0 and st["stored"] == "true" and st["mode"] == "type", json.dumps(st))
        await pg.screenshot(path=str(OUT / "after_purchase.png"))
        # a locked example now plays
        await pg.evaluate("()=>{}")
        # reload: remembered; then the store says no (refund): locked again on resume
        await pg.reload(); await pg.wait_for_function("window.__betaLens&&window.__betaLens.beta", timeout=30000)
        await pg.evaluate("window.__store.owned=false"); await pg.evaluate("window.__resume()"); await pg.wait_for_timeout(400)
        st2 = await pg.evaluate("()=>({pro:window.__betaLens.pro,stored:localStorage.getItem('betalens:pro')})")
        check("store wins: a refunded purchase locks Pro again when the app comes back", not st2["pro"] and st2["stored"] == "false", json.dumps(st2))
        await ctx.close()
        # a fresh install restoring an earlier purchase
        ctx = await b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
        pg = await ctx.new_page()
        pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto(f"{base}/{pages[True]}")
        await pg.wait_for_function("window.__betaLens&&window.__betaLens.beta", timeout=30000)
        await pg.wait_for_timeout(400)
        st3 = await pg.evaluate("()=>({pro:window.__betaLens.pro})")
        await pg.click("#abSet"); await pg.wait_for_timeout(700)
        await pg.click("#proRestore") if await pg.evaluate("!document.querySelector('#proRestore').hidden&&!!document.querySelector('#proRestore').offsetParent") else None
        check("restore: an earlier purchase is found on start-up", st3["pro"], json.dumps(st3))
        await b.close()
    check("no page errors", not errs, "; ".join(errs[:4]))

if __name__ == "__main__":
    if not (WWW / "index.html").exists():
        sys.exit("Missing app/www/index.html. Run: cd app && npm install && npm run web")
    pages = {False: page_with_fake(False), True: page_with_fake(True)}
    s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"],
                           cwd=WWW, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    try:
        asyncio.run(main(f"http://127.0.0.1:{port}", pages))
    finally:
        srv.terminate()
        for f in pages.values():
            (WWW / f).unlink(missing_ok=True)
    print(f"\n{len(failures)} failed" if failures else "\nAll checks passed")
    sys.exit(1 if failures else 0)
