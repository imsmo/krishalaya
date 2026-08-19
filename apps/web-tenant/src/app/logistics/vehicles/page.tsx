// apps/web-tenant/src/app/logistics/vehicles/page.tsx · W229 (Vehicles) — the fleet register (PC-56 TENANT-5b).
// Server-first, requireSession-gated, noindex. Keyset-paged. Also hosts W2421/W2422/W2423's confirm → success →
// failure chain for [Register vehicle] and for parking, via the URL (shareable, back-button-safe, no client JS).
//
// **THIS SCREEN HAD NO CLIENT AT ALL.** `/v1/logistics/vehicles` has existed since the logistics module was built
// and `packages/sdk-js` carried no method for it — the only console that ever reached it is the 3PL partner app,
// through the untyped `request()` escape hatch. So W229, the fleet register an FPO is supposed to run its
// dispatch from, was a drawing.
//
// WHAT THIS PAGE SAYS THAT THE CANON'S SCREEN CANNOT:
//   • the RC's REAL state per vehicle — `vehicles.rc_doc_id` has pointed at a `kyc_documents` row since 0007 and
//     nothing has ever followed the pointer, so "verified · valid 2028" had no data path at all;
//   • whether W229's own promise is switched ON. "An expired RC parks the vehicle automatically; safety is not a
//     preference" describes a job this wave wrote, shipped OFF (`logistics_rc_parking`). With it off, an expired
//     RC sits here and nothing parks anything — and the screen says so, because letting the canon's sentence
//     stand as a description of the software is how a safety claim becomes decoration;
//   • that a vehicle whose TYPE is unset is not a data-entry lapse: the `vehicle_type` vocabulary was declared in
//     the seeds with not one value, so every vehicle on the platform carried a NULL type until this wave;
//   • and it will not print W229's "free 15:30" — no shift model, no working-hours record and no drop-duration
//     estimate exist, so the hour a vehicle becomes free is not derivable, and it is the one number here a
//     dispatcher would promise a farmer.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { DataTable } from '../../../components/DataTable';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatNumber } from '@krishalaya/i18n';
import {
  actionTitleKey, confirmHref, fleetErrorKey, fleetOkKey, isVehicleAction, mechanismNoticeKey, rcKey, rcTone,
  rcYear, reeferBreach, registerHref, splitKey, todayKey, typeContradictsReefer, typeKey, unfitKey,
  unparkWarningKey,
} from '../../../features/logistics/fleet';
import { LOGISTICS_NAV, navLabelKey, unbuiltCount } from '../../../features/logistics/nav';
import type { FleetRegisterPage, LogisticsPartnerRow, LookupValue } from '@krishalaya/sdk-js';
import { parkVehicleAction, registerVehicleAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('fleet.title'), robots: { index: false, follow: false } };
}

