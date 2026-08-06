// apps/web-admin/src/app/support/page.tsx · god-mode cross-tenant support NOC — the ticket queue. Server
// component: requireAdmin gates, adminGet hits GET /v1/support/tickets (tenant/status/severity/SLA-breach/assigned
// filters + keyset). Cross-tenant by design (Law 11). The SLA-breach + tenant-health lenses are linked in the
// section nav. Support is money-free. Degrade-never-die. No inline styles.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../lib/admin-client';
import { DataTable, Column } from '../../components/DataTable';
import { getTranslator } from '../../lib/i18n';
import { adminNoticeKey } from '../../features/nav/nav-model';
import { TICKET_STATUSES, SEVERITIES, ticketStatusKey, severityKey, slaKey, type TicketRow } from '../../features/support/ticket';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('support.title'), robots: { index: false, follow: false } };
}

const SEV_CLASS: Record<string, string> = { P0: 'kv-status--danger', P1: 'kv-status--danger', P2: 'kv-status--warn', P3: 'kv-status--muted' };

export default async function SupportPage({ searchParams }: { searchParams: { cursor?: string; status?: string; severity?: string; slaBreached?: string; assigned?: string; tenantId?: string } }) {
  requireAdmin();
  const t = getTranslator();
  const status = (TICKET_STATUSES as readonly string[]).includes(searchParams.status ?? '') ? searchParams.status : undefined;
  const severity = (SEVERITIES as readonly string[]).includes(searchParams.severity ?? '') ? searchParams.severity : undefined;
  const slaBreached = searchParams.slaBreached === 'true' ? 'true' : undefined;
  const assigned = searchParams.assigned === 'true' ? 'true' : searchParams.assigned === 'false' ? 'false' : undefined;
  const tenantId = searchParams.tenantId?.trim() || undefined;

  let rows: TicketRow[] = []; let nextCursor: string | undefined; let notice: string | undefined;
  // PC-56 ADMIN-2b · the canon's chip COUNTS (W005). Fetched separately and allowed to fail on its own: a count is a
  // decoration on a queue, and a counts query that 500s must not take the queue with it (degrade-never-die, Law 12).
  // They are CROSS-TENANT totals, not counts of this page — a chip whose number describes something other than the list
  // it filters to is worse than a chip with no number, so `null` renders as nothing rather than as 0.
  let counts: Record<string, number> | null = null;
  try {
    const res = await adminGet<TicketRow[]>('support/tickets', { cursor: searchParams.cursor, status, severity, slaBreached, assigned, tenantId, limit: 50 });
    rows = res.data ?? [];
    nextCursor = (res.meta?.nextCursor as string | undefined) ?? undefined;
  } catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }
  try { counts = (await adminGet<{ counts: Record<string, number> }>('support/ticket-counts')).data?.counts ?? null; }
  catch { counts = null; }   // unknown ≠ zero: no number at all beats a wrong one

  /** A count for a chip, or null when unknown. A status the server did not mention genuinely has none. */
  const countFor = (statusKey?: string): number | null => {
    if (!counts) return null;
    if (!statusKey) return Object.values(counts).reduce((a, b) => a + Number(b || 0), 0);
    const v = counts[statusKey];
    return v === undefined || v === null ? 0 : Number(v);
  };
  const chipCount = (statusKey?: string) => {
    const n = countFor(statusKey);
    return n === null ? null : <> <span className="kv-chip__count">{n}</span></>;
  };

  const cols: Column<TicketRow>[] = [
    { header: t.t('support.ticketNo'), cell: (r) => <Link href={`/support/tickets/${encodeURIComponent(r.id)}`}>{r.ticketNo}</Link> },
    { header: t.t('support.subject'), cell: (r) => r.subject ?? t.t('common.dash') },
    { header: t.t('support.severity'), cell: (r) => { const s = severityKey(r.severity); return <span className={`kv-status ${SEV_CLASS[s]}`}>{t.t(`support.sev.${s}`)}</span>; } },
    { header: t.t('support.status'), cell: (r) => t.t(`support.state.${ticketStatusKey(r.status)}`) },
    { header: t.t('support.sla'), cell: (r) => { const k = slaKey(r.sla); return <span className={`kv-status ${k === 'breached' ? 'kv-status--danger' : 'kv-status--ok'}`}>{t.t(`support.slaState.${k}`)}</span>; } },
  ];

  const qp = (extra: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    const merged = { status, severity, slaBreached, assigned, tenantId, ...extra };
    for (const [k, v] of Object.entries(merged)) if (v) sp.append(k, v);
    const s = sp.toString();
    return `/support${s ? `?${s}` : ''}`;
  };

  return (
    <section>
      <h1>{t.t('support.title')}</h1>
      <p className="kv-muted">{t.t('support.lead')}</p>
      <nav className="kv-filters" aria-label={t.t('support.nav')}>
        <Link href="/support/sla-breaches" className="kv-chip">{t.t('support.breachesNav')}</Link>
        <Link href="/support/tenant-health" className="kv-chip">{t.t('support.healthNav')}</Link>
        {/* PC-56 ADMIN-2 · the canon's remaining desk lenses (W053/W054/W055) */}
        <Link href="/support/macros" className="kv-chip">{t.t('support.macrosLink')}</Link>
        <Link href="/support/escalation" className="kv-chip">{t.t('support.escalationLink')}</Link>
        <Link href="/support/insights" className="kv-chip">{t.t('support.insightsLink')}</Link>
        {/* PC-56 ADMIN-2c · the rating-review queue, the coaching ledger and the audited exports */}
        <Link href="/support/csat/queue" className="kv-chip">{t.t('support.reviewLink')}</Link>
        <Link href="/support/coaching" className="kv-chip">{t.t('support.coachingLink')}</Link>
        <Link href="/support/exports" className="kv-chip">{t.t('support.exportsLink')}</Link>
      </nav>

      <nav className="kv-filters" aria-label={t.t('support.filterStatus')}>
        <Link href={qp({ status: undefined, cursor: undefined })} className={`kv-chip${!status ? ' is-active' : ''}`} aria-current={!status ? 'true' : undefined}>{t.t('support.filterAll')}{chipCount()}</Link>
        {TICKET_STATUSES.map((s) => (
          <Link key={s} href={qp({ status: s, cursor: undefined })} className={`kv-chip${status === s ? ' is-active' : ''}`} aria-current={status === s ? 'true' : undefined}>{t.t(`support.state.${s}`)}{chipCount(s)}</Link>
        ))}
      </nav>
      <nav className="kv-filters" aria-label={t.t('support.filterSeverity')}>
        <Link href={qp({ severity: undefined, cursor: undefined })} className={`kv-chip${!severity ? ' is-active' : ''}`} aria-current={!severity ? 'true' : undefined}>{t.t('support.filterAll')}</Link>
        {SEVERITIES.map((s) => (
          <Link key={s} href={qp({ severity: s, cursor: undefined })} className={`kv-chip${severity === s ? ' is-active' : ''}`} aria-current={severity === s ? 'true' : undefined}>{t.t(`support.sev.${s}`)}</Link>
        ))}
        <Link href={qp({ slaBreached: slaBreached ? undefined : 'true', cursor: undefined })} className={`kv-chip${slaBreached ? ' is-active' : ''}`} aria-current={slaBreached ? 'true' : undefined}>{t.t('support.filterBreached')}</Link>
      </nav>

      {/* Where the numbers come from, so nobody reads them as this page's row count. */}
      {counts ? <p className="kv-field__hint">{t.t('support.countsHint')}</p> : <p className="kv-field__hint">{t.t('support.countUnknown')}</p>}

      {notice ? <p className="kv-error" role="alert">{notice}</p> : (
        <>
          <DataTable columns={cols} rows={rows} empty={t.t('support.empty')} />
          {nextCursor && <p className="kv-pager"><Link className="kv-btn" href={qp({ cursor: nextCursor })}>{t.t('common.nextPage')}</Link></p>}
        </>
      )}
    </section>
  );
}
