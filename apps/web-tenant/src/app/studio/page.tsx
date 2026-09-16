// apps/web-tenant/src/app/studio/page.tsx · education studio home (PC-26): the tenant's OWN courses
// (courses.list box=mine — drafts included) + a create-course form. Server-first, requireSession-gated, noindex.
// Everything is server-gated by education.author/.publish + the `education` flag; a flag-off tenant sees the
// degrade message, never a faked studio. Money float-free; keyset paging.
//
// PC-56 TENANT-7a: the inline create form is GONE — one write, one path (6d-4's rule). *New course* is the course
// form chain at `/courses/new` (W2546–W2549), and the desk's library is `/courses` (W178). This page remains the
// INSTRUCTOR's own library until TENANT-7d rebuilds it as W410.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { DataTable } from '../../components/DataTable';
import { getTranslator, getLang } from '../../lib/i18n';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { upsertInstructorAction } from './actions';
import { NEW_COURSE_HREF } from '../../features/courses/desk';
import type { Course } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('studio.title'), robots: { index: false, follow: false } };
}

const ERR = new Set(['instructor']);
const OK = new Set(['instructor']);

export default async function StudioPage({ searchParams }: { searchParams: { cursor?: string; ok?: string; error?: string } }) {
  await requireSession('/studio');
  const t = getTranslator();
  const lang = getLang();

  let items: Course[] = []; let nextCursor: string | null = null; let failed = false;
  try {
    const p = await tenantClient().courses.list({ box: 'mine', cursor: searchParams.cursor, limit: 50 });
    items = p.items; nextCursor = p.nextCursor;
  } catch { failed = true; }

  // PC-26b: instructor self-profile (GET degrades to null — the form still allows creating one).
  let myBio: string | null = null;
  try { myBio = (await tenantClient().liveStudio.myInstructor())?.bio ?? null; } catch { myBio = null; }

  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('studio.title')}</h1>
        <span>
          <Link href={NEW_COURSE_HREF} className="kv-btn">{t.t('courses.new')}</Link>{' '}
          <Link href="/studio/live" className="kv-btn--link">{t.t('studio.liveLink')} →</Link>
        </span>
      </div>
      <p className="kv-field__hint">{t.t('studio.hint')}</p>
      {okKey && <p className="kv-success" role="status">{t.t(`studio.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`studio.error.${errKey}`)}</p>}

      {failed ? <p className="kv-error" role="alert">{t.t('studio.loadError')}</p> : (
        <DataTable
          rows={items}
          empty={t.t('studio.empty')}
          columns={[
            { header: t.t('studio.colCourse'), cell: (c) => <Link href={`/studio/${c.id}`} className="kv-link">{c.defaultTitle}</Link> },
            { header: t.t('studio.colStatus'), cell: (c) => <span className="kv-badge">{t.t(`studio.status.${c.status}`) || c.status}</span> },
            { header: t.t('studio.colLevel'), cell: (c) => t.t(`studio.level.${c.level}`) || c.level },
            { header: t.t('studio.colPrice'), cell: (c) => (c.priceMinor === '0' ? t.t('studio.free') : formatMoneyMinor(c.priceMinor, c.currencyCode, lang)) },
            { header: t.t('studio.colCert'), cell: (c) => (c.certEnabled ? t.t('studio.certYes') : t.t('common.dash')) },
          ]}
        />
      )}
      {nextCursor && <p className="kv-pager"><a href={`/studio?cursor=${encodeURIComponent(nextCursor)}`} className="kv-btn--link">{t.t('common.nextPage')}</a></p>}

      <details className="kv-card">
        <summary className="kv-card__title">{t.t('studio.instructor')}</summary>
        <p className="kv-field__hint">{t.t('studio.instructorHint')}</p>
        <form action={upsertInstructorAction} className="kv-form">
          <label htmlFor="ins-bio" className="kv-field__label">{t.t('studio.bio')}</label>
          <textarea id="ins-bio" name="bio" className="kv-textarea" rows={3} maxLength={2000} defaultValue={myBio ?? ''} />
          <button type="submit" className="kv-btn">{t.t('studio.bioSave')}</button>
        </form>
      </details>
    </section>
  );
}
