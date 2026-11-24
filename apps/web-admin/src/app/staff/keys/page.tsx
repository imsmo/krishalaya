// apps/web-admin/src/app/staff/keys/page.tsx · "Security keys" — my hardware keys and the enrollment codes (PC-56 ADMIN-AUTH-1).
//
// The key list W439 promised and ADMIN-9 could not build (0074's table keyed on the tenant realm): 0244 gives the admin realm
// its own `platform_operator_credentials`, so this is now a list of facts. Register two keys (a spare in a safe place) — a
// lost key with no second one means a colleague must issue you a new enrollment code. Your LAST key cannot be revoked here.
//
// Enrollment codes: issued for a NAMED colleague whose email already has an operator binding, shown once, single use,
// 24 hours. Needs `staff.enroll` (platform_staff_onboarding / platform_staff_checker). You cannot issue one for yourself.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { Button, Callout, StatusPill } from '@krishalaya/ui';
import {
  activeKeys, authCopy, canRevokeOwnKey, codeStateKey, enrolledViaKey, stepUpHref, type KeyView,
} from '../../../features/admin-auth/admin-auth';
import { AddKeyPanel } from '../../../components/auth/AddKeyPanel';
import { IssueCodePanel } from '../../../components/auth/IssueCodePanel';
import { revokeCodeAction, revokeKeyAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('keys.title'), robots: { index: false, follow: false } };
}

interface CodeRow { id: string; email: string; issuedByAdminId: string; reason: string; issuedAt: string; expiresAt: string; consumedAt: string | null; revokedAt: string | null }

const OK = new Set(['keyAdded', 'keyRevoked', 'codeRevoked']);
const ERR = new Set(['elevation', 'keyRevoke', 'reason', 'generic']);

export default async function SecurityKeysPage(props: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const searchParams = await props.searchParams;
  requireAdmin();
  const t = getTranslator();
  const copy = authCopy((k) => t.t(k));
  const backHere = stepUpHref('/staff/keys', '');

  let keys: KeyView[] | null = null;
  try { keys = (await adminGet<KeyView[]>('auth/keys')).data ?? []; } catch { keys = null; }
  let codes: CodeRow[] | null = null; let codesRestricted = false;
  try { codes = (await adminGet<CodeRow[]>('auth/enrollment-codes')).data ?? []; }
  catch (e) { codes = null; codesRestricted = e instanceof AdminApiError && e.status === 403; }

  return (
    <main className="kv-page">
      <nav className="kv-breadcrumb" aria-label={t.t('nav.breadcrumb')}>
        <Link href="/staff/me">{t.t('st.me.title')}</Link> <span aria-hidden="true">/</span>{' '}
        <span>{t.t('keys.title')}</span>
      </nav>
      <header className="kv-page__head">
        <h1>{t.t('keys.title')}</h1>
        <p className="kv-page__sub">{t.t('keys.sub')}</p>
      </header>

      {searchParams.ok && OK.has(searchParams.ok) ? <Callout tone="success" live="polite">{t.t(`keys.ok.${searchParams.ok}`)}</Callout> : null}
      {searchParams.error && ERR.has(searchParams.error) ? <Callout tone="danger" live="assertive">{t.t(`keys.err.${searchParams.error}`)}</Callout> : null}

      <section className="kv-panel" aria-labelledby="keys-mine">
        <h2 id="keys-mine" className="kv-panel__title">{t.t('keys.mine.title')}</h2>
        {keys === null ? <Callout tone="danger">{t.t('keys.err.load')}</Callout> : (
          <>
            {activeKeys(keys).length < 2 ? <Callout tone="warning">{t.t('keys.mine.onlyOne')}</Callout> : null}
            <table className="kv-table">
              <caption className="kv-table__caption">{t.t('keys.mine.caption')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t.t('keys.col.label')}</th>
                  <th scope="col">{t.t('keys.col.via')}</th>
                  <th scope="col">{t.t('keys.col.added')}</th>
                  <th scope="col">{t.t('keys.col.lastUsed')}</th>
                  <th scope="col">{t.t('keys.col.state')}</th>
                  <th scope="col">{t.t('keys.col.action')}</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id}>
                    <td>{k.label}</td>
                    <td>{t.t(enrolledViaKey(k.enrolledVia))}</td>
                    <td>{k.createdAt.slice(0, 16).replace('T', ' ')}</td>
                    <td>{k.lastUsedAt ? k.lastUsedAt.slice(0, 16).replace('T', ' ') : t.t('keys.never')}</td>
                    <td><StatusPill tone={k.revokedAt ? 'neutral' : 'success'} label={t.t(k.revokedAt ? 'keys.state.revoked' : 'keys.state.active')} /></td>
                    <td>
                      {canRevokeOwnKey(keys!, k.id) ? (
                        <form action={revokeKeyAction}>
                          <input type="hidden" name="keyId" value={k.id} />
                          <input type="hidden" name="returnTo" value="/staff/keys" />
                          <input className="kv-input kv-input--sm" name="reason" required minLength={10} maxLength={500} aria-label={t.t('keys.revoke.reason')} placeholder={t.t('keys.revoke.reason')} />
                          <Button type="submit" variant="danger" size="sm">{t.t('keys.revoke.cta')}</Button>
                        </form>
                      ) : !k.revokedAt ? <small className="kv-muted">{t.t('keys.revoke.lastKey')}</small> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <h3>{t.t('keys.add.title')}</h3>
        <p className="kv-muted">{t.t('keys.add.lead')}</p>
        <AddKeyPanel copy={copy} stepUpHref={backHere} />
      </section>

      <section className="kv-panel" aria-labelledby="keys-codes">
        <h2 id="keys-codes" className="kv-panel__title">{t.t('keys.code.title')}</h2>
        <p className="kv-muted">{t.t('keys.code.lead')}</p>
        {codesRestricted ? <Callout tone="info">{t.t('keys.code.restricted')}</Callout> : (
          <>
            <IssueCodePanel copy={copy} stepUpHref={backHere} />
            {codes && codes.length > 0 ? (
              <table className="kv-table">
                <caption className="kv-table__caption">{t.t('keys.code.caption')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t.t('keys.code.email')}</th>
                    <th scope="col">{t.t('keys.col.added')}</th>
                    <th scope="col">{t.t('keys.code.expires')}</th>
                    <th scope="col">{t.t('keys.col.state')}</th>
                    <th scope="col">{t.t('keys.col.action')}</th>
                  </tr>
                </thead>
                <tbody>
                  {codes.map((c) => {
                    const state = codeStateKey(c);
                    return (
                      <tr key={c.id}>
                        <td>{c.email}</td>
                        <td>{c.issuedAt.slice(0, 16).replace('T', ' ')}</td>
                        <td>{c.expiresAt.slice(0, 16).replace('T', ' ')}</td>
                        <td>{t.t(state)}</td>
                        <td>
                          {state === 'keys.code.open' ? (
                            <form action={revokeCodeAction}>
                              <input type="hidden" name="codeId" value={c.id} />
                              <Button type="submit" variant="secondary" size="sm">{t.t('keys.code.revoke')}</Button>
                            </form>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}
