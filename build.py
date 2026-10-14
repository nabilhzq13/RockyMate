#!/usr/bin/env python3
"""Assemble Beta Lens from src/ into single-file pages.

dist/beta-lens.html       the Claude artifact build (photo + recorded clip, no live camera)
dist/beta-lens-live.html  the standalone build with the live camera (needs https or localhost)
docs/index.html           the standalone build again, served by GitHub Pages from main /docs

web/ holds the home-screen icons and the web app manifest; they are copied next to
the standalone build in dist/ and docs/.
"""
import pathlib, shutil

root = pathlib.Path(__file__).parent
src = root / "src"
page = (src / "page.html").read_text(encoding="utf-8")
vision = (src / "vision.js").read_text(encoding="utf-8").replace("if(typeof module!=='undefined') module.exports=VisionCore;\n", "")
solver = (src / "solver.js").read_text(encoding="utf-8")
app = (src / "app.js").read_text(encoding="utf-8")

def scripts(standalone: bool) -> str:
    a = app.replace("const STANDALONE=false;", f"const STANDALONE={'true' if standalone else 'false'};", 1)
    assert ("STANDALONE=true" in a) == standalone
    return f"<script>\n{vision}\n{solver}\n</script>\n<script>\n{a}\n</script>\n"

def write(path: pathlib.Path, text: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")

# Claude artifact build: the platform wraps it in its own document skeleton.
write(root / "dist" / "beta-lens.html", page.replace("<!--SCRIPTS-->", scripts(False)))

# Standalone build: a complete document with icons for Add to Home Screen.
full = page.replace("<!--SCRIPTS-->", scripts(True))
head_end = full.index("</style>") + len("</style>")
head, body = full[:head_end], full[head_end:]
head = head.replace('<meta name="claude:viewport-fit-sides" content="cover">\n', "")
head = head.replace('<meta charset="utf-8">\n', "")
standalone = (
    '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
    '<meta name="description" content="Point your phone at a bouldering wall, tap one hold, and get the hand and foot moves to the top.">\n'
    '<meta name="theme-color" content="#14181c">\n'
    '<meta name="mobile-web-app-capable" content="yes">\n'
    '<meta name="apple-mobile-web-app-capable" content="yes">\n'
    '<meta name="apple-mobile-web-app-title" content="Beta Lens">\n'
    '<link rel="manifest" href="manifest.webmanifest">\n'
    '<link rel="apple-touch-icon" href="apple-touch-icon.png">\n'
    '<link rel="icon" type="image/png" href="favicon-48.png">\n'
    '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}'
    'body{margin:0}img{max-width:100%}</style>\n'
    + head + "\n</head>\n<body>\n" + body + "\n</body>\n</html>\n"
)
write(root / "dist" / "beta-lens-live.html", standalone)
write(root / "docs" / "index.html", standalone)
write(root / "docs" / ".nojekyll", "")
for f in sorted((root / "web").iterdir()):
    for out in ("dist", "docs"):
        shutil.copy2(f, root / out / f.name)

for f in ("dist/beta-lens.html", "dist/beta-lens-live.html", "docs/index.html"):
    p = root / f
    print(f, round(p.stat().st_size / 1024, 1), "KB")
