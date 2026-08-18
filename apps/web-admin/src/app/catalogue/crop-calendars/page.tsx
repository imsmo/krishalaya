// apps/web-admin/src/app/catalogue/crop-calendars/page.tsx · CROP CALENDARS (PC-56 ADMIN-3c, canon W110).
//
// THIS IS THE ONLY SCREEN IN THE CONSOLE WHOSE CONTENT A FARMER ACTS ON PHYSICALLY. A wrong unit conversion misquotes a
// quantity and somebody argues at the weighbridge; a wrong sowing window is discovered at harvest, by which point nothing
// can be done. So two rules are rendered as notices rather than hints:
//
//   1. EVERY CALENDAR NAMES ITS SOURCE. The canon says it twice and the column was NULLABLE for the platform's whole
//      life — migration 0104 made it a constraint. Unattributed agronomy cannot be checked by anybody.
//   2. THE PLATFORM NEVER COMPUTES A FARM'S CURRENT STAGE. Day offsets are relative to sowing; no per-parcel sowing date
//      exists that it would be honest to anchor them to, and the platform does not invent one. `crop_seasons.sown_on` IS
//      one join away, which is exactly why the rule is written down.
//
// The stage form submits the WHOLE timeline, because a timeline is only coherent as a set — a per-stage save could leave a
// gap between two saves that no single request would have been refused for.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { createCalendarAction, setCalendarActiveAction } from '../actions';
import {
  Button, Callout, Chip, EmptyState, StatusPill,
} from '@krishalaya/ui';
import {
  SEASONS, formStages, timelineProblems, stageWidthPct, MAX_DAY, MIN_REASON,
  type CalendarRow,
} from '../../../features/catalogue/crops';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('cal.title'), robots: { index: false, follow: false } };
}

interface CalendarsView { items: CalendarRow[]; seasons: string[]; basis: string; sourceRule: string }

