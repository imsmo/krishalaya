// apps/web-storefront/src/app/[tenantSlug]/orders/[id]/review/page.tsx · PC-56 STORE-5a · C1 + C3 — canon W290 "Write a review" and its SUBMIT
// chain (W3145 confirm → W3146 success on the order page / W3147 failure here), under the ORGANISATION's chrome (founder Q13 / survey C-13: the
// platform's /orders/[id]/review is a door). PROTECTED + dynamic; noindex.
//   • the store's `reviews` flag OFF → the honest sentence and NO API call beyond the flags (F-11); the flags unreadable → said, with a Retry;
//   • the order from 3a's buyer-safe read (the order number, the product, the ORGANISATION's name — never the farmer — and the delivered date
//     from the events read); a stranger's id → notFound();
//   • which state — from the SERVER's answers only (features/store5a/review.ts `reviewPageState`): not completed · not eligible · Window
//     closed (with the API's date) · Already reviewed ("edit yours until <editLocksAt>" + "Edit my review") · Locked ("locked on <date>") · the
//     form (stars, the vocabulary's sub-ratings, the words ≤ 4,000, the key MINTED HERE — `review:<uuid>` — or carried back by the chain);
//   • `?step=confirm` (W3145): the SERVER's preview of the held draft — the organisation, the stars and dimension labels as they will publish,
//     "Verified buyer", "you can edit it until <editLocksAt>" — Proceed under the form's key; `&failure=` (W3147): the failure BY NAME with
//     Retry carrying the SAME key (a submit that did land is answered, never doubled — even when the preview now says "already reviewed");
//   • the refusals by name (surface `review`): voice, photos, the offline queue, "tonight", the masked name + city, the grading desk, …
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { randomUUID } from 'crypto';
import { formatDate } from '@krishalaya/i18n';
import type { LookupValue, OrderDetail, OrderTimelineEvent, ReviewEligibility, ReviewMine, ReviewPreview, StorefrontFlags } from '@krishalaya/sdk-js';
import { SdkError } from '@krishalaya/sdk-js';
import { serverClient, publicClient } from '../../../../../lib/api-client';
import { requireSession } from '../../../../../lib/session';
import { getTranslator, getLang } from '../../../../../lib/i18n';
import { reloadHref } from '../../../../../features/home/load-result';
import { orderHref, ordersHref } from '../../../../../features/store3a/orders';
import {
  REVIEW_DRAFT_CHUNKS, SUBMIT_FAILURES, draftCookieName, decodeReviewDraft, readFailure, readFormError, readKey, reviewEditHref, reviewHref,
  reviewPageState, submitFailureOf, submitKey, SUBMIT_KEY_RE, type ReviewDraft, type SubmitFailure,
} from '../../../../../features/store5a/review';
import { RefusalList } from '../../../../../components/RefusalList';
import { ReviewFields } from '../../../../../components/ReviewFields';
import { SubmitButton } from '../../../../../components/SubmitButton';
import { previewReviewAction, submitReviewAction } from './actions';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | string[] | undefined>;

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('review.title'), robots: { index: false, follow: false } };
}

