// apps/web-storefront/src/components/RefusalList.tsx · PC-56 STORE-2a · brief §E — the canon claims a surface does NOT make, printed BY NAME
// (features/store2/refusals.ts `STORE2A_REFUSALS`): a refusal is a sentence that says no, never an offer and never a silent gap. One list per
// surface; the render tests read the map, so a refusal that disappears from its page — or a refused claim that comes back — turns them red.
import { getTranslator } from '../lib/i18n';
import { STORE2A_REFUSALS, type Store2aSurface } from '../features/store2/refusals';

export function RefusalList({ surface }: { surface: Store2aSurface }) {
  const t = getTranslator();
  const rows = STORE2A_REFUSALS.filter((r) => r.surfaces.includes(surface));
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
