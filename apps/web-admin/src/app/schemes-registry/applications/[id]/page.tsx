// apps/web-admin/src/app/schemes-registry/applications/[id]/page.tsx · W074's drill-in (PC-56 ADMIN-4b).
//
// STILL MASKED. The drill-in exists to show the CHAIN — the 9-state event trail, the version pointer, the rejection
// code and the officer's own words — none of which needs a phone number. Reading the real number is a separate act
// with its own form, its own mandatory reason, and an audit row written before any data comes back.
//
// `form_data` is NOT shown at all, and the page says so. It is farmer-entered free-form jsonb that an assisted-flow
// operator may have typed anything into; there is no way to know in advance what PII is inside it, so it is withheld
// rather than rendered and hoped over.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../lib/admin-client';
import { DataTable, Column } from '../../../../components/DataTable';
import { getTranslator } from '../../../../lib/i18n';
import { adminNoticeKey } from '../../../../features/nav/nav-model';
import { eligibilityLabel, eligibilityTone, rulesRecoverable, UNMASK_REASON_MIN, type ApplicationRow } from '../../../../features/schemes-registry/oversight';
import { unmaskApplicantAction } from '../../actions';

import { Button, Callout, StatusPill } from '@krishalaya/ui';
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('sov.appTitle'), robots: { index: false, follow: false } };
}

const ERR = new Set(['reasonTooShort', 'reasonTooLong', 'elevation', 'notFound', 'invalid', 'generic']);

interface EventRow { fromStatus: string | null; toStatus: string; note: string | null; actorUserId: string | null; createdAt: string | null }
interface AppDetail extends ApplicationRow { rejectionReason: string | null; events: EventRow[]; formDataWithheld: boolean }

export default async function ApplicationDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();

  let a: AppDetail | undefined; let notice: string | undefined;
  try { a = (await adminGet<AppDetail>(`schemes-oversight/applications/${encodeURIComponent(params.id)}`)).data; }
  catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`);
  }
  if (!a) {
    return <section><p className="kv-backlink"><Link href="/schemes-registry/applications">{t.t('sov.backApps')}</Link></p><p className="kv-error" role="alert">{notice}</p></section>;
  }

  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const l = eligibilityLabel(a.eligibility);
  const evCols: Column<EventRow>[] = [
    { header: t.t('sov.evWhen'), cell: (e) => e.createdAt ?? t.t('common.dash') },
    { header: t.t('sov.evFrom'), cell: (e) => (e.fromStatus ? t.t(`sov.state.${e.fromStatus}`) : t.t('sov.evStart')) },
    { header: t.t('sov.evTo'), cell: (e) => t.t(`sov.state.${e.toStatus}`) },
    { header: t.t('sov.evNote'), cell: (e) => e.note ?? t.t('common.dash') },
    { header: t.t('sov.evActor'), cell: (e) => e.actorUserId ?? t.t('common.dash') },
  ];

  return (
    <section>
      <p className="kv-backlink"><Link href="/schemes-registry/applications">{t.t('sov.backApps')}</Link></p>
      <h1>{a.schemeCode} · <span className={a.statusClass}>{t.t(`sov.state.${a.status}`)}</span></h1>
      {searchParams.ok === 'unmasked' && <p className="kv-success" role="status">{t.t('sov.ok.unmasked')}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`sov.error.${errKey}`)}</p>}

      <dl className="kv-facts">
        <div className="kv-facts__row">
          <dt>{t.t('sov.applicant')}</dt>
          <dd><span className="kv-masked">{a.applicant.nameMasked ?? t.t('sov.noName')} · {a.applicant.phoneMasked ?? t.t('sov.noPhone')}</span></dd>
        </div>
        <div className="kv-facts__row"><dt>{t.t('sov.tenant')}</dt><dd>{a.tenantName ?? a.tenantId}</dd></div>
        <div className="kv-facts__row">
          <dt>{t.t('sov.filedUnder')}</dt>
          <dd>
            v{a.schemeVersion}
            {/* THE POINT OF ADMIN-4, RESTATED WHERE IT IS ACTED ON. A grievance officer reading a refusal needs to
                know when the platform cannot show them the rule the refusal was made under. */}
            {rulesRecoverable(a)
              ? <> — <Link href={`/schemes-registry/schemes/${encodeURIComponent(a.schemeId)}/versions`}>{t.t('sov.viewRules')}</Link></>
              : <> <StatusPill tone="warning" label={t.t('sov.rulesLost')} /> <span className="kv-detail__muted">{t.t('sov.rulesLostWhy')}</span></>}
          </dd>
        </div>
        <div className="kv-facts__row"><dt>{t.t('sov.aiCheck')}</dt><dd><StatusPill tone={eligibilityTone(a.eligibility)} label={`${t.t(`sov.elig.${l.key}`)}${l.score ? ` · ${l.score}` : ''}`} /></dd></div>
        <div className="kv-facts__row"><dt>{t.t('sov.assisted')}</dt><dd>{a.assisted ? (a.assistedBy ?? t.t('sov.assistedYes')) : t.t('sov.assistedSelf')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('sov.govtRef')}</dt><dd>{a.govtAppRef ?? t.t('sov.awaitingAck')}</dd></div>
        {a.rejectionReasonCode && <div className="kv-facts__row"><dt>{t.t('sov.rejectionCode')}</dt><dd>{t.t(`sov.rc.${a.rejectionReasonCode}`)}</dd></div>}
        {a.status === 'rejected' && !a.rejectionReasonCode && (
          <div className="kv-facts__row"><dt>{t.t('sov.rejectionCode')}</dt><dd><StatusPill tone="neutral" label={t.t('sov.rcUncoded')} /></dd></div>
        )}
        {a.rejectionReason && <div className="kv-facts__row"><dt>{t.t('sov.rejectionReason')}</dt><dd>{a.rejectionReason}</dd></div>}
      </dl>

      {a.formDataWithheld && <Callout tone="warning">{t.t('sov.formWithheld')}</Callout>}

      <h2>{t.t('sov.unmaskHeading')}</h2>
      {/* THE CONTROL IS PRESENT (the viewer holds the permission — that is what got them here) but the REASON is
          mandatory with a real floor, because this row is the only record of why a farmer's number was read. */}
      <form action={unmaskApplicantAction} className="kv-card kv-action-card">
        <input type="hidden" name="id" value={a.id} />
        <p className="kv-field__hint">{t.t('sov.unmaskHint')}</p>
        <label className="kv-field__label" htmlFor="unmaskReason">{t.t('sov.unmaskReason')}</label>
        <input id="unmaskReason" name="reason" className="kv-input" required minLength={UNMASK_REASON_MIN} maxLength={500} />
        <p className="kv-field__hint">{t.t('sov.unmaskReasonHint', { min: String(UNMASK_REASON_MIN) })}</p>
        <Button type="submit">{t.t('sov.unmask')}</Button>
      </form>

      <h2>{t.t('sov.trailHeading')}</h2>
      <DataTable columns={evCols} rows={a.events ?? []} empty={t.t('sov.noEvents')} />
    </section>
  );
}
