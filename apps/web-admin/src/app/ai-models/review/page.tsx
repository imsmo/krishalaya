// apps/web-admin/src/app/ai-models/review/page.tsx · W082 (PC-56 ADMIN-7).
//
// "ai_review_queue — fraud_flag · low_confidence_grade · price_anomaly · dispute_triage. Humans decide; AI proposes."
//
// THERE WAS NO PLATFORM SURFACE FOR THIS AT ALL. `platform_ai_ops` is an owner-realm role and `ai_review_queue` is
// tenant-scoped with RLS — so the officer W082 is written for had no route, no permission (`ai.review` existed only in the
// tenant realm) and no index serving a cross-tenant priority scan (`idx_ai_queue_claim` leads with `tenant_id`).
//
// AND THEY COULD NOT HAVE BEEN RECORDED AS THE REVIEWER. `reviewer_user_id` is an FK to `users` — the farmer table — and
// admin-api has no database identity. Sixth occurrence of that finding; 0115 adds a second column and a constraint that a
// resolved case names exactly one reviewer, because recording a platform decision as a tenant's would be a forgery.
//
// OLDEST-FIRST WITHIN A PRIORITY BAND, the opposite of nearly every other list in this console. Here age is harm: a
// fraud_flag case holds a farmer's listing OFF the market while it waits.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import {
  Button, Callout, Chip, EmptyState, StatusPill,
} from '@krishalaya/ui';
import {
  ageMinutes, claimAction, claimKey, kindTone, kindKey, reviewerRealmKey,
} from '../../../features/ai-governance/ai-governance';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ai.review.title'), robots: { index: false, follow: false } };
}

interface CaseItem {
  id: string; tenantId: string | null; inferenceId: string | null; queueKind: string;
  priority: number; status: string; reviewerUserId: string | null; reviewerAdminId: string | null;
  claimedAt: string | null; decisionNote: string | null; resolvedAt: string | null; createdAt: string;
  claim: { kind: string; who?: string | null; since?: string | null; status?: string };
}
interface Meta {
  nextCursor: string | null;
  census: { byKind: Record<string, number>; holdsListings: number };
  note: string;
}

const STATUSES = ['pending', 'in_review', 'accepted', 'rejected'] as const;
const KINDS = ['fraud_flag', 'low_confidence_grade', 'price_anomaly', 'dispute_triage', 'drift'] as const;

