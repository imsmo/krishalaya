// apps/web-tenant/src/app/auditor/page.tsx · the read-only auditor console (P1-12). Server-first,
// requireSession-gated, behind the `audit_trail` flag (NEXT_PUBLIC_FEATURE_AUDITOR + the API's own flag).
// A tenant auditor browses the append-only audit trail — filter by action / entity / actor / date window — and
// inspects a selected entry's before→after change. READ-ONLY: there are no Server Actions, no mutations; the
// trail is immutable and RLS-isolated server-side. Filters are a plain GET form (shareable URLs). Pagination is
// keyset (cursor in the query). All copy via i18n; noindex.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { DataTable } from '../../components/DataTable';
import { getTranslator } from '../../lib/i18n';
import { env } from '../../lib/env';
import { validateFilters, buildAuditQuery, summarizeChange, compact, changedKeys } from '../../features/audit/viewer';
import type { AuditEntry } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('aud.title'), robots: { index: false, follow: false } };
}

type SP = { action?: string; entityType?: string; entityId?: string; actorUserId?: string; from?: string; to?: string; cursor?: string; entry?: string; error?: string };

export default async function AuditorPage({ searchParams }: { searchParams: SP }) {
  if (!env.featureAuditor) notFound();
  await requireSession('/auditor');
  const t = getTranslator();

  const form = {
    action: searchParams.action, entityType: searchParams.entityType, entityId: searchParams.entityId,
    actorUserId: searchParams.actorUserId, from: searchParams.from, to: searchParams.to,
  };
  const invalid = validateFilters(form);
  const selected = searchParams.entry || null;

  let entries: AuditEntry[] = []; let nextCursor: string | null = null; let listFailed = false;
  let entry: AuditEntry | null = null; let detailFailed = false;

  if (!invalid) {
    const res = await Promise.allSettled([
      tenantClient().audit.list({ ...buildAuditQuery(form), cursor: searchParams.cursor, limit: 50 }),
    ]);
    if (res[0].status === 'fulfilled') { entries = res[0].value.items; nextCursor = res[0].value.nextCursor; } else listFailed = true;
  }
  if (selected) {
    const d = await Promise.allSettled([tenantClient().audit.get(selected)]);
    if (d[0].status === 'fulfilled') entry = d[0].value; else detailFailed = true;
  }

  // preserve the active filters when building the "next page" link
  const qp = new URLSearchParams();
  for (const [k, v] of Object.entries(form)) if (v) qp.set(k, v);
  const nextHref = nextCursor ? `/auditor?${new URLSearchParams({ ...Object.fromEntries(qp), cursor: nextCursor }).toString()}` : null;

  return (
    <section>
      <h1>{t.t('aud.title')}</h1>
      <p className="kv-muted">{t.t('aud.subtitle')}</p>
      {invalid && <p className="kv-error" role="alert">{t.t('aud.error')}: {invalid}</p>}

      {/* ---- filters (GET form) ---- */}
      <form method="get" className="kv-form kv-form--grid">
        <label className="kv-label">{t.t('aud.filter.action')}<input className="kv-input" name="action" defaultValue={form.action ?? ''} maxLength={120} placeholder="kyc.approved" /></label>
        <label className="kv-label">{t.t('aud.filter.entityType')}<input className="kv-input" name="entityType" defaultValue={form.entityType ?? ''} maxLength={60} placeholder="order" /></label>
        <label className="kv-label">{t.t('aud.filter.entityId')}<input className="kv-input" name="entityId" defaultValue={form.entityId ?? ''} placeholder="UUID" /></label>
        <label className="kv-label">{t.t('aud.filter.actor')}<input className="kv-input" name="actorUserId" defaultValue={form.actorUserId ?? ''} placeholder="UUID" /></label>
        <label className="kv-label">{t.t('aud.filter.from')}<input className="kv-input" name="from" type="date" defaultValue={form.from ?? ''} /></label>
        <label className="kv-label">{t.t('aud.filter.to')}<input className="kv-input" name="to" type="date" defaultValue={form.to ?? ''} /></label>
        <span className="kv-actions">
          <button type="submit" className="kv-btn kv-btn--sm">{t.t('aud.filter.apply')}</button>
          <Link href="/auditor" className="kv-btn kv-btn--muted kv-btn--sm">{t.t('aud.filter.clear')}</Link>
        </span>
      </form>

      {/* ---- trail ---- */}
      <h2 className="kv-section-title">{t.t('aud.list.title')}</h2>
      {listFailed ? <p className="kv-error" role="alert">{t.t('aud.loadError')}</p> : (
        <DataTable
          rows={entries}
          empty={t.t('aud.list.empty')}
          columns={[
            { header: t.t('aud.list.when'), cell: (e) => <Link href={`/auditor?entry=${encodeURIComponent(e.id)}`}>{new Date(e.createdAt).toISOString().replace('T', ' ').slice(0, 19)}</Link> },
            { header: t.t('aud.list.action'), cell: (e) => <code className="kv-code kv-code--inline">{e.action}</code> },
            { header: t.t('aud.list.entity'), cell: (e) => e.entityType ? `${e.entityType}${e.entityId ? ` · ${e.entityId.slice(0, 8)}` : ''}` : t.t('common.dash') },
            { header: t.t('aud.list.actor'), cell: (e) => e.actorUserId ? `${e.actorUserId.slice(0, 8)}${e.actorRole ? ` (${e.actorRole})` : ''}` : t.t('aud.list.system') },
            { header: t.t('aud.list.change'), cell: (e) => <span className="kv-fine kv-muted">{summarizeChange(e.oldValue, e.newValue)}</span> },
          ]}
        />
      )}
      {nextHref && <p><Link href={nextHref} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('aud.list.next')}</Link></p>}

      {/* ---- selected entry detail ---- */}
      {selected && (
        <>
          <h2 className="kv-section-title">{t.t('aud.detail.title')} · <Link href="/auditor">{t.t('aud.detail.clear')}</Link></h2>
          {detailFailed || !entry ? <p className="kv-error" role="alert">{t.t('aud.loadError')}</p> : (
            <div className="kv-card">
              <p className="kv-fine kv-muted">
                {t.t('aud.list.action')}: <code className="kv-code kv-code--inline">{entry.action}</code>
                {' · '}{t.t('aud.list.when')}: {new Date(entry.createdAt).toISOString().replace('T', ' ').slice(0, 19)} UTC
                {entry.actorUserId ? ` · ${t.t('aud.list.actor')}: ${entry.actorUserId.slice(0, 8)}${entry.actorRole ? ` (${entry.actorRole})` : ''}` : ` · ${t.t('aud.list.system')}`}
                {entry.entityType ? ` · ${t.t('aud.list.entity')}: ${entry.entityType}${entry.entityId ? ` (${entry.entityId})` : ''}` : ''}
                {entry.reason ? ` · ${t.t('aud.detail.reason')}: ${entry.reason}` : ''}
                {entry.requestId ? ` · ${t.t('aud.detail.request')}: ${entry.requestId}` : ''}
              </p>
              <h3 className="kv-section-title">{t.t('aud.detail.changed')}</h3>
              {changedKeys(entry.oldValue, entry.newValue).length === 0 ? <p className="kv-muted kv-fine">{t.t('aud.detail.noChange')}</p> : (
                <DataTable
                  rows={changedKeys(entry.oldValue, entry.newValue).map((k) => ({ k }))}
                  empty={t.t('aud.detail.noChange')}
                  columns={[
                    { header: t.t('aud.detail.field'), cell: (r) => <code className="kv-code kv-code--inline">{r.k}</code> },
                    { header: t.t('aud.detail.before'), cell: (r) => <span className="kv-fine">{compact((entry!.oldValue as Record<string, unknown> | null)?.[r.k]) || t.t('common.dash')}</span> },
                    { header: t.t('aud.detail.after'), cell: (r) => <span className="kv-fine">{compact((entry!.newValue as Record<string, unknown> | null)?.[r.k]) || t.t('common.dash')}</span> },
                  ]}
                />
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
