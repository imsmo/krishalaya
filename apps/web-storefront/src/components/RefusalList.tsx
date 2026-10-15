// apps/web-storefront/src/components/RefusalList.tsx · PC-56 STORE-2a · brief §E — the canon claims a surface does NOT make, printed BY NAME
// (features/store2/refusals.ts `STORE2A_REFUSALS`): a refusal is a sentence that says no, never an offer and never a silent gap. One list per
// surface; the render tests read the map, so a refusal that disappears from its page — or a refused claim that comes back — turns them red.
// PC-56 STORE-2b: the same list reads `STORE2B_REFUSALS` too (the cart, checkout, and the 2b lines on the listing and inputs pages).
// PC-56 STORE-2c: and `STORE2C_REFUSALS` (the checkout steps, payment processing, the confirmation and the auction).
import { getTranslator } from '../lib/i18n';
// PC-56 STORE-3a: and `STORE3A_REFUSALS` (the order list, the order, the cancel page and the confirmation).
import { STORE2A_REFUSALS, STORE2B_REFUSALS, STORE2C_REFUSALS, type Store2aSurface, type Store2bSurface, type Store2cSurface } from '../features/store2/refusals';
import { STORE3A_REFUSALS, type Store3aSurface } from '../features/store3a/refusals';

export function RefusalList({ surface }: { surface: Store2aSurface | Store2bSurface | Store2cSurface | Store3aSurface }) {
  const t = getTranslator();
  const rows = [
    ...STORE2A_REFUSALS.filter((r) => (r.surfaces as readonly string[]).includes(surface)),
    ...STORE2B_REFUSALS.filter((r) => (r.surfaces as readonly string[]).includes(surface)),
    ...STORE2C_REFUSALS.filter((r) => (r.surfaces as readonly string[]).includes(surface)),
    ...STORE3A_REFUSALS.filter((r) => (r.surfaces as readonly string[]).includes(surface)),
  ];
  return (
    <section className="kv-refused" data-kv-refused={surface} aria-labelledby={`kv-refused-${surface}`}>
      <h2 id={`kv-refused-${surface}`}>{t.t('store2a.refusal.title')}</h2>
      <ul>
        {rows.map((r) => <li key={r.id} className="kv-refusal" data-kv-refusal={r.id}>{t.t(r.key)}</li>)}
      </ul>
    </section>
  );
}

/** The catalogue's kill-switch is OFF (founder D4): the same sentence on every STORE-2a surface — platform-wide, never "for this tenant/plan". */
export function BrowseOff() {
  const t = getTranslator();
  return (
    <div className="kv-state" role="status" data-kv-state="browse-off">
      <p><strong>{t.t('store2a.browseOff.title')}</strong></p>
      <p>{t.t('store2a.browseOff.body')}</p>
    </div>
  );
}

/** PC-56 STORE-2b · founder D2: buying's kill-switch is OFF — the same sentence on the cart and checkout, platform-wide. */
export function CartOff() {
  const t = getTranslator();
  return (
    <div className="kv-state" role="status" data-kv-state="cart-off">
      <p><strong>{t.t('store2b.cartOff.title')}</strong></p>
      <p>{t.t('store2b.cartOff.body')}</p>
    </div>
  );
}
