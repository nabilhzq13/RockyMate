"""Draw the Rocksane app icon and splash screens as SVG and render them to PNG
with headless Chromium (Python Playwright), into app/assets/ for
`npx capacitor-assets generate` (which makes every iOS and Android size).

    python app/scripts/make-icons.py

icon-only.png        1024x1024, opaque (iOS masks the corners itself)
icon-foreground.png  1024x1024, transparent, the hold inside Android's 66% safe zone
icon-background.png  1024x1024, the yellow wall with bolt holes
splash.png / splash-dark.png  2732x2732, the icon on the app's background colour
The design matches web/icon-512.png: setter's-tape yellow, a dark jug with
its bolt, a right-hand badge and a left-foot badge.
"""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

OUT = Path(__file__).resolve().parents[1] / "assets"
OUT.mkdir(exist_ok=True)
YELLOW, INK, PINK, GREEN = "#ffd43b", "#14181c", "#ec3b74", "#58b52b"

def dots():
    return "".join(f'<circle cx="{84 + 170 * i}" cy="{84 + 170 * j}" r="11" fill="rgba(110,82,0,.42)"/>'
                   for i in range(6) for j in range(6))

HOLD = f'''
  <defs>
    <radialGradient id="hl" cx="0.36" cy="0.3" r="0.42"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <filter id="sh" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="10" dy="26" stdDeviation="22" flood-color="#000" flood-opacity=".3"/></filter>
  </defs>
  <g filter="url(#sh)">
    <path d="M206 372 C262 300 380 286 470 296 C560 306 640 350 720 382 C800 414 900 446 904 548 C908 650 830 760 700 798 C586 832 452 806 360 760 C268 714 214 640 186 560 C160 486 166 422 206 372 Z" fill="{INK}"/>
    <path d="M206 372 C262 300 380 286 470 296 C560 306 640 350 720 382 C800 414 900 446 904 548 C908 650 830 760 700 798 C586 832 452 806 360 760 C268 714 214 640 186 560 C160 486 166 422 206 372 Z" fill="url(#hl)"/>
  </g>
  <circle cx="514" cy="552" r="25" fill="none" stroke="{YELLOW}" stroke-width="13"/>
  <circle cx="808" cy="222" r="60" fill="{PINK}" stroke="#fff" stroke-width="13"/>
  <rect x="160" y="792" width="112" height="112" rx="10" fill="{GREEN}" stroke="#fff" stroke-width="13"/>
'''

def svg(size, body, bg=None):
    rect = f'<rect width="1024" height="1024" fill="{bg}"/>' if bg else ""
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 1024 1024">{rect}{body}</svg>'

ICON = svg(1024, dots() + HOLD, YELLOW)
FOREGROUND = svg(1024, f'<g transform="translate(512 512) scale(.6) translate(-512 -512)">{HOLD}</g>')
BACKGROUND = svg(1024, dots(), YELLOW)

def splash(bg):
    # the icon as a rounded tile, a fifth of the screen, on the app's background colour
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="2732" height="2732" viewBox="0 0 2732 2732">'
            f'<rect width="2732" height="2732" fill="{bg}"/>'
            f'<g transform="translate(1066 1066) scale(.586)"><clipPath id="c"><rect width="1024" height="1024" rx="230"/></clipPath>'
            f'<g clip-path="url(#c)"><rect width="1024" height="1024" fill="{YELLOW}"/>{dots()}{HOLD}</g></g></svg>')

async def render(page, markup, size, name, transparent=False):
    await page.set_viewport_size({"width": size, "height": size})
    await page.set_content(f'<html><body style="margin:0;background:transparent">{markup}</body></html>')
    await page.screenshot(path=str(OUT / name), omit_background=transparent, clip={"x": 0, "y": 0, "width": size, "height": size})
    print("wrote", OUT / name)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page()
        await render(pg, ICON, 1024, "icon-only.png")
        await render(pg, FOREGROUND, 1024, "icon-foreground.png", transparent=True)
        await render(pg, BACKGROUND, 1024, "icon-background.png")
        await render(pg, splash("#e7eaed"), 2732, "splash.png")
        await render(pg, splash("#101316"), 2732, "splash-dark.png")
        await b.close()

asyncio.run(main())
