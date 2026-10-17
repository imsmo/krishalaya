// apps/web-storefront/src/components/sweep/TrustScreen.tsx · PC-56 STORE-SWEEP-a · C2 (canon W310 at `(public)/trust` — DELTA `trust_route`; founders
// D2 / D3) — TRUST & YOUR DATA, PLATFORM-ONLY (`/trust-data`; a store host answers 307 to the platform's origin). DERIVED from
// features/sweep/trust-claims.ts: each TRUE claim with the mechanism that makes it true (`data-kv-claim` / `data-kv-verdict="true"`), the
// unprovable ones refused BY NAME (RefusalList `trust`), and the Grievances block (`#grievances` — every store's footer links here) and the
// company's facts from the platform-facts read (migration 0223): each set fact printed, each empty one "not published yet", a failed read said.
// The page never claims what a lawyer or a contract must establish — no "48 hours / 30 days / intermediary rules" from the canon.
import type { PlatformFacts } from '@krishalaya/sdk-js';
import { getTranslator } from '../../lib/i18n';
import { RefusalList } from '../RefusalList';
import { reloadHref, type LoadResult } from '../../features/home/load-result';
import { TRUST_GROUPS, ZERO_SUM_EVERY_MINUTES, claimsOf } from '../../features/sweep/trust-claims';
import { QUALITY_WINDOW_HOURS } from '../../features/sweep/quality-rules';
import { factLine, grievanceLines, legalLines } from '../../features/sweep/facts';
import { FactItem, FactsError } from './Facts';

const GRIEVANCE_LABEL: Record<string, { label: string; setKey?: string }> = {
  officer: { label: 'sweep.fact.officer' }, address: { label: 'sweep.fact.address' }, email: { label: 'sweep.fact.email' },
  ack: { label: 'sweep.fact.ack', setKey: 'sweep.fact.ackSet' }, resolve: { label: 'sweep.fact.resolve', setKey: 'sweep.fact.resolveSet' },
};

export function TrustScreen({ facts }: { facts: LoadResult<PlatformFacts> }) {
  const t = getTranslator();
  const params = { minutes: String(ZERO_SUM_EVERY_MINUTES), hours: String(QUALITY_WINDOW_HOURS) };
  return (
    <article className="kv-prose" data-kv-trust="">
      <h1>{t.t('sweep.trust.title')}</h1>
      <p className="kv-prose__lead">{t.t('sweep.trust.lead')}</p>
      {TRUST_GROUPS.map((g) => (
        <section key={g} data-kv-trust-group={g} aria-labelledby={`kv-trust-${g}`}>
          <h2 id={`kv-trust-${g}`}>{t.t(`sweep.trust.group.${g}`)}</h2>
          <ul>
            {claimsOf(g).map((c) => c.verdict === 'true' ? (
              <li key={c.id} data-kv-claim={c.id} data-kv-verdict="true">
                <strong>{t.t(c.key, params)}</strong> <span data-kv-mechanism={c.id}>{t.t(c.mechanismKey, params)}</span>
              </li>
            ) : null)}
          </ul>
        </section>
      ))}
      <section id="grievances" data-kv-trust-group="grievances" aria-labelledby="kv-trust-grievances">
        <h2 id="kv-trust-grievances">{t.t('sweep.trust.grievancesTitle')}</h2>
        <p>{t.t('sweep.trust.grievancesLead')}</p>
        {facts.ok
          ? <ul className="kv-facts">{grievanceLines(facts.data).map((g) => (
            <FactItem key={g.id} id={`grievance.${g.id}`} label={t.t(GRIEVANCE_LABEL[g.id].label)} line={g.line} setKey={GRIEVANCE_LABEL[g.id].setKey} />
          ))}</ul>
          : <FactsError retryHref={reloadHref('/trust-data')} />}
      </section>
      <section data-kv-trust-group="company" aria-labelledby="kv-trust-company">
        <h2 id="kv-trust-company">{t.t('sweep.trust.companyTitle')}</h2>
        {facts.ok && (
          <ul className="kv-facts">
            {legalLines(facts.data).map((l) => <FactItem key={l.id} id={`legal.${l.id}`} label={t.t(`sweep.fact.${l.id}`)} line={l.line} />)}
            <FactItem id="contact.security" label={t.t('sweep.fact.mailbox.security')} line={factLine(facts.data.contact.securityEmail)} />
          </ul>
        )}
      </section>
      <RefusalList surface="trust" />
    </article>
  );
}
