// apps/web-admin/src/app/announcements/[id]/page.tsx · announcement detail + edit + lifecycle + change history.
// Server component: requireAdmin gates, fetches GET /v1/announcements/:id (404 → notFound) and GET :id/history
// (degrades independently). Edit (PATCH) is offered only while draft/scheduled; schedule/publish/expire/archive
// are surfaced only when legal (features/announcements mirrors the state machine; a published notice is immutable).
// Each is a Server-Action form carrying a mandatory audit reason; admin-api requires FIDO2 + step-up, so a 403
// degrades to a re-auth notice and a 409 (illegal/immutable) to a message. Text is plain (no HTML). No inline styles.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { DataTable, Column } from '../../../components/DataTable';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { announcementStatusKey, canEdit, canSchedule, canPublish, canExpire, canArchive, SEVERITIES, PLACEMENTS, type AnnouncementRow, type ChangeRow } from '../../../features/announcements/announcement';
import { updateAnnouncementAction, scheduleAnnouncementAction, publishAnnouncementAction, expireAnnouncementAction, archiveAnnouncementAction } from '../actions';

import { Button, StatusPill, type StatusTone } from '@krishalaya/ui';
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ann.detailTitle'), robots: { index: false, follow: false } };
}

const SEV_TONE: Record<string, StatusTone> = { info: 'neutral', warning: 'warning', critical: 'danger' };
const OK = new Set(['created', 'updated', 'scheduled', 'published', 'expired', 'archived']);
const ERR = new Set(['title', 'body', 'severity', 'placement', 'plans', 'countries', 'startsAt', 'endsAt', 'window', 'reason', 'elevation', 'conflict', 'invalid', 'notFound', 'generic']);

