// apps/web-tenant/src/app/studio/page.tsx · W410 — the studio home · PC-56 TENANT-7d.
//
// W410: *"Your teaching, in one place — the courses you author, the learners you reach, the classes you host live."*
// The instructor's HONEST desk: their profile as it stands (with the verified badge drawn only from the API's fact),
// their courses by state with W410's Learners / Completion columns, their next class, and four tiles — three MEASURED
// (learners who enrolled in a declared 30-day window; watch-hours as the LIFETIME sum, because `lesson_progress` has no
// timestamp and *"this month"* is not a fact it holds; certificates ever) and ONE REFUSED BY NAME: *"Earnings MTD
// ₹25,508.80 — your 80% royalty share"* is 7d-money's number — the money path pays the wallet at purchase and keeps no
// royalty ledger, so this tile prints what exists (the royalty share on the row) and *not measured*, never a figure.
//
// PC-26's inline bio form is GONE: the profile is the instructor FORM chain at `/studio/profile/edit` (W2636–W2639). *New
// course* is the course chain (7a); *Start from template* is the STUDIO FORM chain at `/studio/from-template`
// (W2775–W2778), offered because 0173's `course_templates` registry exists and the page lists what it holds.
//
// SIX STATES. `ready` · `noProfile` (an author with no instructor row yet — W410's *"Studio access needed"* said *"ask
// your tenant admin to verify your credentials"*; the honest first step is the profile, and the page says so) ·
// `restricted` (no education verb) · `notEnabled` (the module guard's 404) · `error` with Retry · loading (loading.tsx).
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { getTranslator, getLang } from '../../lib/i18n';
import { formatMoneyMinor, formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { StudioView } from '@krishalaya/sdk-js';
import { NEW_COURSE_HREF } from '../../features/courses/desk';
import { liveClassHref, liveHref, whenText } from '../../features/live/classes';
import {
  STUDIO_TILES, completenessDone, completenessKey, coursesByState, editProfileHref, fromTemplateHref, instructorsHref, profileHref, refusedKey, studioHref, studioState, studioStateKey,
  tileKey, tileMeasured, verifiedBadge, watchHoursText,
} from '../../features/studio/instructor';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('studio.title'), robots: { index: false, follow: false } };
}

