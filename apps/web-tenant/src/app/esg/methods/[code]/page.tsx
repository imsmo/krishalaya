// apps/web-tenant/src/app/esg/methods/[code]/page.tsx · ONE METRIC'S METHOD PAGE · PC-56 TENANT-9d.
//
// W423's Method and Source cells link to `#method-kv-esg-m2` and twelve `#source-…` anchors — ids its own file does not
// contain (F-16). Each metric has a real page here: for a PUBLISHED method its reference, version, date, the method itself
// (platform words, en/hi/gu), the declared source tables, the freshness rule and what it reads right now; for an unpublished
// one, the refusal and the fact it would need. A method is a PLATFORM record — no tenant edits it (the canon's "editing
// method definitions needs the tenant compliance role" refused by name: no such role, and no tenant write on the registry).
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SdkError } from '@krishalaya/sdk-js';
import type { EsgClock, EsgRow } from '@krishalaya/sdk-js';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getLang, getTranslator } from '../../../../lib/i18n';
import { env } from '../../../../lib/env';
import { ESG_HREF, byNameKey, civilLabel, esgState, factLines, methodHref, noValueKey, pick, pillarKey, valueShown, verdictKey } from '../../../../features/esg/esg';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('esg.methodPage.title'), robots: { index: false, follow: false } };
}

export default async function EsgMethodPage({ params }: { params: { code: string } }) {
  if (!env.featureEsg) notFound();
  await requireSession(methodHref(params.code));
  const t = getTranslator();
  const lang = getLang();
  const fmt = (n: number) => formatNumber(n, lang);

  let row: EsgRow | null = null; let clock: EsgClock | null = null; let state: string | null = null;
  try { const r = await tenantClient().esg.method(params.code); row = r.row; clock = r.clock; }
  catch (e) { const err = e instanceof SdkError ? e : null; state = esgState(err?.code, err?.status); }

  return (
    <section>
      <nav aria-label={t.t('esg.breadcrumb')} className="kv-field__hint"><Link href={ESG_HREF}>{t.t('esg.title')}</Link>{' / '}{t.t('esg.methodPage.title')}</nav>
      {state && <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><strong>{t.t(`esg.state.${state}.title`)}</strong><p>{t.t(`esg.state.${state}.body`)}</p></div>}
      {row && clock && (
        <>
          <h1>{pick(row.name, lang)}</h1>
          <p className="kv-field__hint">{t.t(pillarKey(row.pillar))} · <span className="kv-badge kv-badge--muted">{t.t(verdictKey(row.verdict))}</span></p>
          <div className="kv-card">
            <h2>{t.t('esg.methodPage.method')}</h2>
            {row.method.status === 'published' && row.method.ref ? (
              <dl className="kv-dl">
                <dt>{t.t('esg.methodPage.ref')}</dt><dd><code>{row.method.ref}</code> · v{row.method.version}</dd>
                <dt>{t.t('esg.methodPage.publishedAt')}</dt><dd>{row.method.publishedAt ? formatDate(row.method.publishedAt, lang, { dateStyle: 'medium', timeZone: clock.zone }) : ''}</dd>
                <dt>{t.t('esg.methodPage.text')}</dt><dd>{pick(row.method.text, lang)}</dd>
                <dt>{t.t('esg.methodPage.sources')}</dt><dd><code>{row.method.sourceTables.join(' · ')}</code></dd>
                <dt>{t.t('esg.methodPage.freshness')}</dt><dd>{t.t(`esg.methodPage.rule.${row.method.freshnessRule === 'catalogue_now' ? 'catalogue_now' : 'latest_source_fact'}`)}
                  {row.method.windowDays !== null && <> · {t.t('esg.methodPage.window', { days: fmt(row.method.windowDays), zone: clock.zone })}</>}
                  {row.method.staleAfterDays !== null && <> · {t.t('esg.methodPage.staleAfter', { days: fmt(row.method.staleAfterDays) })}</>}</dd>
              </dl>
            ) : (
              <>
                <p><strong>{t.t(noValueKey(row.verdict))}</strong></p>
                {row.needs && <p>{pick(row.needs, lang)}</p>}
              </>
            )}
            <p className="kv-field__hint">{t.t(byNameKey('methodEditing'))}</p>
          </div>
          <div className="kv-card">
            <h2>{t.t('esg.methodPage.now')}</h2>
            {valueShown(row) && row.fact
              ? <ul className="kv-list">{factLines(row.fact, fmt).map((l) => <li key={l.key}>{t.t(l.key, l.vars)}</li>)}</ul>
              : <p>{t.t(noValueKey(row.verdict))}</p>}
            {row.freshness && <p className="kv-field__hint">{t.t(row.freshness.rule === 'catalogue_now' ? 'esg.freshness.now' : 'esg.freshness.asOf', { when: civilLabel(row.freshness.asOf) ?? '', zone: row.freshness.zone })}</p>}
          </div>
          <p><Link href={ESG_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </>
      )}
    </section>
  );
}