export default async function ReviewPage({ params, searchParams }: { params: { tenantSlug: string; id: string }; searchParams: SP }) {
  const { tenantSlug: slug, id } = params;
  await requireSession(reviewHref(slug, id));
  const t = getTranslator();
  const lang = getLang();
  const date = (v: string | null | undefined) => (v ? formatDate(v, lang, { dateStyle: 'medium' }) : t.t('store5a.noDate'));
  const back = <Link href={orderHref(slug, id)} className="kv-btn--link" data-kv-back="order">{t.t('store5a.backToOrder')}</Link>;
  const shell = (state: string, body: ReactNode) => (
    <section className="kv-review" data-kv-screen="review" data-kv-state={state} data-kv-store={slug}>
      <nav aria-label={t.t('store5a.crumbLabel')}>
        <ol className="kv-crumb">
          <li><Link href={ordersHref(slug)}>{t.t('order.listTitle')}</Link></li>
          <li><Link href={orderHref(slug, id)}>{t.t('store5a.crumbOrder')}</Link></li>
          <li aria-current="page">{t.t('review.title')}</li>
        </ol>
      </nav>
      {body}
      <RefusalList surface="review" />
    </section>
  );
  const loadError = () => shell('error', (
    <>
      <h1>{t.t('review.title')}</h1>
      <div className="kv-state kv-state--error" role="alert" data-kv-state="error">
        <p>{t.t('store5a.loadError')}</p>
        <a href={reloadHref(reviewHref(slug, id), searchParams)} className="kv-btn" data-kv-retry="reload">{t.t('home.retry')}</a>
      </div>
      <p>{back}</p>
    </>
  ));

  // (1) the store's flag FIRST — OFF: the honest sentence, no review read at all (F-11)
  let flags: StorefrontFlags | null = null;
  try { flags = await publicClient(slug).storefront.flags(); } catch { flags = null; }
  if (flags === null) return loadError();
  if (flags.reviews !== true) {
    return shell('off', (<><h1>{t.t('review.title')}</h1><div className="kv-state" role="status" data-kv-state="off"><p>{t.t('store5a.off')}</p></div><p>{back}</p></>));
  }

  // (2) the order (3a's buyer-safe read) and when it was delivered (the events read — roles and times only)
  const api = serverClient(slug);
  let order: OrderDetail | null = null;
  try { order = await api.orders.get(id); }
  catch (e) { if (e instanceof SdkError && e.isNotFound) notFound(); order = null; }
  if (!order) return loadError();
  let events: OrderTimelineEvent[] | null = null;
  try { events = await api.orders.events(order.id); } catch { events = null; }
  const deliveredAt = events?.find((e) => e.toStatus === 'delivered')?.at ?? null;
  const item = order.items[0]?.title_snapshot ?? order.orderNo;
  const org = order.organisation?.name ?? t.t('store5a.theOrganisation');
  const head = (
    <>
      <h1>{t.t('store5a.h1', { item })}</h1>
      <p className="kv-detail__muted" data-kv-context="order">
        <code className="kv-mono">{order.orderNo}</code> · {item} · <span data-kv-seller="organisation">{org}</span>
        {deliveredAt && <> · {t.t('store5a.delivered', { date: date(String(deliveredAt)) })}</>}
      </p>
      <p className="kv-detail__muted">{t.t('store5a.onlyBuyers')}</p>
    </>
  );

  // (3) the server's answers: eligibility (and the author's own review when there is one)
  let elig: ReviewEligibility | null = null; let mine: ReviewMine | null = null;
  if (order.status === 'completed') {
    try { elig = await api.reviews.eligibility({ orderId: order.id }); } catch { return loadError(); }
    if (elig.reviewed) { try { mine = await api.reviews.mine({ orderId: order.id }); } catch { mine = null; } }
  }
  const state = reviewPageState({ flagOn: true, orderStatus: order.status, elig, mineEditable: mine ? mine.editable : null });
  const okUpdated = searchParams.ok === 'updated';

  if (state === 'not_completed') return shell(state, <>{head}<div className="kv-state" role="status" data-kv-state="not_completed"><p>{t.t('store5a.state.notCompleted')}</p></div><p>{back}</p></>);
  if (state === 'not_eligible') return shell(state, <>{head}<div className="kv-state" role="status" data-kv-state="not_eligible"><p>{t.t('store5a.state.notEligible')}</p></div><p>{back}</p></>);
  if (state === 'closed') return shell(state, <>{head}<div className="kv-state" role="status" data-kv-state="closed"><p><strong>{t.t('store5a.state.closedTitle')}</strong></p><p>{t.t('store5a.state.closed', { date: date(elig?.expiresAt) })}</p></div><p>{back}</p></>);
  if (state === 'reviewed' || state === 'locked') {
    return shell(state, (
      <>
        {head}
        {okUpdated && mine && <p className="kv-form__notice" role="status" data-kv-ok="updated">{t.t('store5a.edit.updated', { date: date(mine.editLocksAt) })}</p>}
        <div className="kv-state" role="status" data-kv-state={state}>
          <p><strong>{t.t('store5a.state.reviewedTitle')}</strong></p>
          {mine && <p data-kv-mine-stars={mine.stars}>{t.t('store5a.state.youRated', { stars: String(mine.stars), date: date(mine.createdAt) })}</p>}
          {state === 'reviewed'
            ? <><p>{t.t('store5a.state.editUntil', { date: date(mine?.editLocksAt) })}</p><p><Link href={reviewEditHref(slug, id)} className="kv-btn" data-kv-act="edit">{t.t('store5a.state.editMine')}</Link></p></>
            : <p data-kv-locked="true">{t.t('store5a.state.locked', { date: date(mine?.editLocksAt) })}</p>}
        </div>
        <p>{back}</p>
      </>
    ));
  }

  // (4) the form or the confirm — the chain's key and draft (never the URL)
  const carried = readKey(searchParams.k, SUBMIT_KEY_RE);
  const chunks = Array.from({ length: REVIEW_DRAFT_CHUNKS }, (_, i) => cookies().get(draftCookieName(i))?.value);
  const draft: ReviewDraft | null = carried ? decodeReviewDraft(chunks, carried, id) : null;
  const key = carried ?? submitKey(randomUUID());
  const failure = readFailure<SubmitFailure>(searchParams.failure, SUBMIT_FAILURES);

  if (searchParams.step === 'confirm' && draft && draft.mode === 'submit' && draft.stars !== null) {
    let preview: ReviewPreview | null = null; let previewFailure: SubmitFailure | null = null;
    try { preview = await api.reviews.preview({ orderId: id, stars: draft.stars, subRatings: draft.subRatings, ...(draft.body ? { body: draft.body } : {}) }); }
    catch (e) { previewFailure = submitFailureOf(e instanceof SdkError ? e.code : null, e instanceof SdkError ? e.status : null); }
    const shown = failure ?? previewFailure;
    return shell(shown ? 'failure' : 'confirm', (
      <>
        {head}
        <h2>{t.t(shown ? 'store5a.confirm.failureTitle' : 'store5a.confirm.title')}</h2>
        {shown && <div className="kv-state kv-state--error" role="alert" data-kv-failure={shown}><p>{t.t(`store5a.failure.${shown}`)}</p></div>}
        {preview && (
          <div className="kv-review__preview" data-kv-preview="server">
            <p data-kv-publish-org="organisation">{t.t('store5a.confirm.where', { org: preview.organisation.name ?? org })}</p>
            <p data-kv-preview-stars={preview.stars}>{t.t('store5a.confirm.stars', { stars: String(preview.stars) })}</p>
            {preview.subRatings.length > 0 && (
              <ul data-kv-preview-dims={preview.subRatings.length}>
                {preview.subRatings.map((d) => <li key={d.code} data-kv-preview-dim={d.code}>{t.t('store5a.confirm.dim', { label: d.label, stars: String(d.stars) })}</li>)}
              </ul>
            )}
            {preview.body && <blockquote className="kv-review__quote">{preview.body}</blockquote>}
            <p data-kv-label={preview.label}>{t.t('store5a.confirm.label')}</p>
            <p data-kv-edit-until="server">{t.t('store5a.confirm.editUntil', { date: date(preview.editLocksAt) })}</p>
          </div>
        )}
        <form action={submitReviewAction} className="kv-form" data-kv-form="review-submit">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="key" value={draft.key} />
          <div className="kv-cart__actions">
            <SubmitButton idle={t.t(shown ? 'store5a.confirm.retry' : 'store5a.confirm.proceed')} busy={t.t('store5a.busy')} />{' '}
            <Link href={reviewHref(slug, id, { k: draft.key })} className="kv-btn--link" data-kv-cancel="form">{t.t('store5a.confirm.cancel')}</Link>
          </div>
        </form>
      </>
    ));
  }

  // (5) the form (W290) — the vocabulary's dimensions (labels in this language, from the API), the values kept on a form error
  let dims: LookupValue[] | null = null;
  try { dims = (await publicClient(slug).lookups.values('review_dimension')).slice().sort((a, b) => a.sortOrder - b.sortOrder); } catch { dims = null; }
  const formError = readFormError(searchParams.error);
  const values = draft && draft.mode === 'submit' ? { stars: draft.stars, subRatings: draft.subRatings, body: draft.body } : { stars: null, subRatings: {}, body: '' };
  return shell('form', (
    <>
      {head}
      {formError && <p className="kv-form__error" role="alert" data-kv-form-error={formError}>{t.t(`store5a.formError.${formError}`)}</p>}
      {failure && <p className="kv-form__error" role="alert" data-kv-failure={failure}>{t.t(`store5a.failure.${failure}`)}</p>}
      <form action={previewReviewAction} className="kv-form" data-kv-form="review">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="key" value={key} />
        <ReviewFields dims={dims} values={values} />
        <div className="kv-cart__actions">
          <button type="submit" className="kv-btn" data-kv-act="submit-review">{t.t('store5a.form.submit')}</button>{' '}
          {back}
        </div>
      </form>
      <ul className="kv-detail__muted" data-kv-facts="review">
        <li data-kv-fact="label">{t.t('store5a.fact.label')}</li>
        <li data-kv-fact="organisation">{t.t('store5a.fact.organisation')}</li>
        <li data-kv-fact="window">{t.t('store5a.fact.window', { date: date(elig?.expiresAt) })}</li>
        <li data-kv-fact="nudges">{t.t('store5a.fact.nudges')}</li>
      </ul>
    </>
  ));
}
