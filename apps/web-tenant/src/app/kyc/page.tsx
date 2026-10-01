// apps/web-tenant/src/app/kyc/page.tsx · W121 · THE KYC CENTRE — the organisation's documents + the member verification desk.
// PC-56 TENANT-9a.
//
// Every figure is the API's live answer (`GET kyc/desk`, `GET kyc/desk/queue`): the organisation's verification is
// COMPUTED (every document type REQUIRED for its country verified and unexpired — the missing types named, never a flag);
// the member tiles are counts over the documents and the roles that require KYC. The queue is keyset-paged, filtered by
// GET-forms (subject, status, document type, role, expiring within N days). Six states: loading (loading.tsx), flagged
// off (the API's 404), restricted (`KYC_DESK_RESTRICTED`), couldn't load, no documents yet, the desk. The canon's
// "camp Sat 18 Jul", "categories pause automatically", the masked preview and the row kebabs are refused BY NAME; the
// couldn't-load *Retry* is a page load (the 7d ruling), never the mutate chain.
import type { Metadata } from 'next';
import Link from 'next/link';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { KycDeskOverview, KycDeskRow, KycDeskCatalogue } from '@krishalaya/sdk-js';
import { tenantClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { getTranslator, getLang } from '../../lib/i18n';
import {
  DESK_STATUSES, EXPIRING_WINDOWS, KYC_DESK_HREF, KYC_ME_HREF, deskState, docHref, orgStateKey, percentOf, queueFilters, queueHref,
  reasonKey, renewingSoon, statusKey, statusTone, subjectKindKey, submitHref,
} from '../../features/kyc/desk';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('kyc.desk.title'), robots: { index: false, follow: false } };
}

