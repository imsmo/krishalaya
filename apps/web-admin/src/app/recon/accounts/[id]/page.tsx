// apps/web-admin/src/app/recon/accounts/[id]/page.tsx · wallet-account drill-down + freeze CONTROL. Server
// component: requireAdmin gates, adminGet hits GET /v1/recon/accounts/:id (404 → notFound). Money is a minor-unit
// string → formatMoneyMinor (never floated). The freeze/unfreeze control flips wallet_accounts.is_frozen server-
// side — it NEVER posts the ledger; admin-api requires FIDO2 + step-up, so a 403 degrades to a re-auth notice.
// No inline styles.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { requireAdmin } from '../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../lib/admin-client';
import { getTranslator } from '../../../../lib/i18n';
import { adminNoticeKey } from '../../../../features/nav/nav-model';
import type { WalletAccount } from '../../../../features/recon/recon';
import { freezeAccountAction } from '../../actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('recon.accountTitle'), robots: { index: false, follow: false } };
}

const OK = new Set(['freeze', 'unfreeze']);
const ERR = new Set(['reason', 'elevation', 'illegal', 'notFound', 'generic']);

export default async function ReconAccountPage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();

  let acct: WalletAccount | undefined; let notice: string | undefined;
  try { acct = (await adminGet<WalletAccount>(`recon/accounts/${params.id}`)).data; }
  catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`);
  }

  if (!acct) {
    return <section><p className="kv-backlink"><Link href="/recon">{t.t('recon.back')}</Link></p><p className="kv-error" role="alert">{notice}</p></section>;
  }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;

  return (
    <section>
      <p className="kv-backlink"><Link href="/recon">{t.t('recon.back')}</Link></p>
      <h1>{acct.accountCode}</h1>
      {okKey && <p className="kv-success" role="status">{t.t(`recon.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`recon.error.${errKey}`)}</p>}

      <dl className="kv-facts">
        <div className="kv-facts__row"><dt>{t.t('recon.acctOwner')}</dt><dd>{acct.ownerKind}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('recon.acctBalance')}</dt><dd>{formatMoneyMinor(acct.balanceMinor, acct.currency)}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('recon.acctFrozen')}</dt><dd><span className={acct.isFrozen ? 'kv-status kv-status--danger' : 'kv-status kv-status--ok'}>{acct.isFrozen ? t.t('recon.frozenYes') : t.t('recon.frozenNo')}</span></dd></div>
        <div className="kv-facts__row"><dt>{t.t('recon.acctFreezeReason')}</dt><dd>{acct.freezeReason || t.t('common.dash')}</dd></div>
      </dl>

      <h2>{t.t('recon.freezeControl')}</h2>
      <p className="kv-muted kv-note">{t.t('recon.freezeNote')}</p>
      <form action={freezeAccountAction} className="kv-card kv-action-card">
        <input type="hidden" name="id" value={acct.id} />
        <input type="hidden" name="action" value={acct.isFrozen ? 'unfreeze' : 'freeze'} />
        <label className="kv-field__label">{t.t('recon.reason')}</label>
        <input name="reason" className="kv-input" required minLength={3} maxLength={1000} />
        <button type="submit" className={`kv-btn${acct.isFrozen ? '' : ' kv-btn--danger'}`}>{acct.isFrozen ? t.t('recon.unfreeze') : t.t('recon.freeze')}</button>
      </form>
    </section>
  );
}
