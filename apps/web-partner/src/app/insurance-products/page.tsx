// apps/web-partner/src/app/insurance-products/page.tsx · the insurance CATALOGUE (PC-2A): the IRDAI partner
// registry + the products they underwrite (GET insurance/partners + insurance/products). requirePartner-gated;
// sections degrade independently (Law 12).
//
// PC-55 B7: this header used to say the API had no product-authoring endpoints. W54-9 shipped them, so that claim
// had become false — authoring (publish a product, issue a policy, read the book and the loss ratio) now lives on
// /insurance-book, and this page links there instead of implying nothing can be edited anywhere.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePartner } from '../../lib/session';
import { partnerClient } from '../../lib/api-client';
import { DataTable } from '../../components/DataTable';
import { getTranslator } from '../../lib/i18n';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('insProducts.title'), robots: { index: false, follow: false } };
}

interface IrdaiPartner { id: string; name?: string | null; defaultName?: string | null; irdaiRegNo?: string | null; isActive?: boolean }
interface InsProduct { id: string; name?: string | null; defaultName?: string | null; partnerId?: string | null; productType?: string | null; coverageKind?: string | null; isActive?: boolean }

export default async function InsuranceProductsPage() {
  await requirePartner();
  const t = getTranslator();

  let partners: IrdaiPartner[] = []; let partnersFailed = false;
  try { partners = (await partnerClient().request<IrdaiPartner[]>('GET', 'insurance/partners')).data; }
  catch { partnersFailed = true; }

  let products: InsProduct[] = []; let productsFailed = false;
  try { products = (await partnerClient().request<InsProduct[]>('GET', 'insurance/products')).data; }
  catch { productsFailed = true; }

  const partnerName = (id?: string | null) => {
    if (!id) return t.t('common.dash');
    const p = partners.find((x) => x.id === id);
    return p?.name ?? p?.defaultName ?? `${id.slice(0, 8)}…`;
  };

  return (
    <section>
      <h1>{t.t('insProducts.title')}</h1>
      <p className="kv-field__hint"><Link href="/insurance-book" className="kv-link">{t.t('insProducts.authoringLink')}</Link></p>
      <p className="kv-field__hint">{t.t('insProducts.hint')}</p>

      <h2>{t.t('insProducts.products')}</h2>
      {productsFailed ? <p className="kv-error" role="alert">{t.t('insProducts.loadError')}</p> : (
        <DataTable
          rows={products}
          empty={t.t('insProducts.productsEmpty')}
          columns={[
            { header: t.t('insProducts.colProduct'), cell: (x) => x.name ?? x.defaultName ?? x.id.slice(0, 8) },
            { header: t.t('insProducts.colType'), cell: (x) => x.productType ?? x.coverageKind ?? t.t('common.dash') },
            { header: t.t('insProducts.colPartner'), cell: (x) => partnerName(x.partnerId) },
            { header: t.t('insProducts.colActive'), cell: (x) => (x.isActive === false ? t.t('common.dash') : t.t('insProducts.activeYes')) },
          ]}
        />
      )}

      <h2>{t.t('insProducts.partners')}</h2>
      {partnersFailed ? <p className="kv-error" role="alert">{t.t('insProducts.loadError')}</p> : (
        <DataTable
          rows={partners}
          empty={t.t('insProducts.partnersEmpty')}
          columns={[
            { header: t.t('insProducts.colPartner'), cell: (x) => x.name ?? x.defaultName ?? x.id.slice(0, 8) },
            { header: t.t('insProducts.colIrdai'), cell: (x) => x.irdaiRegNo ?? t.t('common.dash') },
            { header: t.t('insProducts.colActive'), cell: (x) => (x.isActive === false ? t.t('common.dash') : t.t('insProducts.activeYes')) },
          ]}
        />
      )}

      <p className="kv-field__hint kv-note">{t.t('insProducts.authoringNote')}</p>
    </section>
  );
}
