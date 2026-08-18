// apps/web-admin/src/app/billing/dunning/page.tsx · the COLLECTION QUEUE (PC-56 ADMIN-1, canon W015). Server
// component: requireAdmin gates, adminGet hits GET /v1/billing/dunning (owner perm enforced server-side) — every
// invoice currently owed across every tenant, worst-first, keyset-paged by (days late, id) so no debtor hides at a
// page boundary. Ageing tiers are GET-form filters (?tier=), which keeps the view linkable and back-button honest.
//
// THE OUTSTANDING TOTAL COVERS ONLY WHAT THE PLATFORM CAN MEASURE. Migration 0092 (ADMIN-1b) closed the old hole —
// payments are recorded now, so a part-paid invoice HAS a balance — but the queue still reports `knownRows` and
// `unknownRows` separately, because a row whose figure the API could not resolve must not be silently folded into a
// number somebody reads out on a phone call. When everything resolves, the unknown count is zero and the note is
// absent; the machinery stays because the guarantee is "this total is complete or it says so".
//
// THE LADDER IS NOW REAL. Migration 0094 (ADMIN-1b) stores a versioned collections policy, so this page shows what
// the ladder EXPECTS beside what was actually recorded, and flags rows that are BEHIND it. With no active policy the
// page degrades to the old behaviour and calls the suggested channel a convention — which it then honestly is.
// Money is minor-unit strings via formatMoneyMinor (Law 2). Degrade-never-die: a failed read is a notice, not a blank.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import { invoiceStatusKey } from '../../../features/billing/billing';
import {
  DUNNING_CHANNELS, ageingTier, isAgeingTier, tierMinDays, tierCounts, knownOutstanding,
  outstandingUnknown, dunningStep, suggestedChannel, touchBlockedReason, canRecordTouch, needsWriteOffReview,
  isLeaving, MAX_DUNNING_ATTEMPTS, type QueueRow,
} from '../../../features/billing/dunning-queue';
import { stepForDaysLate, nextStepAfter, behindPolicy, type LadderStep } from '../../../features/billing/money-controls';
import { recordDunningFromQueueAction } from '../actions';

import {
  Button, Callout, EmptyState, StatusPill, type StatusTone,
} from '@krishalaya/ui';
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('dun.title'), robots: { index: false, follow: false } };
}

const OK = new Set(['dunning']);
const ERR = new Set(['channel', 'outcome', 'note', 'elevation', 'illegal', 'notFound', 'generic']);
const STATUS_TONE: Record<string, StatusTone> = { issued: 'neutral', partially_paid: 'warning', overdue: 'danger' };

