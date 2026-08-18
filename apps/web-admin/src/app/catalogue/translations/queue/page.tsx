// apps/web-admin/src/app/catalogue/translations/queue/page.tsx · THE MACHINE-REVIEW QUEUE (PC-56 ADMIN-3b, canon W028).
//
// EVERY ROW HERE IS INVISIBLE TO FARMERS, and the screen says so rather than assuming the reader knows. A draft in this
// queue has never been shown to anybody; that is what makes the queue safe to leave for a day and dangerous to leave for
// a month.
//
// THREE THINGS THIS PAGE GETS RIGHT ON PURPOSE:
//   1. EVERY ROW CARRIES THE ENGLISH IT TRANSLATES. Without it a reviewer is judging Gujarati against nothing, which is a
//      spelling check rather than a review — and the whole justification for the language scope is that this person can
//      compare the two.
//   2. OLDEST FIRST. A draft nobody has looked at for three weeks is the queue quietly failing; newest-first would bury
//      it under fresh machine output for ever.
//   3. A ROW IN A LANGUAGE YOU DO NOT REVIEW OFFERS NO FORM — not a disabled button. The reason is stated once, at the
//      top, because it is about the person rather than the row.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../lib/admin-client';
import { getTranslator } from '../../../../lib/i18n';
import { adminNoticeKey } from '../../../../features/nav/nav-model';
import { reviewTranslationAction } from '../../actions';
import {
  Button, Callout, Chip, EmptyState, StatusPill,
} from '@krishalaya/ui';
import {
  REVIEW_DECISIONS, canReview, stateTone, stateKey, MIN_REASON, MAX_TEXT,
  type TranslationRow,
} from '../../../../features/catalogue/translations';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('tr.queueTitle'), robots: { index: false, follow: false } };
}

interface QueueView {
  items: TranslationRow[]; nextCursor: string | null; yourLanguages: string[];
  decisions: string[]; scopeNote: string | null;
}

