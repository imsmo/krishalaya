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

import { Button, Chip, StatusPill, type StatusTone } from '@krishalaya/ui';
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('support.title'), robots: { index: false, follow: false } };
}

const SEV_TONE: Record<string, StatusTone> = { P0: 'danger', P1: 'danger', P2: 'warning', P3: 'neutral' };

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
    { header: t.t('support.severity'), cell: (r) => { const s = severityKey(r.severity); return <StatusPill tone={SEV_TONE[s] ?? 'neutral'} label={t.t(`support.sev.${s}`)} />; } },
    { header: t.t('support.status'), cell: (r) => t.t(`support.state.${ticketStatusKey(r.status)}`) },
    { header: t.t('support.sla'), cell: (r) => { const k = slaKey(r.sla); return <StatusPill tone={k === 'breached' ? 'danger' : 'success'} label={t.t(`support.slaState.${k}`)} />; } },
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
        {/* ADMIN-SWEEP-b2/b3: W050's Hub and W058's Emergency tabs — linked the day each stopped 404ing. */}
        <Chip as={Link} href="/support/hub">{t.t('support.hubNav')}</Chip>
        <Chip as={Link} href="/support/emergency">{t.t('support.emergencyNav')}</Chip>
        <Chip as={Link} href="/support/sla-breaches">{t.t('support.breachesNav')}</Chip>
        <Chip as={Link} href="/support/tenant-health">{t.t('support.healthNav')}</Chip>
        {/* PC-56 ADMIN-2 · the canon's remaining desk lenses (W053/W054/W055) */}
        <Chip as={Link} href="/support/macros">{t.t('support.macrosLink')}</Chip>
        <Chip as={Link} href="/support/escalation">{t.t('support.escalationLink')}</Chip>
        <Chip as={Link} href="/support/insights">{t.t('support.insightsLink')}</Chip>
        {/* PC-56 ADMIN-2c · the rating-review queue, the coaching ledger and the audited exports */}
        <Chip as={Link} href="/support/csat/queue">{t.t('support.reviewLink')}</Chip>
        <Chip as={Link} href="/support/coaching">{t.t('support.coachingLink')}</Chip>
        <Chip as={Link} href="/support/exports">{t.t('support.exportsLink')}</Chip>
        {/* PC-56 ADMIN-2d · replies an operator wrote that never reached a farmer */}
        <Chip as={Link} href="/support/replies/stuck">{t.t('support.stuckRepliesLink')}</Chip>
      </nav>

      <nav className="kv-filters" aria-label={t.t('support.filterStatus')}>
        <Chip as={Link} href={qp({ status: undefined, cursor: undefined })} aria-current={!status ? 'true' : undefined} active={!status}>{t.t('support.filterAll')}{chipCount()}</Chip>
        {TICKET_STATUSES.map((s) => (
          <Chip as={Link} key={s} href={qp({ status: s, cursor: undefined })} aria-current={status === s ? 'true' : undefined} active={status === s}>{t.t(`support.state.${s}`)}{chipCount(s)}</Chip>
        ))}
      </nav>
      <nav className="kv-filters" aria-label={t.t('support.filterSeverity')}>
        <Chip as={Link} href={qp({ severity: undefined, cursor: undefined })} aria-current={!severity ? 'true' : undefined} active={!severity}>{t.t('support.filterAll')}</Chip>
        {SEVERITIES.map((s) => (
          <Chip as={Link} key={s} href={qp({ severity: s, cursor: undefined })} aria-current={severity === s ? 'true' : undefined} active={severity === s}>{t.t(`support.sev.${s}`)}</Chip>
        ))}
        <Chip as={Link} href={qp({ slaBreached: slaBreached ? undefined : 'true', cursor: undefined })} aria-current={slaBreached ? 'true' : undefined} active={!!slaBreached}>{t.t('support.filterBreached')}</Chip>
      </nav>

      {/* Where the numbers come from, so nobody reads them as this page's row count. */}
      {counts ? <p className="kv-field__hint">{t.t('support.countsHint')}</p> : <p className="kv-field__hint">{t.t('support.countUnknown')}</p>}

      {notice ? <p className="kv-error" role="alert">{notice}</p> : (
        <>
          <DataTable columns={cols} rows={rows} empty={t.t('support.empty')} />
          {nextCursor && <p className="kv-pager"><Button as={Link} href={qp({ cursor: nextCursor })}>{t.t('common.nextPage')}</Button></p>}
        </>
      )}
    </section>
  );
}
