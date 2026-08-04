// apps/web-tenant/src/app/disputes/[id]/page.tsx · tenant dispute detail + moderation. Server-first,
// requireSession-gated. disputes.get(id) → notFound() on a missing/foreign id (the API is tenant-scoped = the
// IDOR guard). Surfaces only LEGAL moderation actions for the current status (features/disputes/manage.ts,
// unit-tested): take-under-review / escalate / resolve (with a decision + optional amount). Money via
// formatMoneyMinor; all copy via i18n; noindex.
//
// SDK note (flagged, not faked): the SDK's DisputesResource exposes review/escalate/resolve but NO seller-side
// "respond" method (the seller_responded transition). So we offer the moderation actions only and don't fake a
// respond form. Unblocked when the SDK adds a dispute-respond method.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import { canReview, canEscalate, canResolve, RESOLUTION_TYPES } from '../../../features/disputes/manage';
import { reviewDisputeAction, escalateDisputeAction, resolveDisputeAction } from '../actions';
import type { Dispute } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('disputeDetail.title'), robots: { index: false, follow: false } };
}

const ERR = new Set(['review', 'escalate', 'resolve', 'type', 'amount', 'illegal']);
const OK = new Set(['review', 'escalate', 'resolve']);

export default async function DisputeDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  await requireSession(`/disputes/${params.id}`);
  const t = getTranslator();
  const lang = getLang();

  let dispute: Dispute;
  try { dispute = await tenantClient().disputes.get(params.id); }
  catch { notFound(); }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errorKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;

  const facts: Array<[string, string]> = [
    [t.t('disputeDetail.status'), dispute.status],
    [t.t('disputeDetail.order'), dispute.orderId],
    [t.t('disputeDetail.description'), dispute.description ?? t.t('common.dash')],
    [t.t('disputeDetail.resolution'), dispute.resolutionType ?? t.t('common.dash')],
    [t.t('disputeDetail.resolutionAmount'), dispute.resolutionAmountMinor ? formatMoneyMinor(dispute.resolutionAmountMinor, 'INR', lang) : t.t('common.dash')],
    [t.t('disputeDetail.sla'), dispute.slaDueAt ? formatDate(dispute.slaDueAt, lang) : t.t('common.dash')],
  ];

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('disputeDetail.heading')}</h1>
        <Link href="/disputes" className="kv-btn--link">← {t.t('disputes.title')}</Link>
      </div>

      {okKey && <p className="kv-success" role="status">{t.t('disputeDetail.done')}</p>}
      {errorKey && <p className="kv-error" role="alert">{t.t(`disputeDetail.error.${errorKey}`)}</p>}

      <dl className="kv-facts">
        {facts.map(([k, v]) => (<div key={k} className="kv-facts__row"><dt>{k}</dt><dd>{v}</dd></div>))}
      </dl>

      {(canReview(dispute.status) || canEscalate(dispute.status)) && (
        <div className="kv-actions">
          {canReview(dispute.status) && (
            <form action={reviewDisputeAction} className="kv-inline-form">
              <input type="hidden" name="id" value={dispute.id} />
              <button type="submit" className="kv-btn">{t.t('disputeDetail.review')}</button>
            </form>
          )}
          {canEscalate(dispute.status) && (
            <form action={escalateDisputeAction} className="kv-inline-form">
              <input type="hidden" name="id" value={dispute.id} />
              <button type="submit" className="kv-btn kv-btn--muted">{t.t('disputeDetail.escalate')}</button>
            </form>
          )}
        </div>
      )}

      {canResolve(dispute.status) && (
        <form action={resolveDisputeAction} className="kv-form kv-card">
          <h2 className="kv-card__title">{t.t('disputeDetail.resolve')}</h2>
          <input type="hidden" name="id" value={dispute.id} />
          <label htmlFor="resolutionType" className="kv-field__label">{t.t('disputeDetail.resolutionType')}</label>
          <select id="resolutionType" name="resolutionType" className="kv-select" defaultValue="refund_full">
            {RESOLUTION_TYPES.map((r) => <option key={r} value={r}>{t.t(`disputeDetail.resType.${r}`)}</option>)}
          </select>
          <label htmlFor="amountMajor" className="kv-field__label">{t.t('disputeDetail.amount')}</label>
          <input id="amountMajor" name="amountMajor" type="text" inputMode="decimal" pattern="\d{1,12}(\.\d{1,2})?" className="kv-input" />
          <p className="kv-field__hint">{t.t('disputeDetail.amountHint')}</p>
          <label htmlFor="note" className="kv-field__label">{t.t('disputeDetail.note')}</label>
          <textarea id="note" name="note" className="kv-textarea" rows={3} maxLength={2000} />
          <button type="submit" className="kv-btn">{t.t('disputeDetail.resolveBtn')}</button>
        </form>
      )}

      <p className="kv-field__hint kv-note">{t.t('disputeDetail.respondUnavailable')}</p>
    </section>
  );
}
