// apps/web-tenant/src/app/ops/logistics/slots/page.tsx · W230 · Pickup slots — PC-56 TENANT-SW-e.
//
// The desk across sellers (masked): each seller's own weekday × window, pickups in 30 days, and first-attempt success — of DELIVERY,
// labelled as such, because only delivery attempts are recorded; pickup first-attempt is REFUSED BY NAME. "Run suggestions" is a READ of
// the seller's own pickup history over 90 days (no model, no write). "Propose slots" sends a proposal the MEMBER accepts — in the app or
// through the OTP link — and nothing is written to their slots until they do. "Members set slots by voice" is refused by name.
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { SlotDesk, SlotProposal, SlotSuggestions } from '@krishalaya/sdk-js';
import { formatDate } from '@krishalaya/i18n';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { tenantHasPerm } from '../../../../lib/auth';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { DataTable } from '../../../../components/DataTable';
import { SLOTS_HREF, isUuid, ratioLabel, refusedKey, swePageState, weekdayKey } from '../../../../features/swe/console';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('swe.slots.title'), robots: { index: false, follow: false } }; }

export default async function SlotsPage({ searchParams }: { searchParams: { cursor?: string; seller?: string } }) {
  await requireSession(SLOTS_HREF);
  const t = getTranslator(); const lang = getLang();
  const canManage = tenantHasPerm('logistics.manage');
  let desk: SlotDesk | null = null; let state: string | null = null;
  try { desk = await tenantClient().pickupSlots.desk({ cursor: searchParams.cursor, limit: 50 }); }
  catch (e) { state = swePageState(e instanceof SdkError ? e.status : undefined, true); }
  const seller = isUuid(searchParams.seller) ? searchParams.seller : null;
  let open: SlotProposal[] = []; let sugg: SlotSuggestions | null = null; let suggFailed = false;
  if (desk) {
    const [p, s] = await Promise.allSettled([tenantClient().pickupSlots.proposals({ status: 'proposed', limit: 50 }), seller ? tenantClient().pickupSlots.suggestions(seller) : Promise.resolve(null)]);
    open = p.status === 'fulfilled' ? p.value.items : []; sugg = s.status === 'fulfilled' ? s.value : null; suggFailed = !!seller && s.status === 'rejected';
  }
  const win = (w: { weekday: number; start: string; end: string }) => `${t.t(weekdayKey(w.weekday))} ${w.start}–${w.end}`;
  const when = (iso: string | null) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short' }) : t.t('common.dash'));

  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('swe.slots.title')}><span>{t.t('swa.ops')}</span> / <span>{t.t('swa.logistics')}</span> / <span aria-current="page">{t.t('swe.slots.title')}</span></nav>
      <h1>{t.t('swe.slots.title')}</h1>
      <p className="kv-field__hint">{t.t('swe.slots.subtitle')}</p>
      {state ? (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert">
          <strong>{t.t(`swe.state.${state}.title`)}</strong><p>{t.t(`swe.state.${state}.body`)}</p>
          {state === 'error' && <p><Link href={SLOTS_HREF} className="kv-btn--link">{t.t('swe.retry')}</Link></p>}
        </div>
      ) : desk && (
        <>
          {!desk.proposalsOn && <p className="kv-notice" role="note">{t.t('swe.slots.proposalsOff')}</p>}
          <p>{t.t('swe.slots.sellers', { n: String(desk.totalSellers) })}</p>
          {desk.items.length === 0 ? (
            <div className="kv-card kv-card--notice" role="status"><strong>{t.t('swe.slots.empty.title')}</strong><p>{t.t('swe.slots.empty.body')}</p></div>
          ) : (
            <DataTable rows={desk.items} empty={t.t('swe.slots.empty.title')} columns={[
              { header: t.t('swe.slots.col.seller'), cell: (r) => <span>{r.sellerName ?? t.t('common.dash')}<br /><span className="kv-detail__muted">{r.sellerPhoneMasked ?? ''}</span></span> },
              { header: t.t('swe.slots.col.windows'), cell: (r) => (r.windows.length ? r.windows.map(win).join(' · ') : t.t('swe.slots.noWindows')) },
              { header: t.t('swe.slots.col.pickups30d'), cell: (r) => String(r.pickups30d) },
              { header: t.t('swe.slots.col.deliveryFirst'), cell: (r) => ratioLabel(r.deliveryFirstAttempt.ratio) ?? t.t('swe.slots.noAttempts') },
              { header: t.t('swe.slots.col.pickupFirst'), cell: (r) => <span className="kv-badge kv-badge--muted" title={t.t(refusedKey(r.pickupFirstAttempt.code))}>{t.t('swe.refusedShort')}</span> },
              { header: '', cell: (r) => (
                <span>
                  <Link href={`${SLOTS_HREF}?seller=${r.sellerUserId}`} className="kv-btn--link">{t.t('swe.slots.suggest')}</Link>
                  {canManage && desk!.proposalsOn && !r.openProposal && <>{' · '}<Link href={`${SLOTS_HREF}/propose?sellerUserId=${r.sellerUserId}`} className="kv-btn--link">{t.t('swe.slots.propose')}</Link></>}
                  {r.openProposal && <>{' · '}<span className="kv-detail__muted">{t.t('swe.slots.awaiting', { at: when(r.openProposal.expiresAt) })}</span></>}
                </span>) },
            ]} />
          )}
          {desk.nextCursor && <p><Link href={`${SLOTS_HREF}?cursor=${encodeURIComponent(desk.nextCursor)}`} className="kv-btn--link">{t.t('swe.next')}</Link></p>}

          {seller && (
            <div className="kv-card">
              <h2>{t.t('swe.slots.suggestTitle')}</h2>
              {suggFailed || !sugg ? <p className="kv-error">{t.t('swe.slots.suggestFailed')}</p> : (
                <>
                  <p className="kv-field__hint">{t.t('swe.slots.suggestLabel', { days: String(sugg.windowDays), n: String(sugg.pickupsRead) })}</p>
                  {sugg.cells.length === 0 ? <p>{t.t('swe.slots.suggestNone')}</p> : (
                    <DataTable rows={sugg.cells} empty={t.t('swe.slots.suggestNone')} columns={[
                      { header: t.t('swe.slots.col.window'), cell: (c) => win(c) },
                      { header: t.t('swe.slots.col.pickups'), cell: (c) => String(c.pickups) },
                      { header: t.t('swe.slots.col.deliveryFirst'), cell: (c) => ratioLabel(c.deliveryFirstAttempt) ?? t.t('swe.slots.noAttempts') },
                    ]} />
                  )}
                  <p className="kv-field__hint">{t.t('swe.slots.suggestNoWrite')}</p>
                </>
              )}
            </div>
          )}

          <h2>{t.t('swe.slots.open')}</h2>
          {open.length === 0 ? <p className="kv-field__hint">{t.t('swe.slots.noOpen')}</p> : open.map((p) => (
            <div key={p.id} className="kv-card">
              <p><strong>{p.sellerName ?? t.t('common.dash')}</strong> <span className="kv-detail__muted">{p.sellerPhoneMasked ?? ''}</span> · {p.windows.map(win).join(' · ')}</p>
              <p className="kv-detail__muted">{p.reason}</p>
              <p className="kv-detail__muted">{t.t('swe.slots.expires', { at: when(p.expiresAt) })}</p>
              {canManage && <p><Link href={`${SLOTS_HREF}/act?act=withdraw&id=${p.id}`} className="kv-btn--link">{t.t('swe.slots.withdraw')}</Link></p>}
            </div>
          ))}
          <div className="kv-card">
            <h2>{t.t('swe.methods')}</h2>
            <ul className="kv-list">
              <li>{t.t('swe.slots.method.delivery')}</li>
              <li>{t.t('swe.slots.col.pickupFirst')}: {t.t(refusedKey(desk.refused.pickupFirstAttempt))}</li>
              <li>{t.t('swe.slots.voice')}: {t.t(refusedKey(desk.refused.voiceSlots))}</li>
              <li>{t.t('swe.slots.method.nothingWritten')}</li>
            </ul>
          </div>
        </>
      )}
    </section>
  );
}
