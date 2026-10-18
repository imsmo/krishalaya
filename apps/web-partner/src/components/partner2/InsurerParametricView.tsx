// apps/web-partner/src/components/partner2/InsurerParametricView.tsx · PC-56 PARTNER-2b · W262 THE PARAMETRIC RUN — AN HONEST PAGE (founder Q3),
// presentational.
//
// "There is no parametric run, index feed, trigger evaluation or automatic payout on the platform. A parametric product is a label on a product
// today; nothing is armed, evaluated or paid." (`partner2.parametric.statement`, verbatim from the founder — the ONLY place the page says
// "automatic", and it says no). The only figures are two COUNTS from the 2a products read: the insurer's own products marked parametric and
// the policies in force on them — never money. "Trigger audit trail" is DECOR → W2977–W2979 (`?act=`: there is no trigger record; the FM
// mis-classes a read as a mutate, F-17). Reached from the insurer dashboard and the products page — NOT from the nav (founder 2b-4). The whole
// canon run — the season window, the index, the figures, the money set aside, the release with no human per act, the replay, the promise to
// families — is refused by name below.
import Link from 'next/link';
import type { Tr } from '../NotYet';
import { InsurerRefusals } from './InsurerRefusals';
import { InsurerSwitchedOff } from './InsurerStates';
import { asOfText } from '../../features/partner1/dashboard';
import type { HonestState, ParametricCounts } from '../../features/partner2/figures';

export function InsurerParametricView({ t, lang, state, counts }: { t: Tr; lang: string; state: HonestState; counts: ParametricCounts | null }) {
  if (state === 'off' || state === 'insurance_off') return <InsurerSwitchedOff t={t} which={state} page="parametric" />;
  return (
    <section data-kv-insurer="parametric" data-kv-state={state}>
      <h1>{t.t('partner2.parametric.title')}</h1>
      <p className="kv-statement" data-kv-statement="partner2.parametric.statement">{t.t('partner2.parametric.statement')}</p>
      <p><Link className="kv-btn kv-btn--muted" href="/insurer/parametric?act=confirm" data-kv-decor="trail">{t.t('partner2.parametric.trail')}</Link></p>
      {state === 'error' || !counts ? (
        <div className="kv-card" role="alert">
          <h2 className="kv-card__title">{t.t('partner2.parametric.error.title')}</h2>
          <p>{t.t('partner2.parametric.error.body')}</p>
          <p className="kv-pager"><Link className="kv-btn" href="/insurer/parametric?act=confirm">{t.t('partner2.retry')}</Link></p>
        </div>
      ) : (
        <>
          <p className="kv-muted">{t.t('partner2.parametric.lead')}</p>
          <div className="kv-stat-row">
            <div className="kv-card kv-stat" data-kv-count="products">
              <div className="kv-stat__label">{t.t('partner2.parametric.products')}</div>
              <div className="kv-stat__value">{String(counts.products)}</div>
              <p className="kv-field__hint">{t.t('partner2.parametric.productsHint')}</p>
            </div>
            <div className="kv-card kv-stat" data-kv-count="active">
              <div className="kv-stat__label">{t.t('partner2.parametric.active')}</div>
              <div className="kv-stat__value">{String(counts.active)}</div>
              <p className="kv-field__hint">{t.t('partner2.parametric.activeHint')}</p>
            </div>
          </div>
          {counts.computedAt && <p className="kv-muted" data-kv-asof={counts.computedAt}>{t.t('partner2.asOf', { time: asOfText(counts.computedAt, lang) })}</p>}
          <p className="kv-pager"><Link className="kv-btn kv-btn--muted" href="/insurer/products">{t.t('partner2.dash.viewProducts')}</Link></p>
        </>
      )}
      <InsurerRefusals t={t} surface="ins_parametric" />
    </section>
  );
}