export default async function CropCalendarsPage(
  { searchParams }: { searchParams: { categoryId?: string; season?: string; ok?: string; error?: string; why?: string } },
) {
  requireAdmin();
  const t = getTranslator();

  const season = (SEASONS as readonly string[]).includes(searchParams.season ?? '') ? searchParams.season : undefined;

  let view: CalendarsView | null = null; let notice: string | undefined;
  try {
    view = (await adminGet<CalendarsView>('catalogue/crop-calendars', {
      categoryId: searchParams.categoryId, season,
    })).data ?? null;
  } catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const rows = view?.items ?? [];
  const okKey = searchParams.ok?.startsWith('cal_') ? searchParams.ok.slice(4) : undefined;
  const errKey = searchParams.error?.startsWith('cal_') ? searchParams.error.slice(4) : searchParams.error;
  const blankRows = formStages([]);

  const href = (extra: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries({ categoryId: searchParams.categoryId, season, ...extra })) if (v) sp.append(k, v);
    const s = sp.toString();
    return `/catalogue/crop-calendars${s ? `?${s}` : ''}`;
  };

  return (
    <section>
      <p className="kv-backlink"><Link href="/catalogue/crops">{t.t('cat.back')}</Link></p>
      <h1>{t.t('cal.title')}</h1>
      <p className="kv-muted">{t.t('cal.lead')}</p>
      {/* the two rules, as notices */}
      <Callout>{t.t('cal.sourceRule')}</Callout>
      <Callout>{t.t('cal.absentRule')}</Callout>

      {okKey && <p className="kv-success" role="status">{t.t(`cal.ok.${okKey}`)}</p>}
      {errKey && (
        <p className="kv-error" role="alert">
          {errKey === 'rejected' ? t.t('cal.error.rejected', { why: searchParams.why ?? '' }) : t.t(`cal.error.${errKey}`)}
        </p>
      )}

      <nav className="kv-filters" aria-label={t.t('cal.season')}>
        <Chip as={Link} href={href({ season: undefined })} active={!season}>{t.t('attr.filterAllTypes')}</Chip>
        {SEASONS.map((s) => (
          <Chip as={Link} key={s} href={href({ season: s })} active={season === s}>
            {t.t(`crop.season.${s}`)}
          </Chip>
        ))}
      </nav>

      {notice ? <p className="kv-error" role="alert">{notice}</p> : rows.length === 0 ? (
        <EmptyState title={t.t('cal.none')} />
      ) : (
        rows.map((c) => {
          const problems = timelineProblems(c.stages);
          const total = c.durationDaysMax;
          return (
            <div key={c.id} className="kv-card">
              <p className="kv-card__title">
                {c.cropName} · {t.t(`crop.season.${c.season}`)}
                {' · '}{c.regionName ?? t.t('cal.panIndia')}
                {' '}<StatusPill tone={c.isActive ? 'success' : 'neutral'} label={t.t(c.isActive ? 'cat.active' : 'eav.inactive')} />
              </p>
              <dl className="kv-detail">
                <dt>{t.t('cal.source')}</dt><dd>{c.source}</dd>
                <dt>{t.t('cal.duration')}</dt>
                <dd>{t.t('cal.durationDays', { min: String(c.durationDaysMin), max: String(c.durationDaysMax) })}</dd>
                <dt>{t.t('cal.linked')}</dt>
                <dd>
                  {c.categoryCode
                    ? <code>{c.categoryCode}</code>
                    // said on the row: an unlinked calendar does not back its crop's season claim
                    : <StatusPill tone="warning" label={t.t('cal.notLinked')} title={t.t('cal.notLinkedHint')} />}
                </dd>
              </dl>

              {/* problems computed here only to MARK them; the server's refusal is the authority */}
              {problems.length > 0 && (
                <p className="kv-error" role="alert">{t.t('cal.problems', { list: problems.join('; ') })}</p>
              )}

              <table className="kv-table">
                <thead><tr>
                  <th scope="col">{t.t('cal.stageName')}</th>
                  <th scope="col">{t.t('cal.dayFrom')}</th>
                  <th scope="col">{t.t('cal.dayTo')}</th>
                  <th scope="col">{t.t('cal.advisory')}</th>
                </tr></thead>
                <tbody>
                  {c.stages.map((s, i) => (
                    <tr key={`${c.id}-${i}`}>
                      <td>
                        {s.name}
                        {/* a bare proportional bar — no dates anywhere, because there is no sowing date to anchor to */}
                        <span className="kv-bar" style={{ width: `${stageWidthPct(s, total)}%` }} aria-hidden="true" />
                      </td>
                      <td>{s.dayFrom}</td>
                      <td>{s.dayTo}</td>
                      <td>{s.advisory ?? t.t('common.dash')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <details className="kv-limit-form">
                <summary className="kv-card__title">{t.t(c.isActive ? 'cal.deactivate' : 'cal.activate')}</summary>
                <p className="kv-field__hint">{t.t('cal.deactivateHint')}</p>
                <form action={setCalendarActiveAction} className="kv-form">
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="isActive" value={c.isActive ? 'false' : 'true'} />
                  <label htmlFor={`ca-${c.id}`} className="kv-field__label">{t.t('eav.reason')}</label>
                  <input id={`ca-${c.id}`} name="reason" className="kv-input" required minLength={MIN_REASON} maxLength={1000} />
                  <Button type="submit" variant={c.isActive ? 'danger' : 'secondary'}>
                    {t.t(c.isActive ? 'cal.deactivate' : 'cal.activate')}
                  </Button>
                </form>
              </details>
            </div>
          );
        })
      )}

      {/* ---------------- author one ---------------- */}
      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('cal.newTitle')}</summary>
        <p className="kv-field__hint">{t.t('cal.newHint')}</p>
        <form action={createCalendarAction} className="kv-form">
          {/* the SOURCE is the first field, because it is the first rule */}
          <label htmlFor="c-source" className="kv-field__label">{t.t('cal.source')}</label>
          <input id="c-source" name="source" className="kv-input" required minLength={3} maxLength={120}
            placeholder="ICAR-DGR Junagadh" />

          <label htmlFor="c-crop" className="kv-field__label">{t.t('cal.crop')}</label>
          <input id="c-crop" name="cropName" className="kv-input" required minLength={2} maxLength={120} />

          <label htmlFor="c-season" className="kv-field__label">{t.t('cal.season')}</label>
          <select id="c-season" name="season" className="kv-input" required defaultValue="">
            <option value="" disabled>{t.t('cal.season')}</option>
            {SEASONS.map((s) => <option key={s} value={s}>{t.t(`crop.season.${s}`)}</option>)}
          </select>

          <label htmlFor="c-cat" className="kv-field__label">{t.t('cal.linked')}</label>
          <input id="c-cat" name="categoryId" className="kv-input" defaultValue={searchParams.categoryId ?? ''} />
          <p className="kv-field__hint">{t.t('cal.notLinkedHint')}</p>

          <label htmlFor="c-region" className="kv-field__label">{t.t('cal.region')}</label>
          <input id="c-region" name="regionId" className="kv-input" />

          <label htmlFor="c-min" className="kv-field__label">{t.t('cal.duration')}</label>
          <input id="c-min" name="durationDaysMin" type="number" min={0} max={MAX_DAY} className="kv-input" required />
          <input aria-label={t.t('cal.duration')} name="durationDaysMax" type="number" min={0} max={MAX_DAY}
            className="kv-input" required />

          {/* the WHOLE timeline in one submit */}
          <p className="kv-field__hint">{t.t('cal.blankRows')}</p>
          <input type="hidden" name="stageCount" value={String(blankRows.length)} />
          <table className="kv-table">
            <thead><tr>
              <th scope="col">{t.t('cal.stageName')}</th>
              <th scope="col">{t.t('cal.dayFrom')}</th>
              <th scope="col">{t.t('cal.dayTo')}</th>
              <th scope="col">{t.t('cal.advisory')}</th>
            </tr></thead>
            <tbody>
              {blankRows.map((_, i) => (
                <tr key={`new-stage-${i}`}>
                  <td><input aria-label={t.t('cal.stageName')} name={`stage_${i}_name`} className="kv-input" maxLength={60} /></td>
                  <td><input aria-label={t.t('cal.dayFrom')} name={`stage_${i}_dayFrom`} type="number" min={0} max={MAX_DAY} className="kv-input" /></td>
                  <td><input aria-label={t.t('cal.dayTo')} name={`stage_${i}_dayTo`} type="number" min={0} max={MAX_DAY} className="kv-input" /></td>
                  <td><input aria-label={t.t('cal.advisory')} name={`stage_${i}_advisory`} className="kv-input" maxLength={2000} /></td>
                </tr>
              ))}
            </tbody>
          </table>

          <label htmlFor="c-reason" className="kv-field__label">{t.t('eav.reason')}</label>
          <input id="c-reason" name="reason" className="kv-input" required minLength={MIN_REASON} maxLength={1000} />
          <Button type="submit" variant="danger">{t.t('cal.create')}</Button>
        </form>
      </details>
    </section>
  );
}
