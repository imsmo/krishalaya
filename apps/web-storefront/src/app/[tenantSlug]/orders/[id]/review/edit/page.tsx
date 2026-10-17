// apps/web-storefront/src/app/[tenantSlug]/orders/[id]/review/edit/page.tsx · PC-56 STORE-5a · C2 — the REVIEW FORM chain, REAL = the edit
// (canon W3141 form-error · W3142 review · W3143 success · W3144 failure), under the organisation's chrome. PROTECTED + dynamic; noindex.
//   • the store's `reviews` flag OFF → the honest sentence, no review read; the flags unreadable → said, with a Retry;
//   • the author's own review of this order (`reviews.mine` — the author's shape, `editLocksAt`, `editable`: the SERVER's decision); none → a
//     link to write one; locked → "locked on <date>" (no form);
//   • the form (W3141 when `?error=` names a field: stars required, the words ≤ 4,000, an unknown dimension, nothing changed — the values KEPT
//     from the held draft), the key MINTED HERE (`review-edit:<uuid>`) or carried back;
//   • `?step=review` (W3142): old vs new per row (stars, each dimension, the words) and the lock date — Save under the form's key; `&failure=`
//     (W3144): the failure BY NAME (locked / removed / invalid / unknown dimension / switched off / server) with Retry carrying the SAME key;
//   • success → the review page `?ok=updated` (W3143: "Updated — locks on <date>"). Every link returns to the review page or the order (the
//     canon's W273 links are a defect — DELTA `chain_links`).
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { randomUUID } from 'crypto';
import { formatDate } from '@krishalaya/i18n';
import type { LookupValue, ReviewMine, StorefrontFlags } from '@krishalaya/sdk-js';
import { SdkError } from '@krishalaya/sdk-js';
import { serverClient, publicClient } from '../../../../../../lib/api-client';
import { requireSession } from '../../../../../../lib/session';
import { getTranslator, getLang } from '../../../../../../lib/i18n';
import { reloadHref } from '../../../../../../features/home/load-result';
import { orderHref } from '../../../../../../features/store3a/orders';
import {
  EDIT_FAILURES, EDIT_KEY_RE, REVIEW_DRAFT_CHUNKS, decodeReviewDraft, draftCookieName, editDiff, editKey, readFailure, readFormError, readKey,
  reviewEditHref, reviewHref, type EditFailure, type ReviewDraft,
} from '../../../../../../features/store5a/review';
import { RefusalList } from '../../../../../../components/RefusalList';
import { ReviewFields } from '../../../../../../components/ReviewFields';
import { SubmitButton } from '../../../../../../components/SubmitButton';
import { editReviewAction, saveReviewEditAction } from '../actions';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | string[] | undefined>;

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('store5a.edit.title'), robots: { index: false, follow: false } };
}

