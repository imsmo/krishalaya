// apps/web-tenant/src/app/content/templates/experiments/page.tsx · W182 — template A/B testing, REFUSED BY NAME ·
// PC-56 TENANT-8a.
//
// The canon's own banner is the page: *"Backend pending (DELTA-029): template experiments table (variant split, exposure
// counts, winner promotion) — not in schema yet."* It is still true (`SELECT relname FROM pg_class WHERE relname ~*
// '(experiment|variant|ab_|split)'` → 0 rows; `grep -rln "DELTA-029\|template_experiment" db apps/*/src` → 0, the 8a
// report). So nothing here draws an arm, an exposure count, a z-score or a winner. What the page CAN print is what does
// exist — your overrides, each with the version serving and the one waiting, which is the only "variant" this platform
// keeps — and, by name, what does not: the allocation, the hash bucket, the exposures, the statistics, the promotion.
// *New experiment* and *Retry* are PARITY-DECOR with those reasons (no route; Retry is a page load).
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator } from '../../../../lib/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { TemplateIndex } from '@krishalaya/sdk-js';
import {
  EXPERIMENTS_HREF, TEMPLATES_HREF, channelKey, lifecycleKey, pageStateKey, refusedKey, slotHref, templatesTransportState, type TemplatesPageState,
} from '../../../../features/templates/override';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('experiments.title'), robots: { index: false, follow: false } };
}

const MISSING = ['allocation', 'bucket', 'exposures', 'statistics', 'promotion', 'eligibleList'] as const;

export default async function ExperimentsPage() {
  await requireSession(EXPERIMENTS_HREF);
  const t = getTranslator();
  let idx: TemplateIndex | null = null;
  let state: TemplatesPageState | null = null;
  try { idx = await tenantClient().notifications.templateIndex({ only: 'overrides', limit: 50 }); }
  catch (e) { state = e instanceof SdkError ? templatesTransportState(e.code, e.status) : 'error'; }

  return (
    <section>
      <p className="kv-field__hint"><Link href={TEMPLATES_HREF} className="kv-btn--link">{t.t('templates.backToList')}</Link></p>
      <h1>{t.t('experiments.title')}</h1>
      <div className="kv-card kv-card--notice" role="status">
        <p><strong>{t.t('experiments.refused')}</strong></p>
        <p className="kv-field__hint">{t.t('experiments.refusedWhy')}</p>
      </div>
      <p className="kv-field__hint">{t.t('experiments.moneyNever')}</p>

      <h2>{t.t('experiments.notExist')}</h2>
      <ul className="kv-list">{MISSING.map((m) => <li key={m}>{t.t(`experiments.missing.${m}`)}</li>)}</ul>
      <p className="kv-field__hint">{t.t(refusedKey('experiment'))}</p>

      <h2>{t.t('experiments.exists')}</h2>
      {state !== null && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <p>{t.t(pageStateKey(state))}</p>
          {state === 'error' && <p><Link href={EXPERIMENTS_HREF} className="kv-btn--link">{t.t('templates.retry')}</Link></p>}
        </div>
      )}
      {idx && (idx.items.length === 0 ? <p className="kv-field__hint">{t.t('experiments.noOverrides')}</p> : (
        <table className="kv-table">
          <thead><tr><th>{t.t('templates.col.event')}</th><th>{t.t('templates.col.channel')}</th><th>{t.t('templates.col.lang')}</th><th>{t.t('experiments.col.serving')}</th><th>{t.t('experiments.col.latest')}</th></tr></thead>
          <tbody>
            {idx.items.map((r) => {
              const href = slotHref(r);
              return (
                <tr key={`${r.eventCode}|${r.channel}|${r.languageCode}`}>
                  <td>{href ? <Link href={href} className="kv-link"><code>{r.eventCode}</code></Link> : <code>{r.eventCode}</code>}</td>
                  <td>{t.t(channelKey(r.channel))}</td>
                  <td>{r.languageCode}</td>
                  <td>{r.override.servingVersionNo !== null ? `v${r.override.servingVersionNo}` : <span className="kv-field__hint">{t.t('templates.serving.none')}</span>}</td>
                  <td>{r.override.latestVersionNo !== null && r.override.latestLifecycle ? `v${r.override.latestVersionNo} · ${t.t(lifecycleKey(r.override.latestLifecycle))}` : t.t('common.dash')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ))}
      <p className="kv-field__hint">{t.t('experiments.oneServes')}</p>
    </section>
  );
}
