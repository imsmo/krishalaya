// apps/web-admin/src/app/ai-models/page.tsx · god-mode AI model registry. Server component: requireAdmin gates,
// adminGet hits admin-api GET /v1/ai/models (owner perm enforced server-side). Keyset pagination (?cursor=).
// Degrade-never-die: failures map (via features/nav adminNoticeKey) to a localized notice — 403 → re-auth prompt,
// 401 → session expired, else transient. Read-only list; promote/threshold mutations live on the detail page.
// confidenceThreshold is a model CONFIDENCE RATIO (0..1), not money — rendered via the feature module's float-free
// formatThreshold4 (integer math, no float-format helper). Status chip tone via the shared modelStatusTone helper.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../lib/admin-client';
import { DataTable, Column } from '../../components/DataTable';
import { getTranslator } from '../../lib/i18n';
import { adminNoticeKey } from '../../features/nav/nav-model';
import { modelStatusKey, modelStatusTone, formatThreshold4, type ModelRow } from '../../features/ai-models/model';

import { Button, StatusPill, type StatusTone } from '@krishalaya/ui';
export const dynamic = 'force-dynamic';

// modelStatusTone (features/ai-models/model.ts) predates the StatusPill canon and still returns the old
// kv-status--* token name ('ok' | 'warn' | 'muted'); mapped here rather than editing that shared helper.
const MODEL_TONE: Record<'ok' | 'warn' | 'muted', StatusTone> = { ok: 'success', warn: 'warning', muted: 'neutral' };

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('aiModels.title'), robots: { index: false, follow: false } };
}

export default async function AiModelsPage({ searchParams }: { searchParams: { cursor?: string; status?: string } }) {
  requireAdmin();
  const t = getTranslator();

  let rows: ModelRow[] = [];
  let nextCursor: string | undefined;
  let notice: string | undefined;
  try {
    const res = await adminGet<ModelRow[]>('ai/models', { cursor: searchParams.cursor, status: searchParams.status, limit: 50 });
    rows = res.data ?? [];
    nextCursor = (res.meta?.nextCursor as string | undefined) ?? undefined;
  } catch (e) {
    notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`);
  }

  const columns: Column<ModelRow>[] = [
    { header: t.t('aiModels.colCode'), cell: (r) => <Link href={`/ai-models/${r.id}`}>{r.code}</Link> },
    { header: t.t('aiModels.colVersion'), cell: (r) => r.version },
    { header: t.t('aiModels.colProvider'), cell: (r) => r.provider ?? t.t('common.dash') },
    { header: t.t('aiModels.colStatus'), cell: (r) => <StatusPill tone={MODEL_TONE[modelStatusTone(r.status)]} label={t.t(modelStatusKey(r.status))} /> },
    { header: t.t('aiModels.colThreshold'), cell: (r) => formatThreshold4(r.confidenceThreshold) ?? t.t('common.dash') },
  ];

  return (
    <section>
      <h1>{t.t('aiModels.title')}</h1>
      <p className="kv-muted">{t.t('aiModels.lead')}</p>
      {notice ? <p className="kv-error" role="alert">{notice}</p> : (
        <>
          <DataTable columns={columns} rows={rows} empty={t.t('aiModels.empty')} />
          {nextCursor && (
            <p className="kv-pager">
              <Button as={Link} href={`/ai-models?cursor=${encodeURIComponent(nextCursor)}${searchParams.status ? `&status=${encodeURIComponent(searchParams.status)}` : ''}`}>{t.t('common.nextPage')}</Button>
            </p>
          )}
        </>
      )}
    </section>
  );
}
