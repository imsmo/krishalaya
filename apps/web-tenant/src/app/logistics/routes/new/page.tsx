// apps/web-tenant/src/app/logistics/routes/new/page.tsx · W231's [New route], and the four chain states the
// canon requires of every form (PC-56 TENANT-5b): W2402 form-error · W2403 review · W2404 success · W2405 failure.
// Server-first, requireSession-gated, noindex, no client JS — the step rides in the URL, so Back works and a
// half-filled form survives a dropped village signal.
//
// THE FORM'S OWN HONESTY:
//   • the villages on offer are the CORRIDORS this tenant's parcels already travel (village + weekday + parcels +
//     spend, from delivered shipments). W231's empty state promises "the suggest tool maps 30 days of ad-hoc
//     shipments into route candidates"; no such tool exists, and offering the real traffic as the picker is the
//     honest half of it — the operator draws the route, the platform shows them where their parcels go;
//   • the review step (W2403) says the thing being created is a PROPOSAL. An operator who thinks they have just
//     scheduled a truck will not come back to approve it, and the Saturday will pass with nobody notified;
//   • the vehicle and the consolidation point are NOT asked for here. W231's proposal row shows `unassigned` and
//     the restricted state says approval "commits a vehicle + ambassador weekly" — so those two belong to the
//     approval, in one transaction, and asking for them a week early would record a commitment nobody made.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { formatMoneyMinor } from '@krishalaya/i18n';
import {
  MAX_ROUTE_NAME, dayLabelKey, errorFor, reviewNoticeKey, routeErrorKey, suggestKey, validateDraft,
} from '../../../../features/logistics/routes';
import { WEEKDAY_OPTIONS } from '../../../../features/logistics/weekdays';
import type { RouteCorridor } from '@krishalaya/sdk-js';
import { createRouteAction } from '../actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('route.form.title'), robots: { index: false, follow: false } };
}

