// apps/web-partner/src/components/partner1/SettlementView.tsx · PC-56 PARTNER-1b · founder D3 / Q2 — THE SETTLEMENT ACCOUNT PAGE, HONEST (canon
// W265 at `onboarding/step-3`; built at `/onboarding/settlement` — there are no steps). A static page: NO settlement account is collected in
// Phase 1; the organisation (FPO) is the lender of record and lends from its own wallet; a partner's own money never moves through the
// platform. TRUE and printed: the partner's kind (from `/me`) and the platform's partner-kind vocabulary. Refused by name: the stepper and
// "Save & exit", the account fields and branch lookup, "stored encrypted", the test credit and its narration, the retry and live call, the
// paper path, the register check, the signatory (a person), the locked step, the per-kind switch. "Add account number" and "Verify &
// continue" lead to the DECOR chains (W2970–W2976). No form, no input, nothing written.
import Link from 'next/link';
import type { Tr } from '../NotYet';
import { RefusalList } from './RefusalList';

export const PARTNER_KINDS = ['bank', 'nbfc', 'mfi', 'insurer', 'amc', 'gold_loan'] as const;
const kindKey = (k: string) => ((PARTNER_KINDS as readonly string[]).includes(k) ? `partner1.onboarding.kind.${k}` : null);

export function SettlementView({ t, kind }: { t: Tr; kind: string | null }) {
  const own = kind ? kindKey(kind) : null;
  return (
    <section data-kv-settlement>
      <h1>{t.t('partner1.onboarding.title')}</h1>
      <div className="kv-card" data-kv-settlement-statement>
        <p>{t.t('partner1.onboarding.statement')}</p>
        <p className="kv-field__hint">{t.t('partner1.onboarding.nothingAsked')}</p>
      </div>
      <div className="kv-card" data-kv-partner-kind={kind ?? 'unknown'}>
        <p>{own ? t.t('partner1.onboarding.yourKind', { kind: t.t(own) }) : t.t('partner1.onboarding.kindUnknown')}</p>
        <p className="kv-field__hint">{t.t('partner1.onboarding.kinds')}</p>
        <ul className="kv-list">{PARTNER_KINDS.map((k) => <li key={k}>{t.t(`partner1.onboarding.kind.${k}`)}</li>)}</ul>
      </div>
      <div className="kv-card" data-kv-decor="settlement">
        <p>
          <Link className="kv-btn kv-btn--muted" href="/onboarding/settlement?form=review">{t.t('partner1.onboarding.add')}</Link>{' '}
          <Link className="kv-btn kv-btn--muted" href="/onboarding/settlement?act=confirm">{t.t('partner1.onboarding.verify')}</Link>
        </p>
        <p className="kv-field__hint">{t.t('partner1.onboarding.decor')}</p>
      </div>
      <RefusalList t={t} surface="onboarding" />
      <p className="kv-pager"><Link className="kv-btn" href="/onboarding/status">{t.t('partner1.onboarding.back')}</Link></p>
    </section>
  );
}
