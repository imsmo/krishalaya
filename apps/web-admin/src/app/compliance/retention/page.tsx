// apps/web-admin/src/app/compliance/retention/page.tsx · data-retention policy config. Server component:
// requireAdmin gates, adminGet hits GET /v1/compliance/retention (all policies). The upsert form (POST
// /compliance/retention) sets a table's active/archive windows (whole months, float-free) + action + legal basis,
// carrying a mandatory audit reason. Degrade-never-die. No inline styles.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { DataTable, Column } from '../../../components/DataTable';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { RETENTION_ACTIONS, type RetentionRow } from '../../../features/compliance/compliance';
import { upsertRetentionAction } from '../actions';

import { Button } from '@krishalaya/ui';
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('compliance.retentionTitle'), robots: { index: false, follow: false } };
}

const ERR = new Set(['tableName', 'activeMonths', 'archiveMonths', 'action', 'reason', 'elevation', 'invalid', 'generic']);

export default async function RetentionPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();

  let rows: RetentionRow[] = []; let notice: string | undefined;
  try { rows = (await adminGet<RetentionRow[]>('compliance/retention')).data ?? []; }
  catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const okKey = searchParams.ok === 'saved' ? 'saved' : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;

  const cols: Column<RetentionRow>[] = [
    { header: t.t('compliance.table'), cell: (r) => r.tableName },
    { header: t.t('compliance.activeMonths'), cell: (r) => r.activeMonths.toLocaleString() },
    { header: t.t('compliance.archiveMonths'), cell: (r) => (r.archiveMonths == null ? t.t('common.dash') : r.archiveMonths.toLocaleString()) },
    { header: t.t('compliance.retentionAction'), cell: (r) => t.t(`compliance.retAction.${r.action}`) },
    { header: t.t('compliance.legalBasis'), cell: (r) => r.legalBasis ?? t.t('common.dash') },
    { header: t.t('compliance.active'), cell: (r) => (r.isActive ? t.t('compliance.yes') : t.t('common.dash')) },
  ];

  return (
    <section>
      <p className="kv-backlink"><Link href="/compliance">{t.t('compliance.back')}</Link></p>
      <h1>{t.t('compliance.retentionTitle')}</h1>
      <p className="kv-muted">{t.t('compliance.retentionLead')}</p>
      {okKey && <p className="kv-success" role="status">{t.t('compliance.retentionOk')}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`compliance.error.${errKey}`)}</p>}

      {notice ? <p className="kv-error" role="alert">{notice}</p> : <DataTable columns={cols} rows={rows} empty={t.t('compliance.retentionEmpty')} />}

      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('compliance.upsertRetention')}</summary>
        <p className="kv-field__hint">{t.t('compliance.upsertRetentionHint')}</p>
        <form action={upsertRetentionAction} className="kv-form">
          <label htmlFor="tableName" className="kv-field__label">{t.t('compliance.table')}</label>
          <input id="tableName" name="tableName" className="kv-input" required placeholder="audit_log" />
          <label htmlFor="activeMonths" className="kv-field__label">{t.t('compliance.activeMonths')}</label>
          <input id="activeMonths" name="activeMonths" className="kv-input" required inputMode="numeric" placeholder="24" />
          <label htmlFor="archiveMonths" className="kv-field__label">{t.t('compliance.archiveMonths')}</label>
          <input id="archiveMonths" name="archiveMonths" className="kv-input" inputMode="numeric" placeholder={t.t('compliance.archiveMonthsHint')} />
          <label htmlFor="retAction" className="kv-field__label">{t.t('compliance.retentionAction')}</label>
          <select id="retAction" name="action" className="kv-input" required defaultValue="">
            <option value="" disabled>{t.t('compliance.choose')}</option>
            {RETENTION_ACTIONS.map((a) => <option key={a} value={a}>{t.t(`compliance.retAction.${a}`)}</option>)}
          </select>
          <label htmlFor="legalBasis" className="kv-field__label">{t.t('compliance.legalBasis')}</label>
          <input id="legalBasis" name="legalBasis" className="kv-input" maxLength={200} />
          <label htmlFor="retReason" className="kv-field__label">{t.t('compliance.reason')}</label>
          <input id="retReason" name="reason" className="kv-input" required minLength={3} maxLength={2000} />
          <Button type="submit">{t.t('compliance.upsertRetentionSubmit')}</Button>
        </form>
      </details>
    </section>
  );
}
