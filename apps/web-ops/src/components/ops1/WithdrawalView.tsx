// apps/web-ops/src/components/ops1/WithdrawalView.tsx · PC-56 OPS-1a · W377 WITHDRAWAL — A GOODS RELEASE AGAINST AN e-NWR, NOT CASH (survey C-3).
// AN HONEST PAGE THAT READS NOTHING (founder 1a-2, Q3-A), presentational: how release works on this platform (the whole booking, the operator's
// act, the storage fee settles from the depositor's wallet at release) and that release is PAUSED until she can confirm it herself; never a part
// of a booking; no receipt is pledged on this platform yet; a real link to the bookings list. "Request release" is DECOR → the W3369–W3371 chain
// (`?act=confirm`), labelled with what is true. No input, no figure, no error state (nothing is read, so nothing can fail).
import Link from 'next/link';
import type { Tr } from '../../features/ops1/refusals';
import { WITHDRAWAL_PAGE } from '../../features/ops1/payout';
import { Ops1Refusals } from './Ops1Chain';

export function WithdrawalView({ t }: { t: Tr }) {
  return (
    <section data-kv-ops1="withdrawal" data-kv-state="honest">
      <h1>{t.t('ops1.withdrawal.title')}</h1>
      <p className="kv-muted">{t.t('ops1.withdrawal.lead')}</p>
      <div className="kv-card" data-kv-statement="withdrawal">
        <h2 className="kv-card__title">{t.t('ops1.withdrawal.statementTitle')}</h2>
        <p className="kv-statement" data-kv-statement="ops1.withdrawal.statement">{t.t('ops1.withdrawal.statement')}</p>
        <p data-kv-fact="whole">{t.t('ops1.withdrawal.noPartial')}</p>
        <p data-kv-fact="pledge">{t.t('ops1.withdrawal.noPledge')}</p>
      </div>
      <p className="kv-pager" data-kv-acts="withdrawal">
        <Link className="kv-btn" href="/warehouse" data-kv-real="bookings">{t.t('ops1.withdrawal.bookingsLink')}</Link>{' '}
        <Link className="kv-btn kv-btn--muted" href={`${WITHDRAWAL_PAGE}?act=confirm`} data-kv-decor="request">{t.t('ops1.withdrawal.requestAct')}</Link>
      </p>
      <Ops1Refusals t={t} surface="withdrawal" />
    </section>
  );
}

/** The sentence `/warehouse/[id]` prints where its release button was (no button), with the inbound edge to this page. */
export function ReleasePaused({ t }: { t: Tr }) {
  return (
    <div className="kv-card" data-kv-release="paused">
      <p className="kv-statement" data-kv-statement="ops1.withdrawal.paused">{t.t('ops1.withdrawal.paused')}</p>
      <p><Link href={WITHDRAWAL_PAGE} className="kv-btn--link" data-kv-real="withdrawal">{t.t('ops1.withdrawal.howLink')}</Link></p>
    </div>
  );
}
