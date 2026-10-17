# Publishing Rocksane on the App Store and Google Play

This is the checklist for getting Rocksane into both stores, with Rocksane Pro
as a one-time purchase. Everything that can live in the repository is done.
What's left are the accounts, the payments set-up, and the store reviews,
which only the account owner can do. **No Mac is needed**: the iPhone app is
built and signed on Codemagic's Macs, and the Android app on GitHub (or Codemagic).

## What is ready

| | Where |
|---|---|
| iPhone and Android projects (Capacitor 8), app id `io.github.nabilhzq13.rocksane` | `app/` (see `app/README.md`) |
| Rocksane Pro, product id `rocksane_pro`, with Restore | the app, through StoreKit 2 and Google Play Billing |
| Icon, splash screens, store screenshots, feature graphic, purchase screenshot | `app/assets/`, `app/store/` |
| Store text: names, descriptions, keywords, review notes | `app/store/listing.md` |
| Privacy policy, terms of use, support page | `web/privacy.html`, `web/terms.html`, `web/support.html`, on GitHub Pages |
| Android builds (test APK, signed bundle) | `.github/workflows/app.yml` (GitHub Actions) |
| Signed iPhone builds to TestFlight, Android to Play | `codemagic.yaml` (Codemagic) |

## Before you start

**Unlock GitHub Actions.** GitHub refused to run the app builds because the
account is "locked due to a billing issue". Building on GitHub is free for a
public repository, so it's a billing problem on the account itself (often an
expired card or an unpaid invoice). Fix it at
[github.com/settings/billing](https://github.com/settings/billing), then
open the repository's **Actions** tab and re-run "Phone app". Until then,
Codemagic can make every build instead (its `android-bundle` workflow makes the
Android bundle).

**Costs**

| | Apple | Google |
|---|---|---|
| Developer account | US$99 a year | US$25 once |
| Store's share of Rocksane Pro sales | 15% if you join the App Store Small Business Program (under US$1 million a year), otherwise 30% | 15% on your first US$1 million each year |
| Build service | Codemagic: 500 free Mac minutes a month (about 25 builds) | GitHub Actions: free for public repositories |

**Price.** You choose it in each store; Apple and Google convert it for every
country, and you can adjust single countries (for example Malaysia). The app
always shows the store's own price, never a number written in the code.

**EU (Digital Services Act).** Both stores ask whether you are a "trader".
Selling Rocksane Pro usually counts. For traders, the stores show your
address, phone number and email on the app's page in EU countries. If you'd
rather not publish those, leave the 27 EU countries out of the app's
availability; you can add them later.

**Keep these safe, outside the repository** (the `.gitignore` already
refuses them): the Android upload key (`.jks`) and its passwords, the App
Store Connect API key (`.p8`), and the certificate key you make for Codemagic.

---

## Google Play

1. **Developer account.** Sign up at
   [play.google.com/console/signup](https://play.google.com/console/signup)
   as a personal account, pay US$25 and verify your identity (can take a few days).
2. **Payments profile.** Play Console → Settings → Payments profile. You need
   it to sell Rocksane Pro and to be paid.
3. **Create the app.** Play Console → Create app: name `Rocksane: Bouldering Beta`,
   language English, App, **Free** (the app is free; Pro is an in-app product).
4. **Make your upload key** (once). You need Java's `keytool`: on Windows run
   `winget install EclipseAdoptium.Temurin.21.JDK`, open a new terminal, then:
   ```
   keytool -genkeypair -v -keystore rocksane-upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
   ```
   It asks for a password and your name. Back the file and the password up.
   Google keeps the real app signing key (Play App Signing); this upload key
   only proves an upload is yours, and Google can reset it if you lose it.
5. **Give the key to GitHub.** Repository → Settings → Secrets and variables →
   Actions → New repository secret, four times:
   - `ANDROID_KEYSTORE_BASE64`: the file as text. In PowerShell:
     `[Convert]::ToBase64String([IO.File]::ReadAllBytes("rocksane-upload.jks")) | Set-Clipboard`, then paste.
   - `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`upload`), `ANDROID_KEY_PASSWORD`
     (the same password unless you set a separate one).

   (For Codemagic instead: Team settings → codemagic.yaml settings → Code
   signing identities → Android keystores → upload the `.jks` with reference
   name `rocksane_upload`.)
6. **Build the bundle.** GitHub → Actions → Phone app → Run workflow. When it
   finishes, download `rocksane-android-play-bundle` from the run's page and
   unzip it: that `.aab` is what Play wants. The same run has
   `rocksane-android-test-apk`, which you can install on an Android phone
   straight away.
7. **Internal testing.** Play Console → Test and release → Testing →
   Internal testing → Create new release → upload the `.aab` → add yourself
   as a tester → roll out. Open the opt-in link on your Android phone.
8. **Create Rocksane Pro.** Monetize with Play → Products → One-time products
   → Create: product id `rocksane_pro`, name `Rocksane Pro`, description from
   `app/store/listing.md`, a price → Activate. (Play only allows this after a
   build with the billing permission is uploaded, which step 7 did.)
9. **Test the purchase.** Settings → License testing → add your Gmail address.
   Purchases by licence testers are never charged. Buy Pro in the app,
   delete and reinstall, then Restore.
10. **Store listing.** Grow users → Store presence → Main store listing:
    copy the text from `app/store/listing.md`, upload `app/store/icon-512.png`,
    `app/store/feature-graphic.png` and `app/store/android/*.png`.
11. **App content** (Policy and programs → App content): privacy policy
    `https://nabilhzq13.github.io/RockyMate/privacy.html`; ads: no; app access:
    all functionality available; content rating questionnaire (All other app
    types, No to everything); target audience 13 and over; data safety: no
    data collected or shared; government, financial and health features: none.
    Google also asks for a contact email that is shown on the store; if you
    want it on the support page too, add it to `web/support.html`.
12. **Closed test, 14 days.** New personal accounts must run a closed test
    with at least 12 testers who stay opted in for 14 days in a row before
    they can publish. Testing → Closed testing → create a track, upload the
    same `.aab`, add 12 or more testers by email (climbing friends, people at
    your gym), and ask them to open the app now and then.
13. **Production.** After the 14 days: Dashboard → Apply for production,
    answer the questions about your test, then create a production release
    with the same build and send it for review.

## App Store

1. **Enrol** in the [Apple Developer Program](https://developer.apple.com/programs/enroll/)
   as an individual (US$99 a year). The Apple Developer app on your iPhone is
   the quickest way; it verifies your identity.
2. **Agreements and bank.** [App Store Connect](https://appstoreconnect.apple.com)
   → Business: accept the Paid Apps agreement and add your bank account and
   tax forms. Selling Rocksane Pro needs this.
3. **Register the app id.** [developer.apple.com/account](https://developer.apple.com/account) →
   Certificates, Identifiers & Profiles → Identifiers → + → App IDs → App:
   description `Rocksane`, explicit bundle id `io.github.nabilhzq13.rocksane`.
   In-App Purchase is included by default.
4. **Create the app.** App Store Connect → Apps → + → New App: iOS, name
   `Rocksane: Bouldering Beta` (pick another if it's taken), English, the
   bundle id from step 3, SKU `rocksane-ios`.
5. **Create Rocksane Pro.** Your app → Monetization → In-App Purchases → +:
   Non-Consumable, reference name `Rocksane Pro`, product id `rocksane_pro`.
   Then set the price, the display name and description, and add
   `app/store/iap-review.png` as the review screenshot (text in
   `app/store/listing.md`). Your first purchase is reviewed together with
   the first app version.
6. **API key for Codemagic.** App Store Connect → Users and Access →
   Integrations → App Store Connect API → Team Keys → +: name `Codemagic`,
   access **Admin** (the first build creates your signing certificate and
   profile). Download the `.p8` file (you can only download it once) and note
   the Key ID and the Issuer ID.
7. **Certificate key.** In Git Bash:
   ```
   ssh-keygen -t rsa -b 2048 -m PEM -f rocksane_cert_key -q -N ""
   ```
   The whole text of the file `rocksane_cert_key` (not the `.pub`) is your
   `CERTIFICATE_PRIVATE_KEY`. Codemagic makes the Apple distribution
   certificate with it and reuses it on every build.
8. **Codemagic.** Sign up at [codemagic.io](https://codemagic.io/signup) with
   GitHub and add the RockyMate repository; it reads `codemagic.yaml`. In the
   app's Environment variables tab, add a group named `app_store` with four
   secret variables: `APP_STORE_CONNECT_ISSUER_ID`,
   `APP_STORE_CONNECT_KEY_IDENTIFIER`, `APP_STORE_CONNECT_PRIVATE_KEY` (the
   whole `.p8` text) and `CERTIFICATE_PRIVATE_KEY`. Then Start new build →
   **iOS to TestFlight**. It takes 15 to 20 minutes; Apple then processes the
   build for a few more.
9. **TestFlight.** App Store Connect → your app → TestFlight → Internal
   Testing → add yourself. Install the TestFlight app on your iPhone and open
   Rocksane from it. Purchases in TestFlight are free, so you can try buying
   Pro and Restore.
10. **The version page.** Your app → iOS App 1.0: upload
    `app/store/ios/*.png` (6.9-inch display), paste the promotional text,
    description and keywords, add the support and marketing URLs, choose the
    build, add Rocksane Pro under In-App Purchases, fill in App Review
    information (your contact details, sign-in not required, and the notes
    from `app/store/listing.md`).
11. **The rest of the app page.** App Privacy: privacy policy URL and **Data
    Not Collected**. Age rating: None/No everywhere (4+). Category: Sports.
    Price: Free. Availability: your choice of countries (see the EU note above).
12. **Submit for review.** Most reviews take one to three days. If Apple
    asks a question, answer it in App Store Connect; nothing needs rebuilding
    unless they ask for a change.

## After approval

- Put the store links in `src/app.js` (`APP_LINKS`), run `python build.py`,
  run the tests and push to `main`: the free web demo then shows "Get it on
  the App Store" and "Get it on Google Play" where it now says the app is
  coming.
- **An update:** change `"version"` in `app/package.json` (for example
  `1.0.1`), push, build again (GitHub Actions or Codemagic for Android,
  Codemagic for iPhone), then create a new version in each store with the new
  build. Build numbers go up by themselves.

## Review rules Rocksane already follows

- **Apple 3.1.1:** Pro is unlocked only by the in-app purchase, and there is
  a Restore button (on the purchase sheet and in Settings → Rocksane Pro).
- **Apple 5.1.1 and Google Play:** the privacy policy is linked in the app
  and on the store page; the app collects no data.
- **Apple 2.3.10:** the iPhone app names only Apple; the Android app names
  only Google.
- **Apple 4.2 (minimum functionality):** Rocksane works offline with the
  camera, haptics and purchases; the review notes say so.
- **Google Play:** targets Android 16 (API level 36), required for new apps
  and updates since 31 August 2026; Play Billing Library 9 acknowledges each
  purchase, so Google doesn't refund it after three days.
- **Export compliance:** the app declares it uses no non-exempt encryption,
  so App Store Connect doesn't ask on every build.