export default async function ReviewQueuePage({ searchParams }: {
  searchParams: { status?: string; queueKind?: string; cursor?: string; ok?: string; error?: string };
}) {
  requireAdmin();
  const t = getTranslator();
  const status = (STATUSES as readonly string[]).includes(searchParams.status ?? '') ? searchParams.status : undefined;
  const queueKind = (KINDS as readonly string[]).includes(searchParams.queueKind ?? '') ? searchParams.queueKind : undefined;

  let rows: CaseItem[] = []; let meta: Meta | undefined; let notice: string | undefined;
  try {
    const q = new URLSearchParams();
    if (status) q.set('status', status);
    if (queueKind) q.set('queueKind', queueKind);
    if (searchParams.cursor) q.set('cursor', searchParams.cursor);
    const res = await adminGet<CaseItem[]>(`ai/review/cases?${q.toString()}`);
    rows = res.data ?? []; meta = res.meta as unknown as Meta;
  } catch (e) {
    notice = e instanceof AdminApiError && e.status === 403 ? 'ai.restricted.review' : 'ai.error.review';
  }

  // Filters preserved across paging — the ADMIN-1 finding (page 2 of a filter silently becoming page 2 of everything)
  // applies to any list with both a filter and a cursor.
  const withFilters = (extra: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    if (status) q.set('status', status);
    if (queueKind) q.set('queueKind', queueKind);
    for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
    const s = q.toString();
    return s ? `/ai-models/review?${s}` : '/ai-models/review';
  };

  const now = Date.now();

  return (
    <main className="kv-page">
      <nav className="kv-breadcrumb" aria-label={t.t('nav.breadcrumb')}>
        <Link href="/ai-models">{t.t('nav.aiModels')}</Link> <span aria-hidden="true">/</span>{' '}
        <span>{t.t('ai.review.title')}</span>
      </nav>

      <header className="kv-page__head">
        <h1>{t.t('ai.review.title')}</h1>
        <p className="kv-page__sub">{t.t('ai.review.sub')}</p>
      </header>

      {notice ? <Callout tone="danger" live="assertive">{t.t(notice)}</Callout> : null}
      {searchParams.ok ? <Callout tone="success" live="polite">{t.t(`ai.ok.${searchParams.ok}`)}</Callout> : null}
      {searchParams.error ? <Callout tone="danger" live="assertive">{t.t(`ai.err.${searchParams.error}`)}</Callout> : null}

      {/* Counts across the WHOLE open queue, not this page — ADMIN-5f's rule, and here it matters because a fraud case
          waiting is somebody's produce not selling. */}
      {meta?.census && meta.census.holdsListings > 0 ? (
        <Callout tone="warning" live="polite">
          {t.t('ai.queue.holdsListings', { n: String(meta.census.holdsListings) })}
        </Callout>
      ) : null}

      <form className="kv-filters" method="get" action="/ai-models/review">
        <div className="kv-chips" role="group" aria-label={t.t('ai.filter.kind')}>
          <Chip as={Link} href={withFilters({ queueKind: undefined })} active={!queueKind}>
            {t.t('common.all')}
          </Chip>
          {KINDS.map((k) => (
            <Chip as={Link} key={k} href={(() => { const q = new URLSearchParams(); q.set('queueKind', k); if (status) q.set('status', status); return `/ai-models/review?${q.toString()}`; })()} active={queueKind === k}>
              {t.t(kindKey(k))}
              {meta?.census.byKind[k] ? ` (${meta.census.byKind[k]})` : ''}
            </Chip>
          ))}
        </div>
        <div className="kv-field">
          <label className="kv-field__label" htmlFor="ai-status">{t.t('ai.filter.status')}</label>
          <select className="kv-input" id="ai-status" name="status" defaultValue={status ?? ''}>
            <option value="">{t.t('ai.filter.open')}</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <Button type="submit">{t.t('common.apply')}</Button>
      </form>

      {rows.length === 0 && !notice ? (
        // W082's own empty state, and it is the honest one here: no AI decision is waiting on a human, which means the
        // thresholds are doing their job.
        <EmptyState title={t.t('ai.review.empty.title')} body={t.t('ai.review.empty.body')} />
      ) : (
        <table className="kv-table">
          <caption className="kv-table__caption">{t.t('ai.review.caption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t.t('ai.col.priority')}</th>
              <th scope="col">{t.t('ai.col.case')}</th>
              <th scope="col">{t.t('ai.col.kind')}</th>
              <th scope="col">{t.t('ai.col.tenant')}</th>
              <th scope="col">{t.t('ai.col.age')}</th>
              <th scope="col">{t.t('ai.col.holder')}</th>
              <th scope="col">{t.t('ai.col.action')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const age = ageMinutes(c.createdAt, now);
              const action = claimAction(c.claim.kind);
              return (
                <tr key={c.id}>
                  <td>{c.priority}</td>
                  <td><Link href={`/ai-models/review/${encodeURIComponent(c.id)}`}>{c.id.slice(0, 8)}</Link></td>
                  <td><StatusPill tone={kindTone(c.queueKind)} label={t.t(kindKey(c.queueKind))} /></td>
                  {/* Tenant by id: this realm has no tenant-name join on this path and inventing a display name would be
                      inventing an identity. */}
                  <td>{c.tenantId ? c.tenantId.slice(0, 8) : t.t('ai.tenant.platform')}</td>
                  {/* NULL for an unreadable date rather than 0 — "arrived this second" and "we cannot read when this
                      arrived" must not render alike on a queue whose whole job is to show what has waited. */}
                  <td>{age === null ? '—' : t.t('ai.age.minutes', { m: String(age) })}</td>
                  <td>
                    {t.t(claimKey(c.claim.kind))}
                    {/* WHICH REALM holds it. `ck_ai_review_one_reviewer` makes exactly one non-null on a resolved case. */}
                    {c.reviewerAdminId || c.reviewerUserId
                      ? <><br /><small>{t.t(reviewerRealmKey(c.reviewerUserId, c.reviewerAdminId))}</small></>
                      : null}
                  </td>
                  <td>
                    {action
                      ? <Link href={`/ai-models/review/${encodeURIComponent(c.id)}`}>{t.t(`ai.action.${action}`)}</Link>
                      : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* The triage caveat, stated: ordering applies within a page, and the census counts every open case. */}
      {meta?.note ? <Callout>{t.t('ai.review.orderNote')}</Callout> : null}

      {meta?.nextCursor ? (
        <nav className="kv-pager" aria-label={t.t('common.pagination')}>
          <Button as={Link} href={withFilters({ cursor: meta.nextCursor })}>{t.t('common.next')}</Button>
        </nav>
      ) : null}
    </main>
  );
}
