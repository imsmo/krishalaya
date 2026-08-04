// apps/web-tenant/src/app/ai-review/page.tsx · the AI review-queue (human-in-the-loop) console (P1-12).
// Server-first, requireSession-gated, behind the `ai_governance` flag (NEXT_PUBLIC_FEATURE_AI_REVIEW + the API's
// own flag). A reviewer browses the queue of AI decisions awaiting human judgement (filter by box/status/kind),
// claims an item, and resolves it accepted/rejected — the resolution drives the originating module server-side.
// Sections degrade on their own (Law 12). Every write is a Server Action → the audited, RBAC-gated (ai.review)
// API, which owns the review state machine. All copy via i18n; noindex.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { DataTable } from '../../components/DataTable';
import { getTranslator } from '../../lib/i18n';
import { env } from '../../lib/env';
import { REVIEW_STATUSES, QUEUE_KINDS, reviewerActions, canResolve, isOpen, priorityBucket, openCount } from '../../features/ai-review/queue';
import { claimAction, resolveAction, enqueueAction } from './actions';
import type { AiReviewItem, AiReviewStatus, AiReviewQueueKind } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('air.title'), robots: { index: false, follow: false } };
}

const OK = new Set(['claim', 'accept', 'reject', 'enqueue']);
type SP = { ok?: string; error?: string; item?: string; box?: string; status?: string; kind?: string };