export default async function NewRoutePage({ searchParams }: {
  searchParams: { step?: string; defaultName?: string; runWeekday?: string; villageRegionIds?: string | string[]; invalid?: string; error?: string };
}) {
  await requireSession('/logistics/routes/new');
  const t = getTranslator();
  const lang = getLang();

  const picked = Array.isArray(searchParams.villageRegionIds)
    ? searchParams.villageRegionIds
    : searchParams.villageRegionIds ? [searchParams.villageRegionIds] : [];
  const draft = {
    defaultName: searchParams.defaultName ?? '',
    runWeekday: searchParams.runWeekday ?? '',
    villageRegionIds: picked,
  };
  const review = searchParams.step === 'review';
  // Validated on THIS render, not trusted from the URL: a link carrying `step=review` must not skip validation.
  const errors = review || searchParams.invalid ? validateDraft(draft) : [];
  const errKey = searchParams.error ? routeErrorKey(searchParams.error) : null;

  let corridors: RouteCorridor[] = [];
  try {
    corridors = (await tenantClient().routes.corridors()).items;
  } catch { corridors = []; }
  const nameOf = (id: string) => corridors.find((c) => c.regionId === id)?.villageName ?? id.slice(0, 8);

  return (
    <section>
      <h1>{t.t('route.form.title')}</h1>
      <p className="kv-field__hint">
        <Link href="/logistics/routes" className="kv-link">{t.t('route.backToBoard')}</Link>
      </p>

      {/* W2405: the attempt was rejected and state is untouched — the reason, then a retry path. */}
      {errKey && (
        <div className="kv-error" role="alert">
          <p>{t.t('route.form.failureTitle')}</p>
          <p>{t.t(errKey)}</p>
          <p>{t.t('route.form.failureUntouched')}</p>
        </div>
      )}

      {/* W2402: every invalid field listed with its reason; the values entered are preserved. */}
      {errors.length > 0 && (
        <div className="kv-error" role="alert">
          <p>{t.t('route.form.errorTitle')}</p>
          <ul>{errors.map((e) => <li key={e.field}>{t.t(e.key)}</li>)}</ul>
        </div>
      )}

      {review && errors.length === 0 ? (
        /* ---- W2403: review, read-only, before anything is written ---- */
        <form action={createRouteAction} className="kv-card">
          <h2>{t.t('route.form.reviewTitle')}</h2>
          <p className="kv-card kv-card--notice" role="status">{t.t(reviewNoticeKey())}</p>
          <dl>
            <dt>{t.t('route.form.name')}</dt><dd>{draft.defaultName.trim()}</dd>
            <dt>{t.t('route.form.day')}</dt>
            <dd>{t.t(dayLabelKey(draft.runWeekday === '' ? null : `route.day.${WEEKDAY_OPTIONS[Number(draft.runWeekday)]?.code}`, draft.runWeekday === ''))}</dd>
            <dt>{t.t('route.form.villages')}</dt>
            <dd>{draft.villageRegionIds.map(nameOf).join(', ')} ({draft.villageRegionIds.length})</dd>
            <dt>{t.t('route.form.vehicle')}</dt><dd>{t.t('route.vehicle.unassigned')}</dd>
            <dt>{t.t('route.form.consolidation')}</dt><dd>{t.t('route.consolidation.unset')}</dd>
          </dl>
          <input type="hidden" name="defaultName" value={draft.defaultName} />
          <input type="hidden" name="runWeekday" value={draft.runWeekday} />
          {draft.villageRegionIds.map((v) => <input key={v} type="hidden" name="villageRegionIds" value={v} />)}
          <button type="submit" className="kv-btn">{t.t('route.form.submit')}</button>{' '}
          <Link href={`/logistics/routes/new?${new URLSearchParams({ defaultName: draft.defaultName, runWeekday: draft.runWeekday }).toString()}`} className="kv-btn--link">
            {t.t('route.form.backToEdit')}
          </Link>
        </form>
      ) : (
        /* ---- the form itself. GET → the review step, so nothing is written before the read-only check ---- */
        <form method="get" action="/logistics/routes/new" className="kv-card">
          <input type="hidden" name="step" value="review" />
          <label className="kv-field__label" htmlFor="r-name">{t.t('route.form.name')}</label>
          <input id="r-name" name="defaultName" className="kv-input" maxLength={MAX_ROUTE_NAME} defaultValue={draft.defaultName}
                 aria-invalid={!!errorFor(errors, 'defaultName')} required />
          {errorFor(errors, 'defaultName') && <p className="kv-error">{t.t(errorFor(errors, 'defaultName')!)}</p>}

          <label className="kv-field__label" htmlFor="r-day">{t.t('route.form.day')}</label>
          <select id="r-day" name="runWeekday" className="kv-input" defaultValue={draft.runWeekday}>
            <option value="">{t.t('route.day.onDemand')}</option>
            {WEEKDAY_OPTIONS.map((w) => <option key={w.value} value={String(w.value)}>{t.t(`route.day.${w.code}`)}</option>)}
          </select>

          <fieldset>
            <legend className="kv-field__label">{t.t('route.form.villages')}</legend>
            <p className="kv-field__hint">{t.t(suggestKey())}</p>
            {corridors.length === 0 ? (
              <p className="kv-field__hint">{t.t('route.suggest.none')}</p>
            ) : (
              corridors.map((c) => (
                <label key={`${c.regionId}-${c.dayKey ?? 'x'}`} className="kv-field__label" htmlFor={`v-${c.regionId}`}>
                  <input id={`v-${c.regionId}`} type="checkbox" name="villageRegionIds" value={c.regionId}
                         defaultChecked={draft.villageRegionIds.includes(c.regionId)} />
                  {' '}{c.villageName ?? c.regionId.slice(0, 8)} · {t.t(dayLabelKey(c.dayKey, false))} · {c.parcels}
                  {' · '}{formatMoneyMinor(c.spentMinor, 'INR', lang)}
                </label>
              ))
            )}
            {errorFor(errors, 'villageRegionIds') && <p className="kv-error">{t.t(errorFor(errors, 'villageRegionIds')!)}</p>}
          </fieldset>

          <button type="submit" className="kv-btn">{t.t('route.form.review')}</button>{' '}
          <Link href="/logistics/routes" className="kv-btn--link">{t.t('route.form.cancel')}</Link>
        </form>
      )}
    </section>
  );
}
