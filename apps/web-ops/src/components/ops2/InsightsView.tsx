// apps/web-ops/src/components/ops2/InsightsView.tsx · PC-56 OPS-2c · W379 WAREHOUSE INSIGHTS — AN HONEST PAGE THAT READS NOTHING, presentational.
// There are no warehouse insights on this platform yet, and why: no quantity is weighed (a booking's quantity is what the depositor asked to store)
// and quantities were not always in one unit. No figure, no percentage, no count, no input, no error state (nothing is read, so nothing can fail).
// The assay page (W372) is named in a SENTENCE — it is OPS-2b's and not built, and no link goes to an unbuilt route. "Export (audit-stamped)" is
// DECOR → the W3360–W3361 chain (`?export=queued`), labelled with what is true (Q10-A); its Back returns HERE. A real link to the billing page.
import Link from 'next/link';
import type { Tr } from '../../features/ops2/refusals';
import { BILLING_PAGE, INSIGHTS_PAGE } from '../../features/ops2/billing';
import { Ops2Refusals } from './Ops2Chain';

export function InsightsView({ t }: { t: Tr }) {
  return (
    <section data-kv-ops2="wh_insights" data-kv-state="honest">
      <h1>{t.t('ops2.insights.title')}</h1>
      <p className="kv-muted">{t.t('ops2.insights.lead')}</p>
      <div className="kv-card" data-kv-statement="wh_insights">
        <h2 className="kv-card__title">{t.t('ops2.insights.statementTitle')}</h2>
        <p className="kv-statement" data-kv-statement="ops2.insights.statement">{t.t('ops2.insights.statement')}</p>
        <p data-kv-fact="assay">{t.t('ops2.insights.assaySentence')}</p>
      </div>
      <p className="kv-pager" data-kv-acts="wh_insights">
        <Link className="kv-btn" href={BILLING_PAGE} data-kv-real="billing">{t.t('ops2.insights.billingLink')}</Link>{' '}
        <Link className="kv-btn kv-btn--muted" href={`${INSIGHTS_PAGE}?export=queued`} data-kv-decor="export">{t.t('ops2.insights.exportAct')}</Link>
      </p>
      <Ops2Refusals t={t} surface="wh_insights" />
    </section>
  );
}
