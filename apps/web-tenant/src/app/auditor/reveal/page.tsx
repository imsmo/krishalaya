// apps/web-tenant/src/app/auditor/reveal/page.tsx · THE RECORDED REVEAL of one audit entry's masked fields (PC-56 TENANT-9c, F-9).
// `member.pii.reveal` (1b's control) and a reason of at least 20 characters. The API records the reveal (a read-log row and an
// `audit.entry.revealed` trail row, never the values) BEFORE it answers; the console then re-opens the row with the reveal's
// own grant (its read-log id) — so no value ever travels in a URL. An auditor session never reaches the act: it holds no
// reveal, and the realm refuses it every non-GET.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../lib/session';
import { tenantHasPerm } from '../../../lib/auth';
import { getTranslator } from '../../../lib/i18n';
import { AUDITOR_HREF } from '../../../features/auditor/realm';
import { revealAuditEntryAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('auditor.reveal.title'), robots: { index: false, follow: false } };
}

const REVEAL_ERRORS = ['NO_PERMISSION', 'REVEAL_REASON_TOO_SHORT', 'AUDIT_ENTRY_NOT_FOUND', 'AUDITOR_READ_ONLY', 'reveal'] as const;

export default async function RevealPage({ searchParams }: { searchParams: { entry?: string; error?: string } }) {
  await requireSession('/auditor');
  const t = getTranslator();
  const id = typeof searchParams.entry === 'string' && /^\d{1,19}$/.test(searchParams.entry) ? searchParams.entry : null;
  const err = (REVEAL_ERRORS as readonly string[]).includes(searchParams.error ?? '') ? searchParams.error! : null;
  const can = tenantHasPerm('member.pii.reveal');
  return (
    <section>
      <h1>{t.t('auditor.reveal.title')}</h1>
      <p className="kv-field__hint"><Link href={id ? `${AUDITOR_HREF}?entry=${id}` : AUDITOR_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
      {!id && <div className="kv-card kv-card--notice" role="status"><p>{t.t('auditor.state.notFound')}</p></div>}
      {err && <div className="kv-error" role="alert"><p>{t.t(`auditor.reveal.error.${err}`)}</p></div>}
      {id && !can && <div className="kv-card kv-card--notice" role="status"><p>{t.t('auditor.reveal.restricted')}</p></div>}
      {id && can && (
        <form action={revealAuditEntryAction} className="kv-card kv-form">
          <p>{t.t('auditor.reveal.rule')}</p>
          <input type="hidden" name="id" value={id} />
          <label className="kv-field" htmlFor="r-reason"><span>{t.t('auditor.reveal.reason')}</span>
            <textarea id="r-reason" name="reason" className="kv-textarea" rows={3} minLength={20} maxLength={500} required /></label>
          <p className="kv-field__hint">{t.t('auditor.reveal.recorded')}</p>
          <button type="submit" className="kv-btn kv-btn--primary">{t.t('auditor.reveal.proceed')}</button>{' '}
          <Link href={`${AUDITOR_HREF}?entry=${id}`} className="kv-btn--link">{t.t('kyc.act.cancel')}</Link>
        </form>
      )}
    </section>
  );
}
