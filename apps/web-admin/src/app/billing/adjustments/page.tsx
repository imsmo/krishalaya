// apps/web-admin/src/app/billing/adjustments/page.tsx · manual billing adjustments under MAKER-CHECKER
// (PC-56 ADMIN-1b, canon W014 — closes ADMIN-1-Q5; workflow in migration 0093). Server component: requireAdmin
// gates, adminGet hits GET /v1/billing/adjustments (status filter + keyset).
//
// WHAT CHANGED HERE, AND WHY IT MATTERS. Until this wave the form on this page MOVED MONEY on submit: one operator,
// up to ₹10,00,000, no second pair of eyes. It now REQUESTS an adjustment, and two further acts — decide, then apply —
// are offered only to somebody else. The control is a database CHECK (`ck_billing_adj_maker_ne_checker`), so this page
// is only reflecting it.
//
// THE REQUESTER IS OFFERED NOTHING ON THEIR OWN REQUEST — not a disabled button, not a tooltip. The controls are
// absent and a sentence explains that a second approver is needed. A greyed-out button teaches an operator that the
// control is decorative and invites them to ask a colleague to "just do it on their login", which is precisely the
// behaviour maker-checker exists to prevent.
//
// APPROVE and APPLY are deliberately separate clicks: approving says the money should move, applying moves it. If the
// wallet-service fails, the approval survives and the retry is one click — never a fresh approval cycle.
// Money is minor-unit strings via formatMoneyMinor (Law 2). Degrade-never-die.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin, adminUserId } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { formatMoneyMinor } from '@krishalaya/i18n';
import {
  ADJUSTMENT_STATUSES, isAdjustmentStatus, adjustmentActions, adjustmentBlockedReason, moneyHasMoved,
  pendingForViewer, type AdjustmentRow,
} from '../../../features/billing/money-controls';
import { applyAdjustmentAction, decideAdjustmentAction, applyApprovedAdjustmentAction } from '../actions';

import {
  Button, Callout, EmptyState, StatusPill, type StatusTone,
} from '@krishalaya/ui';
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('billing.adjTitle'), robots: { index: false, follow: false } };
}

const OK = new Set(['requested', 'approved', 'returned', 'rejected', 'applied']);
const ERR = new Set(['tenantId', 'direction', 'amountMinor', 'currency', 'reason', 'subscriptionId', 'invoiceId',
  'elevation', 'amount', 'notFound', 'generic', 'illegal', 'adj_decision', 'adj_note']);
const STATUS_TONE: Record<string, StatusTone> = {
  awaiting_approval: 'warning', approved: 'neutral', applied: 'success',
  returned: 'warning', rejected: 'neutral',
};

