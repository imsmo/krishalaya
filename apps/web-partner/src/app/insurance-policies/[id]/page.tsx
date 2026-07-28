// apps/web-partner/src/app/insurance-policies/[id]/page.tsx · policy detail (KV-BL-056, DEV-24; canon W255-264,
// screen 286's policy-detail shape referenced for the insurer view). READ-ONLY: no cancel/activate action here —
// those are the HOLDER's own `insurance.enrol` actions, not exposed to this console. Server-gated; the API scopes
// the read to this tenant (404 if not found -> notFound). Links out to the claims queue filtered to this policy
// (the one place a policyId context filter is legitimately set — never a free-text user input). Money via
// formatMoneyMinor (Law 2). All copy via i18n; no inline styles; noindex.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePartner } from '../../../lib/session';
import { partnerClient } from '../../../lib/api-client';
import { getTranslator } from '../../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishi-verse/i18n';
import { SdkError } from '@krishi-verse/sdk-js';
import { policyStatusKey, policyStatusTone, isOnCover, claimsHref, type PolicyRow } from '../../../features/insurance/insurance';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('policy.detailTitle'), robots: { index: false, follow: false } };
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="kv-facts__row"><dt>{label}</dt><dd>{value}</dd></div>;
}

export default async function InsurancePolicyPage({ params }: { params: { id: string } }) {
  await requirePartner();
  const t = getTranslator();

  let p: PolicyRow | undefined;
  let notice: string | undefined;
  try {
    p = (await partnerClient().request<PolicyRow>('GET', `insurance/policies/${params.id}`)).data;
  } catch (e) {
    if (e instanceof SdkError && e.status === 404) notFound();
    notice = t.t('dash.unavailable');
  }

  if (!p) {
    return <section><p className="kv-backlink"><Link href="/insurance-policies">{t.t('policy.back')}</Link></p><p className="kv-error" role="alert">{notice}</p></section>;
  }

  return (
    <section>
      <p className="kv-backlink"><Link href="/insurance-policies">{t.t('policy.back')}</Link></p>
      <h1>{t.t('policy.detailTitle')} {p.policyNo ?? p.id.slice(0, 8) + '…'}</h1>
      <p><span className={`kv-status kv-status--${policyStatusTone(p.status)}`}>{t.t(policyStatusKey(p.status))}</span></p>

      <dl className="kv-facts">
        <Field label={t.t('policy.subject')} value={t.t(`policy.subject.${p.subjectType}`)} />
        <Field label={t.t('policy.sumInsured')} value={formatMoneyMinor(p.sumInsuredMinor, 'INR', 'en')} />
        <Field label={t.t('policy.premium')} value={formatMoneyMinor(p.premiumMinor, 'INR', 'en')} />
        <Field label={t.t('policy.validFrom')} value={formatDate(p.validFrom, 'en')} />
        <Field label={t.t('policy.validUntil')} value={formatDate(p.validUntil, 'en')} />
        <Field label={t.t('policy.onCover')} value={t.t(isOnCover(p.status) ? 'common.yes' : 'common.no')} />
        <Field label={t.t('policy.created')} value={p.createdAt ? formatDate(p.createdAt, 'en') : t.t('common.dash')} />
      </dl>

      <p className="kv-actions">
        <Link className="kv-btn" href={claimsHref(undefined, undefined, p.id)}>{t.t('policy.viewClaims')}</Link>
      </p>
    </section>
  );
}
