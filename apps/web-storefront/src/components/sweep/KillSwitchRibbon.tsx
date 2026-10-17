// apps/web-storefront/src/components/sweep/KillSwitchRibbon.tsx · PC-56 STORE-SWEEP-b · C2 (founder D2 b — canon W320 "when WE'RE the problem"; no
// status page in Phase 1, B9 refused and queued) — THE RIBBON. Mounted ONCE in each chrome's layout beside `OnlineGuard` (the offline banner covers
// YOUR network; this covers OURS), from the public flags the layout reads: while the platform's `storefront_cart` or `storefront_browse` kill-switch
// is OFF, every page of the chrome says so — the FEATURE (buying / browsing lots), whose side the problem is on ("our side"; for buying, "nothing
// was charged"), and the WORKING DETOUR as a link (browsing lots works / your orders stay readable). No time promise and no "next update by" (there
// is no incident record to hold one); no provider named. Both switches fail OPEN at the API (2a/2b), so an unreadable flag read shows no ribbon —
// the pages behind the switch still answer for themselves (store2a.browseOff.* / store2b.cartOff.*).
import { getTranslator } from '../../lib/i18n';
import type { AccountChrome } from '../../features/store4a/account';

const base = (c: AccountChrome) => (c.kind === 'tenant' ? `/${encodeURIComponent(c.slug)}` : '');

/** `flags` = the public flags the layout read (null when unreadable → no ribbon). */
export function KillSwitchRibbon({ chrome, flags }: { chrome: AccountChrome; flags: { storefront_cart?: boolean; storefront_browse?: boolean } | null }) {
  if (!flags) return null;
  const browseOff = flags.storefront_browse === false;
  const cartOff = flags.storefront_cart === false;
  if (!browseOff && !cartOff) return null;
  const t = getTranslator();
  const b = base(chrome);
  const which = browseOff && cartOff ? 'both' : browseOff ? 'browse' : 'cart';
  return (
    <div className="kv-state kv-ribbon" role="status" aria-label={t.t('sweep.ribbon.label')} data-kv-ribbon={which}>
      {cartOff && <p data-kv-ribbon-feature="cart"><strong>{t.t('sweep.ribbon.cartOff')}</strong></p>}
      {browseOff && <p data-kv-ribbon-feature="browse"><strong>{t.t('sweep.ribbon.browseOff')}</strong></p>}
      <p>
        {!browseOff && <><a href={`${b}/search`} className="kv-btn--link" data-kv-detour="browse">{t.t('sweep.ribbon.browseWorks')}</a>{' · '}</>}
        <a href={`${b}/orders`} className="kv-btn--link" data-kv-detour="orders">{t.t('sweep.ribbon.ordersReadable')}</a>
      </p>
    </div>
  );
}
