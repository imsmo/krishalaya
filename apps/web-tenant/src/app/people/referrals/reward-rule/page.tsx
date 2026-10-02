// apps/web-tenant/src/app/people/referrals/reward-rule/page.tsx · W162 "Configure reward rule" → the form chain W2731–W2734 ·
// PC-56 TENANT-10a · REFUSED BY NAME (F-11).
//
// The canon draws a form (edit → review → success / failure) for a reward rule. NO RULE CAN EXIST YET, so this route renders
// ONE state card and no form: a reward is money (a wallet credit to one or both members), and before a rule can be written
// somebody must decide who funds it — the cooperative's own wallet or the platform. There is no rule table, no reward
// ledger write, and nothing has ever paid a reward on this platform (`referrals.status = 'rewarded'` and `reward_txn_id`
// have no writer). The four canon screens are therefore served by this card; the one real referral act — activation — has
// its own chain (/people/referrals/[id]/activate).
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../../lib/session';
import { getTranslator } from '../../../../lib/i18n';
import { REFERRALS_HREF, REWARD_RULE_HREF } from '../../../../features/ambassadors/console';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ref.rule.title'), robots: { index: false, follow: false } };
}

export default async function RewardRulePage() {
  await requireSession(REWARD_RULE_HREF);
  const t = getTranslator();
  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('amb.breadcrumb')}><Link href={REFERRALS_HREF}>{t.t('ref.title')}</Link> / <span aria-current="page">{t.t('ref.rule.title')}</span></nav>
      <h1>{t.t('ref.rule.title')}</h1>
      <div className="kv-card kv-card--notice" role="status">
        <strong>{t.t('ref.rule.stateTitle')}</strong>
        <p>{t.t('ref.rule.stateBody')}</p>
        <p className="kv-field__hint">{t.t('ref.rule.whatExists')}</p>
      </div>
      <p><Link href={REFERRALS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
    </section>
  );
}