export default async function AiReviewPage({ searchParams }: { searchParams: SP }) {
  if (!env.featureAiReview) notFound();
  await requireSession('/ai-review');
  const t = getTranslator();
  const selected = searchParams.item || null;
  const box = searchParams.box === 'all' ? 'all' : 'open';
  const status = (searchParams.status && (REVIEW_STATUSES as readonly string[]).includes(searchParams.status)) ? searchParams.status as AiReviewStatus : undefined;
  const kind = (searchParams.kind && (QUEUE_KINDS as readonly string[]).includes(searchParams.kind)) ? searchParams.kind as AiReviewQueueKind : undefined;

  let items: AiReviewItem[] = []; let listFailed = false;
  let item: AiReviewItem | null = null; let detailFailed = false;
  const lRes = await Promise.allSettled([tenantClient().aiReview.list({ box, status, queueKind: kind, limit: 100 })]);
  if (lRes[0].status === 'fulfilled') items = lRes[0].value.items; else listFailed = true;
  if (selected) {
    const d = await Promise.allSettled([tenantClient().aiReview.get(selected)]);
    if (d[0].status === 'fulfilled') item = d[0].value; else detailFailed = true;
  }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errorKey = searchParams.error || null;
  const actions = item ? reviewerActions(item.status) : [];

  return (
    <section>
      <h1>{t.t('air.title')}</h1>
      <p className="kv-muted">{t.t('air.subtitle')}</p>
      {okKey && <p className="kv-success" role="status">{t.t(`air.ok.${okKey}`)}</p>}
      {errorKey && <p className="kv-error" role="alert">{t.t('air.error')}: {errorKey}</p>}

      {/* ---- queue ---- */}
      <h2 className="kv-section-title">{t.t('air.queue.title')}{!listFailed ? ` · ${t.t('air.queue.open')}: ${openCount(items)}` : ''}</h2>
      <form method="get" className="kv-form kv-form--inline">
        <label className="kv-label">{t.t('air.queue.box')}
          <select className="kv-input" name="box" defaultValue={box}>
            <option value="open">{t.t('air.queue.boxOpen')}</option>
            <option value="all">{t.t('air.queue.boxAll')}</option>
          </select>
        </label>
        <label className="kv-label">{t.t('air.queue.status')}
          <select className="kv-input" name="status" defaultValue={status ?? ''}>
            <option value="">{t.t('air.queue.allStatuses')}</option>
            {REVIEW_STATUSES.map((s) => <option key={s} value={s}>{t.t(`air.status.${s}`)}</option>)}
          </select>
        </label>
        <label className="kv-label">{t.t('air.queue.kind')}
          <select className="kv-input" name="kind" defaultValue={kind ?? ''}>
            <option value="">{t.t('air.queue.allKinds')}</option>
            {QUEUE_KINDS.map((k) => <option key={k} value={k}>{t.t(`air.kind.${k}`)}</option>)}
          </select>
        </label>
        <button type="submit" className="kv-btn kv-btn--muted kv-btn--sm">{t.t('air.queue.filter')}</button>
      </form>
      {listFailed ? <p className="kv-error" role="alert">{t.t('air.loadError')}</p> : (
        <DataTable
          rows={items}
          empty={t.t('air.queue.empty')}
          columns={[
            { header: t.t('air.queue.item'), cell: (r) => <Link href={`/ai-review?item=${encodeURIComponent(r.id)}`}><code className="kv-code kv-code--inline">{r.id.slice(0, 8)}</code></Link> },
            { header: t.t('air.queue.kind'), cell: (r) => t.t(`air.kind.${r.queueKind}`) },
            { header: t.t('air.queue.priority'), cell: (r) => <span className="kv-badge">{t.t(`air.priority.${priorityBucket(r.priority)}`)} ({r.priority})</span> },
            { header: t.t('air.status'), cell: (r) => <span className="kv-badge">{t.t(`air.status.${r.status}`)}</span> },
            { header: t.t('air.queue.inference'), cell: (r) => r.inferenceId ? <code className="kv-code kv-code--inline">{r.inferenceId.slice(0, 8)}</code> : t.t('common.dash') },
          ]}
        />
      )}

      {/* ---- manually enqueue ---- */}
      <details className="kv-disclosure">
        <summary>{t.t('air.new.title')}</summary>
        <p className="kv-fine kv-muted">{t.t('air.new.help')}</p>
        <form action={enqueueAction} className="kv-form kv-form--grid">
          <label className="kv-label">{t.t('air.queue.kind')}
            <select className="kv-input" name="queueKind" required defaultValue="">
              <option value="" disabled>{t.t('air.new.pickKind')}</option>
              {QUEUE_KINDS.map((k) => <option key={k} value={k}>{t.t(`air.kind.${k}`)}</option>)}
            </select>
          </label>
          <label className="kv-label">{t.t('air.new.priority')}<input className="kv-input" name="priority" type="number" min={1} max={1000} placeholder="100" /></label>
          <label className="kv-label">{t.t('air.new.subjectType')}<input className="kv-input" name="subjectType" maxLength={50} placeholder="listing" /></label>
          <label className="kv-label">{t.t('air.new.subjectId')}<input className="kv-input" name="subjectId" placeholder="UUID" /></label>
          <button type="submit" className="kv-btn">{t.t('air.new.enqueue')}</button>
        </form>
      </details>

      {/* ---- selected item ---- */}
      {selected && (
        <>
          <h2 className="kv-section-title">{t.t('air.detail.title')} · <Link href="/ai-review">{t.t('air.detail.clear')}</Link></h2>
          {detailFailed || !item ? <p className="kv-error" role="alert">{t.t('air.loadError')}</p> : (
            <div className="kv-card">
              <p className="kv-fine kv-muted">
                {t.t('air.queue.kind')}: {t.t(`air.kind.${item.queueKind}`)}
                {' · '}{t.t('air.status')}: <span className="kv-badge">{t.t(`air.status.${item.status}`)}</span>
                {' · '}{t.t('air.queue.priority')}: {t.t(`air.priority.${priorityBucket(item.priority)}`)} ({item.priority})
                {item.inferenceId ? ` · ${t.t('air.queue.inference')}: ${item.inferenceId}` : ''}
                {item.reviewerUserId ? ` · ${t.t('air.detail.reviewer')}: ${item.reviewerUserId.slice(0, 8)}` : ''}
                {item.decisionNote ? ` · ${t.t('air.detail.note')}: ${item.decisionNote}` : ''}
                {item.resolvedAt ? ` · ${t.t('air.detail.resolved')}: ${item.resolvedAt}` : ''}
              </p>

              {isOpen(item.status) ? (
                <>
                  <span className="kv-actions">
                    {actions.includes('claim') && (
                      <form action={claimAction}><input type="hidden" name="id" value={item.id} /><button type="submit" className="kv-btn kv-btn--sm">{t.t('air.action.claim')}</button></form>
                    )}
                  </span>
                  {canResolve(item.status) && (
                    <details className="kv-disclosure" open><summary>{t.t('air.action.resolve')}</summary>
                      <form action={resolveAction} className="kv-form">
                        <input type="hidden" name="id" value={item.id} />
                        <label className="kv-label">{t.t('air.detail.decision')}
                          <select className="kv-input" name="decision" required defaultValue="">
                            <option value="" disabled>{t.t('air.detail.pickDecision')}</option>
                            <option value="accepted">{t.t('air.decision.accepted')}</option>
                            <option value="rejected">{t.t('air.decision.rejected')}</option>
                          </select>
                        </label>
                        <label className="kv-label">{t.t('air.detail.note')}<textarea className="kv-input" name="note" rows={2} maxLength={1000} /></label>
                        <button type="submit" className="kv-btn">{t.t('air.action.resolve')}</button>
                      </form>
                    </details>
                  )}
                </>
              ) : <p className="kv-muted kv-fine">{t.t('air.detail.closed')}</p>}
            </div>
          )}
        </>
      )}
    </section>
  );
}
