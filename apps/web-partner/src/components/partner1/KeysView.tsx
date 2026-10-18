// apps/web-partner/src/components/partner1/KeysView.tsx · PC-56 PARTNER-1b · founder D1 — API KEYS (canon W267 at `account/api`), presentational.
//
// The partner's OWN keys over `GET /v1/partner/keys`: name, prefix, scopes, the hourly quota, last used, status (revoked: when, and the
// administrator's reason) — there is no hash on the type, and none on the page. TRUE and printed: a secret is shown once and only a hash is
// kept; revoking is permanent and every call with the key fails at once; the partner API answers no key until the platform switches it on.
// "Revoke" (W2911–W2913, REAL) only for a person whose role may revoke (the API decides); "Create key" is DECOR (W2907–W2910): keys are issued
// by the platform's partner operations — write to the partners mailbox. States: ok / empty / error / switched off / not in your role.
import Link from 'next/link';
import { formatDate } from '@krishalaya/i18n';
import type { PartnerKey } from '@krishalaya/sdk-js';
import type { Tr } from '../NotYet';
import type { Mailbox } from './HelpView';
import { MailboxLine } from './MailboxLine';
import { RefusalList } from './RefusalList';
import { keyStatusText } from '../../features/partner1/keys';

export type KeysState = 'ok' | 'error' | 'off' | 'forbidden';
export interface KeysViewProps { t: Tr; lang: string; state: KeysState; keys: readonly PartnerKey[]; canRevoke: boolean; mailbox: Mailbox }

const when = (v: string | null, lang: string) => (v ? formatDate(v, lang, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) : '');

export function KeysView({ t, lang, state, keys, canRevoke, mailbox }: KeysViewProps) {
  if (state === 'off') return <section data-kv-keys="off"><h1>{t.t('partner.off.title')}</h1><p className="kv-muted">{t.t('partner.off.body')}</p></section>;
  return (
    <section data-kv-keys={state === 'ok' ? (keys.length ? 'ok' : 'empty') : state}>
      <h1>{t.t('partner1.keys.title')}</h1>
      <p className="kv-muted">{t.t('partner1.keys.lead')}</p>

      <div className="kv-card" data-kv-keys-list>
        {state === 'forbidden' && <p role="alert">{t.t('partner1.keys.forbidden')}</p>}
        {state === 'error' && <p role="alert">{t.t('partner1.keys.error')} <Link className="kv-link" href="/account/api">{t.t('partner1.keys.retry')}</Link></p>}
        {state === 'ok' && keys.length === 0 && <p>{t.t('partner1.keys.empty')}</p>}
        {state === 'ok' && keys.length > 0 && (
          <table className="kv-table">
            <thead><tr>
              <th scope="col">{t.t('partner1.keys.colName')}</th><th scope="col">{t.t('partner1.keys.colPrefix')}</th><th scope="col">{t.t('partner1.keys.colScopes')}</th>
              <th scope="col">{t.t('partner1.keys.colRate')}</th><th scope="col">{t.t('partner1.keys.colLastUsed')}</th><th scope="col">{t.t('partner1.keys.colStatus')}</th>
              {canRevoke && <th scope="col">{t.t('partner1.keys.colActions')}</th>}
            </tr></thead>
            <tbody>{keys.map((k) => (
              <tr key={k.id} data-kv-key={k.id} data-kv-key-status={k.status}>
                <td>{k.name}</td>
                <td><code className="kv-code">{k.keyPrefix}</code></td>
                <td>{k.scopes.map((sc) => <code key={sc} className="kv-code kv-scope">{sc}</code>)}</td>
                <td>{t.t('partner1.keys.rate', { count: k.rateLimitPerHour })}</td>
                <td>{k.lastUsedAt ? when(k.lastUsedAt, lang) : t.t('partner1.keys.neverUsed')}</td>
                <td>{keyStatusText(t, k, lang)}{k.status === 'revoked' && k.revokedReason && <span className="kv-muted"> · {t.t('partner1.keys.reasonShown', { reason: k.revokedReason })}</span>}</td>
                {canRevoke && <td>{k.status !== 'revoked' && <Link className="kv-btn--link" href={`/account/api?act=revoke&id=${encodeURIComponent(k.id)}`}>{t.t('partner1.keys.revoke')}</Link>}</td>}
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>

      <div className="kv-card" data-kv-keys-truths>
        <p>{t.t('partner1.keys.secretTruth')}</p>
        <p>{t.t('partner1.keys.revokeTruth')}</p>
        <p className="kv-field__hint">{t.t('partner1.keys.apiSwitch')}</p>
      </div>

      <div className="kv-card" data-kv-decor="create-key">
        <p><Link className="kv-btn kv-btn--muted" href="/account/api?form=review">{t.t('partner1.keys.create')}</Link></p>
        <p className="kv-field__hint">{t.t('partner1.keys.createRefused')}</p>
        <MailboxLine t={t} mailbox={mailbox} />
      </div>

      <RefusalList t={t} surface="keys" />
    </section>
  );
}
