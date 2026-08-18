// apps/web-admin/src/app/support/sla-breaches/page.tsx · god-mode SLA-breach queue. Server component: requireAdmin
// gates, adminGet hits GET /v1/support/sla-breaches (most-urgent first — highest severity, then oldest; keyset).
// A breach = a still-working ticket past an unsatisfied SLA due date. Cross-tenant (Law 11). Money-free.
// Degrade-never-die. No inline styles.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { DataTable, Column } from '../../../components/DataTable';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { SEVERITIES, ticketStatusKey, severityKey, type TicketRow } from '../../../features/support/ticket';

import { Button, Chip, StatusPill, type StatusTone } from '@krishalaya/ui';
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('support.breachesTitle'), robots: { index: false, follow: false } };
}

const SEV_TONE: Record<string, StatusTone> = { P0: 'danger', P1: 'danger', P2: 'warning', P3: 'neutral' };

export default async function SlaBreachesPage({ searchParams }: { searchParams: { cursor?: string; severity?: string; tenantId?: string } }) {
  requireAdmin();
  const t = getTranslator();
  const severity = (SEVERITIES as readonly string[]).includes(searchParams.severity ?? '') ? searchParams.severity : undefined;
  const tenantId = searchParams.tenantId?.trim() || undefined;

  let rows: TicketRow[] = []; let nextCursor: string | undefined; let notice: string | undefined;
  try {
    const res = await adminGet<TicketRow[]>('support/sla-breaches', { cursor: searchParams.cursor, severity, tenantId, limit: 50 });
    rows = res.data ?? [];
    nextCursor = (res.meta?.nextCursor as string | undefined) ?? undefined;
  } catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const cols: Column<TicketRow>[] = [
    { header: t.t('support.ticketNo'), cell: (r) => <Link href={`/support/tickets/${encodeURIComponent(r.id)}`}>{r.ticketNo}</Link> },
    { header: t.t('support.subject'), cell: (r) => r.subject ?? t.t('common.dash') },
    { header: t.t('support.severity'), cell: (r) => { const s = severityKey(r.severity); return <StatusPill tone={SEV_TONE[s] ?? 'neutral'} label={t.t(`support.sev.${s}`)} />; } },
    { header: t.t('support.status'), cell: (r) => t.t(`support.state.${ticketStatusKey(r.status)}`) },
    { header: t.t('support.breachKind'), cell: (r) => r.sla.firstResponseBreached && r.sla.resolutionBreached ? t.t('support.breachBoth') : r.sla.firstResponseBreached ? t.t('support.breachFirst') : r.sla.resolutionBreached ? t.t('support.breachResolution') : t.t('common.dash') },
  ];

  const qp = (extra: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    const merged = { severity, tenantId, ...extra };
    for (const [k, v] of Object.entries(merged)) if (v) sp.append(k, v);
    const s = sp.toString();
    return `/support/sla-breaches${s ? `?${s}` : ''}`;
  };

  return (
    <section>
      <p className="kv-backlink"><Link href="/support">{t.t('support.back')}</Link></p>
      <h1>{t.t('support.breachesTitle')}</h1>
      <p className="kv-muted">{t.t('support.breachesLead')}</p>

      <nav className="kv-filters" aria-label={t.t('support.filterSeverity')}>
        <Chip as={Link} href={qp({ severity: undefined, cursor: undefined })} aria-current={!severity ? 'true' : undefined} active={!severity}>{t.t('support.filterAll')}</Chip>
        {SEVERITIES.map((s) => (
          <Chip as={Link} key={s} href={qp({ severity: s, cursor: undefined })} aria-current={severity === s ? 'true' : undefined} active={severity === s}>{t.t(`support.sev.${s}`)}</Chip>
        ))}
      </nav>

      {notice ? <p className="kv-error" role="alert">{notice}</p> : (
        <>
          <DataTable columns={cols} rows={rows} empty={t.t('support.breachesEmpty')} />
          {nextCursor && <p className="kv-pager"><Button as={Link} href={qp({ cursor: nextCursor })}>{t.t('common.nextPage')}</Button></p>}
        </>
      )}
    </section>
  );
}