export default async function VehiclesPage({ searchParams }: {
  searchParams: { active?: string; cursor?: string; act?: string; id?: string; ok?: string; error?: string };
}) {
  await requireSession('/logistics/vehicles');
  const t = getTranslator();
  const lang = getLang();
  const activeOnly = searchParams.active === '1';

  let page: FleetRegisterPage | null = null;
  let failed = false;
  try {
    page = await tenantClient().fleet.register({ activeOnly, cursor: searchParams.cursor, limit: 50 });
  } catch { failed = true; }

  const act = isVehicleAction(searchParams.act) ? searchParams.act : null;
  const target = act && searchParams.id ? page?.items.find((v) => v.id === searchParams.id) ?? null : null;
  // The register form needs real options, which is the point of seeding `vehicle_type`: a select with no options
  // is the state this screen was in before TENANT-5b.
  let partners: LogisticsPartnerRow[] = [];
  let types: LookupValue[] = [];
  if (act === 'register') {
    const [p, ty] = await Promise.allSettled([
      tenantClient().fleet.listPartners({ activeOnly: true, limit: 100 }),
      tenantClient().lookups.values('vehicle_type'),
    ]);
    partners = p.status === 'fulfilled' ? p.value : [];
    types = ty.status === 'fulfilled' ? ty.value : [];
  }

  const okKey = searchParams.ok ? fleetOkKey(searchParams.ok) : null;
  const errKey = searchParams.error ? fleetErrorKey(searchParams.error) : null;
  const notice = page ? mechanismNoticeKey(page.mechanisms, page.items) : null;

  return (
    <section>
      <h1>{t.t('fleet.title')}</h1>
      <p className="kv-field__hint">{t.t('fleet.lead')}</p>

      {/* W225's sub-nav, all seven entries, with the four that have no screen named as unbuilt. */}
      <nav className="kv-tabs" aria-label={t.t('logistics.nav.label')}>
        {LOGISTICS_NAV.map((i) => (i.href ? (
          <Link key={i.key} href={i.href} className={i.key === 'vehicles' ? 'kv-tab kv-tab--on' : 'kv-tab'} aria-current={i.key === 'vehicles' ? 'page' : undefined}>
            {t.t(navLabelKey(i))}
          </Link>
        ) : (
          <span key={i.key} className="kv-tab kv-tab--muted" aria-disabled="true">{t.t(navLabelKey(i))}</span>
        )))}
      </nav>
      <p className="kv-field__hint">{t.t('logistics.nav.unbuilt')} {unbuiltCount()}</p>

      {okKey && <p className="kv-success" role="status">{t.t(okKey)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(errKey)}</p>}

      {/* ---- W2421: the confirm step every state-changing action gets (Completeness Law B4) ---- */}
      {act === 'park' && target && (
        <form action={parkVehicleAction} className="kv-card kv-card--notice">
          <h2>{t.t(actionTitleKey('park'))}</h2>
          <p>{t.t('fleet.act.park.body')} <strong>{target.regNoMasked}</strong></p>
          <p className="kv-field__hint">{t.t('fleet.act.audited')}</p>
          <input type="hidden" name="id" value={target.id} />
          <input type="hidden" name="isActive" value="false" />
          <button type="submit" className="kv-btn">{t.t('fleet.act.proceed')}</button>{' '}
          <Link href={registerHref(activeOnly)} className="kv-btn--link">{t.t('fleet.act.cancel')}</Link>
        </form>
      )}
      {act === 'unpark' && target && (
        <form action={parkVehicleAction} className="kv-card kv-card--notice">
          <h2>{t.t(actionTitleKey('unpark'))}</h2>
          <p>{t.t('fleet.act.unpark.body')} <strong>{target.regNoMasked}</strong></p>
          {/* Un-parking a vehicle with an expired RC puts an unroadworthy lorry back on a village road. Said
              plainly, not as "are you sure?". */}
          {unparkWarningKey(target.rc) && <p className="kv-error" role="alert">{t.t(unparkWarningKey(target.rc)!)}</p>}
          <input type="hidden" name="id" value={target.id} />
          <input type="hidden" name="isActive" value="true" />
          <button type="submit" className="kv-btn">{t.t('fleet.act.proceed')}</button>{' '}
          <Link href={registerHref(activeOnly)} className="kv-btn--link">{t.t('fleet.act.cancel')}</Link>
        </form>
      )}
      {act === 'register' && (
        <form action={registerVehicleAction} className="kv-card">
          <h2>{t.t(actionTitleKey('register'))}</h2>
          <p className="kv-field__hint">{t.t('fleet.act.register.body')}</p>
          <label className="kv-field__label" htmlFor="v-partner">{t.t('fleet.form.partner')}</label>
          <select id="v-partner" name="partnerId" className="kv-input" required>
            {partners.map((p) => <option key={p.id} value={p.id}>{p.defaultName}</option>)}
          </select>
          <label className="kv-field__label" htmlFor="v-reg">{t.t('fleet.form.regNo')}</label>
          <input id="v-reg" name="regNo" className="kv-input" required maxLength={20} />
          <label className="kv-field__label" htmlFor="v-type">{t.t('fleet.form.type')}</label>
          <select id="v-type" name="vehicleTypeId" className="kv-input">
            <option value="">{t.t('common.dash')}</option>
            {/* The lookup's LOCALE-RESOLVED name is the fallback; the console's own key wins so the five types
                read the same on this screen as in the register's Type column. */}
            {types.map((ty) => <option key={ty.id} value={ty.id}>{t.t(typeKey(ty.code)) || ty.name}</option>)}
          </select>
          {types.length === 0 && <p className="kv-field__hint">{t.t('fleet.form.noTypes')}</p>}
          <label className="kv-field__label" htmlFor="v-cap">{t.t('fleet.form.capacity')}</label>
          <input id="v-cap" name="capacityKg" type="number" min="1" className="kv-input" />
          <label className="kv-field__label" htmlFor="v-reefer">
            <input id="v-reefer" name="isRefrigerated" type="checkbox" /> {t.t('fleet.form.refrigerated')}
          </label>
          <p className="kv-field__hint">{t.t('fleet.form.rcHint')}</p>
          <button type="submit" className="kv-btn">{t.t('fleet.act.proceed')}</button>{' '}
          <Link href={registerHref(activeOnly)} className="kv-btn--link">{t.t('fleet.act.cancel')}</Link>
        </form>
      )}

      {!act && (
        <p className="kv-toolbar">
          <Link href={confirmHref('register')} className="kv-btn">{t.t('fleet.registerVehicle')}</Link>{' '}
          <Link href={registerHref(!activeOnly)} className="kv-btn--link">
            {t.t(activeOnly ? 'fleet.filter.showParked' : 'fleet.filter.activeOnly')}
          </Link>
        </p>
      )}

      {failed || !page ? (
        // W229's error state: "Assigned runs continue. Retry." A register that cannot be read does not stop a
        // lorry that is already on the road, and the copy says so (Law 12).
        <p className="kv-error" role="alert">{t.t('fleet.loadError')}</p>
      ) : (
        <>
          {notice && <p className="kv-card kv-card--notice" role="status">{t.t(notice)}</p>}
          <DataTable
            rows={page.items}
            empty={t.t('fleet.empty')}
            columns={[
              {
                header: t.t('fleet.colReg'),
                cell: (v) => (
                  <>
                    <span>{v.regNoMasked}</span>
                    {v.scope === 'platform' && <> <span className="kv-badge kv-badge--muted">{v.partnerName ?? t.t('fleet.partnered')}</span></>}
                  </>
                ),
              },
              {
                header: t.t('fleet.colType'),
                cell: (v) => (
                  <>
                    <span>{t.t(typeKey(v.typeCode))}</span>
                    {typeContradictsReefer(v) && <> <span className="kv-badge kv-badge--warn">{t.t('fleet.typeMismatch')}</span></>}
                  </>
                ),
              },
              // A weight, never money (Law 2 is about money; this is kilograms and formatNumber is the right tool).
              { header: t.t('fleet.colCapacity'), cell: (v) => (v.capacityKg === null ? t.t('common.dash') : `${formatNumber(v.capacityKg, lang)} ${t.t('fleet.kg')}`) },
              {
                header: t.t('fleet.colRc'),
                cell: (v) => {
                  const year = rcYear(v.rc);
                  return <span className={`kv-status kv-status--${rcTone(v.rc)}`}>{t.t(rcKey(v.rc))}{year ? ` · ${year}` : ''}</span>;
                },
              },
              {
                header: t.t('fleet.colToday'),
                cell: (v) => (
                  <>
                    <span>{t.t(todayKey(v.today))}</span>
                    {v.today.kind === 'carrying' && v.today.reefer && <> · {v.today.reefer.tempC}°C</>}
                    {reeferBreach(v.today) && <> <span className="kv-badge kv-badge--danger">{t.t('fleet.breach')}</span></>}
                    {v.today.kind === 'loads_next' && <> · {v.today.routeName}</>}
                  </>
                ),
              },
              {
                header: t.t('fleet.colState'),
                cell: (v) => (
                  <>
                    {v.isActive
                      ? <Link href={confirmHref('park', v.id)} className="kv-link">{t.t('fleet.park')}</Link>
                      : <Link href={confirmHref('unpark', v.id)} className="kv-link">{t.t('fleet.unpark')}</Link>}
                    {unfitKey(v.unfit) && <> <span className="kv-badge kv-badge--warn">{t.t(unfitKey(v.unfit)!)}</span></>}
                  </>
                ),
              },
            ]}
          />
          <p className="kv-field__hint">
            {t.t(splitKey(page.split))} {page.split.own} / {page.split.partnered} · {page.split.total}
          </p>
          {page.nextCursor && (
            <p className="kv-pager">
              <a href={registerHref(activeOnly, page.nextCursor)} className="kv-btn--link">{t.t('common.nextPage')}</a>
            </p>
          )}
        </>
      )}
    </section>
  );
}
