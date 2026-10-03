// apps/web-tenant/src/app/settings/branding/publish/page.tsx · "Publish" — the mutate chain W2797 confirm · W2798 success · W2799 failure
// · PC-56 TENANT-13d. Also the ROLLBACK ("reversible with history"): the same chain, `kind=rollback&version=N`.
//   • confirm: what will be published (the draft as it stands, or history version N), the three checks AS BUILT — contrast (every pair
//     with its ratio, from the API's own console), the logo (clean upload), a second administrator — and the reason. Blocking checks
//     are printed before anything is pressed; the API judges again;
//   • success: the proposal is waiting for a DIFFERENT administrator; nothing members see has changed yet;
//   • failure: every refusal by name — a contrast failure names the pair and its ratio ("primary on surface 4.4:1").
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { BrandConsole, BrandHistoryEntry } from '@krishalaya/sdk-js';
import { formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getLang, getTranslator } from '../../../../lib/i18n';
import { mutateStep, mutateStepKey } from '../../../../features/mutate/chain';
import { BRANDING_HREF, BRAND_PUBLISH_HREF, brandProposalHref, brandRefusalKey, pageState, parseCodes } from '../../../../features/branding/branding';
import { proposePublishAction } from '../actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('br.pub.title'), robots: { index: false, follow: false } };
}

