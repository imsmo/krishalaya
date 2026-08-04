// apps/web-tenant/src/app/studio/page.tsx · education studio home (PC-26): the tenant's OWN courses
// (courses.list box=mine — drafts included) + a create-course form. Server-first, requireSession-gated, noindex.
// Everything is server-gated by education.author/.publish + the `education` flag; a flag-off tenant sees the
// degrade message, never a faked studio. Money float-free; keyset paging.
//
// Honest scope notes (recorded in the ledger): QUIZ authoring (lesson `quiz` JSON) and LIVE-session hosting
// (live-sessions/channels controllers) exist API-side but ship in the NEXT studio wave — no placeholder UI here.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { DataTable } from '../../components/DataTable';
import { MediaUploader } from '../../components/MediaUploader';
import { getTranslator, getLang } from '../../lib/i18n';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { COURSE_LEVELS } from '../../features/studio/manage';
import { createCourseAction, upsertInstructorAction } from './actions';
import type { Course } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('studio.title'), robots: { index: false, follow: false } };
}

const ERR = new Set(['title', 'level', 'price', 'create', 'instructor']);
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

  const uploaderLabels = {
    add: t.t('studio.coverAdd'), hint: t.t('studio.coverHint'), uploading: t.t('studio.uploading'),
    failed: t.t('studio.uploadFailed'), remove: t.t('studio.remove'),
  };

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('studio.title')}</h1>
        <Link href="/studio/live" className="kv-btn--link">{t.t('studio.liveLink')} →</Link>
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
        <summary className="kv-card__title">{t.t('studio.create')}</summary>
        <form action={createCourseAction} className="kv-form">
          <label htmlFor="s-title" className="kv-field__label">{t.t('studio.courseTitle')}</label>
          <input id="s-title" name="title" className="kv-input" required maxLength={250} />

          <label htmlFor="s-level" className="kv-field__label">{t.t('studio.colLevel')}</label>
          <select id="s-level" name="level" className="kv-input" defaultValue="basic">
            {COURSE_LEVELS.map((l) => <option key={l} value={l}>{t.t(`studio.level.${l}`)}</option>)}
          </select>

          <label htmlFor="s-price" className="kv-field__label">{t.t('studio.price')}</label>
          <input id="s-price" name="priceMajor" className="kv-input" inputMode="decimal" pattern="\d{1,12}(\.\d{1,2})?" placeholder="0" />
          <p className="kv-field__hint">{t.t('studio.priceHint')}</p>

          <label className="kv-field__label" htmlFor="s-cert">
            <input id="s-cert" type="checkbox" name="certEnabled" value="1" /> {t.t('studio.certEnable')}
          </label>

          <span className="kv-field__label">{t.t('studio.cover')}</span>
          <MediaUploader labels={uploaderLabels} fieldName="coverMediaId" single />

          <button type="submit" className="kv-btn">{t.t('studio.createBtn')}</button>
        </form>
      </details>

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