export default async function StudioPage() {
  await requireSession(studioHref());
  const t = getTranslator();
  const lang = getLang();

  let view: StudioView | null = null; let code: string | null = null; let status: number | undefined;
  try { view = await tenantClient().instructors.studio(); }
  catch (e) { if (e instanceof SdkError) { code = e.code ?? null; status = e.status; } else code = 'error'; }
  const state = studioState(code, status, view);
  const me = view?.instructor ?? null;
  const facts = view?.facts ?? null;

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('studio.title')}</h1>
        {state === 'ready' && <span><Link href={NEW_COURSE_HREF} className="kv-btn">{t.t('courses.new')}</Link> <Link href={liveHref()} className="kv-btn--link">{t.t('live.title')} →</Link></span>}
      </div>
      <p className="kv-field__hint">{t.t('studio.lead')}</p>

      {state !== 'ready' && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <p>{t.t(studioStateKey(state))}</p>
          {state === 'noProfile' && <p><Link href={editProfileHref()} className="kv-btn">{t.t('studio.createProfile')}</Link></p>}
          {state === 'noProfile' && view && view.templates.length > 0 && <p className="kv-field__hint">{t.t('studio.templatesAfterProfile', { n: formatNumber(view.templates.length, lang) })}</p>}
          {state === 'error' && <p><Link href={studioHref()} className="kv-btn--link">{t.t('courses.retry')}</Link></p>}
        </div>
      )}

      {state === 'ready' && view && me && (
        <>
          {/* ---- who is teaching: the profile as it stands, the badge from the API's fact alone ---- */}
          <div className="kv-card">
            <p>
              <strong>{me.name ?? t.t('studio.unnamed')}</strong>{' '}
              {verifiedBadge(me) ? <span className="kv-badge kv-badge--ok">{t.t('studio.verified')}</span> : <span className="kv-badge">{t.t('studio.notVerified')}</span>}
              {' '}<Link href={profileHref()} className="kv-btn--link">{t.t('studio.profileLink')}</Link>
            </p>
            <p className="kv-field__hint">{t.t('studio.completeness', { done: formatNumber(completenessDone(me).done, lang), of: formatNumber(completenessDone(me).of, lang) })}</p>
            <ul className="kv-list">
              {me.completeness.map((c) => <li key={c.check}>{c.done ? '✓' : '○'} {t.t(completenessKey(c.check))}</li>)}
            </ul>
            {me.privileged && <p><Link href={instructorsHref()} className="kv-btn--link">{t.t('studio.deskList')}</Link></p>}
          </div>

          {/* ---- four tiles: three measured over a declared window, one refused by name ---- */}
          <div className="kv-tiles">
            {STUDIO_TILES.map((tile) => (
              <div className="kv-card kv-tile" key={tile}>
                <span className="kv-tile__label">{t.t(tileKey(tile, 'label'))}</span>
                {tileMeasured(tile) && facts ? (
                  <strong className="kv-tile__value">
                    {tile === 'learners' && formatNumber(facts.learnersWindow, lang)}
                    {tile === 'watchHours' && formatNumber(Number(watchHoursText(facts.watchSecondsLifetime)), lang)}
                    {tile === 'certificates' && formatNumber(facts.certificatesLifetime, lang)}
                  </strong>
                ) : <strong className="kv-tile__value kv-field__hint">{t.t('studio.notMeasured')}</strong>}
                <span className="kv-field__hint">
                  {tile === 'learners' && t.t(tileKey(tile, 'sub'), { days: formatNumber(view.windowDays, lang), lifetime: formatNumber(facts?.learnersLifetime ?? 0, lang) })}
                  {tile === 'watchHours' && <>{t.t(tileKey(tile, 'sub'))} {t.t(refusedKey('watchMonth'))}</>}
                  {tile === 'certificates' && t.t(tileKey(tile, 'sub'))}
                  {tile === 'earnings' && <>{t.t(tileKey(tile, 'sub'), { share: formatNumber(me.instructor.royaltyBps / 100, lang) })} {t.t(refusedKey('earnings'))}</>}
                </span>
              </div>
            ))}
          </div>

          {/* ---- my courses, by state, with W410's columns ---- */}
          <div className="kv-card">
            <h2>{t.t('studio.myCourses')}</h2>
            <p className="kv-field__hint">{coursesByState(view.byStatus).map((s) => `${t.t(`studio.status.${s.status}`)} ${formatNumber(s.n, lang)}`).join(' · ')}</p>
            {view.courses.length === 0 ? (
              <div className="kv-card kv-card--notice" role="status">
                <p>{t.t('studio.empty')}</p>
                <p>{t.t('studio.emptyTemplate')}</p>
                {view.templates.length > 0 ? <p><Link href={fromTemplateHref()} className="kv-btn">{t.t('studio.startFromTemplate')}</Link></p> : <p className="kv-field__hint">{t.t('studio.noTemplates')}</p>}
              </div>
            ) : (
              <table className="kv-table">
                <thead><tr><th>{t.t('studio.colCourse')}</th><th>{t.t('studio.colTopic')}</th><th>{t.t('studio.colStatus')}</th><th>{t.t('studio.colPrice')}</th><th>{t.t('studio.colLearners')}</th><th>{t.t('studio.colCompletion')}</th></tr></thead>
                <tbody>
                  {view.courses.map((c) => {
                    const st = c.stats;
                    // integer arithmetic on two counts the API sent; NOTHING for a course nobody opened (7a's ruling)
                    const pct = st && st.learners > 0 ? Math.floor((st.completed * 100) / st.learners) : null;
                    return (
                      <tr key={c.id}>
                        <td><Link href={`/courses/${encodeURIComponent(c.id)}`} className="kv-link">{c.defaultTitle}</Link> <Link href={`/studio/${encodeURIComponent(c.id)}`} className="kv-btn--link">{t.t('studio.openBuilder')}</Link></td>
                        <td>{c.topicName ?? <span className="kv-field__hint">{t.t('common.dash')}</span>}</td>
                        <td><span className="kv-badge">{t.t(`studio.status.${c.status}`) || c.status}</span></td>
                        <td>{c.priceMinor === '0' ? t.t('studio.free') : formatMoneyMinor(c.priceMinor, c.currencyCode, lang)}</td>
                        <td>{st ? formatNumber(st.learners, lang) : <span className="kv-field__hint">{t.t('common.dash')}</span>}</td>
                        <td>{pct === null ? <span className="kv-field__hint">{t.t('common.dash')}</span> : `${formatNumber(pct, lang)}%`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {view.courses.length > 0 && view.templates.length > 0 && <p><Link href={fromTemplateHref()} className="kv-btn--link">{t.t('studio.startFromTemplate')}</Link></p>}
            <p className="kv-field__hint">{t.t(refusedKey('tenantTemplates'))}</p>
          </div>

          {/* ---- classes: the next one, and the schedule ---- */}
          <div className="kv-card">
            <h2>{t.t('studio.classes')}</h2>
            {facts && facts.nextClass ? (
              <p>{t.t('studio.upcomingClasses', { n: formatNumber(facts.upcomingClasses, lang) })} · <Link href={liveClassHref(facts.nextClass.id)} className="kv-link">{facts.nextClass.title}</Link> <span className="kv-field__hint">{whenText(facts.nextClass)}</span></p>
            ) : <p className="kv-field__hint">{t.t('studio.noClasses')}</p>}
            <p><Link href={liveHref()} className="kv-btn--link">{t.t('live.title')}</Link></p>
          </div>

          {/* ---- W410's sidebar furniture this platform does not have, by name ---- */}
          <p className="kv-field__hint">{t.t(refusedKey('learnerInsights'))}</p>
        </>
      )}
    </section>
  );
}