export default async function ReviewQueuePage(
  { searchParams }: { searchParams: { cursor?: string; languageCode?: string; ok?: string; error?: string; why?: string } },
) {
  requireAdmin();
  const t = getTranslator();

  let view: QueueView | null = null; let notice: string | undefined;
  try {
    view = (await adminGet<QueueView>('translations/queue', {
      cursor: searchParams.cursor, languageCode: searchParams.languageCode, limit: 50,
    })).data ?? null;
  } catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const rows = view?.items ?? [];
  const scopes = view?.yourLanguages ?? [];
  const okKey = searchParams.ok?.startsWith('tr_') ? searchParams.ok.slice(3) : undefined;
  const errKey = searchParams.error?.startsWith('tr_') ? searchParams.error.slice(3) : searchParams.error;

  /** One href builder for the chips AND the pager. */
  const href = (extra: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries({ languageCode: searchParams.languageCode, cursor: searchParams.cursor, ...extra })) if (v) sp.append(k, v);
    const s = sp.toString();
    return `/catalogue/translations/queue${s ? `?${s}` : ''}`;
  };

  return (
    <section>
      <p className="kv-backlink"><Link href="/catalogue/translations">{t.t('cat.back')}</Link></p>
      <h1>{t.t('tr.queueTitle')}</h1>
      <p className="kv-muted">{t.t('tr.queueLead')}</p>

      {okKey && <p className="kv-success" role="status">{t.t(`tr.ok.${okKey}`)}</p>}
      {errKey && (
        <p className="kv-error" role="alert">
          {errKey === 'scope' ? t.t('tr.error.scope', { why: searchParams.why ?? '' })
            : errKey === 'rejected2' ? t.t('tr.error.rejected2', { why: searchParams.why ?? '' })
              : t.t(`tr.error.${errKey}`)}
        </p>
      )}

      {/* about the PERSON, said once */}
      {view?.scopeNote
        ? <p className="kv-error" role="alert">{t.t('tr.noScope')}</p>
        : scopes.length > 0 && <p className="kv-field__hint">{t.t('tr.yourLanguages', { langs: scopes.join(', ') })}</p>}

      {scopes.length > 0 && (
        <nav className="kv-filters" aria-label={t.t('tr.language')}>
          <Chip as={Link} href={href({ languageCode: undefined, cursor: undefined })} active={!searchParams.languageCode}>{t.t('attr.filterAllTypes')}</Chip>
          {scopes.map((l) => (
            <Chip as={Link} key={l} href={href({ languageCode: l, cursor: undefined })} active={searchParams.languageCode === l}>{l}</Chip>
          ))}
        </nav>
      )}

      {notice ? <p className="kv-error" role="alert">{notice}</p> : rows.length === 0 ? (
        <EmptyState title={t.t('tr.queueEmpty')} />
      ) : (
        <>
          <table className="kv-table">
            <thead><tr>
              <th scope="col">{t.t('tr.language')}</th>
              <th scope="col">{t.t('tr.sourceText')}</th>
              <th scope="col">{t.t('tr.text')}</th>
              <th scope="col">{t.t('tr.engine')}</th>
              <th scope="col">{t.t('tr.state')}</th>
              <th scope="col">{t.t('tr.when')}</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><code>{r.languageCode}</code></td>
                  {/* the English. Without it this is not a review. */}
                  <td>{r.sourceText ?? <span className="kv-detail__muted">{t.t('tr.noSourceText')}</span>}</td>
                  <td>{r.text}</td>
                  <td>{r.source ?? t.t('common.dash')}</td>
                  <td>
                    <StatusPill tone={stateTone(r)} label={t.t(`tr.state.${stateKey(r)}`)} />
                  </td>
                  <td>{r.createdAt ?? t.t('common.dash')}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {view?.nextCursor && (
            <p className="kv-pager">
              <Button as={Link} href={href({ cursor: view.nextCursor })}>{t.t('common.nextPage')}</Button>
            </p>
          )}

          {/* ---------------- judge one ---------------- */}
          {rows.some((r) => canReview(r, scopes)) ? (
            <details className="kv-card kv-limit-form" open>
              <summary className="kv-card__title">{t.t('tr.reviewTitle')}</summary>
              <p className="kv-field__hint">{t.t('tr.reviewHint')}</p>
              <form action={reviewTranslationAction} className="kv-form">
                <label htmlFor="q-id" className="kv-field__label">{t.t('tr.text')}</label>
                <select id="q-id" name="id" className="kv-input" required defaultValue="">
                  <option value="" disabled>{t.t('tr.text')}</option>
                  {/* ONLY rows this person may act on. A row in another language is not offered at all. */}
                  {rows.filter((r) => canReview(r, scopes)).map((r) => (
                    <option key={r.id} value={r.id}>{r.languageCode} · {r.sourceText ?? r.field} → {r.text.slice(0, 40)}</option>
                  ))}
                </select>
                <label htmlFor="q-decision" className="kv-field__label">{t.t('tr.decision')}</label>
                <select id="q-decision" name="decision" className="kv-input" required defaultValue="">
                  <option value="" disabled>{t.t('tr.decision')}</option>
                  {REVIEW_DECISIONS.map((d) => <option key={d} value={d}>{t.t(`tr.decision.${d}`)}</option>)}
                </select>
                <label htmlFor="q-text" className="kv-field__label">{t.t('tr.correctedText')}</label>
                <textarea id="q-text" name="text" className="kv-input" rows={2} maxLength={MAX_TEXT} />
                <label htmlFor="q-note" className="kv-field__label">{t.t('tr.note')}</label>
                <textarea id="q-note" name="note" className="kv-input" rows={2} maxLength={2000} minLength={MIN_REASON} />
                <Button type="submit">{t.t('tr.review')}</Button>
              </form>
            </details>
          ) : rows.length > 0 && scopes.length > 0 ? (
            // no control at all, and the reason
            <Callout>{t.t('tr.notYourLanguage')}</Callout>
          ) : null}
        </>
      )}
    </section>
  );
}
