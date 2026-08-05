// apps/web-gov/src/app/registers/page.tsx · GW-3 regulator registers (READ-ONLY): the IRDAI insurance partner/
// product registry and the lending partner/loan-product registry — the regulated-vertical reads a gov token can
// hold. Sections degrade independently. HONEST EXPORT NOTE: audit-stamped export files need a main-api export
// service (PC-54 `gov-report-exports`) — no fake download buttons here; the on-screen registers ARE the read.
import type { Metadata } from 'next';
import { requireSession } from '../../lib/session';
import { govClient } from '../../lib/api-client';
import { DataTable } from '../../components/DataTable';
import { getTranslator } from '../../lib/i18n';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('reg.title'), robots: { index: false, follow: false } };
}

interface Row { id: string; name?: string | null; defaultName?: string | null; irdaiRegNo?: string | null; productType?: string | null; coverageKind?: string | null; isActive?: boolean }

export default async function RegistersPage() {
  await requireSession('/registers');
  const t = getTranslator();
  const c = govClient();
  const get = async (path: string) => { try { return (await c.request<Row[]>('GET', path)).data; } catch { return null; } };
  const [insPartners, insProducts, finPartners, loanProducts] = await Promise.all([
    get('insurance/partners'), get('insurance/products'), get('fintech/partners'), get('fintech/loan-products'),
  ]);

  const table = (rows: Row[] | null, emptyKey: string, extra?: (r: Row) => string) => rows === null
    ? <p className="kv-error" role="alert">{t.t('reg.loadError')}</p>
    : <DataTable rows={rows} empty={t.t(emptyKey)} columns={[
        { header: t.t('reg.colName'), cell: (r: Row) => r.name ?? r.defaultName ?? r.id.slice(0, 8) },
        { header: t.t('reg.colDetail'), cell: (r: Row) => (extra ? extra(r) : t.t('common.dash')) },
        { header: t.t('reg.colActive'), cell: (r: Row) => (r.isActive === false ? t.t('common.dash') : t.t('reg.activeYes')) },
      ]} />;

  return (
    <section>
      <h1>{t.t('reg.title')}</h1>
      <p className="kv-field__hint">{t.t('reg.hint')}</p>
      <h2>{t.t('reg.insPartners')}</h2>
      {table(insPartners, 'reg.empty', (r) => r.irdaiRegNo ?? t.t('common.dash'))}
      <h2>{t.t('reg.insProducts')}</h2>
      {table(insProducts, 'reg.empty', (r) => r.productType ?? r.coverageKind ?? t.t('common.dash'))}
      <h2>{t.t('reg.finPartners')}</h2>
      {table(finPartners, 'reg.empty')}
      <h2>{t.t('reg.loanProducts')}</h2>
      {table(loanProducts, 'reg.empty')}
      <p className="kv-field__hint kv-note">{t.t('reg.exportNote')}</p>
    </section>
  );
}
