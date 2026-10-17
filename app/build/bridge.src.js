/* The native side of Rocksane, for src/app.js (window.RocksaneNative).
   Bundled by `npm run bridge` into build/bridge.js, which build.py puts
   before the app's scripts in app/www/index.html.

   platform                       'ios' | 'android'
   haptics.selection()            a light tick (moving between steps, sheet heights)
   haptics.impact(style)          'light' | 'medium' | 'heavy'
   haptics.notify(type)           'success' | 'warning' | 'error'
   purchases.product(id)          {price, title} from the store (never hard-coded), or null
   purchases.buy(id)              {ok} | {ok:false, cancelled:true} | {ok:false, message}
   purchases.restore(id)          {owned}
   purchases.owned(id)            true | false, or null when the store can't be reached
   statusBar(dark)                dark = the page behind the bars is dark
   onBack(cb)                     Android back button; cb returns true if it closed something
   onResume(cb)                   the app came back to the front
   open(url)                      a link in the in-app browser
   ready()                        hide the splash screen */
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { SplashScreen } from '@capacitor/splash-screen';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { NativePurchases, PURCHASE_TYPE } from '@capgo/native-purchases';

const platform = Capacitor.getPlatform();
const quiet = p => { if (p && p.catch) p.catch(() => {}); };
const IMPACT = { light: ImpactStyle.Light, medium: ImpactStyle.Medium, heavy: ImpactStyle.Heavy };
const NOTE = { success: NotificationType.Success, warning: NotificationType.Warning, error: NotificationType.Error };

/* A purchase counts when the store lists it: on iOS (StoreKit 2) a listed
   non-consumable is owned; on Android it must be in the PURCHASED state
   (a pending purchase is not paid yet). Refunds drop out of these lists. */
async function owned(id) {
  try {
    const { purchases } = await NativePurchases.getPurchases({ productType: PURCHASE_TYPE.INAPP });
    return (purchases || []).some(p => p.productIdentifier === id &&
      (platform === 'ios' || p.purchaseState === 'PURCHASED' || p.purchaseState === '1' || p.purchaseState === 1));
  } catch (e) { return null; }
}
const message = e => {
  const m = String((e && (e.message || e.code)) || e || '');
  if (/pending|deferred/i.test(m)) return 'The purchase is waiting for approval (for example Ask to Buy). Pro unlocks as soon as it goes through.';
  if (/network|offline|connect/i.test(m)) return 'The store couldn\'t be reached. Check your connection, then try again.';
  if (/not allowed|restricted|parental/i.test(m)) return 'Purchases are turned off on this device (Screen Time or parental controls).';
  return 'The purchase didn\'t go through, and nothing was charged. Try again in a moment.';
};

let backCb = null;
window.RocksaneNative = {
  platform,
  haptics: {
    selection() { quiet(Haptics.selectionStart().then(() => Haptics.selectionChanged()).then(() => Haptics.selectionEnd())); },
    impact(style) { quiet(Haptics.impact({ style: IMPACT[style] || ImpactStyle.Light })); },
    notify(type) { quiet(Haptics.notification({ type: NOTE[type] || NotificationType.Success })); }
  },
  purchases: {
    async product(id) {
      try {
        const { product } = await NativePurchases.getProduct({ productIdentifier: id, productType: PURCHASE_TYPE.INAPP });
        return product ? { price: product.priceString, title: product.title } : null;
      } catch (e) { return null; }
    },
    async buy(id) {
      try {
        await NativePurchases.purchaseProduct({ productIdentifier: id, productType: PURCHASE_TYPE.INAPP, quantity: 1 });
        return { ok: (await owned(id)) !== false };
      } catch (e) {
        const m = String((e && (e.message || e.code)) || e || '');
        if (/cancel/i.test(m)) return { ok: false, cancelled: true };
        return { ok: false, message: message(e) };
      }
    },
    async restore(id) {
      try { await NativePurchases.restorePurchases(); } catch (e) {}
      return { owned: (await owned(id)) === true };
    },
    owned
  },
  statusBar(dark) { quiet(SystemBars.setStyle({ style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light })); },
  onBack(cb) { backCb = cb; },
  onResume(cb) { quiet(App.addListener('resume', () => { try { cb(); } catch (e) {} })); },
  open(url) { quiet(Browser.open({ url, presentationStyle: 'popover' })); },
  ready() { quiet(SplashScreen.hide({ fadeOutDuration: 250 })); }
};
quiet(App.addListener('backButton', () => {
  let handled = false;
  try { handled = !!(backCb && backCb()); } catch (e) {}
  if (!handled) quiet(App.minimizeApp());
}));
