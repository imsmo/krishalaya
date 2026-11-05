// apps/web-partner/src/components/partner6/LenderConsentsView.tsx · PC-56 PARTNER-6b · W213 (canon `lender/consents`) — AN HONEST PAGE THAT
// READS NOTHING AND SHOWS NO ONE (founder 6b-1, door Q3-A), presentational.
//
// How a farmer's consent works on this platform — given for one application, checked by the platform every time the organisation reads it,
// access ending when the consent expires; the lender never sees who consented, when, how or what it covers — and the truth today: no consent
// is recorded on the platform yet, because the step that asks the farmer does not exist. A real link to the loan queue. NO registry, NO
// person, NO phone, NO application reference, NO channel, NO scope, NO count, NO digit. Never "revocable", "time-boxed", "within 60 seconds",
// "logged on both sides" or "standing access" (founder 6b-2, Q4-A). No read → no audit row and NO error state (the W217 / 5b rule); the state
// is the public flag map (`partner_console` OFF prints OFF). "Export registry" is DECOR → the W2921–W2922 chain with the mailbox line.
// No form, no input.
import Link from 'next/link';
import type { Tr } from '../NotYet';
import { LenderSwitchedOff } from '../partner4/LenderChain';
import { Refusals6 } from './LenderChain6';
import type { LenderHonestState } from '../../features/partner4/figures';
import { consentsHref } from '../../features/partner6/figures';

export function LenderConsentsView({ t, state }: { t: Tr; state: LenderHonestState }) {
  if (state === 'off') return <LenderSwitchedOff t={t} page="consents" />;
  return (
    <section data-kv-lender="consents" data-kv-state={state}>
      <h1>{t.t('partner6.consents.title')}</h1>
      <p className="kv-muted">{t.t('partner6.consents.lead')}</p>

      <div className="kv-card" data-kv-statement="consents">
        <h2 className="kv-card__title">{t.t('partner6.consents.statementTitle')}</h2>
        <p className="kv-statement" data-kv-statement="partner6.consents.statement">{t.t('partner6.consents.statement')}</p>
      </div>

      <div className="kv-card" data-kv-statement="noneYet">
        <h2 className="kv-card__title">{t.t('partner6.consents.noneYetTitle')}</h2>
        <p className="kv-statement" data-kv-statement="partner6.consents.noneYet">{t.t('partner6.consents.noneYet')}</p>
        <p className="kv-pager" data-kv-acts="queue">
          <Link className="kv-btn kv-btn--muted" href="/lender/queue" data-kv-real="queue">{t.t('partner6.consents.viewQueue')}</Link>
        </p>
      </div>

      <p className="kv-pager" data-kv-acts="consents">
        <Link className="kv-btn kv-btn--muted" href={`${consentsHref()}?export=queued`} data-kv-decor="export">{t.t('partner6.consents.exportAct')}</Link>
      </p>
      <Refusals6 t={t} surface="consents" />
    </section>
  );
}
