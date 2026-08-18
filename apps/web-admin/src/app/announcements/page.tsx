// apps/web-admin/src/app/announcements/page.tsx · god-mode platform-announcements. Server component: requireAdmin
// gates, adminGet hits GET /v1/announcements (status + severity filter, keyset) and GET /active (the currently-live
// set) in parallel, each degrading independently. A create form (POST) starts a draft; text is plain (no HTML,
// validated in features/announcements). A platform notice reaches every tenant. Degrade-never-die. No inline styles.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../lib/admin-client';
import { DataTable, Column } from '../../components/DataTable';
import { getTranslator } from '../../lib/i18n';
import { adminNoticeKey } from '../../features/nav/nav-model';
import { ANNOUNCEMENT_STATUSES, SEVERITIES, PLACEMENTS, announcementStatusKey, type AnnouncementRow } from '../../features/announcements/announcement';
import { createAnnouncementAction } from './actions';

import { Button, Chip, StatusPill, type StatusTone } from '@krishalaya/ui';
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ann.title'), robots: { index: false, follow: false } };
}

const ST_TONE: Record<string, StatusTone> = { draft: 'neutral', scheduled: 'warning', published: 'success', expired: 'neutral', archived: 'neutral' };
const SEV_TONE: Record<string, StatusTone> = { info: 'neutral', warning: 'warning', critical: 'danger' };
const ERR = new Set(['title', 'body', 'severity', 'placement', 'plans', 'countries', 'reason', 'elevation', 'conflict', 'invalid', 'generic']);

