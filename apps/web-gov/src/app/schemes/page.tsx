// apps/web-gov/src/app/schemes/page.tsx · GW-1: scheme definitions + the applications pipeline (box=queue,
// status filter in URL, keyset preserving it). Row → /schemes/[id] for review actions.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../lib/session';
import { govClient } from '../../lib/api-client';
import { DataTable } from '../../components/DataTable';
import { getTranslator, getLang } from '../../lib/i18n';
import { formatDate } from '@krishalaya/i18n';
import { APP_STATUSES, isAppStatus } from '../../features/schemes/review';
import type { Scheme, SchemeApplication, ApplicationStatus } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('sch.title'), robots: { index: false, follow: false } };
}

export default async function SchemesPage({ searchParams }: { searchParams: { status?: string; cursor?: string } }) {
  await requireSession('/schemes');
  const t = getTranslator();
  const lang = getLang();
  const status = isAppStatus(searchParams.status) ? (searchParams.status as ApplicationStatus) : undefined;
  const client = govClient();

  let apps: SchemeApplication[] = []; let nextCursor: string | null = null; let appsFailed = false;
  try {
    const p = await client.schemes.listApplications({ box: 'queue', status, cursor: searchParams.cursor, limit: 50 });
    apps = p.items; nextCursor = p.nextCursor;
  } catch { appsFailed = true; }

  let schemes: Scheme[] = []; let schemesFailed = false;
  try { schemes = await client.schemes.list({ activeOnly: true }); } catch { schemesFailed = true; }

  const schemeName = (id: string) => (schemes.find((s) => s.id === id) as { defaultName?: string } | undefined)?.defaultName ?? id.slice(0, 8);
  const pager = (c: string) => { const q = new URLSearchParams(); if (status) q.set('status', status); q.set('cursor', c); return `/schemes?${q}`; };

  return (
    <section>
      <h1>{t.t('sch.title')}</h1>
      <p className="kv-field__hint">{t.t('sch.hint')}</p>

      <h2>{t.t('sch.pipeline')}</h2>
      <form method="get" action="/schemes" className="kv-inline-form" role="search" aria-label={t.t('sch.filterLabel')}>
        <label htmlFor="sc-status" className="kv-field__label">{t.t('sch.colStatus')}</label>
        <select id="sc-status" name="status" defaultValue={status ?? ''} className="kv-input">
          <option value="">{t.t('sch.status.any')}</option>
          {APP_STATUSES.map((s) => <option key={s} value={s}>{t.t(`sch.status.${s}`)}</option>)}
        </select>
        <button type="submit" className="kv-btn kv-btn--muted">{t.t('sch.apply')}</button>
      </form>
      {appsFailed ? <p className="kv-error" role="alert">{t.t('sch.loadError')}</p> : (
        <DataTable
          rows={apps}
          empty={t.t('sch.pipelineEmpty')}
          columns={[
            { header: t.t('sch.colApplication'), cell: (a) => <Link href={`/schemes/${a.id}`} className="kv-link">{schemeName(a.schemeId)} · {a.applicantUserId.slice(0, 8)}…</Link> },
            { header: t.t('sch.colStatus'), cell: (a) => <span className="kv-badge">{t.t(`sch.status.${a.status}`) || a.status}</span> },
            { header: t.t('sch.colSubmitted'), cell: (a) => (a.submittedAt ? formatDate(a.submittedAt, lang) : t.t('common.dash')) },
            { header: t.t('sch.colAssisted'), cell: (a) => (a.assistedBy ? t.t('sch.assistedYes') : t.t('common.dash')) },
          ]}
        />
      )}
      {nextCursor && <p className="kv-pager"><a href={pager(nextCursor)} className="kv-btn--link">{t.t('common.nextPage')}</a></p>}

      <h2>{t.t('sch.definitions')}</h2>
      {schemesFailed ? <p className="kv-error" role="alert">{t.t('sch.loadError')}</p> : (
        <DataTable
          rows={schemes}
          empty={t.t('sch.definitionsEmpty')}
          columns={[
            { header: t.t('sch.colScheme'), cell: (s) => (s as { defaultName?: string; id: string }).defaultName ?? s.id.slice(0, 8) },
            { header: t.t('sch.colVersion'), cell: (s) => String((s as { version?: number }).version ?? t.t('common.dash')) },
          ]}
        />
      )}
      <p className="kv-field__hint kv-note">{t.t('sch.eligNote')}</p>
    </section>
  );
}