export default async function PublishPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  await requireSession(BRAND_PUBLISH_HREF);
  const t = getTranslator();
  const lang = getLang();
  const step = mutateStep(searchParams.step);
  const kind = searchParams.kind === 'rollback' ? 'rollback' : 'publish';
  const version = Number(searchParams.version ?? 0) | 0;
  const failed = parseCodes(searchParams.error);
  const contrast = (searchParams.contrast ?? '').split(',').map((x) => x.split(':')).filter((x) => x.length === 3 && /^[a-z_]{3,40}$/.test(x[0]))
    .map(([pair, n, one]) => ({ pair, display: `${n}:${one}` }));
  let c: BrandConsole | null = null; let target: BrandHistoryEntry | null = null; let state: string | null = null;
  try {
    c = await tenantClient().branding.console();
    if (kind === 'rollback') target = (await tenantClient().branding.history({ limit: 100 })).items.find((h) => h.version === version) ?? null;
  } catch (e) { const err = e instanceof SdkError ? e : null; state = pageState(err?.code, err?.status); }
  const values = kind === 'rollback' ? target?.values ?? null : c?.draft.values ?? null;

  return (
    <section>
      <nav aria-label={t.t('br.breadcrumb.label')} className="kv-field__hint">{t.t('br.breadcrumb.settings')} › <Link href={BRANDING_HREF} className="kv-btn--link">{t.t('br.title')}</Link> › {t.t(kind === 'rollback' ? 'br.pub.rollbackTitle' : 'br.pub.title')}</nav>
      <h1>{t.t(kind === 'rollback' ? 'br.pub.rollbackTitle' : 'br.pub.title')}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))} · {t.t('br.pub.module')}</p>
      {state && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert">
          <strong>{t.t(`br.state.${state}.title`)}</strong><p>{t.t(`br.state.${state}.body`)}</p>
          <p><Link href={BRANDING_HREF} className="kv-btn--link">{t.t('br.form.backToScreen')}</Link></p>
        </div>
      )}

      {step === 'confirm' && c && values && (
        <div className="kv-card">
          <p>{t.t(kind === 'rollback' ? 'br.pub.rollbackLede' : 'br.pub.lede', { v: formatNumber(kind === 'rollback' ? version : (c.published?.version ?? 0) + 1, lang) })}</p>
          <dl className="kv-facts">
            <div className="kv-facts__row"><dt>{t.t('br.field.displayName')}</dt><dd>{values.displayName}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('br.field.appShortName')}</dt><dd>{values.appShortName}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('br.pub.colours')}</dt><dd><code>{values.colours.primary}</code> · <code>{values.colours.accent}</code> · <code>{values.colours.ink}</code> · <code>{values.colours.surface}</code></dd></div>
            <div className="kv-facts__row"><dt>{t.t('br.field.poweredByHidden')}</dt><dd>{t.t(values.poweredByHidden ? 'br.pub.markHidden' : 'br.pub.markShown')}</dd></div>
          </dl>
          <h2>{t.t('br.pub.checks')}</h2>
          <ul className="kv-list">
            {kind === 'publish' && c.draft.contrast.pairs.map((p) => (
              <li key={p.code}>{p.aa ? '✓' : '✗'} {t.t(`br.pair.${p.code}`)} = {p.display} · {t.t(p.aa ? 'br.contrast.aaPass' : 'br.contrast.aaFail')} · {t.t(p.aaa ? 'br.contrast.aaaPass' : 'br.contrast.aaaNeeds')}</li>
            ))}
            {kind === 'publish' && <li>{c.draft.logo.state === 'clean' ? '✓' : '✗'} {t.t(`br.logo.state.${c.draft.logo.state}`)}</li>}
            <li>{c.admins.count >= 2 ? '✓' : '✗'} {t.t('br.publish.step2', { n: formatNumber(c.admins.count, lang) })}</li>
          </ul>
          {kind === 'publish' && c.draft.publishChecks.length > 0 && (
            <ul className="kv-list kv-error" role="alert">{c.draft.publishChecks.map((r, i) => <li key={`${r.code}${i}`}>{t.t(brandRefusalKey(r.code))}{r.code === 'BRAND_CONTRAST_FAILED' && r.detail ? ` — ${t.t(`br.pair.${String(r.detail.pair)}`)} ${String(r.detail.display)}` : ''}</li>)}</ul>
          )}
          <form action={proposePublishAction} className="kv-form">
            <input type="hidden" name="kind" value={kind} /><input type="hidden" name="version" value={String(version)} /><input type="hidden" name="idempotencyKey" value={randomUUID()} />
            <label className="kv-field" htmlFor="br-pub-reason"><span>{t.t('br.pub.reason')}</span>
              <textarea id="br-pub-reason" name="reason" className="kv-textarea" rows={2} minLength={20} maxLength={500} required defaultValue={searchParams.reason ?? ''} /></label>
            <p className="kv-field__hint">{t.t('br.pub.audit')}</p>
            <button type="submit" className="kv-btn kv-btn--primary">{t.t('br.pub.proceed')}</button>{' '}
            <Link href={BRANDING_HREF} className="kv-btn--link">{t.t('br.pub.cancel')}</Link>
          </form>
        </div>
      )}
      {step === 'confirm' && kind === 'rollback' && c && !target && !state && <p className="kv-card kv-card--notice">{t.t('br.refusal.BRAND_VERSION_NOT_FOUND')}</p>}

      {step === 'success' && (
        <div className="kv-card kv-success" role="status">
          <strong>{t.t('br.pub.success.title')}</strong>
          <p>{t.t('br.pub.success.body')}</p>
          <p>{searchParams.proposal && <Link href={brandProposalHref(searchParams.proposal, 'confirm')} className="kv-btn--link">{t.t('br.pub.success.proposal')}</Link>}{' · '}
            <Link href={BRANDING_HREF} className="kv-btn--link">{t.t('br.form.backToScreen')}</Link></p>
        </div>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <strong>{t.t('br.form.failure.title')}</strong>
          <ul className="kv-list">{(failed.length ? failed : ['unknown']).map((code) => <li key={code}>{t.t(brandRefusalKey(code))}</li>)}</ul>
          {contrast.length > 0 && <ul className="kv-list">{contrast.map((f) => <li key={f.pair}>{t.t('br.pub.failPair', { pair: t.t(`br.pair.${f.pair}`), ratio: f.display })}</li>)}</ul>}
          <p>{t.t('br.form.failure.untouched')}</p>
          <p><Link href={`${BRAND_PUBLISH_HREF}?${new URLSearchParams({ step: 'confirm', kind, ...(kind === 'rollback' ? { version: String(version) } : {}), ...(searchParams.reason ? { reason: searchParams.reason } : {}) }).toString()}`} className="kv-btn--link">{t.t('br.pub.retry')}</Link>{' · '}
            <Link href={BRANDING_HREF} className="kv-btn--link">{t.t('br.form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
