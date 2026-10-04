// apps/web-tenant/src/app/people/verification/[id]/page.tsx · W158 (was W122 at /kyc/[docId]) · ONE KYC DOCUMENT — PC-56 TENANT-9a; moved + extended by TENANT-SW-c.
//
// The record as the API holds it (`GET kyc/desk/documents/:id`): subject, type, masked number, issuer, validity (and days
// left in the cooperative's own calendar), the roles it evidences beside each role's recorded and effective status, the
// whole HISTORY (submit · reveal · verify · reject · request more · expire, who and when — a reveal's reason stays on the
// audit trail, not on this page), the document it renews or that renews it, and the desk's acts as VERDICTS with every
// refusal named. *Reveal full document (recorded)* and the decisions go through the mutate chain; *Upload renewal* through
// the form chain. The "masked preview" and "by platform verification" are refused by name; *Retry* is a page load.
import type { Metadata } from 'next';
import Link from 'next/link';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { KycDeskRecord } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { getTranslator, getLang } from '../../../../lib/i18n';
import {
  KYC_DESK_HREF, actHref, actKey, deskState, docHref, historyActKey, reasonKey, refusalKey, renewingSoon, statusKey, statusTone,
  subjectKindKey, submitHref, viaKey,
} from '../../../../features/kyc/desk';
import { auditHref } from '../../../../features/forms/chain';
// PC-56 TENANT-SW-c (W158): recusal banner (the database's verdict), the claim + Skip (take next), what verifying UNLOCKS (read from the
// 0125 money gate), the evidence already verified for the same roles (read), and the canon's unbacked promises refused by name.
import { randomUUID } from 'node:crypto';
import { ME_SECURITY_HREF, SKIP_REASONS, knownPurposeKey, parseCodes, recusalKey, skipReasonKey, swcCodeKey } from '../../../../features/swc/console';
import { releaseClaimAction, skipClaimAction } from './claim-actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('kyc.doc.title'), robots: { index: false, follow: false } };
}