export default async function AnnouncementDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();

  let ann: AnnouncementRow | undefined; let notice: string | undefined;
  try { ann = (await adminGet<AnnouncementRow>(`announcements/${encodeURIComponent(params.id)}`)).data; }
  catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`);
  }

  let history: ChangeRow[] = [];
  try { history = (await adminGet<ChangeRow[]>(`announcements/${encodeURIComponent(params.id)}/history`, { limit: 50 })).data ?? []; } catch { /* degrade */ }

  if (!ann) {
    return <section><p className="kv-backlink"><Link href="/announcements">{t.t('ann.back')}</Link></p><p className="kv-error" role="alert">{notice}</p></section>;
  }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const s = announcementStatusKey(ann.status);
  const audience = ann.audience ?? {};
  const histCols: Column<ChangeRow>[] = [
    { header: t.t('ann.histAction'), cell: (h) => h.action },
    { header: t.t('ann.histReason'), cell: (h) => h.reason },
    { header: t.t('ann.histWhen'), cell: (h) => h.createdAt ?? t.t('common.dash') },
  ];

  return (
    <section>
      <p className="kv-backlink"><Link href="/announcements">{t.t('ann.back')}</Link></p>
      <h1>{ann.title}</h1>
      {okKey && <p className="kv-success" role="status">{t.t(`ann.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`ann.error.${errKey}`)}</p>}

      <dl className="kv-facts">
        <div className="kv-facts__row"><dt>{t.t('ann.status')}</dt><dd>{t.t(`ann.state.${s}`)}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('ann.severity')}</dt><dd><StatusPill tone={SEV_TONE[ann.severity] ?? 'neutral'} label={t.t(`ann.sev.${ann.severity}`)} /></dd></div>
        <div className="kv-facts__row"><dt>{t.t('ann.placement')}</dt><dd>{t.t(`ann.place.${ann.placement}`)}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('ann.body')}</dt><dd>{ann.body}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('ann.plans')}</dt><dd>{audience.plans?.length ? audience.plans.join(', ') : t.t('ann.everyone')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('ann.countries')}</dt><dd>{audience.countries?.length ? audience.countries.join(', ') : t.t('ann.everywhere')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('ann.startsAt')}</dt><dd>{ann.startsAt ?? t.t('common.dash')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('ann.endsAt')}</dt><dd>{ann.endsAt ?? t.t('common.dash')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('ann.publishedAt')}</dt><dd>{ann.publishedAt ?? t.t('common.dash')}</dd></div>
      </dl>

      <h2>{t.t('ann.lifecycle')}</h2>
      <p className="kv-field__hint">{t.t('ann.lifecycleNote')}</p>
      <div className="kv-action-cards">
        {canSchedule(s) && (
          <form action={scheduleAnnouncementAction} className="kv-card kv-action-card">
            <input type="hidden" name="id" value={ann.id} />
            <p className="kv-field__hint">{t.t('ann.scheduleHint')}</p>
            <label className="kv-field__label">{t.t('ann.startsAt')}</label>
            <input name="startsAt" className="kv-input" required placeholder={t.t('ann.isoHint')} />
            <label className="kv-field__label">{t.t('ann.endsAt')}</label>
            <input name="endsAt" className="kv-input" required placeholder={t.t('ann.isoHint')} />
            <label className="kv-field__label">{t.t('ann.reason')}</label>
            <input name="reason" className="kv-input" required minLength={3} maxLength={1000} />
            <Button type="submit">{t.t('ann.schedule')}</Button>
          </form>
        )}
        {canPublish(s) && (
          <form action={publishAnnouncementAction} className="kv-card kv-action-card">
            <input type="hidden" name="id" value={ann.id} />
            <p className="kv-field__hint">{t.t('ann.publishHint')}</p>
            <label className="kv-field__label">{t.t('ann.endsAtOptional')}</label>
            <input name="endsAt" className="kv-input" placeholder={t.t('ann.isoHint')} />
            <label className="kv-field__label">{t.t('ann.reason')}</label>
            <input name="reason" className="kv-input" required minLength={3} maxLength={1000} />
            <Button type="submit">{t.t('ann.publish')}</Button>
          </form>
        )}
        {canExpire(s) && (
          <form action={expireAnnouncementAction} className="kv-card kv-action-card">
            <input type="hidden" name="id" value={ann.id} />
            <label className="kv-field__label">{t.t('ann.reason')}</label>
            <input name="reason" className="kv-input" required minLength={3} maxLength={1000} />
            <Button type="submit">{t.t('ann.expire')}</Button>
          </form>
        )}
        {canArchive(s) && (
          <form action={archiveAnnouncementAction} className="kv-card kv-action-card">
            <input type="hidden" name="id" value={ann.id} />
            <label className="kv-field__label">{t.t('ann.reason')}</label>
            <input name="reason" className="kv-input" required minLength={3} maxLength={1000} />
            <Button type="submit" variant="danger">{t.t('ann.archive')}</Button>
          </form>
        )}
      </div>

      {canEdit(s) && (
        <details className="kv-card kv-limit-form">
          <summary className="kv-card__title">{t.t('ann.edit')}</summary>
          <p className="kv-field__hint">{t.t('ann.editHint')}</p>
          <form action={updateAnnouncementAction} className="kv-form">
            <input type="hidden" name="id" value={ann.id} />
            <label htmlFor="etitle" className="kv-field__label">{t.t('ann.titleCol')}</label>
            <input id="etitle" name="title" className="kv-input" required maxLength={200} defaultValue={ann.title} />
            <label htmlFor="ebody" className="kv-field__label">{t.t('ann.body')}</label>
            <input id="ebody" name="body" className="kv-input" required maxLength={4000} defaultValue={ann.body} />
            <label htmlFor="eseverity" className="kv-field__label">{t.t('ann.severity')}</label>
            <select id="eseverity" name="severity" className="kv-input" defaultValue={ann.severity}>{SEVERITIES.map((x) => <option key={x} value={x}>{t.t(`ann.sev.${x}`)}</option>)}</select>
            <label htmlFor="eplacement" className="kv-field__label">{t.t('ann.placement')}</label>
            <select id="eplacement" name="placement" className="kv-input" defaultValue={ann.placement}>{PLACEMENTS.map((x) => <option key={x} value={x}>{t.t(`ann.place.${x}`)}</option>)}</select>
            <label htmlFor="eplans" className="kv-field__label">{t.t('ann.plans')}</label>
            <input id="eplans" name="plans" className="kv-input" defaultValue={(audience.plans ?? []).join(', ')} placeholder={t.t('ann.plansHint')} />
            <label htmlFor="ecountries" className="kv-field__label">{t.t('ann.countries')}</label>
            <input id="ecountries" name="countries" className="kv-input" defaultValue={(audience.countries ?? []).join(', ')} placeholder={t.t('ann.countriesHint')} />
            <label htmlFor="ereason" className="kv-field__label">{t.t('ann.reason')}</label>
            <input id="ereason" name="reason" className="kv-input" required minLength={3} maxLength={1000} />
            <Button type="submit">{t.t('ann.editSubmit')}</Button>
          </form>
        </details>
      )}

      <h2>{t.t('ann.historyHeading')}</h2>
      <DataTable columns={histCols} rows={history} empty={t.t('ann.noHistory')} />
    </section>
  );
}
