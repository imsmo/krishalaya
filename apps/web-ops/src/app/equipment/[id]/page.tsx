// apps/web-ops/src/app/equipment/[id]/page.tsx · one rental's lifecycle (PC-33 OW-3): quote the advance →
// (renter confirms on THEIR device — equipment.rent, not ours) → start with the renter's OTP (presence proof)
// → record actual usage → settle (idempotent, money server-side). Only the legal action shows. notFound = IDOR.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '../../../lib/session';
import { opsClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import { canQuote, canStart, canComplete, canSettle, canCancelRental } from '../../../features/equipment/manage';
import { rentalActionAction } from '../actions';
import type { EquipmentRental } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('chc.detailTitle'), robots: { index: false, follow: false } };
}

const OK = new Set(['quote', 'start', 'complete', 'settle', 'cancel']);
const ERR = new Set(['action', 'illegal', 'advance', 'otp', 'quantity']);

export default async function RentalDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  await requireSession(`/equipment/${params.id}`);
  const t = getTranslator();
  const lang = getLang();

  let r: EquipmentRental;
  try { r = await opsClient().equipment.rental(params.id); }
  catch { notFound(); }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const s = r.status;

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('chc.detailTitle')}</h1>
        <Link href="/equipment" className="kv-btn--link">← {t.t('chc.title')}</Link>
      </div>
      {okKey && <p className="kv-success" role="status">{t.t(`chc.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`chc.error.${errKey}`)}</p>}

      <dl className="kv-facts">
        <div className="kv-facts__row"><dt>{t.t('chc.colRental')}</dt><dd>{r.assetName ?? r.assetId} · <strong>{r.quantity} {r.unitCode}</strong></dd></div>
        <div className="kv-facts__row"><dt>{t.t('chc.colStatus')}</dt><dd><span className="kv-badge">{t.t(`chc.status.${s}`) || s}</span></dd></div>
        <div className="kv-facts__row"><dt>{t.t('chc.colAdvance')}</dt><dd>{r.advanceMinor ? formatMoneyMinor(r.advanceMinor, 'INR', lang) : t.t('common.dash')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('chc.colTotal')}</dt><dd>{r.totalMinor ? formatMoneyMinor(r.totalMinor, 'INR', lang) : t.t('chc.totalServer')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('chc.colScheduled')}</dt><dd>{r.scheduledAt ? formatDate(r.scheduledAt, lang) : t.t('common.dash')}</dd></div>
      </dl>

      {canQuote(s) && (
        <form action={rentalActionAction} className="kv-card kv-form">
          <h2 className="kv-card__title">{t.t('chc.actQuote')}</h2>
          <input type="hidden" name="id" value={r.id} />
          <input type="hidden" name="kind" value="quote" />
          <label htmlFor="ch-adv" className="kv-field__label">{t.t('chc.advance')}</label>
          <input id="ch-adv" name="advanceMajor" className="kv-input" required inputMode="decimal" pattern="\d{1,12}(\.\d{1,2})?" placeholder="0" />
          <p className="kv-field__hint">{t.t('chc.quoteHint')}</p>
          <button type="submit" className="kv-btn">{t.t('chc.actQuote')}</button>
        </form>
      )}

      {s === 'quoted' && <p className="kv-field__hint kv-note">{t.t('chc.awaitConfirm')}</p>}

      {canStart(s) && (
        <form action={rentalActionAction} className="kv-card kv-form">
          <h2 className="kv-card__title">{t.t('chc.actStart')}</h2>
          <input type="hidden" name="id" value={r.id} />
          <input type="hidden" name="kind" value="start" />
          <label htmlFor="ch-otp" className="kv-field__label">{t.t('chc.otp')}</label>
          <input id="ch-otp" name="otp" className="kv-input" required inputMode="numeric" pattern="\d{4,12}" autoComplete="off" />
          <p className="kv-field__hint">{t.t('chc.otpHint')}</p>
          <button type="submit" className="kv-btn">{t.t('chc.actStart')}</button>
        </form>
      )}

      {canComplete(s) && (
        <form action={rentalActionAction} className="kv-card kv-form">
          <h2 className="kv-card__title">{t.t('chc.actComplete')}</h2>
          <input type="hidden" name="id" value={r.id} />
          <input type="hidden" name="kind" value="complete" />
          <label htmlFor="ch-qty" className="kv-field__label">{t.t('chc.actualQty', { unit: r.unitCode })}</label>
          <input id="ch-qty" name="actualQuantity" className="kv-input" required inputMode="decimal" pattern="\d{1,9}(\.\d{1,3})?" defaultValue={r.quantity} />
          <button type="submit" className="kv-btn">{t.t('chc.actComplete')}</button>
        </form>
      )}

      {canSettle(s) && (
        <form action={rentalActionAction} className="kv-inline-form">
          <input type="hidden" name="id" value={r.id} />
          <input type="hidden" name="kind" value="settle" />
          <button type="submit" className="kv-btn">{t.t('chc.actSettle')}</button>
          <p className="kv-field__hint">{t.t('chc.settleHint')}</p>
        </form>
      )}

      {canCancelRental(s) && (
        <form action={rentalActionAction} className="kv-card kv-form">
          <h2 className="kv-card__title">{t.t('chc.actCancel')}</h2>
          <input type="hidden" name="id" value={r.id} />
          <input type="hidden" name="kind" value="cancel" />
          <label htmlFor="ch-reason" className="kv-field__label">{t.t('chc.cancelReason')}</label>
          <input id="ch-reason" name="reason" className="kv-input" maxLength={500} />
          <button type="submit" className="kv-btn kv-btn--muted">{t.t('chc.actCancel')}</button>
        </form>
      )}
    </section>
  );
}
