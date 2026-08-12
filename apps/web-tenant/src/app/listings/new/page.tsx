// apps/web-tenant/src/app/listings/new/page.tsx · W125, the new-listing form (PC-56 TENANT-2b over the DEV-18 page).
//
// THREE RULES FROM THE CANON, BUILT AS STRUCTURE:
//   • ON BEHALF NEEDS THE MEMBER'S RECORDED YES — staff (listing.moderate) pick the member first (W125's own
//     empty state: "pick the member first"); the server refuses creation without the member's on_behalf_listing
//     consent, and this page shows that refusal as the canon's restricted state. Their produce, their yes.
//   • THE FAIR-PRICE GUIDE IS THE PEER BAND, LABELLED AS WHAT IT IS — P10–P90 of this organisation's own
//     published listings for the same product × area (the read QC trusts), resolved from the pincode via a
//     no-JS GET preview. No comparable listings = "no band", never an invented range, never "AI".
//   • A REFUSED SUBMIT PRESERVES EVERY TYPED VALUE (W2357) — errors redirect back with the fields in the query
//     and this page re-fills them. The REVIEW step (W2358) is the draft's own detail page: create lands there,
//     where Submit for QC lives — a review page that is the real object, not a mock of it.
import type { Metadata } from 'next';
import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { requireSession } from '../../../lib/session';
import { tenantHasPerm } from '../../../lib/auth';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { MediaUploader } from '../../../components/MediaUploader';
import { createListingAction } from './actions';
import { encodeProductChoice, decodeProductChoice, LISTING_SALE_TYPES, LISTING_ORGANIC, LISTING_VISIBILITY } from '../../../features/listings/form';
import type { ProductCard, FairPriceGuide, RosterMember } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('listingNew.title'), robots: { index: false, follow: false } };
}

type SP = Record<string, string | string[] | undefined>;
const one = (sp: SP, k: string): string => { const v = sp[k]; return (Array.isArray(v) ? v[0] : v) ?? ''; };
const many = (sp: SP, k: string): string[] => { const v = sp[k]; return Array.isArray(v) ? v : v ? [v] : []; };

