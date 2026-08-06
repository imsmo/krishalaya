// apps/web-partner/src/app/consents/page.tsx · the partner's OWN consent registry (PC-2C, DPDP). privacy
// consents are caller-scoped and APPEND-ONLY server-side (setConsent writes a new record — history is never
// mutated). Toggle = one Idempotency-Keyed action per purpose.
import type { Metadata } from 'next';
import { requirePartner } from '../../lib/session';
import { partnerClient } from '../../lib/api-client';
import { DataTable } from '../../components/DataTable';
import { getTranslator } from '../../lib/i18n';
import { setConsentAction } from '../notifications/actions';
import type { ConsentRecord } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('consents.title'), robots: { index: false, follow: false } };
}

export default async function ConsentsPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  await requirePartner();
  const t = getTranslator();

  let consents: ConsentRecord[] = []; let failed = false;
  try { consents = await partnerClient().privacy.listConsents(); } catch { failed = true; }

  return (
    <section>
      <h1>{t.t('consents.title')}</h1>
      <p className="kv-field__hint">{t.t('consents.hint')}</p>
      {searchParams.ok && <p className="kv-success" role="status">{t.t('consents.ok')}</p>}
      {searchParams.error && <p className="kv-error" role="alert">{t.t('consents.errorMsg')}</p>}

      {failed ? <p className="kv-error" role="alert">{t.t('consents.loadError')}</p> : (
        <DataTable
          rows={consents}
          empty={t.t('consents.empty')}
          columns={[
            { header: t.t('consents.colPurpose'), cell: (c) => <span className="kv-mono">{c.purposeCode}</span> },
            { header: t.t('consents.colStatus'), cell: (c) => <span className="kv-badge">{c.granted ? t.t('consents.granted') : t.t('consents.withdrawn')}</span> },
            {
              header: t.t('consents.colActions'),
              cell: (c) => (
                <form action={setConsentAction} className="kv-inline-form">
                  <input type="hidden" name="purposeCode" value={c.purposeCode} />
                  <input type="hidden" name="granted" value={c.granted ? '0' : '1'} />
                  <button type="submit" className="kv-btn--link">{c.granted ? t.t('consents.withdraw') : t.t('consents.grant')}</button>
                </form>
              ),
            },
          ]}
        />
      )}
      <p className="kv-field__hint kv-note">{t.t('consents.appendNote')}</p>
    </section>
  );
}
