// apps/web-tenant/src/app/studio/instructors/page.tsx · the desk's list of instructors · PC-56 TENANT-7d.
//
// Not a canon screen of its own: W419's verification is the tenant desk's act (maker ≠ checker), and the desk needs a way
// to reach an instructor's W419 that is not their own. This is that way — this tenant's instructors, who is verified,
// what is waiting on each (credentials in the queue), how many courses — keyset, with a verified/unverified filter as a
// GET form. Everything printed is a count the API sent; every row links to `/studio/profile?instructor=`.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { InstructorListItem } from '@krishalaya/sdk-js';
import { courseTransportState, pageStateKey, type CoursePageState } from '../../../features/courses/desk';
import { INSTRUCTORS_PATH, instructorsHref, profileHref, studioHref } from '../../../features/studio/instructor';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('instructors.title'), robots: { index: false, follow: false } };
}

export default async function InstructorsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession(INSTRUCTORS_PATH);
  const t = getTranslator();
  const lang = getLang();
  const verified = typeof searchParams.verified === 'string' && (searchParams.verified === 'true' || searchParams.verified === 'false') ? searchParams.verified : undefined;
  const cursor = typeof searchParams.cursor === 'string' ? searchParams.cursor : null;

  let items: InstructorListItem[] = []; let nextCursor: string | null = null; let state: CoursePageState | null = null;
  try { const p = await tenantClient().instructors.list({ verified: verified === undefined ? undefined : verified === 'true', cursor: cursor ?? undefined, limit: 50 }); items = p.items; nextCursor = p.nextCursor; }
  catch (e) { state = e instanceof SdkError ? courseTransportState(e.code, e.status) : 'error'; }

  return (
    <section>
      <div className="kv-page-head"><h1>{t.t('instructors.title')}</h1></div>
      <p className="kv-field__hint">{t.t('instructors.lead')}</p>
      <p className="kv-field__hint"><Link href={studioHref()} className="kv-btn--link">← {t.t('studio.title')}</Link></p>

      {state !== null && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <p>{t.t(pageStateKey(state === 'notFound' ? 'error' : state))}</p>
          {state === 'error' && <p><Link href={instructorsHref({ verified, cursor })} className="kv-btn--link">{t.t('courses.retry')}</Link></p>}
        </div>
      )}

      {state === null && (
        <>
          <form action={INSTRUCTORS_PATH} method="get" className="kv-card kv-form--inline">
            <label className="kv-field" htmlFor="ins-verified">
              <span>{t.t('instructors.filterVerified')}</span>
              <select id="ins-verified" name="verified" defaultValue={verified ?? ''}>
                <option value="">{t.t('instructors.filterAll')}</option>
                <option value="true">{t.t('studio.verified')}</option>
                <option value="false">{t.t('studio.notVerified')}</option>
              </select>
            </label>
            <button type="submit" className="kv-btn kv-btn--muted">{t.t('common.apply')}</button>
          </form>
          {items.length === 0 ? <div className="kv-card kv-card--notice" role="status"><p>{t.t('instructors.empty')}</p></div> : (
            <table className="kv-table">
              <thead><tr><th>{t.t('instructors.colName')}</th><th>{t.t('instructors.colVerified')}</th><th>{t.t('instructors.colPending')}</th><th>{t.t('instructors.colAccepted')}</th><th>{t.t('instructors.colCourses')}</th></tr></thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.instructor.id}>
                    <td><Link href={profileHref(r.instructor.id)} className="kv-link">{r.instructor.displayName ?? r.fullName ?? t.t('studio.unnamed')}</Link></td>
                    <td>{r.instructor.isVerified ? <span className="kv-badge kv-badge--ok">{t.t('studio.verified')}</span> : <span className="kv-badge">{t.t('studio.notVerified')}</span>}</td>
                    <td>{r.pendingCredentials > 0 ? <strong>{formatNumber(r.pendingCredentials, lang)}</strong> : formatNumber(r.pendingCredentials, lang)}</td>
                    <td>{formatNumber(r.acceptedCredentials, lang)}</td>
                    <td>{formatNumber(r.courses, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {nextCursor && <p className="kv-pager"><Link href={instructorsHref({ verified, cursor: nextCursor })} className="kv-btn--link">{t.t('common.nextPage')}</Link></p>}
        </>
      )}
    </section>
  );
}
