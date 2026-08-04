// apps/web-partner/src/app/insurance-products/page.tsx · READ-ONLY insurance catalogue (PC-2A): the IRDAI
// partner registry + the products they underwrite (GET insurance/partners + insurance/products — the API has no
// product-authoring endpoints; products are seeded/registered platform-side, so this page honestly shows the
// catalogue and nothing pretends to edit it). requirePartner-gated; sections degrade independently (Law 12).
import type { Metadata } from 'next';
import { requirePartner } from '../../lib/partner-auth';
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
