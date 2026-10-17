# Rocksane for iPhone and Android

The phone app is the same Rocksane page as the website, inside a native shell
([Capacitor 8](https://capacitorjs.com/docs)). The shell adds what a web page
can't do well: haptics, the status bar, the Android back button, a splash
screen, the app icon, and the one-time **Rocksane Pro** purchase through the
App Store (StoreKit 2) and Google Play (Play Billing Library 9).

| | |
|---|---|
| App name | Rocksane |
| Bundle id / package | `io.github.nabilhzq13.rocksane` |
| In-app purchase | `rocksane_pro`, non-consumable (one-time) |
| Version | `"version"` in `app/package.json` (shown in Settings; the cloud builds use it for the stores) |
| iOS | iPhone only, portrait, iOS 15 or later, built with Xcode 26 |
| Android | phones and tablets, portrait, Android 7 (API 24) or later, targets API 36 |

## How it fits together

```
src/*.js + src/page.html ──build.py──▶ app/www/index.html   (EDITION='app')
app/build/bridge.src.js ──esbuild──▶ app/build/bridge.js    (window.RocksaneNative, first script in the page)
@fontsource fonts ──make-fonts──▶ app/www/fonts/            (no network needed)
app/www ──cap sync──▶ ios/App/App/public and android/app/src/main/assets/public
```

`src/app.js` reads `EDITION`. In the app edition it uses the phone layout
(sheets, springs, the bottom sheet with detents), asks the bridge for the
price, buy and restore, and checks the store on start-up and whenever the
app comes back (a refund locks Pro again). Free: photos, the colour reader,
real-size planning, the moves, Learn and three technique examples. Pro: the
live camera, video, the Hold type tool and all nine technique examples.

## Commands (run in `app/`)

```bash
npm install          # once (Node 22 or later)
npm run web          # fonts + bridge + build.py → www/index.html
npm run sync         # web, then copy it into the iOS and Android projects (cap sync)
npm run android      # sync, then open Android Studio (Windows, Mac or Linux)
npm run ios          # sync, then open Xcode (Mac only)
python scripts/make-icons.py && npm run assets   # redraw the icon and splash, make every size
```

On Windows you can build and run the Android app yourself: install
[Android Studio](https://developer.android.com/studio), run `npm run android`,
then press Run with a phone plugged in (USB debugging on) or an emulator.
The iPhone app needs Xcode, which only runs on a Mac, so it is built in the
cloud instead (below).

## Cloud builds (no Mac needed)

- **GitHub Actions** (`.github/workflows/app.yml`, free for this public repository):
  on every push that touches `src/` or `app/`, an Android test APK
  (install it on an Android phone to try the app) and, once the upload key is in
  the repository secrets, the signed `.aab` for Google Play; plus an unsigned
  iPhone simulator build that proves the Xcode project still compiles.
- **Codemagic** (`codemagic.yaml`, 500 free macOS minutes a month): the signed
  iPhone build, uploaded to App Store Connect / TestFlight, and the signed
  Android bundle, uploaded to Google Play's internal testing track.

`PUBLISHING.md` in the repository root has the step-by-step setup for both
stores, the accounts, the price, the store listing and the review checklist.

## Testing

```bash
python test/app_edition.py   # from the repository root; needs npm run web first
```

It swaps the bridge for a stand-in store and checks, in Chromium at iPhone
size: the price comes from the store, a cancelled purchase says nothing, a
failed one explains itself, a purchase unlocks the tool that asked for it, a
refund locks Pro again, a fresh install restores an earlier purchase, and the
Android back button closes sheets first.

On a real phone, test purchases with a Sandbox Apple Account (App Store
Connect → Users and Access → Sandbox) on a TestFlight build, and with a
licence tester (Play Console → Settings → License testing) on an internal
testing build. Neither charges money.

## Files

- `capacitor.config.json` - app id, name, the splash screen (hidden by the page
  when it is ready), the system bars (`insetsHandling: css`, so the page gets
  `--safe-area-inset-*`), no overscroll on iOS.
- `build/bridge.src.js` - `window.RocksaneNative`: haptics, purchases,
  status bar, back button, resume, in-app browser for links, splash.
- `scripts/make-fonts.mjs`, `scripts/build-web.mjs`, `scripts/make-icons.py`.
- `assets/` - the source icon and splash PNGs (`npm run assets` makes all sizes).
- `ios/`, `android/` - the native projects. Edited by hand: camera and
  microphone usage text, portrait only, iPhone only, no export-compliance
  question (`ITSAppUsesNonExemptEncryption` false), the shared `App` scheme,
  camera and billing permissions, release signing from the environment.
