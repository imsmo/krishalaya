// apps/web-gov/src/app/verification/[id]/page.tsx · GW-4: one KYC case (PC-55 B1, canon W336).
// The whole point of this page is EVIDENCE BEFORE DECISION (Ledger Appendix 6). Until PC-54 W54-1 there was no
// reviewer read at all — approve/reject existed as blind writes. So the order here is deliberate: the facts, then
// the evidence, and only then the two decisions.
//
// WHAT IS AND IS NOT SHOWN. The document NUMBER arrives masked from the API and is rendered as it arrives — this
// console never sees, stores or logs a full Aadhaar/PAN (DPDP §4). The subject appears as a truncated user id, not a
// name. The photo itself is never inlined: the "Open evidence" link goes through a server route that mints a
// short-lived presigned URL, so the image bytes never pass through our servers and no long-lived link exists in the
// page HTML to be copied out of a screenshot.
//
// GATES REFLECT THE API'S STATE MACHINE, THEY DO NOT INVENT ONE (features/verification/review.ts):
//   pending + evidence → Verify or Reject | pending WITHOUT evidence → Reject only, with the reason said out loud
//   verified → Reject only (a legal later revocation) | rejected/expired → no decision; the person re-submits.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '../../../lib/session';
import { govClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatDate } from '@krishalaya/i18n';
import { canRejectKyc, canVerifyKyc, evidenceMissing } from '../../../features/verification/review';
import { decideKycAction } from '../actions';
import type { KycReviewItem } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ver.caseTitle'), robots: { index: false, follow: false } };
}

const OK = new Set(['verify', 'reject']);
const ERR = new Set(['action', 'illegal', 'decision', 'reason', 'reasonLong', 'noEvidence', 'forbidden']);

export default async function VerificationCasePage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  await requireSession(`/verification/${params.id}`);
  const t = getTranslator();
  const lang = getLang();

  let k: KycReviewItem;
  try { k = await govClient().kyc.reviewCase(params.id); }
  catch { notFound(); }   // 404 AND 403 both land here: an officer without the grant learns nothing about the case

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const facts = { status: k.status, mediaId: k.mediaId };

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('ver.caseTitle')}</h1>
        <Link href="/verification" className="kv-btn--link">← {t.t('ver.title')}</Link>
      </div>
      {okKey && <p className="kv-success" role="status">{t.t(`ver.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`ver.error.${errKey}`)}</p>}

      <dl className="kv-facts">
        <div className="kv-facts__row"><dt>{t.t('ver.colStatus')}</dt><dd><span className="kv-badge">{t.t(`ver.box.${k.status}`) || k.status}</span></dd></div>
        <div className="kv-facts__row"><dt>{t.t('ver.colSubject')}</dt><dd>{k.userId.slice(0, 8)}…</dd></div>
        <div className="kv-facts__row"><dt>{t.t('ver.colDocNo')}</dt><dd>{k.docNoMasked ?? t.t('common.dash')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('ver.issuedBy')}</dt><dd>{k.issuedBy ?? t.t('common.dash')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('ver.validity')}</dt><dd>
          {k.validFrom ? formatDate(k.validFrom, lang) : t.t('common.dash')} → {k.validUntil ? formatDate(k.validUntil, lang) : t.t('common.dash')}
        </dd></div>
        <div className="kv-facts__row"><dt>{t.t('ver.verifyMethod')}</dt><dd>{k.verifyMethod ?? t.t('common.dash')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('ver.colSubmitted')}</dt><dd>{k.createdAt ? formatDate(k.createdAt, lang) : t.t('common.dash')}</dd></div>
        {k.reviewedAt && <div className="kv-facts__row"><dt>{t.t('ver.reviewed')}</dt><dd>{formatDate(k.reviewedAt, lang)} · {(k.reviewedBy ?? '').slice(0, 8)}…</dd></div>}
        {k.rejectReason && <div className="kv-facts__row"><dt>{t.t('ver.rejectReason')}</dt><dd>{k.rejectReason}</dd></div>}
      </dl>

      <h2 className="kv-section-title">{t.t('ver.evidence')}</h2>
      {k.mediaId ? (
        <p>
          <a href={`/verification/${encodeURIComponent(k.id)}/evidence`} className="kv-link" target="_blank" rel="noreferrer">{t.t('ver.openEvidence')}</a>
          <span className="kv-field__hint"> {t.t('ver.evidenceHint')}</span>
        </p>
      ) : (
        <p className="kv-notice" role="note">{t.t('ver.noEvidenceNotice')}</p>
      )}
      <p className="kv-field__hint">{t.t('ver.piiNote')}</p>

      <h2 className="kv-section-title">{t.t('ver.decision')}</h2>
      {evidenceMissing(facts) && <p className="kv-notice" role="note">{t.t('ver.verifyBlocked')}</p>}
      <div className="kv-actions">
        {canVerifyKyc(facts) && (
          <form action={decideKycAction} className="kv-inline-form">
            <input type="hidden" name="id" value={k.id} />
            <input type="hidden" name="decision" value="verify" />
            <button type="submit" className="kv-btn">{t.t('ver.verifyBtn')}</button>
          </form>
        )}
      </div>

      {canRejectKyc(facts) && (
        <form action={decideKycAction} className="kv-form kv-card">
          <input type="hidden" name="id" value={k.id} />
          <input type="hidden" name="decision" value="reject" />
          <div className="kv-field">
            <label htmlFor="reason" className="kv-field__label">{t.t('ver.reasonLabel')}</label>
            <textarea id="reason" name="reason" className="kv-textarea" rows={3} maxLength={500} required aria-describedby="reason-hint" />
            <p id="reason-hint" className="kv-field__hint">{t.t('ver.reasonHint')}</p>
          </div>
          <div className="kv-form__actions">
            <button type="submit" className="kv-btn kv-btn--muted">{k.status === 'verified' ? t.t('ver.revokeBtn') : t.t('ver.rejectBtn')}</button>
          </div>
        </form>
      )}
      {!canVerifyKyc(facts) && !canRejectKyc(facts) && <p className="kv-field__hint">{t.t('ver.noDecision')}</p>}

      <p className="kv-field__hint kv-note">{t.t('ver.auditNote')}</p>
    </section>
  );
}