export default async function KycDocumentPage({ params, searchParams = {} }: { params: { id: string }; searchParams?: Record<string, string | undefined> }) {
  await requireSession(docHref(params.id));
  const t = getTranslator();
  const lang = getLang();
  let rec: KycDeskRecord | null = null; let state: string | null = null;
  try { rec = await tenantClient().kyc.deskDocument(params.id); } catch (e) { const err = e instanceof SdkError ? e : null; state = deskState(err?.code, err?.status); }
  const day = (d: string | null) => (d ? formatDate(`${d}T12:00:00Z`, lang, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : null);
  const at = (iso: string | null) => (iso ? formatDate(iso, lang, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null);

  if (!rec) {
    const s = state ?? 'error';
    return (
      <section>
        <p><Link href={KYC_DESK_HREF} className="kv-btn--link">{t.t('kyc.doc.back')}</Link></p>
        <div className={s === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={s === 'error' ? 'alert' : 'status'}>
          <h1>{t.t(s === 'notFound' ? 'kyc.doc.state.notFound.title' : `kyc.desk.state.${s}.title`)}</h1>
          <p>{t.t(s === 'notFound' ? 'kyc.doc.state.notFound.body' : s === 'error' ? 'kyc.doc.state.error.body' : `kyc.desk.state.${s}.body`)}</p>
          {s === 'error' && <p><Link href={docHref(params.id)} className="kv-btn--link">{t.t('kyc.desk.retryLoad')}</Link> <span className="kv-field__hint">{t.t('kyc.desk.refused.retry')}</span></p>}
        </div>
      </section>
    );
  }
  const d = rec.doc;
  const daysLeft = d.validUntil ? Math.round((Date.parse(`${d.validUntil}T12:00:00Z`) - Date.parse(`${rec.today}T12:00:00Z`)) / 86_400_000) : null;
  const soon = renewingSoon(d.status, daysLeft);
  const reveal = rec.acts.find((a) => a.act === 'reveal');
  const decisions = rec.acts.filter((a) => a.act !== 'reveal');

  return (
    <section>
      <p><Link href={KYC_DESK_HREF} className="kv-btn--link">{t.t('kyc.doc.back')}</Link></p>
      <h1>{d.docTypeName} <span className={`kv-badge kv-badge--${statusTone(d.status)}`}>{t.t(statusKey(d.status))}</span>{soon && <span className="kv-field__hint"> · {t.t('kyc.desk.renewingSoon')}</span>}</h1>
      <p className="kv-field__hint">
        {t.t(subjectKindKey(d.subjectKind))}{d.subjectKind === 'user' && d.subjectName ? ` · ${d.subjectName}` : ''}
        {' · '}{t.t('kyc.doc.uploaded', { at: at(d.createdAt) ?? '', by: d.submittedByName ?? t.t('common.dash') })}
        {d.reviewedAt && <> · {t.t(d.verifyMethod?.startsWith('ekyc:') ? 'kyc.doc.verifiedByProvider' : 'kyc.doc.decidedBy', { at: at(d.reviewedAt) ?? '', by: d.reviewedByName ?? t.t('common.dash'), provider: d.verifyMethod ?? '' })}</>}
      </p>
      <p className="kv-field__hint">{t.t('kyc.desk.refused.platformDesk')}</p>

      {recusalKey(rec.recusal?.code) && (
        <div className="kv-card kv-card--notice" role="alert">
          <strong>{t.t(recusalKey(rec.recusal?.code)!)}</strong>
          <p className="kv-field__hint">{t.t('swc.recusal.howDecided')}</p>
        </div>
      )}
      {parseCodes(searchParams.error).map((c) => <p key={c} className="kv-error" role="alert">{t.t(swcCodeKey(c))}</p>)}
      {rec.claim && !rec.claim.mine && <p className="kv-badge kv-badge--muted">{t.t('swc.desk.claim.other', { who: rec.claim.byMasked ?? '••' })}</p>}
      {rec.claim?.mine && rec.claim.id && (
        <div className="kv-card">
          <h2>{t.t('swc.claim.title')}</h2>
          <p>{t.t('swc.claim.until', { at: at(rec.claim.expiresAt) ?? '' })}</p>
          <form action={skipClaimAction} className="kv-form">
            <input type="hidden" name="claimId" value={rec.claim.id} /><input type="hidden" name="docId" value={d.id} />
            <input type="hidden" name="idempotencyKey" value={randomUUID()} />
            <label className="kv-field" htmlFor="skip-reason"><span>{t.t('swc.claim.skipReason')}</span>
              <select id="skip-reason" name="reasonCode" className="kv-select" required defaultValue="">
                <option value="" disabled>{t.t('swc.claim.skipChoose')}</option>
                {SKIP_REASONS.map((r) => <option key={r} value={r}>{t.t(skipReasonKey(r))}</option>)}
              </select></label>
            <label className="kv-field" htmlFor="skip-note"><span>{t.t('swc.claim.skipNote')}</span>
              <input id="skip-note" name="note" className="kv-input" maxLength={300} /></label>
            <p className="kv-field__hint">{t.t('swc.claim.skipHint')} <a href={ME_SECURITY_HREF} className="kv-btn--link">{t.t('swc.desk.declareLink')}</a></p>
            <button type="submit" className="kv-btn">{t.t('swc.claim.skip')}</button>
          </form>
          <form action={releaseClaimAction}><input type="hidden" name="claimId" value={rec.claim.id} /><input type="hidden" name="docId" value={d.id} />
            <button type="submit" className="kv-btn--link">{t.t('swc.claim.release')}</button></form>
        </div>
      )}

      <dl className="kv-facts">
        <dt>{t.t('kyc.desk.col.number')}</dt><dd>{d.docNoMasked ?? t.t('common.dash')}</dd>
        <dt>{t.t('kyc.doc.issuedBy')}</dt><dd>{d.issuedBy ?? t.t('common.dash')}</dd>
        <dt>{t.t('kyc.doc.validity')}</dt><dd>{d.validUntil ? `${day(d.validFrom) ?? t.t('common.dash')} → ${day(d.validUntil)}${daysLeft !== null ? ` · ${daysLeft >= 0 ? t.t('kyc.desk.daysLeft', { n: formatNumber(daysLeft, lang) }) : t.t('kyc.doc.lapsed')}` : ''}` : t.t('kyc.desk.perpetual')}</dd>
        {d.status === 'rejected' && <><dt>{t.t('kyc.doc.why')}</dt><dd>{d.reasonCode ? t.t(reasonKey(d.reasonCode)) : t.t('common.dash')}{d.rejectReason && d.rejectReason !== d.reasonCode ? <span className="kv-field__hint"> · {d.rejectReason}</span> : null}</dd></>}
        {d.supersedesId && <><dt>{t.t('kyc.doc.renews')}</dt><dd><Link href={docHref(d.supersedesId)} className="kv-btn--link">{t.t('kyc.desk.openDoc')}</Link></dd></>}
        {d.supersededById && <><dt>{t.t('kyc.doc.renewedBy')}</dt><dd><Link href={docHref(d.supersededById)} className="kv-btn--link">{t.t('kyc.desk.openDoc')}</Link></dd></>}
      </dl>
      {(d.status === 'verified' || d.status === 'expired' || d.status === 'rejected') && !d.supersededById && rec.can.manage && (
        <p><Link href={submitHref({ subjectKind: d.subjectKind, docTypeCode: d.docTypeCode, userId: d.userId })} className="kv-btn">{t.t(d.status === 'rejected' ? 'kyc.doc.resubmit' : 'kyc.doc.uploadRenewal')}</Link></p>
      )}

      <h2>{t.t('kyc.doc.preview')}</h2>
      <p>{d.hasMedia ? t.t('kyc.doc.evidence', { mime: d.mediaMime ?? t.t('common.dash'), bytes: d.mediaBytes ? formatNumber(Number(d.mediaBytes), lang) : t.t('common.dash'), scan: t.t(`kyc.doc.scan.${['clean', 'pending', 'infected', 'failed'].includes(d.scanStatus ?? '') ? d.scanStatus : 'unknown'}`) }) : t.t('kyc.doc.noEvidence')}</p>
      <p className="kv-field__hint">{t.t('kyc.desk.refused.maskedPreview')}</p>
      {reveal && (reveal.allowed || reveal.refusals.every((r) => r === 'REVEAL_REASON_TOO_SHORT')) ? (
        <p><Link href={actHref(d.id, 'reveal')} className="kv-btn">{t.t('kyc.desk.act.reveal')}</Link></p>
      ) : reveal ? (
        <div className="kv-card kv-card--notice" role="note"><p>{t.t('kyc.doc.revealRestricted')}</p>{reveal.refusals.map((r) => <p className="kv-field__hint" key={r}>{t.t(refusalKey(r))}</p>)}</div>
      ) : null}

      {d.subjectKind === 'user' && (
        <>
          <h2>{t.t('kyc.doc.roles')}</h2>
          <table className="kv-table">
            <thead><tr><th scope="col">{t.t('kyc.doc.col.role')}</th><th scope="col">{t.t('kyc.doc.col.evidenced')}</th><th scope="col">{t.t('kyc.doc.col.recorded')}</th><th scope="col">{t.t('kyc.doc.col.effective')}</th></tr></thead>
            <tbody>{rec.roles.map((r) => (
              <tr key={r.roleCode}><th scope="row">{r.roleCode}</th><td>{t.t(r.evidenced ? 'kyc.doc.evidencedYes' : 'kyc.doc.evidencedNo')}</td>
                <td><span className={`kv-badge kv-badge--${statusTone(r.recorded)}`}>{t.t(statusKey(r.recorded))}</span></td>
                <td><span className={`kv-badge kv-badge--${statusTone(r.effective)}`}>{t.t(statusKey(r.effective))}</span></td></tr>
            ))}</tbody>
          </table>
          <p className="kv-field__hint">{t.t('kyc.doc.rolesRule')}</p>
        </>
      )}

      {d.subjectKind === 'user' && (
        <>
          <h2>{t.t('swc.unlocks.title')}</h2>
          {(rec.unlocks ?? []).length === 0 ? <p className="kv-field__hint">{t.t('swc.unlocks.none')}</p> : (
            <ul className="kv-list">{(rec.unlocks ?? []).map((u) => (
              <li key={u.roleCode}><strong>{u.roleCode}</strong> · <span className={`kv-badge kv-badge--${statusTone(u.effective)}`}>{t.t(statusKey(u.effective))}</span>
                {' · '}{u.purposes.length ? u.purposes.map((p) => t.t(knownPurposeKey(p))).join(', ') : t.t('swc.unlocks.noPurpose')}
                {' · '}<span className="kv-field__hint">{t.t(u.unlocksOnVerify ? 'swc.unlocks.wouldUnlock' : 'swc.unlocks.alreadyOpen')}</span></li>
            ))}</ul>
          )}
          <p className="kv-field__hint">{t.t('swc.unlocks.source')}</p>
          <p className="kv-field__hint">{t.t('swc.refused.listingGate')}</p>
          <h2>{t.t('swc.reuse.title')}</h2>
          {(rec.evidenceReuse ?? []).length === 0 ? <p className="kv-field__hint">{t.t('swc.reuse.none')}</p> : (
            <ul className="kv-list">{(rec.evidenceReuse ?? []).map((r) => (
              <li key={r.documentId}>{t.t(r.viaProvider ? 'swc.reuse.lineProvider' : 'swc.reuse.line', { doc: r.docTypeCode, roles: r.roles.join(', ') })} <Link href={docHref(r.documentId)} className="kv-btn--link">{t.t('kyc.desk.openDoc')}</Link></li>
            ))}</ul>
          )}
          <p className="kv-field__hint">{t.t('swc.refused.attestationPath')}</p>
          <p className="kv-field__hint">{t.t('swc.refused.aiPrecheck')}</p>
          <p className="kv-field__hint">{t.t('swc.refused.nameInference')}</p>
        </>
      )}

      <h2>{t.t('kyc.doc.renewalHeading')}</h2>
      <ol className="kv-steps"><li>{t.t('kyc.doc.renewal.1')}</li><li>{t.t('kyc.doc.renewal.2')}</li><li>{t.t('kyc.doc.renewal.3')}</li></ol>

      <h2>{t.t('kyc.doc.decide')}</h2>
      <ul className="kv-list">
        {decisions.map((v) => (
          <li key={v.act}>
            {v.allowed ? <Link href={actHref(d.id, v.act)} className="kv-btn">{t.t(actKey(v.act))}</Link> : <span className="kv-badge kv-badge--muted">{t.t(actKey(v.act))}</span>}
            {!v.allowed && v.refusals.map((r) => <span className="kv-field__hint" key={r}> · {t.t(refusalKey(r))}</span>)}
          </li>
        ))}
      </ul>

      <h2>{t.t('kyc.doc.history')}</h2>
      <ol className="kv-timeline">
        {rec.history.map((h, i) => (
          <li key={`${h.decidedAt}-${i}`}>
            <strong>{t.t(historyActKey(h.act))}</strong> · {at(h.decidedAt)} · {h.decidedByName ?? t.t(viaKey(h.via))}
            {h.reasonCode && <span className="kv-field__hint"> · {t.t(reasonKey(h.reasonCode))}</span>}
            {h.note && <span className="kv-field__hint"> · {h.note}</span>}
          </li>
        ))}
      </ol>
      <p><Link href={auditHref('kyc_document', d.id)} className="kv-btn--link">{t.t('form.viewAudit')}</Link></p>
      <p className="kv-field__hint">{t.t('kyc.desk.refused.categoryPause')}</p>
    </section>
  );
}
