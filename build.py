#!/usr/bin/env python3
"""Assemble Rocksane from src/ into single-file pages, one per edition.

dist/beta-lens.html       artifact: the Claude artifact (photo + recorded clip, no live camera), everything unlocked
dist/beta-lens-live.html  dev: standalone with the live camera, everything unlocked (localhost or any https host)
dist/beta-lens-web.html   web: the free web demo; Rocksane Pro features point to the app stores
docs/index.html           web edition again, served by GitHub Pages from main /docs
app/www/index.html        app: the iPhone and Android app (Capacitor); Pro is a one-time in-app purchase.
                          Built only when app/ exists (see app/README.md); fonts are bundled, no network needed.

Every edition is the same code: app.js reads EDITION, and elements with
data-edition="web app" are shown only in those editions.
web/ holds the home-screen icons and the web app manifest; they are copied next to
the standalone pages in dist/ and docs/.
"""
import pathlib, shutil

root = pathlib.Path(__file__).parent
src = root / "src"
page = (src / "page.html").read_text(encoding="utf-8")
vision = (src / "vision.js").read_text(encoding="utf-8").replace("if(typeof module!=='undefined') module.exports=VisionCore;\n", "")
solver = (src / "solver.js").read_text(encoding="utf-8")
holds = (src / "holds.js").read_text(encoding="utf-8")
app = (src / "app.js").read_text(encoding="utf-8")
FONTS_LINK = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Barlow:wght@400;500;600;700&family=Permanent+Marker&display=swap">'
assert FONTS_LINK in page

def scripts(standalone: bool, edition: str, before: str = "") -> str:
    a = app.replace("const STANDALONE=false;", f"const STANDALONE={'true' if standalone else 'false'};", 1)
    a = a.replace("const EDITION='artifact';", f"const EDITION='{edition}';", 1)
    assert ("STANDALONE=true" in a) == standalone and f"const EDITION='{edition}';" in a
    return f"{before}<script>\n{vision}\n{solver}\n{holds}\n</script>\n<script>\n{a}\n</script>\n"

def write(path: pathlib.Path, text: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")

def standalone(edition: str, viewport: str, fonts: str = "", before: str = "", extra_head: str = "") -> str:
    """A complete document: the page's styles in <head>, the body after."""
    p = page if not fonts else page.replace(FONTS_LINK, fonts)
    full = p.replace("<!--SCRIPTS-->", scripts(True, edition, before))
    head_end = full.index("</style>") + len("</style>")
    head, body = full[:head_end], full[head_end:]
    head = head.replace('<meta name="claude:viewport-fit-sides" content="cover">\n', "")
    head = head.replace('<meta charset="utf-8">\n', "")
    return (
        '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        f'<meta name="viewport" content="{viewport}">\n'
        '<meta name="description" content="Point your phone at a bouldering wall, tap one hold, and get the hand and foot moves to the top.">\n'
        '<meta name="theme-color" content="#14181c">\n'
        + extra_head
        + '<style>body{margin:0}img{max-width:100%}</style>\n'
        + head + "\n</head>\n<body>\n" + body + "\n</body>\n</html>\n"
    )

WEB_HEAD = (
    '<meta name="mobile-web-app-capable" content="yes">\n'
    '<meta name="apple-mobile-web-app-capable" content="yes">\n'
    '<meta name="apple-mobile-web-app-title" content="Rocksane">\n'
    '<link rel="manifest" href="manifest.webmanifest">\n'
    '<link rel="apple-touch-icon" href="apple-touch-icon.png">\n'
    '<link rel="icon" type="image/png" href="favicon-48.png">\n'
)
VIEW = "width=device-width,initial-scale=1,viewport-fit=cover"

# Claude artifact: the platform wraps it in its own document skeleton.
write(root / "dist" / "beta-lens.html", page.replace("<!--SCRIPTS-->", scripts(False, "artifact")))
write(root / "dist" / "beta-lens-live.html", standalone("dev", VIEW, extra_head=WEB_HEAD))
web = standalone("web", VIEW, extra_head=WEB_HEAD)
write(root / "dist" / "beta-lens-web.html", web)
write(root / "docs" / "index.html", web)
write(root / "docs" / ".nojekyll", "")
for f in sorted((root / "web").iterdir()):
    for out in ("dist", "docs"):
        shutil.copy2(f, root / out / f.name)
built = ["dist/beta-lens.html", "dist/beta-lens-live.html", "dist/beta-lens-web.html", "docs/index.html"]

# The native app (Capacitor): bundled fonts and the bridge to the native plugins.
appdir = root / "app"
if (appdir / "capacitor.config.json").exists():
    fonts_css = appdir / "build" / "fonts.css"
    bridge = appdir / "build" / "bridge.js"
    if fonts_css.exists() and bridge.exists():
        www = appdir / "www"
        www.mkdir(exist_ok=True)
        fonts = "<style>\n" + fonts_css.read_text(encoding="utf-8") + "\n</style>"
        before = "<script>\n" + bridge.read_text(encoding="utf-8") + "\n</script>\n"
        write(www / "index.html", standalone("app", VIEW + ",user-scalable=no", fonts=fonts, before=before))
        fdir = appdir / "build" / "fonts"
        if fdir.exists():
            (www / "fonts").mkdir(exist_ok=True)
            for f in fdir.iterdir():
                shutil.copy2(f, www / "fonts" / f.name)
        built.append("app/www/index.html")
    else:
        print("app/: run `npm run fonts` and `npm run bridge` in app/ first (see app/README.md)")

for f in built:
    p = root / f
    print(f, round(p.stat().st_size / 1024, 1), "KB")