export default async function DunningQueuePage({ searchParams }: {
  searchParams: { cursor?: string; tier?: string; ok?: string; error?: string };
}) {
  requireAdmin();
  const t = getTranslator();
  const tier = isAgeingTier(searchParams.tier) ? searchParams.tier : undefined;

  let rows: QueueRow[] = []; let nextCursor: string | undefined; let notice: string | undefined;
  try {
    const res = await adminGet<QueueRow[]>('billing/dunning', {
      cursor: searchParams.cursor,
      minDaysLate: tier ? tierMinDays(tier) : undefined,
      limit: 50,
    });
    rows = res.data ?? [];
    nextCursor = (res.meta?.nextCursor as string | undefined) ?? undefined;
  } catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  // PC-56 ADMIN-1b · the ACTIVE ladder (0094). Degrades independently: with no policy the queue still works exactly as
  // it did before, and the suggested channel goes back to being labelled a convention — which it then honestly is.
  let ladder: LadderStep[] = []; let hasPolicy = false;
  try {
    const pol = (await adminGet<{ policy: unknown; steps: LadderStep[] } | null>('billing/dunning-policy')).data ?? null;
    if (pol) { ladder = pol.steps ?? []; hasPolicy = true; }
  } catch { /* no policy read → no policy column */ }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const owed = knownOutstanding(rows);
  const chips = tierCounts(rows);
  // one currency per page-load in practice (the platform bills INR today); taken from the rows rather than assumed
  const cur = rows.find((r) => r.currency)?.currency ?? 'INR';
  const href = (params: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    const s = q.toString();
    return s ? `/billing/dunning?${s}` : '/billing/dunning';
  };

  return (
    <section>
      <p className="kv-backlink"><Link href="/billing">{t.t('billing.back')}</Link></p>
      <h1>{t.t('dun.title')}</h1>
      <p className="kv-field__hint">{t.t('dun.hint')}</p>
      <p className="kv-detail__muted">
        <Button as={Link} href="/billing/dunning/policy" variant="tertiary">
          {hasPolicy ? t.t('dun.policyLink') : t.t('dun.noPolicyLink')}
        </Button>
      </p>

      {okKey && <p className="kv-success" role="status">{t.t(`dun.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`dun.error.${errKey}`)}</p>}

      {notice ? <p className="kv-error" role="alert">{notice}</p> : (
        <>
          {/* What is owed — and, beside it, how much of the book this figure does NOT cover. */}
          <p className="kv-card__title">
            {t.t('dun.knownOwed', { amount: formatMoneyMinor(owed.totalMinor.toString(), cur), n: String(owed.knownRows) })}
          </p>
          {owed.unknownRows > 0 && (
            <Callout>{t.t('dun.unknownOwed', { n: String(owed.unknownRows) })}</Callout>
          )}

          {/* Ageing filter. `All` first, then only the tiers that actually have rows. */}
          <nav className="kv-tabs" aria-label={t.t('dun.filter')}>
            <Link href={href({})} className={`kv-tab${tier ? '' : ' kv-tab--active'}`} aria-current={tier ? undefined : 'page'}>
              {t.t('dun.all')}
            </Link>
            {chips.map((c) => (
              <Link key={c.tier} href={href({ tier: c.tier })} className={`kv-tab${c.tier === tier ? ' kv-tab--active' : ''}`}
                aria-current={c.tier === tier ? 'page' : undefined}>
                {t.t(`dun.tier.${c.tier}`)} {c.n}
              </Link>
            ))}
          </nav>
          {chips.length === 0 && !tier && <EmptyState title={t.t('dun.empty')} />}
          {chips.length === 0 && tier && <EmptyState title={t.t('dun.emptyTier')} />}

          <ul className="kv-list" role="list">
            {rows.map((r) => {
              const status = invoiceStatusKey(r.status);
              const step = dunningStep(r);
              const next = suggestedChannel(r);
              const blocked = touchBlockedReason(r);
              return (
                <li key={r.invoiceId ?? r.invoiceNo} className="kv-card">
                  <p className="kv-card__title">
                    <Link href={`/billing/invoices/${encodeURIComponent(String(r.invoiceId ?? ''))}`}>{r.invoiceNo ?? t.t('common.dash')}</Link>
                    {' '}<StatusPill tone={STATUS_TONE[status] ?? 'neutral'} label={t.t(`billing.status.${status}`)} />
                    {needsWriteOffReview(r) && <StatusPill tone="danger" label={t.t('dun.writeOffReview')} />}
                    {isLeaving(r) && <StatusPill tone="neutral" label={t.t('dun.leaving')} />}
                  </p>

                  <p className="kv-detail__muted">
                    {r.tenantId
                      ? <Link href={`/tenants/${encodeURIComponent(r.tenantId)}`}>{r.tenantSlug ?? r.tenantId.slice(0, 8)}</Link>
                      : t.t('common.dash')}
                    {' · '}{t.t(`dun.tier.${ageingTier(r.daysLate)}`)}
                    {' · '}{t.t('dun.daysLate', { n: String(r.daysLate ?? 0) })}
                    {r.dueDate ? ` · ${t.t('dun.due')}: ${formatDate(r.dueDate)}` : ''}
                  </p>

                  {/* The one number on this row, or the honest absence of it. */}
                  <p>
                    {outstandingUnknown(r)
                      ? <StatusPill tone="warning" label={t.t('dun.outstandingUnknown')} />
                      : <strong>{t.t('dun.outstanding', { amount: formatMoneyMinor(String(r.outstandingMinor), r.currency ?? cur) })}</strong>}
                    {' · '}{t.t('dun.invoiceTotal', { amount: formatMoneyMinor(String(r.totalMinor ?? '0'), r.currency ?? cur) })}
                  </p>
                  {outstandingUnknown(r) && <p className="kv-field__hint">{t.t('dun.partPaidNote')}</p>}

                  <p className="kv-detail__muted">
                    {t.t('dun.touches', { n: String(step), max: String(MAX_DUNNING_ATTEMPTS) })}
                    {r.lastDunnedAt ? ` · ${t.t('dun.lastTouch')}: ${formatDate(r.lastDunnedAt)}` : ` · ${t.t('dun.neverTouched')}`}
                  </p>

                  {/* What the LADDER expects at this lateness, beside what was actually recorded. The useful signal is
                      not "what should I send" — it is WHO HAS BEEN FORGOTTEN, so that is what gets the warning. */}
                  {hasPolicy && (() => {
                    const days = Number(r.daysLate ?? 0);
                    const due = stepForDaysLate(ladder, days);
                    const upcoming = nextStepAfter(ladder, days);
                    const behind = behindPolicy(ladder, days, step);
                    return (
                      <p className={behind ? 'kv-error' : 'kv-detail__muted'} role={behind ? 'alert' : undefined}>
                        {behind ? t.t('dun.behindPolicy') : due
                          ? t.t('dun.policyDue', { channel: t.t(`billing.channel.${due.channel}`), day: String(due.dayOffset) })
                          : t.t('dun.policyNotYet')}
                        {upcoming ? ` · ${t.t('dun.policyNext', { channel: t.t(`billing.channel.${upcoming.channel}`), day: String(upcoming.dayOffset) })}` : ''}
                      </p>
                    );
                  })()}

                  {canRecordTouch(r) ? (
                    <form action={recordDunningFromQueueAction} className="kv-form">
                      <input type="hidden" name="id" value={String(r.invoiceId ?? '')} />
                      <input type="hidden" name="tier" value={tier ?? ''} />
                      <label htmlFor={`ch-${r.invoiceId}`} className="kv-field__label">{t.t('dun.channel')}</label>
                      <select id={`ch-${r.invoiceId}`} name="channel" className="kv-input" defaultValue={next ?? 'email'}>
                        {DUNNING_CHANNELS.map((c) => <option key={c} value={c}>{t.t(`billing.channel.${c}`)}</option>)}
                      </select>
                      {next && <p className="kv-field__hint">{t.t('dun.suggested', { channel: t.t(`billing.channel.${next}`) })}</p>}
                      <label htmlFor={`oc-${r.invoiceId}`} className="kv-field__label">{t.t('dun.outcome')}</label>
                      <select id={`oc-${r.invoiceId}`} name="outcome" className="kv-input" defaultValue="sent">
                        {['sent', 'promised_pay', 'failed', 'no_response'].map((o) => <option key={o} value={o}>{t.t(`billing.outcome.${o}`)}</option>)}
                      </select>
                      <label htmlFor={`nt-${r.invoiceId}`} className="kv-field__label">{t.t('dun.note')}</label>
                      <input id={`nt-${r.invoiceId}`} name="note" className="kv-input" maxLength={1000} />
                      <Button type="submit">{t.t('dun.recordTouch')}</Button>
                    </form>
                  ) : (
                    <Callout>{t.t(`dun.blocked.${blocked}`)}</Callout>
                  )}
                </li>
              );
            })}
          </ul>

          {nextCursor && (
            <p className="kv-pager">
              <Button as={Link} href={href({ tier, cursor: nextCursor })}>{t.t('common.nextPage')}</Button>
            </p>
          )}
        </>
      )}

      <p className="kv-field__hint">{t.t('dun.footerNote')}</p>
    </section>
  );
}
