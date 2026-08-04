// apps/web-partner/src/app/fleet/carriers/[id]/page.tsx · carrier detail + edit + active toggle (GET
// logistics/partners/:id; 404 → notFound). PATCH :id edits name/providerCode/cold-chain; POST :id/active toggles.
// Degrade-never-die. All copy via i18n; no inline styles; noindex.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePartner } from '../../../../lib/session';
import { partnerClient } from '../../../../lib/api-client';
import { getTranslator } from '../../../../lib/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import { partnerKindKey, type PartnerRow } from '../../../../features/logistics/fleet';
import { updatePartnerAction, setPartnerActiveAction } from '../../actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('fleet.carrierDetailTitle'), robots: { index: false, follow: false } };
}

const OK = new Set(['created', 'updated', 'activated', 'deactivated']);
const ERR = new Set(['name', 'providerCode', 'noChange', 'forbidden', 'conflict', 'notFound', 'generic']);

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="kv-facts__row"><dt>{label}</dt><dd>{value}</dd></div>;
}

export default async function CarrierDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  await requirePartner();
  const t = getTranslator();

  let p: PartnerRow | undefined;
  let notice: string | undefined;
  try {
    p = (await partnerClient().request<PartnerRow>('GET', `logistics/partners/${params.id}`)).data;
  } catch (e) {
    if (e instanceof SdkError && e.status === 404) notFound();
    notice = t.t('dash.unavailable');
  }

  if (!p) {
    return <section><p className="kv-backlink"><Link href="/fleet">{t.t('fleet.back')}</Link></p><p className="kv-error" role="alert">{notice}</p></section>;
  }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;

  return (
    <section>
      <p className="kv-backlink"><Link href="/fleet">{t.t('fleet.back')}</Link></p>
      <h1>{p.defaultName}</h1>
      <p><span className={`kv-status kv-status--${p.isActive ? 'ok' : 'muted'}`}>{t.t(p.isActive ? 'common.active' : 'common.inactive')}</span></p>
      {okKey && <p className="kv-success" role="status">{t.t(`fleet.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`fleet.err.${errKey}`)}</p>}

      <dl className="kv-facts">
        <Field label={t.t('fleet.kind')} value={t.t(partnerKindKey(p.partnerKind))} />
        <Field label={t.t('fleet.providerCode')} value={p.providerCode ?? t.t('common.dash')} />
        <Field label={t.t('fleet.coldChain')} value={t.t(p.supportsColdChain ? 'common.yes' : 'common.no')} />
      </dl>

      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('fleet.editCarrier')}</summary>
        <form action={updatePartnerAction} className="kv-form">
          <input type="hidden" name="id" value={p.id} />
          <label className="kv-field__label">{t.t('fleet.name')}</label>
          <input name="defaultName" className="kv-input" maxLength={150} defaultValue={p.defaultName} />
          <label className="kv-field__label">{t.t('fleet.providerCode')}</label>
          <input name="providerCode" className="kv-input" defaultValue={p.providerCode ?? ''} placeholder={t.t('fleet.providerHint')} />
          <label className="kv-field__label"><input type="checkbox" name="supportsColdChain" value="true" defaultChecked={p.supportsColdChain} /> {t.t('fleet.coldChainField')}</label>
          <button type="submit" className="kv-btn">{t.t('fleet.save')}</button>
        </form>
      </details>

      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('fleet.activeTitle')}</summary>
        <form action={setPartnerActiveAction} className="kv-inline-form">
          <input type="hidden" name="id" value={p.id} />
          <input type="hidden" name="isActive" value={p.isActive ? 'false' : 'true'} />
          <button type="submit" className={`kv-btn${p.isActive ? ' kv-btn--danger' : ''}`}>{t.t(p.isActive ? 'fleet.deactivate' : 'fleet.activate')}</button>
        </form>
      </details>
    </section>
  );
}