export default async function ReviewEditPage({ params, searchParams }: { params: { tenantSlug: string; id: string }; searchParams: SP }) {
  const { tenantSlug: slug, id } = params;
  await requireSession(reviewEditHref(slug, id));
  const t = getTranslator();
  const lang = getLang();
  const date = (v: string | null | undefined) => (v ? formatDate(v, lang, { dateStyle: 'medium' }) : t.t('store5a.noDate'));
  const toReview = <Link href={reviewHref(slug, id)} className="kv-btn--link" data-kv-back="review">{t.t('store5a.edit.backToReview')}</Link>;
  const toOrder = <Link href={orderHref(slug, id)} className="kv-btn--link" data-kv-back="order">{t.t('store5a.backToOrder')}</Link>;
  const shell = (state: string, body: ReactNode) => (
    <section className="kv-review" data-kv-screen="review-edit" data-kv-state={state} data-kv-store={slug}>
      <h1>{t.t('store5a.edit.title')}</h1>
      {body}
      <RefusalList surface="review_edit" />
    </section>
  );

  let flags: StorefrontFlags | null = null;
  try { flags = await publicClient(slug).storefront.flags(); } catch { flags = null; }
  const loadError = () => shell('error', (
    <><div className="kv-state kv-state--error" role="alert" data-kv-state="error"><p>{t.t('store5a.loadError')}</p>
      <a href={reloadHref(reviewEditHref(slug, id), searchParams)} className="kv-btn" data-kv-retry="reload">{t.t('home.retry')}</a></div><p>{toReview} {toOrder}</p></>
  ));
  if (flags === null) return loadError();
  if (flags.reviews !== true) return shell('off', <><div className="kv-state" role="status" data-kv-state="off"><p>{t.t('store5a.off')}</p></div><p>{toOrder}</p></>);

  const api = serverClient(slug);
  let mine: ReviewMine | null = null; let missing = false;
  try { mine = await api.reviews.mine({ orderId: id }); }
  catch (e) { if (e instanceof SdkError && e.status === 404) missing = true; else return loadError(); }
  if (missing || !mine) return shell('none', <><div className="kv-state" role="status" data-kv-state="none"><p>{t.t('store5a.edit.none')}</p></div><p>{toReview} {toOrder}</p></>);
  if (!mine.editable) return shell('locked', <><div className="kv-state" role="status" data-kv-state="locked"><p>{t.t('store5a.state.locked', { date: date(mine.editLocksAt) })}</p></div><p>{toReview} {toOrder}</p></>);

  let dims: LookupValue[] | null = null;
  try { dims = (await publicClient(slug).lookups.values('review_dimension')).slice().sort((a, b) => a.sortOrder - b.sortOrder); } catch { dims = null; }
  const carried = readKey(searchParams.k, EDIT_KEY_RE);
  const chunks = Array.from({ length: REVIEW_DRAFT_CHUNKS }, (_, i) => cookies().get(draftCookieName(i))?.value);
  const draft: ReviewDraft | null = carried ? decodeReviewDraft(chunks, carried, id) : null;
  const key = carried ?? editKey(randomUUID());
  const lockLine = <p className="kv-detail__muted" data-kv-edit-until="server">{t.t('store5a.state.editUntil', { date: date(mine.editLocksAt) })}</p>;

  // W3142 / W3144 — the edit's review: old vs new, the lock date, Save (or Retry) under the form's key
  if (searchParams.step === 'review' && draft && draft.mode === 'edit' && draft.stars !== null) {
    const failure = readFailure<EditFailure>(searchParams.failure, EDIT_FAILURES);
    const vocab = (dims ?? []).map((d) => d.code);
    const labelOf = (field: string) => field === 'stars' ? t.t('store5a.form.overall') : field === 'body' ? t.t('store5a.form.words')
      : (dims ?? []).find((d) => `dim.${d.code}` === field)?.name ?? field.slice(4);
    const rows = editDiff(mine, { stars: draft.stars, subRatings: draft.subRatings, body: draft.body }, vocab, t.t('store5a.edit.none_value'));
    return shell(failure ? 'failure' : 'review', (
      <>
        <h2>{t.t(failure ? 'store5a.edit.failureTitle' : 'store5a.edit.reviewTitle')}</h2>
        {failure && <div className="kv-state kv-state--error" role="alert" data-kv-failure={failure}><p>{t.t(`store5a.editFailure.${failure}`)}</p></div>}
        <table className="kv-review__diff" data-kv-diff={rows.filter((r) => r.changed).length}>
          <thead><tr><th scope="col">{t.t('store5a.edit.field')}</th><th scope="col">{t.t('store5a.edit.before')}</th><th scope="col">{t.t('store5a.edit.after')}</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.field} data-kv-row={r.field} data-kv-changed={r.changed ? 'true' : 'false'}>
                <th scope="row">{labelOf(r.field)}</th><td>{r.before}</td><td>{r.after}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {lockLine}
        <form action={saveReviewEditAction} className="kv-form" data-kv-form="review-save">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="key" value={draft.key} />
          <div className="kv-cart__actions">
            <SubmitButton idle={t.t(failure ? 'store5a.edit.retry' : 'store5a.edit.save')} busy={t.t('store5a.busy')} />{' '}
            <Link href={reviewEditHref(slug, id, { k: draft.key })} className="kv-btn--link" data-kv-back="edit">{t.t('store5a.edit.backToEdit')}</Link>
          </div>
        </form>
        <p>{toReview}</p>
      </>
    ));
  }

  // W3141 — the form (the error by name, the values kept), or the plain edit form pre-filled from the review
  const formError = readFormError(searchParams.error);
  const values = draft && draft.mode === 'edit' ? { stars: draft.stars, subRatings: draft.subRatings, body: draft.body } : { stars: mine.stars, subRatings: mine.subRatings ?? {}, body: mine.body ?? '' };
  return shell(formError ? 'form-error' : 'form', (
    <>
      {formError && <p className="kv-form__error" role="alert" data-kv-form-error={formError}>{t.t(`store5a.formError.${formError}`)}</p>}
      {lockLine}
      <form action={editReviewAction} className="kv-form" data-kv-form="review-edit">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="key" value={key} />
        <ReviewFields dims={dims} values={values} />
        <div className="kv-cart__actions">
          <button type="submit" className="kv-btn" data-kv-act="review-edit">{t.t('store5a.edit.continue')}</button>{' '}
          {toReview}
        </div>
      </form>
    </>
  ));
}
