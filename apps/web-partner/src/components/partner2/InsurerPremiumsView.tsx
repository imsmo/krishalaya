// apps/web-partner/src/components/partner2/InsurerPremiumsView.tsx · PC-56 PARTNER-2b · W251 PREMIUMS — AN HONEST PAGE (founder Q1), presentational.
//
// ONE approved statement (`partner2.premiums.statement`, verbatim from the founder) and nothing counted as the insurer's: premiums sit in the
// platform's escrow account and nothing remits them yet. The only figures are two COUNTS from the 2a dashboard read — the policies in force on
// the insurer's products and the proposals awaiting the farmer's payment — labelled as counts, never as money. This component is handed a
// `PremiumsCounts` (integers only — features/partner2/figures.ts drops every money field), imports NO money formatter, and prints no rupee figure
// (the render test and the claims guard both pin it — mutant M1). "Export (signed)" is DECOR → the W2896–W2897 chain (`?export=`); "Reload"
// → W2898–W2900 (`?act=`). The canon's collected sum, next-day settlement, subsidy owed, refunds, batches and policy-number matching are
// refused by name below.
import Link from 'next/link';
import type { Tr } from '../NotYet';
import { InsurerRefusals } from './InsurerRefusals';
import { InsurerSwitchedOff } from './InsurerStates';
import { asOfText } from '../../features/partner1/dashboard';
import type { HonestState, PremiumsCounts } from '../../features/partner2/figures';

function Count({ id, label, value, hint }: { id: string; label: string; value: number; hint: string }) {
  return (
    <div className="kv-card kv-stat" data-kv-count={id}>
      <div className="kv-stat__label">{label}</div>
      <div className="kv-stat__value">{String(value)}</div>
      <p className="kv-field__hint">{hint}</p>
    </div>
  );
}

export function InsurerPremiumsView({ t, lang, state, counts }: { t: Tr; lang: string; state: HonestState; counts: PremiumsCounts | null }) {
  if (state === 'off' || state === 'insurance_off') return <InsurerSwitchedOff t={t} which={state} page="premiums" />;
  return (
    <section data-kv-insurer="premiums" data-kv-state={state}>
      <h1>{t.t('partner2.premiums.title')}</h1>
      <p className="kv-statement" data-kv-statement="partner2.premiums.statement">{t.t('partner2.premiums.statement')}</p>
      <p><Link className="kv-btn kv-btn--muted" href="/insurer/premiums?export=queued" data-kv-decor="export">{t.t('partner2.premiums.export')}</Link></p>
      {state === 'error' || !counts ? (
        <div className="kv-card" role="alert">
          <h2 className="kv-card__title">{t.t('partner2.premiums.error.title')}</h2>
          <p>{t.t('partner2.premiums.error.body')}</p>
          <p className="kv-pager"><Link className="kv-btn" href="/insurer/premiums?act=confirm">{t.t('partner2.retry')}</Link></p>
        </div>
      ) : (
        <>
          <p className="kv-muted">{t.t('partner2.premiums.lead')}</p>
          <div className="kv-stat-row">
            <Count id="active" label={t.t('partner2.premiums.active')} value={counts.active} hint={t.t('partner2.premiums.activeHint')} />
            <Count id="proposed" label={t.t('partner2.premiums.proposed')} value={counts.proposed} hint={t.t('partner2.premiums.proposedHint')} />
          </div>
          <p className="kv-muted" data-kv-asof={counts.computedAt}>{t.t('partner2.asOf', { time: asOfText(counts.computedAt, lang) })}</p>
          <p className="kv-pager"><Link className="kv-btn kv-btn--muted" href="/insurer/policies">{t.t('partner2.dash.viewPolicies')}</Link></p>
        </>
      )}
      <InsurerRefusals t={t} surface="ins_premiums" />
    </section>
  );
}
