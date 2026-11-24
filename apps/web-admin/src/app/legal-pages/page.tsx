// apps/web-admin/src/app/legal-pages/page.tsx · PC-56 LEGAL-1.
//
// The four platform policy pages the public storefront serves at /terms, /privacy, /refunds and /shipping — the live
// version of each (or the plain fact that the storefront shows "not published yet") and any draft waiting behind it.
// Reading needs `platform.pages.read`; a 403 renders the restricted notice rather than an empty table.
import type { Metadata } from 'next';
import Link from 'next/link';
import { formatDate } from '@krishalaya/i18n';
import { Callout, StatusPill } from '@krishalaya/ui';
import { requireAdmin, adminUserId } from '../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../lib/admin-client';
import { getTranslator } from '../../lib/i18n';
import { errorKey, isErrorKind, slugKey, whoLabel, type PageListRow } from '../../features/legal-pages/legal-pages';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('lp.title'), robots: { index: false, follow: false } };
}

export default async function LegalPagesPage(props: { searchParams: Promise<{ error?: string }> }) {
  const searchParams = await props.searchParams;
  requireAdmin();
  const t = getTranslator();
  const viewer = adminUserId();

  let rows: PageListRow[] = []; let notice: string | undefined;
  try {
    rows = (await adminGet<PageListRow[]>('platform-pages')).data ?? [];
  } catch (e) {
    notice = e instanceof AdminApiError && e.status === 403 ? 'lp.restricted' : 'lp.error.list';
  }
  const err = searchParams.error && isErrorKind(searchParams.error) ? searchParams.error : undefined;

  return (
    <main className="kv-page">
      <nav className="kv-breadcrumb" aria-label={t.t('nav.breadcrumb')}>
        <Link href="/dashboard">{t.t('nav.dashboard')}</Link> <span aria-hidden="true">/</span>{' '}
        <span>{t.t('lp.title')}</span>
      </nav>

      <header className="kv-page__head">
        <h1>{t.t('lp.title')}</h1>
        <p className="kv-page__sub">{t.t('lp.sub')}</p>
      </header>

      {notice ? <Callout tone="danger" live="assertive">{t.t(notice)}</Callout> : null}
      {err ? <Callout tone="danger" live="assertive">{t.t(errorKey(err))}</Callout> : null}
      <Callout tone="info">{t.t('lp.makerChecker')}</Callout>

      {rows.length > 0 ? (
        <table className="kv-table">
          <caption className="kv-table__caption">{t.t('lp.caption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t.t('lp.col.page')}</th>
              <th scope="col">{t.t('lp.col.live')}</th>
              <th scope="col">{t.t('lp.col.draft')}</th>
              <th scope="col">{t.t('lp.col.versions')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const editor = r.draft ? whoLabel(r.draft.lastEditedByAdminId, viewer) : null;
              return (
                <tr key={r.slug}>
                  <td>
                    <Link href={`/legal-pages/${encodeURIComponent(r.slug)}`}>{t.t(slugKey(r.slug))}</Link>
                    <br /><small className="kv-mono">/{r.slug}</small>
                  </td>
                  <td>
                    {r.live ? (
                      <>
                        <StatusPill tone="success" label={t.t('lp.liveVersion', { n: String(r.live.version) })} />
                        <br />{r.live.title}
                        <br /><small>{t.t('lp.publishedOn', { date: r.live.publishedAt ? formatDate(r.live.publishedAt) : t.t('common.dash') })}</small>
                      </>
                    ) : (
                      // Not an empty cell: the storefront is showing its "not published yet" page right now.
                      <StatusPill tone="danger" label={t.t('lp.notPublished')} />
                    )}
                  </td>
                  <td>
                    {r.draft && editor ? (
                      <>
                        <StatusPill tone="warning" label={t.t('lp.draftVersion', { n: String(r.draft.version) })} />
                        <br /><small>{t.t('lp.lastEdited', { who: t.t(editor.key, { who: editor.who }), date: formatDate(r.draft.updatedAt) })}</small>
                      </>
                    ) : <span>{t.t('lp.noDraft')}</span>}
                  </td>
                  <td>{r.versionCount}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </main>
  );
}
