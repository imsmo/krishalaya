// apps/web-admin/src/app/catalogue/translations/reviewers/page.tsx · WHO MAY APPROVE WHICH LANGUAGE
// (PC-56 ADMIN-3b, canon W028's "reviewers are language-scoped").
//
// AN EMPTY LIST HERE IS AN ALERT, NOT AN EMPTY STATE. With no reviewers, machine drafts accumulate for ever and not one
// of them ever reaches a farmer — the queue looks busy and the product stays English. That is the failure this screen
// exists to make visible, so it is stated in capital letters rather than rendered as "no rows".
//
// REVOKED GRANTS STAY ON SCREEN. A translation approved last year was approved by somebody who held the scope THEN, and
// hiding the revoked grant would make that approval unexplainable.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../lib/admin-client';
import { getTranslator } from '../../../../lib/i18n';
import { adminNoticeKey } from '../../../../features/nav/nav-model';
import { grantReviewerAction, revokeReviewerAction } from '../../actions';
import { MIN_REASON, type ReviewerRow, type LanguageRow } from '../../../../features/catalogue/translations';

import { Button, StatusPill } from '@krishalaya/ui';
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('tr.reviewersTitle'), robots: { index: false, follow: false } };
}

interface ReviewersView { items: ReviewerRow[]; languages: LanguageRow[]; note: string }

export default async function ReviewersPage(
  { searchParams }: { searchParams: { ok?: string; error?: string; why?: string } },
) {
  requireAdmin();
  const t = getTranslator();

  let view: ReviewersView | null = null; let notice: string | undefined;
  try { view = (await adminGet<ReviewersView>('translations/reviewers')).data ?? null; }
  catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const rows = view?.items ?? [];
  const live = rows.filter((r) => !r.revokedAt);
  const okKey = searchParams.ok?.startsWith('tr_') ? searchParams.ok.slice(3) : undefined;
  const errKey = searchParams.error?.startsWith('tr_') ? searchParams.error.slice(3) : searchParams.error;

  return (
    <section>
      <p className="kv-backlink"><Link href="/catalogue/translations">{t.t('cat.back')}</Link></p>
      <h1>{t.t('tr.reviewersTitle')}</h1>
      <p className="kv-muted">{t.t('tr.reviewersLead')}</p>

      {okKey && <p className="kv-success" role="status">{t.t(`tr.ok.${okKey}`)}</p>}
      {errKey && (
        <p className="kv-error" role="alert">
          {errKey === 'rejected2' ? t.t('tr.error.rejected2', { why: searchParams.why ?? '' }) : t.t(`tr.error.${errKey}`)}
        </p>
      )}

      {notice ? <p className="kv-error" role="alert">{notice}</p> : live.length === 0 ? (
        // an alert, because nothing will ever be approved and the product stays English
        <p className="kv-error" role="alert">{t.t('tr.reviewersNone')}</p>
      ) : null}

      {!notice && rows.length > 0 && (
        <table className="kv-table">
          <thead><tr>
            <th scope="col">{t.t('tr.reviewer')}</th>
            <th scope="col">{t.t('tr.language')}</th>
            <th scope="col">{t.t('tr.grantedBy')}</th>
            <th scope="col">{t.t('tr.grantedAt')}</th>
            <th scope="col">{t.t('tr.state')}</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><code>{r.adminUserId.slice(0, 8)}</code></td>
                <td><code>{r.languageCode}</code></td>
                <td><code>{String(r.grantedBy).slice(0, 8)}</code></td>
                <td>{r.grantedAt}</td>
                <td>
                  {/* a revoked grant is KEPT and visibly historical */}
                  <StatusPill tone={r.revokedAt ? 'neutral' : 'success'} label={t.t(r.revokedAt ? 'tr.revoked' : 'tr.live')} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <details className="kv-card kv-limit-form" open={live.length === 0}>
        <summary className="kv-card__title">{t.t('tr.grantTitle')}</summary>
        <p className="kv-field__hint">{t.t('tr.grantHint')}</p>
        <form action={grantReviewerAction} className="kv-form">
          <label htmlFor="g-user" className="kv-field__label">{t.t('tr.reviewer')}</label>
          <input id="g-user" name="adminUserId" className="kv-input" required />
          <label htmlFor="g-lang" className="kv-field__label">{t.t('tr.language')}</label>
          <select id="g-lang" name="languageCode" className="kv-input" required defaultValue="">
            <option value="" disabled>{t.t('tr.language')}</option>
            {(view?.languages ?? []).map((l) => (
              <option key={l.code} value={l.code}>{l.nameNative} — {l.nameEnglish} ({l.code})</option>
            ))}
          </select>
          <label htmlFor="g-note" className="kv-field__label">{t.t('tr.note')}</label>
          <input id="g-note" name="note" className="kv-input" maxLength={2000} />
          <label htmlFor="g-reason" className="kv-field__label">{t.t('eav.reason')}</label>
          <input id="g-reason" name="reason" className="kv-input" required minLength={MIN_REASON} maxLength={1000} />
          <Button type="submit" variant="danger">{t.t('tr.grant')}</Button>
        </form>
      </details>

      {live.length > 0 && (
        <details className="kv-card kv-limit-form">
          <summary className="kv-card__title">{t.t('tr.revokeTitle')}</summary>
          <form action={revokeReviewerAction} className="kv-form">
            <label htmlFor="rv-id" className="kv-field__label">{t.t('tr.reviewer')}</label>
            <select id="rv-id" name="id" className="kv-input" required defaultValue="">
              <option value="" disabled>{t.t('tr.reviewer')}</option>
              {live.map((r) => (
                <option key={r.id} value={r.id}>{r.adminUserId.slice(0, 8)} · {r.languageCode}</option>
              ))}
            </select>
            <label htmlFor="rv-reason" className="kv-field__label">{t.t('eav.reason')}</label>
            <input id="rv-reason" name="reason" className="kv-input" required minLength={MIN_REASON} maxLength={1000} />
            <Button type="submit" variant="secondary">{t.t('tr.revoke')}</Button>
          </form>
        </details>
      )}
    </section>
  );
}
