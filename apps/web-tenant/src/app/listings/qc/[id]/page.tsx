// apps/web-tenant/src/app/listings/qc/[id]/page.tsx · W127, the QC review (PC-56 TENANT-2a).
//
// A REVIEW BUILT ONLY FROM WHAT IS RECORDED. The canon draws five green AI checks; on this platform today the
// ai_grade columns have never been populated and no stock-photo scan exists — so the checks panel shows the
// REAL ones (price against the peer band, labelled as exactly that; the seller's actual record with this
// tenant; the photos with their scan status) and NAMES the absent ones instead of drawing their ticks. A tick
// nobody computed is how a fake lot gets published with a clean conscience.
//
// No self-review: if this reviewer created or owns the lot, the decision forms are replaced by the canon's own
// sentence — and the server enforces the same rule with its own codes, backstopped by 0138's CHECK.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { formatMoneyMinor } from '@krishalaya/i18n';
import type { QcReviewPayload, GalleryItem } from '@krishalaya/sdk-js';
import { waitingAge, bandVerdict } from '../../../../features/listings/console';
import { qcApproveAction, qcRejectAction } from '../actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('qcr.title'), robots: { index: false, follow: false } };
}

const ERR = new Set(['selfreview', 'reason', 'raced', 'grant', 'failed']);

export default async function QcReviewPage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string } }) {
  await requireSession(`/listings/qc/${params.id}`);
  const t = getTranslator();
  const lang = getLang();

  let d: QcReviewPayload;
  try { d = await tenantClient().listings.qcReview(params.id); }
  catch { notFound(); }

  let photos: GalleryItem[] = [];
  try { photos = await tenantClient().listings.mediaOwn(params.id); } catch { photos = []; }

  const age = waitingAge(d.detail.qcSubmittedAt, new Date());
  const band = bandVerdict(d.detail.priceMinor, d.band);
  const stillWaiting = d.detail.status === 'pending_approval';

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('qcr.heading', { title: d.detail.title })}</h1>
        <p className="kv-muted">
          {d.detail.sellerName ?? t.t('common.dash')}
          {' · '}{t.t('qcr.history', { n: String(d.sellerHistory.previousListings), rej: String(d.sellerHistory.rejections) })}
          {' · '}{age.kind === 'aged' ? t.t('qc.ageH', { h: String(age.hours) }) : t.t('qc.beforeClock')}
        </p>
        <p className="kv-fine"><Link href="/listings/qc" className="kv-link">← {t.t('qc.title')}</Link></p>
      </div>

      {searchParams.error && ERR.has(searchParams.error) && <p className="kv-error" role="alert">{t.t(`qcr.error.${searchParams.error}` as never)}</p>}
      {!stillWaiting && <p className="kv-error" role="alert">{t.t('qcr.notWaiting', { status: d.detail.status })}</p>}

      <dl className="kv-facts">
        <div className="kv-facts__row"><dt>{t.t('qcr.product')}</dt><dd>{d.detail.productName ?? t.t('common.dash')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('qcr.qty')}</dt><dd>{d.detail.quantityTotal} {d.detail.unitCode} ({t.t('qcr.minOrder')} {d.detail.minOrderQty})</dd></div>
        <div className="kv-facts__row"><dt>{t.t('qcr.price')}</dt><dd>{formatMoneyMinor(d.detail.priceMinor, d.detail.currencyCode, lang)} / {d.detail.unitCode}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('qcr.organic')}</dt><dd>{t.t(`qcr.organic.${d.detail.organicClaim}` as never)}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('qcr.harvest')}</dt><dd>{d.detail.harvestDate ?? t.t('common.dash')}</dd></div>
      </dl>

      {/* ---- the checks that are REAL ---- */}
      <h2>{t.t('qcr.checksHeading')}</h2>
      <ul>
        <li>
          {band.kind === 'inside' && t.t('qcr.band.inside')}
          {band.kind === 'above' && <span className="kv-error">{t.t('qcr.band.above', { pct: String(band.pct) })}</span>}
          {band.kind === 'below' && <span className="kv-error">{t.t('qcr.band.below', { pct: String(band.pct) })}</span>}
          {band.kind === 'no_band' && <span className="kv-fine">{t.t('qcr.band.none')}</span>}
          {d.band && <span className="kv-fine"> — {t.t('qcr.band.basis', {
            low: formatMoneyMinor(d.band.lowMinor, d.detail.currencyCode, lang),
            high: formatMoneyMinor(d.band.highMinor, d.detail.currencyCode, lang),
            n: String(d.band.sampleSize),
          })}</span>}
        </li>
        <li>{t.t('qcr.sellerRecord', { n: String(d.sellerHistory.previousListings), rej: String(d.sellerHistory.rejections) })}</li>
        <li>{photos.length > 0 ? t.t('qcr.photosN', { n: String(photos.length) }) : t.t('qcr.photosNone')}</li>
      </ul>
      {/* W126's own rule travels with the band verdict. */}
      <p className="kv-fine">{t.t('qc.bandRule')}</p>
      {/* ---- the checks that are NOT recorded — named, never ticked ---- */}
      <p className="kv-fine kv-note">{t.t('qcr.absentChecks')}</p>

      {photos.length > 0 && (
        <ul className="kv-cards">
          {photos.map((p) => (
            <li key={p.mediaId} className="kv-card">
              {/* a plain <img> on purpose: the url is a short-lived presigned GET — next/image's optimizer would
                  re-fetch through a proxy and break the signature */}
              <img src={p.url} alt={t.t('qcr.photoAlt', { title: d.detail.title })} style={{ maxWidth: '100%' }} />
            </li>
          ))}
        </ul>
      )}

      {stillWaiting && (d.selfReview ? (
        // W127's restricted state, verbatim in spirit: the decision needs another pair of hands.
        <p className="kv-error" role="note">{t.t('qcr.selfReview')}</p>
      ) : (
        <>
          <form action={qcApproveAction} className="kv-card kv-form">
            <h2 className="kv-card__title">{t.t('qcr.approveHeading')}</h2>
            <p className="kv-fine">{t.t('qcr.approveNote')}</p>
            <input type="hidden" name="id" value={d.detail.id} />
            <button type="submit" className="kv-btn">{t.t('qcr.approveBtn')}</button>
            <p className="kv-fine">{t.t('qcr.recorded')}</p>
          </form>

          <form action={qcRejectAction} className="kv-card kv-form">
            <h2 className="kv-card__title">{t.t('qcr.rejectHeading')}</h2>
            <label htmlFor="qc-reason" className="kv-field__label">{t.t('qcr.rejectReason')}</label>
            <select id="qc-reason" name="reasonCode" className="kv-input" required defaultValue="">
              <option value="" disabled>{t.t('qcr.rejectPick')}</option>
              {d.reasons.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
            </select>
            <input type="hidden" name="id" value={d.detail.id} />
            <button type="submit" className="kv-btn">{t.t('qcr.rejectBtn')}</button>
            <p className="kv-fine">{t.t('qcr.rejectRecorded')}</p>
          </form>
        </>
      ))}
    </section>
  );
}