export default async function KycDeskPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession(KYC_DESK_HREF);
  const t = getTranslator();
  const lang = getLang();
  const f = queueFilters(searchParams);
  const c = tenantClient().kyc;

  let ov: KycDeskOverview | null = null; let state: string | null = null;
  try { ov = await c.desk(); } catch (e) { const err = e instanceof SdkError ? e : null; state = deskState(err?.code, err?.status); }
  let rows: KycDeskRow[] = []; let next: string | null = null; let queueFailed = false;
  let cat: KycDeskCatalogue | null = null;
  if (ov) {
    try { const q = await c.deskQueue({ ...f, limit: 25 }); rows = q.items; next = q.nextCursor; } catch { queueFailed = true; }
    try { cat = await c.deskCatalogue(); } catch { cat = null; }
  }
  const day = (d: string | null) => (d ? formatDate(`${d}T12:00:00Z`, lang, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : null);
  const n = (x: number) => formatNumber(x, lang);

  if (!ov) {
    return (
      <section>
        <h1>{t.t('kyc.desk.title')}</h1>
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <h2>{t.t(`kyc.desk.state.${state}.title`)}</h2>
          <p>{t.t(`kyc.desk.state.${state}.body`)}</p>
          {state === 'error' && <p><Link href={queueHref(f)} className="kv-btn--link">{t.t('kyc.desk.retryLoad')}</Link> <span className="kv-field__hint">{t.t('kyc.desk.refused.retry')}</span></p>}
          <p><Link href={KYC_ME_HREF} className="kv-btn--link">{t.t('kyc.desk.myOwn')}</Link></p>
        </div>
      </section>
    );
  }

  const org = ov.organisation; const m = ov.members;
  const pct = percentOf(m.fullyVerified, m.people);
  const orgEmpty = org.documentCount === 0;

  return (
    <section>
      <h1>{t.t('kyc.desk.title')} <span className={`kv-badge kv-badge--${org.verified ? 'ok' : 'warn'}`}>{t.t(org.verified ? 'kyc.desk.org.verified' : 'kyc.desk.org.notVerified')}</span></h1>
      <p className="kv-field__hint">{t.t('kyc.desk.subtitle')}</p>
      <p>
        {ov.can.manage && <Link href={submitHref({ subjectKind: 'organisation' })} className="kv-btn kv-btn--primary">{t.t('kyc.desk.upload')}</Link>}{' '}
        <Link href={KYC_ME_HREF} className="kv-btn--link">{t.t('kyc.desk.myOwn')}</Link>
      </p>
      {!ov.can.manage && <div className="kv-card kv-card--notice" role="note"><p>{t.t('kyc.desk.state.restricted.uploadBody')}</p></div>}

      <h2>{t.t('kyc.desk.org.heading')}</h2>
      {orgEmpty ? (
        <div className="kv-card kv-card--notice" role="status">
          <h3>{t.t('kyc.desk.state.empty.title')}</h3>
          <p>{t.t('kyc.desk.state.empty.body')}</p>
          <p className="kv-field__hint">{t.t('kyc.desk.refused.orgPayoutLink')}</p>
          {ov.can.manage && <p><Link href={submitHref({ subjectKind: 'organisation', docTypeCode: 'society_registration' })} className="kv-btn">{t.t('kyc.desk.uploadFirst')}</Link></p>}
        </div>
      ) : null}
      <p className="kv-field__hint">
        {org.verified
          ? t.t('kyc.desk.org.verifiedAt', { at: org.verifiedAt ? (formatDate(org.verifiedAt, lang, { day: 'numeric', month: 'short', year: 'numeric' }) ?? '') : t.t('common.dash') })
          : org.reason === 'no_requirement_declared' ? t.t('kyc.desk.org.noRequirement', { country: ov.countryCode ?? t.t('common.dash') })
            : t.t('kyc.desk.org.missing', { types: org.missingRequired.map((code) => cat?.docTypes.find((d) => d.code === code && d.subjectKind === 'organisation')?.name ?? code).join(', ') })}
      </p>
      <table className="kv-table">
        <caption className="kv-sr-only">{t.t('kyc.desk.org.heading')}</caption>
        <thead><tr><th scope="col">{t.t('kyc.desk.col.document')}</th><th scope="col">{t.t('kyc.desk.col.number')}</th><th scope="col">{t.t('kyc.desk.col.validUntil')}</th><th scope="col">{t.t('kyc.desk.col.status')}</th><th scope="col">{t.t('kyc.desk.col.open')}</th></tr></thead>
        <tbody>
          {org.lines.map((l) => {
            const name = l.docTypeName ?? cat?.docTypes.find((d) => d.code === l.docTypeCode && d.subjectKind === 'organisation')?.name ?? l.docTypeCode;
            const soon = renewingSoon(l.state, l.daysLeft);
            return (
              <tr key={l.docTypeCode}>
                <th scope="row">{name}{l.isRequired && <span className="kv-field__hint"> · {t.t('kyc.desk.org.required')}</span>}</th>
                <td>{l.docNoMasked ?? t.t('common.dash')}</td>
                <td>{l.state === 'missing' ? t.t('common.dash') : l.validUntil ? `${day(l.validUntil)}${l.daysLeft !== null && l.daysLeft >= 0 ? ` · ${t.t('kyc.desk.daysLeft', { n: n(l.daysLeft) })}` : ''}` : t.t('kyc.desk.perpetual')}</td>
                <td>
                  <span className={`kv-badge kv-badge--${statusTone(l.state)}`}>{t.t(orgStateKey(l.state))}</span>
                  {soon && <span className="kv-field__hint"> · {t.t('kyc.desk.renewingSoon')}</span>}
                  {l.renewalPendingId && <span className="kv-field__hint"> · <Link href={docHref(l.renewalPendingId)} className="kv-btn--link">{t.t('kyc.desk.renewalPending')}</Link></span>}
                </td>
                <td>
                  {l.documentId && <Link href={docHref(l.documentId)} className="kv-btn--link">{t.t(soon ? 'kyc.desk.renew' : 'kyc.desk.openDoc')}</Link>}
                  {!l.documentId && ov!.can.manage && <Link href={submitHref({ subjectKind: 'organisation', docTypeCode: l.docTypeCode })} className="kv-btn--link">{t.t('kyc.desk.upload')}</Link>}
                </td>
              </tr>
            );
          })}
          {org.unlisted.map((d) => (
            <tr key={d.id}><th scope="row">{d.docTypeName}</th><td>{d.docNoMasked ?? t.t('common.dash')}</td><td>{d.validUntil ? day(d.validUntil) : t.t('kyc.desk.perpetual')}</td>
              <td><span className={`kv-badge kv-badge--${statusTone(d.status)}`}>{t.t(statusKey(d.status))}</span></td><td><Link href={docHref(d.id)} className="kv-btn--link">{t.t('kyc.desk.openDoc')}</Link></td></tr>
          ))}
        </tbody>
      </table>
      <p className="kv-field__hint">{t.t('kyc.desk.org.showing', { n: n(org.lines.length + org.unlisted.length) })} · {t.t('kyc.desk.refused.kebab')}</p>
      <p className="kv-field__hint">{t.t('kyc.desk.refused.platformDesk')}</p>

      <h2>{t.t('kyc.desk.members.heading')}</h2>
      <dl className="kv-tiles">
        <div className="kv-tile"><dt>{t.t('kyc.desk.tile.verified')}</dt><dd><strong>{n(m.fullyVerified)}</strong> / {n(m.people)}{pct !== null && <span className="kv-field__hint"> · {t.t('kyc.desk.percent', { n: n(pct) })}</span>}</dd><dd className="kv-field__hint">{t.t('kyc.desk.tile.verifiedHint')}</dd></div>
        <div className="kv-tile"><dt>{t.t('kyc.desk.tile.pending')}</dt><dd><strong>{n(m.pending)}</strong>{m.oldestPendingDays !== null && <span className="kv-field__hint"> · {t.t('kyc.desk.tile.oldest', { n: n(m.oldestPendingDays) })}</span>}</dd><dd className="kv-field__hint">{t.t('kyc.desk.refused.kycCamp')}</dd></div>
        <div className="kv-tile"><dt>{t.t('kyc.desk.tile.rejected')}</dt><dd><strong>{n(m.rejectedOpen)}</strong>{m.topRejectReason && <span className="kv-field__hint"> · {t.t('kyc.desk.tile.mostly', { reason: t.t(reasonKey(m.topRejectReason)) })}</span>}</dd></div>
        <div className="kv-tile"><dt>{t.t('kyc.desk.tile.expired')}</dt><dd><strong>{n(m.expiredOpen)}</strong></dd><dd className="kv-field__hint">{t.t('kyc.desk.tile.reminders', { n: n(m.remindersSent), soon: n(m.expiringSoon) })}</dd></div>
      </dl>
      <p className="kv-field__hint">{t.t('kyc.desk.lifecycle')}</p>

      <h3>{t.t('kyc.desk.queue.heading')}</h3>
      <form action={KYC_DESK_HREF} method="get" className="kv-card kv-form kv-filters">
        <label className="kv-field" htmlFor="q-subject"><span>{t.t('kyc.desk.filter.subject')}</span>
          <select id="q-subject" name="subjectKind" className="kv-select" defaultValue={f.subjectKind ?? ''}>
            <option value="">{t.t('kyc.desk.filter.any')}</option>
            <option value="user">{t.t(subjectKindKey('user'))}</option>
            <option value="organisation">{t.t(subjectKindKey('organisation'))}</option>
          </select></label>
        <label className="kv-field" htmlFor="q-status"><span>{t.t('kyc.desk.filter.status')}</span>
          <select id="q-status" name="status" className="kv-select" defaultValue={f.status ?? ''}>
            <option value="">{t.t('kyc.desk.filter.any')}</option>
            {DESK_STATUSES.map((s) => <option key={s} value={s}>{t.t(statusKey(s))}</option>)}
          </select></label>
        <label className="kv-field" htmlFor="q-type"><span>{t.t('kyc.desk.filter.docType')}</span>
          <select id="q-type" name="docTypeCode" className="kv-select" defaultValue={f.docTypeCode ?? ''}>
            <option value="">{t.t('kyc.desk.filter.any')}</option>
            {[...new Map((cat?.docTypes ?? []).map((d) => [d.code, d.name])).entries()].map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select></label>
        <label className="kv-field" htmlFor="q-role"><span>{t.t('kyc.desk.filter.role')}</span>
          <select id="q-role" name="roleCode" className="kv-select" defaultValue={f.roleCode ?? ''}>
            <option value="">{t.t('kyc.desk.filter.any')}</option>
            {[...new Set((cat?.docTypes ?? []).flatMap((d) => d.evidences))].sort().map((r) => <option key={r} value={r}>{r}</option>)}
          </select></label>
        <label className="kv-field" htmlFor="q-exp"><span>{t.t('kyc.desk.filter.expiring')}</span>
          <select id="q-exp" name="expiringWithin" className="kv-select" defaultValue={f.expiringWithin !== undefined ? String(f.expiringWithin) : ''}>
            <option value="">{t.t('kyc.desk.filter.any')}</option>
            {EXPIRING_WINDOWS.map((w) => <option key={w} value={String(w)}>{t.t('kyc.desk.filter.within', { n: n(w) })}</option>)}
          </select></label>
        <button type="submit" className="kv-btn">{t.t('kyc.desk.filter.apply')}</button> <Link href={KYC_DESK_HREF} className="kv-btn--link">{t.t('kyc.desk.filter.clear')}</Link>
      </form>
      {queueFailed ? <div className="kv-error" role="alert"><p>{t.t('kyc.desk.state.error.body')}</p></div> : rows.length === 0 ? <p className="kv-field__hint">{t.t('kyc.desk.queue.empty')}</p> : (
        <table className="kv-table">
          <caption className="kv-sr-only">{t.t('kyc.desk.queue.heading')}</caption>
          <thead><tr><th scope="col">{t.t('kyc.desk.col.subject')}</th><th scope="col">{t.t('kyc.desk.col.document')}</th><th scope="col">{t.t('kyc.desk.col.number')}</th><th scope="col">{t.t('kyc.desk.col.status')}</th><th scope="col">{t.t('kyc.desk.col.validUntil')}</th><th scope="col">{t.t('kyc.desk.col.submitted')}</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <th scope="row"><Link href={docHref(r.id)} className="kv-btn--link">{r.subjectKind === 'organisation' ? t.t('kyc.desk.subject.organisation') : (r.subjectName ?? t.t('common.dash'))}</Link></th>
              <td>{r.docTypeName}</td>
              <td>{r.docNoMasked ?? t.t('common.dash')}</td>
              <td><span className={`kv-badge kv-badge--${statusTone(r.status)}`}>{t.t(statusKey(r.status))}</span>{r.reasonCode && <span className="kv-field__hint"> · {t.t(reasonKey(r.reasonCode))}</span>}</td>
              <td>{r.validUntil ? day(r.validUntil) : t.t('kyc.desk.perpetual')}</td>
              <td>{formatDate(r.createdAt, lang, { day: 'numeric', month: 'short' })}{r.submittedByName && <span className="kv-field__hint"> · {r.submittedByName}</span>}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {next && <p><Link href={queueHref(f, next)} className="kv-btn--link">{t.t('kyc.desk.queue.next')}</Link></p>}
      <p className="kv-field__hint">{t.t('kyc.desk.refused.categoryPause')}</p>
    </section>
  );
}
