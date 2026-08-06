// apps/web-admin/src/app/schemes-registry/calendar/page.tsx · read-only window calendar — active schemes whose
// application window is open on a given 'MM-DD' (default today). Server component: requireAdmin gates, adminGet
// hits GET /v1/schemes-registry/schemes/calendar. A plain GET <form> sets the date (no client JS). Degrade-never-die.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { DataTable, Column } from '../../../components/DataTable';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { isMmDd, type SchemeRow } from '../../../features/schemes-registry/scheme';
import { closeClass, closeKey, type CloseState } from '../../../features/schemes-registry/version';

/** The rows this page renders carry the server's derived deadline state alongside the scheme. */
type CalendarRow = SchemeRow & { closeState?: CloseState; wrapsYear?: boolean };
/** What the server says about the nudge ladder. `available:false` is the only value it can honestly send today. */
interface NudgeGap { available: boolean; reason?: string; missing?: string[] }

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('sr.calendarTitle'), robots: { index: false, follow: false } };
}

export default async function CalendarPage({ searchParams }: { searchParams: { onDate?: string; cursor?: string } }) {
  requireAdmin();
  const t = getTranslator();
  const onDate = isMmDd(searchParams.onDate) ? searchParams.onDate : undefined;

  let rows: CalendarRow[] = []; let nextCursor: string | undefined; let effectiveDate: string | undefined; let notice: string | undefined;
  let closingSoon: Array<{ id: string; code: string; defaultName: string; closeState: CloseState }> = [];
  let nudge: NudgeGap = { available: false };
  try {
    const res = await adminGet<CalendarRow[]>('schemes-registry/schemes/calendar', { onDate, cursor: searchParams.cursor, limit: 50 });
    rows = res.data ?? [];
    nextCursor = (res.meta?.nextCursor as string | undefined) ?? undefined;
    effectiveDate = (res.meta?.onDate as string | undefined) ?? undefined;
    const meta = res.meta as { closingSoon?: typeof closingSoon; nudgeQueue?: NudgeGap } | undefined;
    closingSoon = meta?.closingSoon ?? [];
    nudge = meta?.nudgeQueue ?? { available: false };
  } catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const cols: Column<CalendarRow>[] = [
    { header: t.t('sr.schemeCode'), cell: (r) => <Link href={`/schemes-registry/schemes/${encodeURIComponent(r.id)}`}>{r.code}</Link> },
    { header: t.t('sr.schemeName'), cell: (r) => r.defaultName },
    { header: t.t('sr.window'), cell: (r) => (r.applicationWindow ? `${r.applicationWindow.opens} → ${r.applicationWindow.closes}` : t.t('common.dash')) },
    // The derivable half of W073. An always-open scheme (pm_kisan, kcc) gets NO urgency styling — it has no deadline,
    // and colouring it like one would park pm_kisan permanently at the top of somebody's worry list. An unparseable
    // or impossible window DOES read as a failure: both mean a stored date nobody can act on.
    {
      header: t.t('sv.closes'),
      cell: (r) => {
        const cs: CloseState = r.closeState ?? { kind: 'no_window' };
        const key = closeKey(cs);
        return <span className={closeClass(cs)}>{key === 'closesIn' && cs.kind === 'closes_in' ? t.t('sv.close.closesIn', { days: String(cs.days) }) : t.t(`sv.close.${key}`)}</span>;
      },
    },
  ];
  const nextHref = () => {
    const sp = new URLSearchParams();
    if (onDate) sp.append('onDate', onDate);
    if (nextCursor) sp.append('cursor', nextCursor);
    return `/schemes-registry/calendar?${sp.toString()}`;
  };

  return (
    <section>
      <p className="kv-backlink"><Link href="/schemes-registry">{t.t('sr.back')}</Link></p>
      <h1>{t.t('sr.calendarTitle')}</h1>
      <p className="kv-muted">{t.t('sr.calendarLead')}{effectiveDate ? ` ${t.t('sr.calendarOn')} ${effectiveDate}` : ''}</p>

      <form method="get" className="kv-form kv-filters" aria-label={t.t('sr.calendarFilter')}>
        <input name="onDate" className="kv-input kv-input--sm" defaultValue={onDate ?? ''} placeholder={t.t('sr.mmddHint')} />
        <button type="submit" className="kv-btn">{t.t('sr.calendarApply')}</button>
      </form>

      {notice ? <p className="kv-error" role="alert">{notice}</p> : (
        <>
          <DataTable columns={cols} rows={rows} empty={t.t('sr.calendarEmpty')} />
          {nextCursor && <p className="kv-pager"><Link className="kv-btn" href={nextHref()}>{t.t('common.nextPage')}</Link></p>}

          <h2>{t.t('sv.closingSoonHeading')}</h2>
          {closingSoon.length === 0
            ? <p className="kv-empty">{t.t('sv.closingSoonEmpty')}</p>
            : (
              <ul>
                {closingSoon.map((c) => (
                  <li key={c.id}>
                    <Link href={`/schemes-registry/schemes/${encodeURIComponent(c.id)}`}>{c.code}</Link> — {c.defaultName}{' '}
                    <span className={closeClass(c.closeState)}>{c.closeState.kind === 'closes_in' ? t.t('sv.close.closesIn', { days: String(c.closeState.days) }) : t.t(`sv.close.${closeKey(c.closeState)}`)}</span>
                  </li>
                ))}
              </ul>
            )}

          {/* W073's lower panel is a D−14/D−7/D−2 nudge SCHEDULE with per-channel fan-out and an "eligible
              not-applied" audience. None of it exists: no scheduled job, no eligibility sweep to size an audience,
              no IVR provider, no DLT registration for SMS. Named rather than drawn as three greyed rows implying a
              scheduler — and deliberately with no estimated audience number, because an operator plans outreach
              against whatever number is on this screen. */}
          {!nudge.available && (
            <>
              <h2>{t.t('sv.nudgeHeading')}</h2>
              <p className="kv-notice">{t.t('sv.nudgeNotBuilt')}</p>
              <ul className="kv-detail__muted">
                {(nudge.missing ?? []).map((m) => <li key={m}>{t.t(`sv.nudgeMissing.${m}`)}</li>)}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
