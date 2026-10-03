// apps/web-tenant/src/app/settings/integrations/page.tsx · W187 · INTEGRATIONS — PC-56 TENANT-13c (F-8).
//
// The canon's screen, printed as built:
//   • the lede: credentials live in the platform vault (this console stores references, never keys), one connection per provider, and
//     every credential is VERIFIED against the provider before anything is stored;
//   • columns Provider · Category · Config (masked ref `…••41` + the non-secret config) · Health (24 h) = "N checks · last OK <time>"
//     from real verification pings (never a percentage of calls) · Status: verified / verify failed / disconnected / unverified /
//     platform-managed / available — NEVER "active": the consumers line says what is true, "connected and verified · not yet used by any
//     platform path — payments and SMS run on platform accounts";
//   • row acts: Connect (ownable providers only) → the form chain W2643–W2646 · Rotate → the same chain · Disconnect → the mutate chain
//     W2647–W2649; every one is a proposal a second administrator confirms ("owner + checker"); one in flight per provider;
//   • the two notes, as true: rotation is zero-downtime (the new credential verifies in shadow; the old one retires after commit) and
//     "disconnecting a payment provider blocks until in-flight settlements clear" — nothing settles through a tenant connection, so
//     disconnect is allowed and the sentence says why;
//   • "Direct settlement to your own account" is refused by name (Law 9, its own wave);
//   • states: Platform defaults active (no connection) · count · Couldn't load (Retry) · restricted (api.manage or tenant.settings) ·
//     Flagged off (the API's `tenancy` flag) · Loading.
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { IntegrationList } from '@krishalaya/sdk-js';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getLang, getTranslator } from '../../../lib/i18n';
import {
  INTEGRATIONS_HREF, connectHref, consumersKey, disconnectHref, healthLine, pageState, proposalHref, providerStatusKey, rowActs,
} from '../../../features/integrations/integrations';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('int.list.title'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

export default async function IntegrationsPage() {
  await requireSession(INTEGRATIONS_HREF);
  const t = getTranslator();
  const lang = getLang();
  const when = (iso: string | null) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short' }) : '');

  let data: IntegrationList | null = null; let state: string | null = null;
  try { data = await tenantClient().integrations.list(); }
  catch (e) { const err = e instanceof SdkError ? e : null; state = pageState(err?.code, err?.status); }
  const live = data ? data.items.filter((i) => i.status !== 'disconnected') : [];

  return (
    <section>
      <nav aria-label={t.t('int.breadcrumb.label')} className="kv-field__hint">{t.t('int.breadcrumb.settings')} › {t.t('int.list.crumb')}</nav>
      <h1>{t.t('int.list.title')}</h1>
      <p>{t.t('int.list.lede')}</p>
      {data && <p><Link href={connectHref()} className="kv-btn kv-btn--primary">{t.t('int.list.connect')}</Link></p>}

      {state && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert">
          <strong>{t.t(`int.state.${state}.title`)}</strong><p>{t.t(`int.state.${state}.body`)}</p>
          {state === 'error' && <p><Link href={INTEGRATIONS_HREF} className="kv-btn--link">{t.t('int.state.retry')}</Link></p>}
        </div>
      )}

      {data && live.length === 0 && (
        <div className="kv-card kv-card--notice" role="note">
          <strong>{t.t('int.state.defaults.title')}</strong>
          <p>{t.t('int.state.defaults.body')}</p>
        </div>
      )}

      {data && data.proposals.length > 0 && (
        <div className="kv-card">
          <h2>{t.t('int.proposals.title')}</h2>
          <ul className="kv-list">
            {data.proposals.map((p) => (
              <li key={p.id}>
                {t.t(`int.kind.${p.kind}`)} · {p.providerName ?? p.providerCode}{p.credentialHint ? ` (${p.credentialHint})` : ''}
                <br /><span className="kv-field__hint">{t.t('int.proposals.line', { by: p.proposedByName ?? t.t('int.proposals.someone'), until: when(p.expiresAt) })}</span>
                <br /><Link href={`${proposalHref(p.id)}?step=confirm`} className="kv-btn--link">{t.t(p.canConfirm ? 'int.proposals.review' : 'int.proposals.open')}</Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data && (
        <>
          <table className="kv-table">
            <thead><tr>
              <th scope="col">{t.t('int.list.col.provider')}</th><th scope="col">{t.t('int.list.col.category')}</th><th scope="col">{t.t('int.list.col.config')}</th>
              <th scope="col">{t.t('int.list.col.health')}</th><th scope="col">{t.t('int.list.col.status')}</th><th scope="col">{t.t('int.list.col.actions')}</th>
            </tr></thead>
            <tbody>
              {data.providers.map((p) => {
                const c = data!.items.find((i) => i.providerCode === p.code) ?? null;
                const h = healthLine(c?.health ?? null);
                const pending = data!.proposals.some((x) => x.providerCode === p.code);
                return (
                  <tr key={p.code}>
                    <td>{p.name}<br /><code className="kv-field__hint">{p.code}</code></td>
                    <td>{t.t(`int.category.${p.category}`)}</td>
                    <td>
                      {c && c.status !== 'disconnected' ? (
                        <>
                          {c.maskedRef && <code>{t.t('int.list.ref', { ref: c.maskedRef })}</code>}
                          {c.credentialHint && <><br /><span className="kv-field__hint">{t.t('int.list.hint', { hint: c.credentialHint })}</span></>}
                          {Object.entries(c.config).map(([k, v]) => <span key={k}><br /><span className="kv-field__hint">{k}: {String(v)}</span></span>)}
                        </>
                      ) : p.managed ? <span className="kv-field__hint">{t.t('int.list.managedNote')}</span> : <span className="kv-field__hint">—</span>}
                    </td>
                    <td>{c && c.status !== 'disconnected' ? <>{t.t(h.key, { ...h.vars, n: formatNumber(Number(h.vars.n ?? 0), lang), at: when(h.at) })}</> : '—'}</td>
                    <td>
                      {t.t(providerStatusKey(p, c))}
                      {c && c.status !== 'disconnected' && <><br /><span className="kv-field__hint">{t.t(consumersKey(c.consumers))}</span></>}
                      {c?.status === 'verify_failed' && c.verifyResult?.errorClass && <><br /><span className="kv-error">{t.t(`int.verify.${c.verifyResult.errorClass}`)}</span></>}
                      {c?.status === 'disconnected' && c.disconnectReason && <><br /><span className="kv-field__hint">{t.t('int.list.disconnectedReason', { reason: c.disconnectReason, at: when(c.disconnectedAt) })}</span></>}
                      {p.ownable && !p.verifiable && <><br /><span className="kv-field__hint">{t.t('int.list.notVerifiable')}</span></>}
                    </td>
                    <td>
                      {pending ? <span className="kv-field__hint">{t.t('int.list.inFlight')}</span> : rowActs(c, p).map((a, i) => (
                        <span key={a}>{i > 0 ? ' · ' : ''}<Link href={a === 'disconnect' ? disconnectHref(p.code) : connectHref(p.code, a)} className="kv-btn--link">{t.t(`int.act.${a}`)}</Link></span>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="kv-field__hint">{t.t('int.list.count', { providers: formatNumber(data.count.providers, lang), ownable: formatNumber(data.count.ownable, lang), connected: formatNumber(data.count.connected, lang) })}</p>
          <div className="kv-card">
            <ul className="kv-list">
              <li>{t.t('int.note.rotation')}</li>
              <li>{t.t('int.note.disconnect')}</li>
              <li>{t.t('int.note.directSettlement')}</li>
            </ul>
          </div>
          <p className="kv-field__hint">{t.t('int.list.footnote')}</p>
        </>
      )}
    </section>
  );
}
