// apps/web-tenant/src/app/listings/new/page.tsx · create a draft listing. Server-first: requireSession gates it,
// a server-rendered product picker (catalogue.browseProducts, searchable via ?q=) carries productId+categoryId+
// defaultUnit in each <option>, and the form posts to the createListing Server Action. The only client island is
// MediaUploader (sha256 + presigned PUT + confirm). Money is entered in major units and parsed float-free in the
// pure helper. All copy via i18n; degrades if the catalogue read fails; noindex.
import type { Metadata } from 'next';
import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator } from '../../../lib/i18n';
import { MediaUploader } from '../../../components/MediaUploader';
import { createListingAction } from './actions';
import { encodeProductChoice, LISTING_SALE_TYPES, LISTING_ORGANIC, LISTING_VISIBILITY } from '../../../features/listings/form';
import type { ProductCard } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('listingNew.title'), robots: { index: false, follow: false } };
}

export default async function NewListingPage({ searchParams }: { searchParams: { q?: string; error?: string } }) {
  await requireSession('/listings/new');
  const t = getTranslator();
  const q = (searchParams.q ?? '').trim();

  let products: ProductCard[] = []; let loadFailed = false;
  try { products = (await tenantClient().catalogue.browseProducts({ q: q || undefined, limit: 50 })).items; }
  catch (e) { loadFailed = true; console.error('[new-listing] catalogue load failed:', e); }

  const errorKey = searchParams.error;
  const knownErrors = new Set(['errorProduct', 'errorTitle', 'errorQty', 'errorPrice']);
  const errorMsg = errorKey ? (knownErrors.has(errorKey) ? t.t(`listingNew.${errorKey}`) : t.t('listingNew.errorCreate')) : null;

  return (
    <section className="kv-auth">
      <h1>{t.t('listingNew.title')}</h1>
      {errorMsg && <p className="kv-error" role="alert">{errorMsg}</p>}

      <form method="get" className="kv-search" role="search">
        <label htmlFor="q" className="kv-field__label">{t.t('listingNew.productSearchLabel')}</label>
        <input id="q" name="q" type="search" className="kv-input" defaultValue={q} placeholder={t.t('listingNew.productSearchPlaceholder')} />
        <button type="submit" className="kv-btn kv-btn--muted">{t.t('listingNew.search')}</button>
      </form>

      {loadFailed ? (
        <p className="kv-error" role="alert">{t.t('listingNew.loadError')}</p>
      ) : products.length === 0 ? (
        <p className="kv-empty-state">{t.t('listingNew.noProducts')}</p>
      ) : (
        <form action={createListingAction} className="kv-form">
          <input type="hidden" name="idempotencyKey" value={randomUUID()} />

          <label htmlFor="product" className="kv-field__label">{t.t('listingNew.productLabel')}</label>
          <select id="product" name="product" className="kv-select" required defaultValue="">
            <option value="" disabled>{t.t('listingNew.selectProduct')}</option>
            {products.map((p) => (
              <option key={p.id} value={encodeProductChoice({ id: p.id, categoryId: p.categoryId, defaultUnit: p.defaultUnit })}>
                {p.name} ({p.defaultUnit})
              </option>
            ))}
          </select>

          <label htmlFor="title" className="kv-field__label">{t.t('listingNew.titleLabel')}</label>
          <input id="title" name="title" className="kv-input" required minLength={3} maxLength={140} placeholder={t.t('listingNew.titlePlaceholder')} />

          <label htmlFor="description" className="kv-field__label">{t.t('listingNew.descLabel')}</label>
          <textarea id="description" name="description" className="kv-textarea" rows={3} maxLength={2000} />

          <label htmlFor="quantityTotal" className="kv-field__label">{t.t('listingNew.qtyLabel')}</label>
          <input id="quantityTotal" name="quantityTotal" type="number" inputMode="numeric" min={1} step={1} className="kv-input" required />

          <label htmlFor="minOrderQty" className="kv-field__label">{t.t('listingNew.minQtyLabel')}</label>
          <input id="minOrderQty" name="minOrderQty" type="number" inputMode="numeric" min={1} step={1} className="kv-input" />

          <label htmlFor="priceMajor" className="kv-field__label">{t.t('listingNew.priceLabel')}</label>
          <input id="priceMajor" name="priceMajor" type="text" inputMode="decimal" pattern="\d{1,12}(\.\d{1,2})?" className="kv-input" required />
          <p className="kv-field__hint">{t.t('listingNew.priceHint')}</p>

          <label htmlFor="saleType" className="kv-field__label">{t.t('listingNew.saleTypeLabel')}</label>
          <select id="saleType" name="saleType" className="kv-select" defaultValue="direct">
            {LISTING_SALE_TYPES.map((s) => <option key={s} value={s}>{t.t(`listingNew.saleType.${s}`)}</option>)}
          </select>

          <label htmlFor="organicClaim" className="kv-field__label">{t.t('listingNew.organicLabel')}</label>
          <select id="organicClaim" name="organicClaim" className="kv-select" defaultValue="none">
            {LISTING_ORGANIC.map((o) => <option key={o} value={o}>{t.t(`listingNew.organic.${o}`)}</option>)}
          </select>

          <label htmlFor="visibility" className="kv-field__label">{t.t('listingNew.visibilityLabel')}</label>
          <select id="visibility" name="visibility" className="kv-select" defaultValue="tenant">
            {LISTING_VISIBILITY.map((v) => <option key={v} value={v}>{t.t(`listingNew.visibility.${v}`)}</option>)}
          </select>

          <label htmlFor="pincode" className="kv-field__label">{t.t('listingNew.pincodeLabel')}</label>
          <input id="pincode" name="pincode" className="kv-input" inputMode="numeric" pattern="\d{6}" />

          <label htmlFor="regionId" className="kv-field__label">{t.t('listingNew.regionLabel')}</label>
          <input id="regionId" name="regionId" className="kv-input" />

          <span className="kv-field__label">{t.t('listingNew.mediaLabel')}</span>
          <MediaUploader labels={{
            add: t.t('listingNew.mediaAdd'), hint: t.t('listingNew.mediaHint'),
            uploading: t.t('listingNew.mediaUploading'), failed: t.t('listingNew.mediaFailed'), remove: t.t('listingNew.mediaRemove'),
          }} />

          <div className="kv-form__actions">
            <button type="submit" className="kv-btn">{t.t('listingNew.submit')}</button>
            <Link href="/listings" className="kv-btn--link">{t.t('common.cancel')}</Link>
          </div>
        </form>
      )}
    </section>
  );
}