export default async function AdjustmentsPage({ searchParams }: {
  searchParams: { cursor?: string; tenantId?: string; status?: string; ok?: string; error?: string };
}) {
  requireAdmin();
  const t = getTranslator();
  // display gating only — the DB CHECK and admin-api's 403 are the authority (see lib/admin-auth)
  const viewer = adminUserId();
  const status = isAdjustmentStatus(searchParams.status) ? searchParams.status : undefined;

  let rows: AdjustmentRow[] = []; let nextCursor: string | undefined; let notice: string | undefined;
  try {
    const res = await adminGet<AdjustmentRow[]>('billing/adjustments', {
      cursor: searchParams.cursor, tenantId: searchParams.tenantId, status, limit: 50,
    });
    rows = res.data ?? [];
    nextCursor = (res.meta?.nextCursor as string | undefined) ?? undefined;
  } catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const waiting = pendingForViewer(rows, viewer);
  const href = (params: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    const s = q.toString();
    return s ? `/billing/adjustments?${s}` : '/billing/adjustments';
  };

  return (
    <section>
      <p className="kv-backlink"><Link href="/billing">{t.t('billing.back')}</Link></p>
      <h1>{t.t('billing.adjTitle')}</h1>
      <p className="kv-field__hint">{t.t('adj.makerCheckerHint')}</p>

      {okKey && <p className="kv-success" role="status">{t.t(`adj.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`adj.error.${errKey}`)}</p>}
      {waiting > 0 && <Callout>{t.t('adj.waitingOnYou', { n: String(waiting) })}</Callout>}

      {notice ? <p className="kv-error" role="alert">{notice}</p> : (
        <>
          <nav className="kv-tabs" aria-label={t.t('adj.filter')}>
            <Link href={href({ tenantId: searchParams.tenantId })} className={`kv-tab${status ? '' : ' kv-tab--active'}`}
              aria-current={status ? undefined : 'page'}>{t.t('adj.all')}</Link>
            {ADJUSTMENT_STATUSES.map((s) => (
              <Link key={s} href={href({ status: s, tenantId: searchParams.tenantId })}
                className={`kv-tab${status === s ? ' kv-tab--active' : ''}`} aria-current={status === s ? 'page' : undefined}>
                {t.t(`adj.state.${s}`)}
              </Link>
            ))}
          </nav>

          {rows.length === 0 ? <EmptyState title={t.t('billing.noAdjustments')} /> : (
            <ul className="kv-list" role="list">
              {rows.map((a) => {
                const acts = adjustmentActions(a, viewer);
                const blocked = adjustmentBlockedReason(a, viewer);
                const st = String(a.status ?? '');
                return (
                  <li key={a.id} className="kv-card">
                    <p className="kv-card__title">
                      <StatusPill tone={a.direction === 'credit' ? 'success' : 'warning'}
                        label={t.t(`billing.direction.${String(a.direction)}`)} />
                      {' '}{formatMoneyMinor(String(a.amountMinor ?? '0'), String(a.currency ?? 'INR'))}
                      {' '}<StatusPill tone={STATUS_TONE[st] ?? 'neutral'} label={t.t(`adj.state.${st}`)} />
                    </p>
                    <p className="kv-detail__muted">
                      {a.tenantId ? <Link href={`/tenants/${encodeURIComponent(a.tenantId)}`}>{a.tenantId.slice(0, 8)}</Link> : t.t('common.dash')}
                      {' · '}{a.reason}
                    </p>
                    {/* Who asked, and who agreed — the two facts maker-checker exists to record. */}
                    <p className="kv-detail__muted">
                      {t.t('adj.requestedBy')}: <code>{String(a.requestedBy ?? '').slice(0, 8) || t.t('common.dash')}</code>
                      {a.decidedBy ? <> · {t.t('adj.decidedBy')}: <code>{String(a.decidedBy).slice(0, 8)}</code></> : null}
                    </p>
                    {a.decisionNote && <p className="kv-detail__muted">{t.t('adj.decisionNote')}: {a.decisionNote}</p>}
                    {/* The row's existence is no longer proof the money moved — so the page says which it is. */}
                    <p>
                      {moneyHasMoved(a)
                        ? <StatusPill tone="success" label={t.t('adj.moneyMoved')} />
                        : <StatusPill tone="neutral" label={t.t('adj.noMoneyYet')} />}
                      {a.walletTxnId ? <> <code>{String(a.walletTxnId).slice(0, 8)}</code></> : null}
                    </p>

                    {acts.length === 0 ? (
                      <Callout>{t.t(`adj.blocked.${blocked}`)}</Callout>
                    ) : acts.includes('apply') ? (
                      <form action={applyApprovedAdjustmentAction} className="kv-form">
                        <input type="hidden" name="id" value={String(a.id ?? '')} />
                        <p className="kv-field__hint">{t.t('adj.applyHint')}</p>
                        <Button type="submit">{t.t('adj.apply')}</Button>
                      </form>
                    ) : (
                      <form action={decideAdjustmentAction} className="kv-form">
                        <input type="hidden" name="id" value={String(a.id ?? '')} />
                        <label htmlFor={`nt-${a.id}`} className="kv-field__label">{t.t('adj.note')}</label>
                        <input id={`nt-${a.id}`} name="note" className="kv-input" maxLength={1000} />
                        <p className="kv-field__hint">{t.t('adj.noteHint')}</p>
                        <div className="kv-actions">
                          <Button type="submit" name="decision" value="approve">{t.t('adj.approve')}</Button>
                          <Button type="submit" name="decision" value="return" variant="secondary">{t.t('adj.return')}</Button>
                          <Button type="submit" name="decision" value="reject" variant="danger">{t.t('adj.reject')}</Button>
                        </div>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {nextCursor && (
            <p className="kv-pager">
              <Button as={Link} href={href({ status, tenantId: searchParams.tenantId, cursor: nextCursor })}>{t.t('common.nextPage')}</Button>
            </p>
          )}
        </>
      )}

      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('adj.requestTitle')}</summary>
        <p className="kv-field__hint">{t.t('adj.requestHint')}</p>
        <form action={applyAdjustmentAction} className="kv-form">
          <label htmlFor="tenantId" className="kv-field__label">{t.t('billing.adjTenantId')}</label>
          <input id="tenantId" name="tenantId" className="kv-input" required placeholder="tenant UUID" />
          <label htmlFor="direction" className="kv-field__label">{t.t('billing.adjDirection')}</label>
          <select id="direction" name="direction" className="kv-input" defaultValue="credit">
            <option value="credit">{t.t('billing.direction.credit')}</option>
            <option value="debit">{t.t('billing.direction.debit')}</option>
          </select>
          <label htmlFor="amountMinor" className="kv-field__label">{t.t('billing.adjAmountMinor')}</label>
          <input id="amountMinor" name="amountMinor" className="kv-input" required inputMode="numeric" placeholder="50000" />
          <label htmlFor="currency" className="kv-field__label">{t.t('billing.adjCurrency')}</label>
          <input id="currency" name="currency" className="kv-input" defaultValue="INR" />
          <label htmlFor="adjReason" className="kv-field__label">{t.t('billing.reason')}</label>
          <input id="adjReason" name="reason" className="kv-input" required minLength={3} maxLength={1000} />
          <Button type="submit">{t.t('adj.requestSubmit')}</Button>
        </form>
      </details>

      <p className="kv-field__hint">{t.t('adj.footerNote')}</p>
    </section>
  );
}
