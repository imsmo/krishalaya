// apps/web-admin/src/app/flags/page.tsx · god-mode feature-flag registry. Server component: requireAdmin gates,
// adminGet hits GET /v1/flags (owner perm enforced server-side; global flags, Law 10). Prefix + enabled filter,
// keyset paging. A create-flag form (POST /flags, defaults OFF/0%) lives in a <details>. Degrade-never-die:
// failures map (features/nav adminNoticeKey) to a localized notice (403 → re-auth). No inline styles.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../lib/admin-client';
import { DataTable, Column } from '../../components/DataTable';
import { getTranslator } from '../../lib/i18n';
import { adminNoticeKey } from '../../features/nav/nav-model';
import { flagState, type FlagRow } from '../../features/flags/flag';
import { createFlagAction } from './actions';

import { Button, Chip, StatusPill, type StatusTone } from '@krishalaya/ui';
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('flags.title'), robots: { index: false, follow: false } };
}

const STATE_TONE: Record<string, StatusTone> = { on: 'success', off: 'neutral', locked: 'danger' };
const ERR = new Set(['key', 'rolloutPct', 'reason', 'tenantIds', 'plans', 'countries', 'elevation', 'locked', 'notFound', 'generic']);

export default async function FlagsPage({ searchParams }: { searchParams: { cursor?: string; prefix?: string; enabled?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();
  const enabled = searchParams.enabled === 'true' || searchParams.enabled === 'false' ? searchParams.enabled : undefined;

  let rows: FlagRow[] = [];
  let nextCursor: string | undefined;
  let notice: string | undefined;
  try {
    const res = await adminGet<FlagRow[]>('flags', { cursor: searchParams.cursor, prefix: searchParams.prefix, enabled, limit: 50 });
    rows = res.data ?? [];
    nextCursor = (res.meta?.nextCursor as string | undefined) ?? undefined;
  } catch (e) {
    notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`);
  }

  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const columns: Column<FlagRow>[] = [
    { header: t.t('flags.colKey'), cell: (r) => <Link href={`/flags/${encodeURIComponent(r.key)}`}>{r.key}</Link> },
    { header: t.t('flags.colState'), cell: (r) => { const s = flagState(r); return <StatusPill tone={STATE_TONE[s]} label={t.t(`flags.state.${s}`)} />; } },
    { header: t.t('flags.colRollout'), cell: (r) => `${r.rolloutPct}%` },
  ];

  return (
    <section>
      <h1>{t.t('flags.title')}</h1>
      <p className="kv-muted">{t.t('flags.lead')}</p>
      {errKey && <p className="kv-error" role="alert">{t.t(`flags.error.${errKey}`)}</p>}

      <nav className="kv-filters" aria-label={t.t('flags.filterLabel')}>
        <Chip as={Link} href="/flags" aria-current={!enabled ? 'true' : undefined} active={!enabled}>{t.t('flags.filterAll')}</Chip>
        <Chip as={Link} href="/flags?enabled=true" aria-current={enabled === 'true' ? 'true' : undefined} active={enabled === 'true'}>{t.t('flags.filterOn')}</Chip>
        <Chip as={Link} href="/flags?enabled=false" aria-current={enabled === 'false' ? 'true' : undefined} active={enabled === 'false'}>{t.t('flags.filterOff')}</Chip>
      </nav>

      {notice ? <p className="kv-error" role="alert">{notice}</p> : (
        <>
          <DataTable columns={columns} rows={rows} empty={t.t('flags.empty')} />
          {nextCursor && (
            <p className="kv-pager">
              <Button as={Link} href={`/flags?cursor=${encodeURIComponent(nextCursor)}${enabled ? `&enabled=${enabled}` : ''}`}>{t.t('common.nextPage')}</Button>
            </p>
          )}
        </>
      )}

      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('flags.create')}</summary>
        <p className="kv-field__hint">{t.t('flags.createHint')}</p>
        <form action={createFlagAction} className="kv-form">
          <label htmlFor="key" className="kv-field__label">{t.t('flags.fieldKey')}</label>
          <input id="key" name="key" className="kv-input" required placeholder="payments.upi" />
          <label htmlFor="description" className="kv-field__label">{t.t('flags.fieldDescription')}</label>
          <input id="description" name="description" className="kv-input" maxLength={500} />
          <label htmlFor="rolloutPct" className="kv-field__label">{t.t('flags.fieldRollout')}</label>
          <input id="rolloutPct" name="rolloutPct" className="kv-input" inputMode="numeric" defaultValue="0" />
          <label htmlFor="createReason" className="kv-field__label">{t.t('flags.reason')}</label>
          <input id="createReason" name="reason" className="kv-input" required minLength={3} maxLength={1000} />
          <Button type="submit">{t.t('flags.createSubmit')}</Button>
        </form>
      </details>
    </section>
  );
}