export default async function NewListingPage({ searchParams }: { searchParams: SP }) {
  await requireSession('/listings/new');
  const t = getTranslator();
  const lang = getLang();
  const q = one(searchParams, 'q').trim();
  const isStaff = tenantHasPerm('listing.moderate');

  let products: ProductCard[] = []; let loadFailed = false;
  try { products = (await tenantClient().catalogue.browseProducts({ q: q || undefined, limit: 50 })).items; }
  catch (e) { loadFailed = true; console.error('[new-listing] catalogue load failed:', e); }

  // ---- on-behalf member picker (staff only; display-side — the server enforces perm + consent) ----
  const member = one(searchParams, 'member').trim();
  const memberName = one(searchParams, 'memberName').trim();
  const memberQ = one(searchParams, 'memberQ').trim();
  let memberHits: RosterMember[] = [];
  if (isStaff && memberQ.length >= 2 && !member) {
    try { memberHits = (await tenantClient().members.roster({ q: memberQ, limit: 8 })).items; } catch { memberHits = []; }
  }

  // ---- fair-price preview (no-JS GET round trip; only when both keys are present) ----
  const chosenProduct = decodeProductChoice(one(searchParams, 'product') || undefined);
  const pincode = one(searchParams, 'pincode').trim();
  let guide: FairPriceGuide | null = null;
  if (one(searchParams, 'preview') && chosenProduct && /^\d{4,10}$/.test(pincode)) {
    try { guide = await tenantClient().listings.fairPrice(chosenProduct.id, pincode); } catch { guide = null; }
  }

  const errorKey = one(searchParams, 'error');
  const knownErrors = new Set(['errorProduct', 'errorTitle', 'errorQty', 'errorPrice', 'errorHarvest', 'consent']);
  const errorMsg = errorKey ? (knownErrors.has(errorKey) ? t.t(`listingNew.${errorKey}` as never) : t.t('listingNew.errorCreate')) : null;
  const preservedMedia = many(searchParams, 'mediaIds');
  const d = (k: string) => one(searchParams, k);   // preserved defaults (W2357)

  return (
    <section className="kv-auth">
      <h1>{t.t('listingNew.title')}</h1>
      {errorMsg && <p className="kv-error" role="alert">{errorMsg}</p>}
      {errorKey && !knownErrors.has(errorKey) ? null : errorKey === 'consent' && (
        <p className="kv-fine">{t.t('listingNew.consentHow')}</p>
      )}

      {/* W125: staff pick the member FIRST — their verified profile is whose produce this is. */}
      {isStaff && (
        <div className="kv-card">
          <h2 className="kv-card__title">{t.t('listingNew.onBehalfHeading')}</h2>
          {member ? (
            <p>
              {t.t('listingNew.onBehalfChosen', { name: memberName || member })}{' '}
              <Link href="/listings/new" className="kv-link">{t.t('listingNew.onBehalfClear')}</Link>
            </p>
          ) : (
            <>
              <form method="get" role="search">
                <label htmlFor="memberQ" className="kv-field__label">{t.t('listingNew.onBehalfSearch')}</label>
                <input id="memberQ" name="memberQ" type="search" className="kv-input" defaultValue={memberQ} minLength={2} />
                <button type="submit" className="kv-btn kv-btn--muted">{t.t('listingNew.search')}</button>
              </form>
              {memberHits.length > 0 && (
                <ul>
                  {memberHits.map((m) => (
                    <li key={m.userId}>
                      <Link className="kv-link" href={`/listings/new?member=${encodeURIComponent(m.userId)}&memberName=${encodeURIComponent(m.fullName ?? '')}`}>
                        {m.fullName ?? m.userId} <span className="kv-fine">{m.phoneMasked}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {memberQ.length >= 2 && memberHits.length === 0 && <p className="kv-fine">{t.t('listingNew.onBehalfNone')}</p>}
              <p className="kv-fine">{t.t('listingNew.onBehalfConsentNote')}</p>
            </>
          )}
        </div>
      )}

      <form method="get" className="kv-search" role="search">
        <label htmlFor="q" className="kv-field__label">{t.t('listingNew.productSearchLabel')}</label>
        <input id="q" name="q" type="search" className="kv-input" defaultValue={q} placeholder={t.t('listingNew.productSearchPlaceholder')} />
        {member && <input type="hidden" name="member" value={member} />}
        {member && <input type="hidden" name="memberName" value={memberName} />}
        <button type="submit" className="kv-btn kv-btn--muted">{t.t('listingNew.search')}</button>
      </form>

      {loadFailed ? (
        <p className="kv-error" role="alert">{t.t('listingNew.loadError')}</p>
      ) : products.length === 0 ? (
        <p className="kv-empty-state">{t.t('listingNew.noProducts')}</p>
      ) : (
        // method=get is the PREVIEW path (fair-price band; also W2357's preservation for free);
        // the Create button posts the Server Action explicitly.
        <form method="get" className="kv-form">
          <input type="hidden" name="idempotencyKey" value={randomUUID()} />
          {member && <input type="hidden" name="member" value={member} />}
          {member && <input type="hidden" name="memberName" value={memberName} />}

          <label htmlFor="product" className="kv-field__label">{t.t('listingNew.productLabel')}</label>
          <select id="product" name="product" className="kv-select" required defaultValue={d('product')}>
            <option value="" disabled>{t.t('listingNew.selectProduct')}</option>
            {products.map((p) => (
              <option key={p.id} value={encodeProductChoice({ id: p.id, categoryId: p.categoryId, defaultUnit: p.defaultUnit })}>
                {p.name} ({p.defaultUnit})
              </option>
            ))}
          </select>

          <label htmlFor="title" className="kv-field__label">{t.t('listingNew.titleLabel')}</label>
          <input id="title" name="title" className="kv-input" required minLength={3} maxLength={140} defaultValue={d('title')} placeholder={t.t('listingNew.titlePlaceholder')} />

          <label htmlFor="description" className="kv-field__label">{t.t('listingNew.descLabel')}</label>
          <textarea id="description" name="description" className="kv-textarea" rows={3} maxLength={2000} defaultValue={d('description')} />

          <label htmlFor="quantityTotal" className="kv-field__label">{t.t('listingNew.qtyLabel')}</label>
          <input id="quantityTotal" name="quantityTotal" type="number" inputMode="numeric" min={1} step={1} className="kv-input" required defaultValue={d('quantityTotal')} />

          <label htmlFor="minOrderQty" className="kv-field__label">{t.t('listingNew.minQtyLabel')}</label>
          <input id="minOrderQty" name="minOrderQty" type="number" inputMode="numeric" min={1} step={1} className="kv-input" defaultValue={d('minOrderQty')} />

          <label htmlFor="priceMajor" className="kv-field__label">{t.t('listingNew.priceLabel')}</label>
          <input id="priceMajor" name="priceMajor" type="text" inputMode="decimal" pattern="\d{1,12}(\.\d{1,2})?" className="kv-input" required defaultValue={d('priceMajor')} />
          <p className="kv-field__hint">{t.t('listingNew.priceHint')}</p>

          <label htmlFor="harvestDate" className="kv-field__label">{t.t('listingNew.harvestLabel')}</label>
          <input id="harvestDate" name="harvestDate" type="date" className="kv-input" defaultValue={d('harvestDate')} />
          <p className="kv-field__hint">{t.t('listingNew.harvestHint')}</p>

          <label htmlFor="saleType" className="kv-field__label">{t.t('listingNew.saleTypeLabel')}</label>
          <select id="saleType" name="saleType" className="kv-select" defaultValue={d('saleType') || 'direct'}>
            {LISTING_SALE_TYPES.map((s) => <option key={s} value={s}>{t.t(`listingNew.saleType.${s}`)}</option>)}
          </select>

          <label htmlFor="organicClaim" className="kv-field__label">{t.t('listingNew.organicLabel')}</label>
          <select id="organicClaim" name="organicClaim" className="kv-select" defaultValue={d('organicClaim') || 'none'}>
            {LISTING_ORGANIC.map((o) => <option key={o} value={o}>{t.t(`listingNew.organic.${o}`)}</option>)}
          </select>

          <label htmlFor="visibility" className="kv-field__label">{t.t('listingNew.visibilityLabel')}</label>
          <select id="visibility" name="visibility" className="kv-select" defaultValue={d('visibility') || 'tenant'}>
            {LISTING_VISIBILITY.map((v) => <option key={v} value={v}>{t.t(`listingNew.visibility.${v}`)}</option>)}
          </select>

          <label htmlFor="pincode" className="kv-field__label">{t.t('listingNew.pincodeLabel')}</label>
          <input id="pincode" name="pincode" className="kv-input" inputMode="numeric" pattern="\d{6}" defaultValue={pincode} />

          {/* W125's fair-price guide — the peer band, or an honest reason there is none. */}
          <button type="submit" name="preview" value="1" className="kv-btn kv-btn--muted">{t.t('listingNew.checkBand')}</button>
          {guide && (
            <p className="kv-fine" role="note">
              {guide.band
                ? t.t('listingNew.bandRow', {
                    low: formatMoneyMinor(guide.band.lowMinor, 'INR', lang),
                    modal: formatMoneyMinor(guide.band.modalMinor, 'INR', lang),
                    high: formatMoneyMinor(guide.band.highMinor, 'INR', lang),
                    n: String(guide.band.sampleSize),
                  })
                : guide.regionId
                  ? t.t('listingNew.bandNone')
                  : t.t('listingNew.bandNoRegion')}
            </p>
          )}

          <label htmlFor="regionId" className="kv-field__label">{t.t('listingNew.regionLabel')}</label>
          <input id="regionId" name="regionId" className="kv-input" defaultValue={d('regionId')} />

          <span className="kv-field__label">{t.t('listingNew.mediaLabel')}</span>
          {preservedMedia.map((m) => <input key={m} type="hidden" name="mediaIds" value={m} />)}
          {preservedMedia.length > 0 && <p className="kv-fine">{t.t('listingNew.mediaPreserved', { n: String(preservedMedia.length) })}</p>}
          <MediaUploader labels={{
            add: t.t('listingNew.mediaAdd'), hint: t.t('listingNew.mediaHint'),
            uploading: t.t('listingNew.mediaUploading'), failed: t.t('listingNew.mediaFailed'), remove: t.t('listingNew.mediaRemove'),
          }} />

          <div className="kv-form__actions">
            <button type="submit" formAction={createListingAction} className="kv-btn">
              {member ? t.t('listingNew.submitOnBehalf') : t.t('listingNew.submit')}
            </button>
            <Link href="/listings" className="kv-btn--link">{t.t('common.cancel')}</Link>
          </div>
          <p className="kv-fine">{t.t('listingNew.reviewNote')}</p>
        </form>
      )}
    </section>
  );
}
