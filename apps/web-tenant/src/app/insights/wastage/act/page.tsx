// apps/web-tenant/src/app/insights/wastage/act/page.tsx · W2826 confirm → W2827 success → W2828 failure (retry) — the wastage FACTS re-run,
// PC-56 TENANT-SW-f. The reason (≥ 10) is typed first; success reads the audit entry back and prints what the database recorded (written ·
// already recorded). Manual entry is not offered: refused by name on the screen (MANUAL_WASTAGE_REFUSED).
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { requireSession } from '../../../../lib/session';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { mutateStep, mutateStepKey, failureKey } from '../../../../features/mutate/chain';
import { WASTAGE_HREF, REASON_MIN, failedCodes, swfCodeKey } from '../../../../features/swf/console';
import { AuditEntryCard } from '../../../people/ambassadors/AuditEntryCard';
import { rerunWastageAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('swf.wastage.rerun'), robots: { index: false, follow: false } }; }

export default async function WastageActPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const base = `${WASTAGE_HREF}/act`;
  await requireSession(base);
  const t = getTranslator(); const lang = getLang();
  const step = mutateStep(searchParams.step);
  const reason = (searchParams.reason ?? '').trim().slice(0, 500);
  const reasonOk = reason.length >= REASON_MIN;
  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('swf.wastage.title')}><Link href={WASTAGE_HREF}>{t.t('swf.wastage.title')}</Link> / <span aria-current="page">{t.t('swf.wastage.rerun')}</span></nav>
      <h1>{t.t('swf.wastage.rerun')}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))}</p>
      {step === 'confirm' && (
        <>
          <div className="kv-card"><p>{t.t('swf.wastage.rerun.what')}</p><p className="kv-field__hint">{t.t('swf.wastage.rerun.idempotent')}</p><p className="kv-field__hint">{t.t('mutate.auditNote')}</p></div>
          <form method="get" action={base} className="kv-card kv-form">
            <input type="hidden" name="step" value="confirm" />
            <label className="kv-field" htmlFor="w-why"><span>{t.t('swf.reason')}</span><textarea id="w-why" name="reason" className="kv-textarea" rows={2} maxLength={500} defaultValue={reason} /></label>
            {reason !== '' && !reasonOk && <p className="kv-field__hint">{t.t('swf.reasonMin10')}</p>}
            <button type="submit" className="kv-btn--link">{t.t('mutate.reason.check')}</button>
          </form>
          {reasonOk ? (
            <form action={rerunWastageAction} className="kv-actions">
              <input type="hidden" name="reason" value={reason} /><input type="hidden" name="key" value={randomUUID()} />
              <button type="submit" className="kv-btn kv-btn--primary">{t.t('mutate.confirm')}</button>{' '}
              <Link href={WASTAGE_HREF} className="kv-btn--link">{t.t('mutate.cancel')}</Link>
            </form>
          ) : <p><Link href={WASTAGE_HREF} className="kv-btn--link">{t.t('mutate.cancel')}</Link></p>}
        </>
      )}
      {step === 'success' && (
        <>
          <div className="kv-card kv-card--notice" role="status"><p>{t.t('swf.wastage.rerun.done', { written: searchParams.written ?? '0', existing: searchParams.existing ?? '0' })}</p></div>
          <AuditEntryCard t={t} lang={lang} entityType="wastage_events" entityId={null} action="insights.wastage_rerun" />
          <p><Link href={WASTAGE_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </>
      )}
      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('mutate.failure.title')}</p>
          <ul>{failedCodes(searchParams.error).map((x) => <li key={x}>{t.t(swfCodeKey(x))} <code>{x}</code></li>)}</ul>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p><Link href={`${base}?${new URLSearchParams({ step: 'confirm', ...(reason ? { reason } : {}) }).toString()}`} className="kv-btn--link">{t.t('mutate.retry')}</Link>{' · '}<Link href={WASTAGE_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