export default async function AnnouncementsPage({ searchParams }: { searchParams: { cursor?: string; status?: string; severity?: string; ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();
  const status = (ANNOUNCEMENT_STATUSES as readonly string[]).includes(searchParams.status ?? '') ? searchParams.status : undefined;
  const severity = (SEVERITIES as readonly string[]).includes(searchParams.severity ?? '') ? searchParams.severity : undefined;

  let rows: AnnouncementRow[] = []; let nextCursor: string | undefined; let notice: string | undefined;
  try {
    const res = await adminGet<AnnouncementRow[]>('announcements', { cursor: searchParams.cursor, status, severity, limit: 50 });
    rows = res.data ?? [];
    nextCursor = (res.meta?.nextCursor as string | undefined) ?? undefined;
  } catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  let active: AnnouncementRow[] = [];
  try { active = (await adminGet<AnnouncementRow[]>('announcements/active')).data ?? []; } catch { /* degrade */ }

  const okCreated = searchParams.ok === 'created';
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const cols: Column<AnnouncementRow>[] = [
    { header: t.t('ann.titleCol'), cell: (r) => <Link href={`/announcements/${encodeURIComponent(r.id)}`}>{r.title}</Link> },
    { header: t.t('ann.severity'), cell: (r) => <StatusPill tone={SEV_TONE[r.severity] ?? 'neutral'} label={t.t(`ann.sev.${r.severity}`)} /> },
    { header: t.t('ann.placement'), cell: (r) => t.t(`ann.place.${r.placement}`) },
    { header: t.t('ann.status'), cell: (r) => { const s = announcementStatusKey(r.status); return <StatusPill tone={ST_TONE[s] ?? 'neutral'} label={t.t(`ann.state.${s}`)} />; } },
    { header: t.t('ann.endsAt'), cell: (r) => r.endsAt ?? t.t('common.dash') },
  ];
  const qp = (extra: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    const merged = { status, severity, ...extra };
    for (const [k, v] of Object.entries(merged)) if (v) sp.append(k, v);
    const s = sp.toString();
    return `/announcements${s ? `?${s}` : ''}`;
  };

  return (
    <section>
      <h1>{t.t('ann.title')}</h1>
      <p className="kv-muted">{t.t('ann.lead')}</p>
      {okCreated && <p className="kv-success" role="status">{t.t('ann.ok.created')}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`ann.error.${errKey}`)}</p>}

      <h2>{t.t('ann.activeHeading')}</h2>
      {active.length === 0 ? <p className="kv-muted">{t.t('ann.activeEmpty')}</p> : (
        <ul className="kv-card-grid">{active.map((a) => (
          <li key={a.id} className="kv-card">
            <Link href={`/announcements/${encodeURIComponent(a.id)}`} className="kv-card__title">{a.title}</Link>
            <p><StatusPill tone={SEV_TONE[a.severity] ?? 'neutral'} label={t.t(`ann.sev.${a.severity}`)} /> · {t.t(`ann.place.${a.placement}`)}</p>
            <p className="kv-muted">{t.t('ann.endsAt')}: {a.endsAt ?? t.t('common.dash')}</p>
          </li>
        ))}</ul>
      )}

      <h2>{t.t('ann.allHeading')}</h2>
      <nav className="kv-filters" aria-label={t.t('ann.filterStatus')}>
        <Chip as={Link} href={qp({ status: undefined, cursor: undefined })} aria-current={!status ? 'true' : undefined} active={!status}>{t.t('ann.filterAll')}</Chip>
        {ANNOUNCEMENT_STATUSES.map((s) => (
          <Chip as={Link} key={s} href={qp({ status: s, cursor: undefined })} aria-current={status === s ? 'true' : undefined} active={status === s}>{t.t(`ann.state.${s}`)}</Chip>
        ))}
      </nav>
      <nav className="kv-filters" aria-label={t.t('ann.filterSeverity')}>
        <Chip as={Link} href={qp({ severity: undefined, cursor: undefined })} aria-current={!severity ? 'true' : undefined} active={!severity}>{t.t('ann.filterAll')}</Chip>
        {SEVERITIES.map((s) => (
          <Chip as={Link} key={s} href={qp({ severity: s, cursor: undefined })} aria-current={severity === s ? 'true' : undefined} active={severity === s}>{t.t(`ann.sev.${s}`)}</Chip>
        ))}
      </nav>

      {notice ? <p className="kv-error" role="alert">{notice}</p> : (
        <>
          <DataTable columns={cols} rows={rows} empty={t.t('ann.empty')} />
          {nextCursor && <p className="kv-pager"><Button as={Link} href={qp({ cursor: nextCursor })}>{t.t('common.nextPage')}</Button></p>}
        </>
      )}

      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('ann.create')}</summary>
        <p className="kv-field__hint">{t.t('ann.createHint')}</p>
        <form action={createAnnouncementAction} className="kv-form">
          <label htmlFor="title" className="kv-field__label">{t.t('ann.titleCol')}</label>
          <input id="title" name="title" className="kv-input" required maxLength={200} />
          <label htmlFor="body" className="kv-field__label">{t.t('ann.body')}</label>
          <input id="body" name="body" className="kv-input" required maxLength={4000} />
          <label htmlFor="severity" className="kv-field__label">{t.t('ann.severity')}</label>
          <select id="severity" name="severity" className="kv-input" defaultValue="info">{SEVERITIES.map((s) => <option key={s} value={s}>{t.t(`ann.sev.${s}`)}</option>)}</select>
          <label htmlFor="placement" className="kv-field__label">{t.t('ann.placement')}</label>
          <select id="placement" name="placement" className="kv-input" defaultValue="banner">{PLACEMENTS.map((p) => <option key={p} value={p}>{t.t(`ann.place.${p}`)}</option>)}</select>
          <label htmlFor="plans" className="kv-field__label">{t.t('ann.plans')}</label>
          <input id="plans" name="plans" className="kv-input" placeholder={t.t('ann.plansHint')} />
          <label htmlFor="countries" className="kv-field__label">{t.t('ann.countries')}</label>
          <input id="countries" name="countries" className="kv-input" placeholder={t.t('ann.countriesHint')} />
          <label htmlFor="createReason" className="kv-field__label">{t.t('ann.reason')}</label>
          <input id="createReason" name="reason" className="kv-input" required minLength={3} maxLength={1000} />
          <Button type="submit">{t.t('ann.createSubmit')}</Button>
        </form>
      </details>
    </section>
  );
}
