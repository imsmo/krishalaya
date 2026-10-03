// apps/web-tenant/src/app/ops/logistics/zones/page.tsx · W233 · Delivery zones — PC-56 TENANT-SW-a.
//
// Zones with their pincodes, the fee definition each charges (the fee the buyer is quoted IS the fee placement charges now, F-5), the
// real "Orders 30d" (orders.delivery_zone_id), status; "New zone (checker)"; re-point fee / deactivate / re-activate / confirm / refuse
// through the mutate chain; the serviceability test box ("does this pincode get delivery?"); pending proposals with Confirm offered only to
// a different administrator; every state (none yet, couldn't load, restricted, flagged off).
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { DeliveryZone, DeliveryZoneProposal, ZoneFeeDefinition, ZoneServiceability } from '@krishalaya/sdk-js';
import { formatDate } from '@krishalaya/i18n';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { tenantHasPerm } from '../../../../lib/auth';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { DataTable } from '../../../../components/DataTable';
import { ZONES_HREF, isPincode, pageState } from '../../../../features/swa/console';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('swa.zone.title'), robots: { index: false, follow: false } }; }

export default async function ZonesPage({ searchParams }: { searchParams: { pincode?: string; cursor?: string } }) {
  await requireSession(ZONES_HREF);
  const t = getTranslator(); const lang = getLang();
  const canPropose = tenantHasPerm('logistics.zones.manage');
  let zones: DeliveryZone[] = []; let next: string | null = null; let state: string | null = null;
  try { const p = await tenantClient().tenantConfig.deliveryZones({ activeOnly: false, limit: 50, cursor: searchParams.cursor }); zones = p.items; next = p.nextCursor; }
  catch (e) { state = pageState(e instanceof SdkError ? e.status : undefined, true); }
  let defs: ZoneFeeDefinition[] = []; let proposals: DeliveryZoneProposal[] = []; let test: ZoneServiceability | null = null;
  const pin = isPincode(searchParams.pincode) ? searchParams.pincode : null;
  if (!state) {
    const [d, p, s] = await Promise.allSettled([
      tenantClient().tenantConfig.zoneFeeDefinitions(), tenantClient().tenantConfig.zoneProposals({ status: 'proposed', limit: 50 }),
      pin ? tenantClient().tenantConfig.zoneServiceability(pin) : Promise.resolve(null),
    ]);
    defs = d.status === 'fulfilled' ? d.value : []; proposals = p.status === 'fulfilled' ? p.value.items : []; test = s.status === 'fulfilled' ? s.value : null;
  }
  const feeLabel = (id: string | null) => {
    if (!id) return t.t('swa.zone.noFee');
    const d = defs.find((x) => x.id === id);
    return d ? `${d.label ?? d.chargeCode} · ${t.t(`swa.zone.calc.${d.calcMethod}`)}` : t.t('swa.zone.feeDef', { id: id.slice(0, 8) });
  };
  const pins = (z: DeliveryZone) => (z.pincodes.length <= 3 ? z.pincodes.join(', ') : `${z.pincodes.slice(0, 2).join(', ')} +${z.pincodes.length - 2}`);

  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('swa.zone.title')}><span>{t.t('swa.ops')}</span> / <span>{t.t('swa.logistics')}</span> / <span aria-current="page">{t.t('swa.zone.title')}</span></nav>
      <div className="kv-page-head">
        <h1>{t.t('swa.zone.title')}</h1>
        {canPropose && !state && <Link href={`${ZONES_HREF}/new`} className="kv-btn kv-btn--primary">{t.t('swa.zone.new')}</Link>}
      </div>
      <p className="kv-field__hint">{t.t('swa.zone.subtitle')}</p>
      {!canPropose && !state && <p className="kv-notice" role="note">{t.t('swa.zone.state.restricted.body')}</p>}
      {state ? (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert">
          <strong>{t.t(`swa.zone.state.${state}.title`)}</strong><p>{t.t(`swa.zone.state.${state}.body`)}</p>
          {state === 'error' && <p><Link href={ZONES_HREF} className="kv-btn--link">{t.t('swa.retry')}</Link></p>}
        </div>
      ) : (
        <>
          {zones.length === 0 ? (
            <div className="kv-card kv-card--notice" role="status"><strong>{t.t('swa.zone.state.empty.title')}</strong><p>{t.t('swa.zone.state.empty.body')}</p></div>
          ) : (
            <DataTable rows={zones} empty={t.t('swa.zone.state.empty.title')} columns={[
              { header: t.t('swa.zone.col.zone'), cell: (z) => z.defaultName },
              { header: t.t('swa.zone.col.pincodes'), cell: pins },
              { header: t.t('swa.zone.col.charge'), cell: (z) => feeLabel(z.chargeDefinitionId) },
              { header: t.t('swa.zone.col.orders30d'), cell: (z) => String(z.orders30d ?? 0) },
              { header: t.t('swa.zone.col.status'), cell: (z) => t.t(z.isActive ? 'swa.zone.active' : 'swa.zone.inactive') },
              { header: '', cell: (z) => (canPropose ? (
                <span>
                  <Link href={`${ZONES_HREF}/act?act=repoint&id=${z.id}`} className="kv-btn--link">{t.t('swa.zone.act.repoint')}</Link>{' · '}
                  <Link href={`${ZONES_HREF}/act?act=${z.isActive ? 'deactivate' : 'activate'}&id=${z.id}`} className="kv-btn--link">{t.t(`swa.zone.act.${z.isActive ? 'deactivate' : 'activate'}`)}</Link>
                </span>) : <span className="kv-detail__muted">{t.t('common.dash')}</span>) },
            ]} />
          )}
          {next && <p><Link href={`${ZONES_HREF}?cursor=${encodeURIComponent(next)}`} className="kv-btn--link">{t.t('swa.next')}</Link></p>}
          <p className="kv-field__hint">{t.t('swa.zone.snapshotLaw')}</p>
          <p className="kv-field__hint">{t.t('swa.zone.unserviceableLaw')}</p>

          <div className="kv-card">
            <h2>{t.t('swa.zone.test.title')}</h2>
            <form method="get" action={ZONES_HREF} className="kv-inline-form">
              <label className="kv-field" htmlFor="z-pin"><span>{t.t('swa.zone.test.pincode')}</span>
                <input id="z-pin" name="pincode" className="kv-input" inputMode="numeric" pattern="[1-9][0-9]{5}" maxLength={6} defaultValue={pin ?? ''} /></label>
              <button type="submit" className="kv-btn--link">{t.t('swa.zone.test.ask')}</button>
            </form>
            {test && (test.serviceable
              ? <p>{t.t('swa.zone.test.yes', { pincode: test.pincode, zones: test.zones.map((z) => z.defaultName).join(', ') })}</p>
              : <p className="kv-notice">{t.t('swa.zone.test.no', { pincode: test.pincode })}</p>)}
          </div>

          <h2>{t.t('swa.zone.pending')}</h2>
          {proposals.length === 0 ? <p className="kv-field__hint">{t.t('swa.zone.noPending')}</p> : proposals.map((p) => (
            <div key={p.id} className="kv-card">
              <p><strong>{t.t(`swa.zone.kind.${p.kind}`)}</strong> · {p.defaultName ?? zones.find((z) => z.id === p.zoneId)?.defaultName ?? p.zoneId.slice(0, 8)}{p.kind !== 'deactivate' && p.kind !== 'activate' ? ` · ${feeLabel(p.chargeDefinitionId)}` : ''}</p>
              <p className="kv-detail__muted">{p.reason}</p>
              <p className="kv-detail__muted">{t.t('swa.com.expires', { at: formatDate(p.expiresAt, lang, { dateStyle: 'medium', timeStyle: 'short' }) })}</p>
              {canPropose && (
                <p>{p.canConfirm ? <Link href={`${ZONES_HREF}/act?act=confirm&id=${p.id}`} className="kv-btn kv-btn--sm">{t.t('swa.zone.confirm')}</Link> : <span className="kv-notice">{t.t('swa.com.youProposed')}</span>}{' '}
                  {p.canRefuse && <Link href={`${ZONES_HREF}/act?act=refuse&id=${p.id}`} className="kv-btn--link">{t.t(p.isMine ? 'swa.com.withdraw' : 'swa.com.refuse')}</Link>}</p>
              )}
            </div>
          ))}
          <p className="kv-field__hint">{t.t('swa.zone.recorded')}</p>
        </>
      )}
    </section>
  );
}
