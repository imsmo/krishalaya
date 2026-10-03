// apps/web-tenant/src/app/settings/branding/domains/new/page.tsx · "Add custom domain" — the form chain W2591 form-error · W2592 review ·
// W2593 success · W2594 failure · PC-56 TENANT-13d.
//   • edit → review: the API's review decides — the PLAN first (custom_domain), then the hostname, the reserved rule (the database's one
//     function), "already yours", "already proven by another organisation" — and prints the EXACT CNAME + TXT records to add;
//   • success: the records again (with this claim's own token) + "we check every 5 minutes" + "unproven after 7 days it is released";
//   • failure: every refusal by name; Retry goes back to the review with the values intact.
// The domain is not a secret, so values ride the URL (the canon's "values you entered are preserved").
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { DomainAddReview, TenantDomainView } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { getTranslator } from '../../../../../lib/i18n';
import { chainStep, chainStepKey, chainHref } from '../../../../../features/forms/chain';
import { DOMAINS_HREF, DOMAIN_NEW_HREF, PLANS_HREF, domainRefusalKey, failureCodesFrom, isUuid, parseCodes } from '../../../../../features/branding/branding';
import { addDomainAction } from '../actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('dom.new.title'), robots: { index: false, follow: false } };
}

export default async function AddDomainPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  await requireSession(DOMAIN_NEW_HREF);
  const t = getTranslator();
  const step = chainStep(searchParams.step);
  const domain = (searchParams.domain ?? '').slice(0, 255);
  const reason = (searchParams.reason ?? '').slice(0, 500);
  let review: DomainAddReview | null = null; let reviewCodes: string[] = [];
  if (step === 'review') {
    try { review = await tenantClient().domains.preview({ domain, reason }); }
    catch (e) { const err = e instanceof SdkError ? e : null; reviewCodes = err ? failureCodesFrom(err.code, err.status, err.details) : ['unknown']; }
  }
  let added: TenantDomainView | null = null;
  if (step === 'success' && isUuid(searchParams.id)) {
    try { added = (await tenantClient().domains.list({ limit: 100 })).items.find((d) => d.id === searchParams.id) ?? null; } catch { added = null; }
  }
  const failed = parseCodes(searchParams.error);
  const general = (review?.refusals ?? []).filter((r) => r.field === null);
  const fieldRefusals = (f: string) => (review?.refusals ?? []).filter((r) => r.field === f);

  return (
    <section>
      <nav aria-label={t.t('br.breadcrumb.label')} className="kv-field__hint">{t.t('br.breadcrumb.settings')} › <Link href={DOMAINS_HREF} className="kv-btn--link">{t.t('dom.title')}</Link> › {t.t('dom.new.title')}</nav>
      <h1>{t.t('dom.new.title')}</h1>
      <p className="kv-field__hint">{t.t(chainStepKey(step, (review?.refusals.length ?? 0) > 0))} · {t.t('dom.new.module')}</p>

      {step === 'edit' && (
        <form method="get" action={DOMAIN_NEW_HREF} className="kv-form">
          <input type="hidden" name="step" value="review" />
          <label className="kv-field" htmlFor="dom-domain"><span>{t.t('dom.new.domain')}</span>
            <input id="dom-domain" name="domain" className="kv-input" required maxLength={255} defaultValue={domain} placeholder="mandi.example.in" /></label>
          <label className="kv-field" htmlFor="dom-reason"><span>{t.t('dom.new.reason')}</span>
            <input id="dom-reason" name="reason" className="kv-input" required minLength={5} maxLength={500} defaultValue={reason} /></label>
          <button type="submit" className="kv-btn kv-btn--primary">{t.t('dom.new.review')}</button>{' '}
          <Link href={DOMAINS_HREF} className="kv-btn--link">{t.t('dom.backToScreen')}</Link>
        </form>
      )}

      {step === 'review' && (
        <div className="kv-card">
          {reviewCodes.map((c) => <p key={c} className="kv-error" role="alert">{t.t(domainRefusalKey(c))}</p>)}
          {general.map((r, i) => <p key={`${r.code}${i}`} className="kv-error" role="alert">{t.t(domainRefusalKey(r.code))}{r.code === 'PLAN_FEATURE_REQUIRED' ? <> · <Link href={PLANS_HREF} className="kv-btn--link">{t.t('dom.viewPlans')}</Link></> : null}</p>)}
          {review && (
            <>
              <dl className="kv-facts">
                <div className="kv-facts__row"><dt>{t.t('dom.new.domain')}</dt><dd><code>{review.domain ?? domain}</code>{fieldRefusals('domain').map((r) => <span key={r.code} className="kv-error" role="alert"><br />{t.t(domainRefusalKey(r.code))}{r.detail?.problem ? ` (${String(r.detail.problem)})` : ''}</span>)}</dd></div>
                <div className="kv-facts__row"><dt>{t.t('dom.new.reason')}</dt><dd>{reason}{fieldRefusals('reason').map((r) => <span key={r.code} className="kv-error" role="alert"><br />{t.t(domainRefusalKey(r.code))}</span>)}</dd></div>
              </dl>
              {review.records.length > 0 && (
                <>
                  <p>{t.t('dom.new.recordsLede')}</p>
                  <ul className="kv-list">{review.records.map((r) => <li key={r.type}><code>{r.type}</code> <code>{r.name}</code> → <code>{r.type === 'TXT' ? t.t('dom.new.tokenOnAdd') : r.value}</code></li>)}</ul>
                </>
              )}
              <p className="kv-field__hint">{t.t('dom.new.window', { days: String(review.claimWindowDays) })} · {review.tls.note}</p>
              {review.ready && (
                <form action={addDomainAction} className="kv-form">
                  <input type="hidden" name="domain" value={domain} /><input type="hidden" name="reason" value={reason} /><input type="hidden" name="idempotencyKey" value={randomUUID()} />
                  <button type="submit" className="kv-btn kv-btn--primary">{t.t('dom.new.submit')}</button>
                </form>
              )}
            </>
          )}
          <p><Link href={chainHref(DOMAIN_NEW_HREF, 'edit', { domain, reason })} className="kv-btn--link">{t.t('dom.new.backToEdit')}</Link></p>
        </div>
      )}

      {step === 'success' && (
        <div className="kv-card kv-success" role="status">
          <strong>{t.t('dom.new.success.title')}</strong>
          {added && (
            <>
              <p>{t.t('dom.new.success.records', { domain: added.domain })}</p>
              <ul className="kv-list">{added.verification.records.map((r) => <li key={r.type}><code>{r.type}</code> <code>{r.name}</code> → <code>{r.value}</code></li>)}</ul>
            </>
          )}
          <p>{t.t('dom.new.success.checks')}</p>
          <p className="kv-field__hint">{t.t('dom.new.success.audit')}</p>
          <p><Link href={DOMAINS_HREF} className="kv-btn kv-btn--primary">{t.t('dom.backToScreen')}</Link>{added && <>{' · '}<Link href={`/auditor?entityType=tenant_domain&entityId=${encodeURIComponent(added.id)}`} className="kv-btn--link">{t.t('br.form.viewAudit')}</Link></>}</p>
        </div>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <strong>{t.t('br.form.failure.title')}</strong>
          <ul className="kv-list">{(failed.length ? failed : ['unknown']).map((c) => <li key={c}>{t.t(domainRefusalKey(c))}</li>)}</ul>
          <p>{t.t('br.form.failure.untouched')}</p>
          <p><Link href={chainHref(DOMAIN_NEW_HREF, 'review', { domain, reason })} className="kv-btn--link">{t.t('br.pub.retry')}</Link>{' · '}<Link href={DOMAINS_HREF} className="kv-btn--link">{t.t('dom.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
