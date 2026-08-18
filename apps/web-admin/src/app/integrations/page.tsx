// apps/web-admin/src/app/integrations/page.tsx · W106 (PC-56 ADMIN-11c).
//
// **THE FIGURE THIS SCREEN LEADS WITH IS A COUNT OF ROWS IN A TABLE NO CODE HAS EVER WRITTEN.** W106 says "Active keys
// 412 across 186 tenants" over `api_keys`, created in migration 0002 — and `grep -rn "[^_]api_keys\b" apps packages`
// returns nothing. No issuance route, no gateway that authenticates one of these keys, no `last_used_at` stamp, no
// revoke, and no tenant console screen, through twenty-one further migrations.
//
// There IS a live key plane: `partner_api_keys` (PC-55 A10) — hashed, scoped, rate-limited, stamped, enforced. So this
// screen reports BOTH and keeps them apart, because one number over both would present a live partner integration and a
// dormant table as the same fact.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../lib/admin-client';
import { getTranslator } from '../../lib/i18n';
import { revokeKeyAction } from './actions';
import { Button, Callout, Chip, EmptyState, StatusPill } from '@krishalaya/ui';
import {
  backlogClass, backlogKey, canRevoke, idleKey, keyStateTone, keyStateKey, registryKey, registryNoticeKey,
  revokeWithheldKey, successClass, successKey, tenantEmptyKey, usageKey,
  type DeliveryHealth, type KeyRow,
} from '../../features/integrations/api-oversight';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ap11.title'), robots: { index: false, follow: false } };
}

interface KeyMeta {
  tenantKeys: number; tenantTenants: number; partnerKeys: number; partnerOwners: number;
  tenantRegistryHasNoIssuer: boolean; keyIssuanceOwner: string; usageCounterOwner: string; nextCursor: string | null;
}

export default async function IntegrationsPage({ searchParams }: {
  searchParams: { registry?: string; ok?: string; error?: string };
}) {
  requireAdmin();
  const t = getTranslator();
  const registry = searchParams.registry === 'tenant' || searchParams.registry === 'partner' ? searchParams.registry : undefined;

  let keys: KeyRow[] = []; let meta: KeyMeta | undefined; let health: DeliveryHealth | undefined; let notice: string | undefined;
  try {
    const q = registry ? `?registry=${registry}` : '';
    const [k, h] = await Promise.all([
      adminGet<KeyRow[]>(`platform-api/keys${q}`),
      adminGet<DeliveryHealth>('platform-api/webhooks/health'),
    ]);
    keys = k.data ?? []; meta = k.meta as unknown as KeyMeta; health = h.data as unknown as DeliveryHealth;
  } catch (e) {
    notice = e instanceof AdminApiError && e.status === 403 ? 'ap11.restricted' : 'ap11.error.keys';
  }

  return (
    <main className="kv-page">
      <nav className="kv-breadcrumb" aria-label={t.t('nav.breadcrumb')}>
        <Link href="/dashboard">{t.t('nav.dashboard')}</Link> <span aria-hidden="true">/</span>{' '}
        <span>{t.t('ap11.title')}</span>
      </nav>

      <header className="kv-page__head">
        <h1>{t.t('ap11.title')}</h1>
        <p className="kv-page__sub">{t.t('ap11.sub')}</p>
      </header>

      {notice ? <Callout tone="danger" live="assertive">{t.t(notice)}</Callout> : null}
      {searchParams.ok ? <Callout tone="success" live="polite">{t.t(`ap11.ok.${searchParams.ok}`)}</Callout> : null}
      {searchParams.error ? <Callout tone="danger" live="assertive">{t.t(`ap11.err.${searchParams.error}`)}</Callout> : null}

      {/* SECRETS ARE HASHES, and this console never reads one — not even a hash, because a hash on a screen is a hash
          in a screenshot. */}
      <Callout tone="info">{t.t('ap11.hashesOnly')}</Callout>

      {meta ? (
        <>
          <section className="kv-stats" aria-label={t.t('ap11.census')}>
            <div className="kv-stat">
              <dt>{t.t('ap11.stat.partnerKeys')}</dt>
              <dd>{meta.partnerKeys.toLocaleString('en-IN')}</dd>
            </div>
            <div className="kv-stat">
              <dt>{t.t('ap11.stat.tenantKeys')}</dt>
              <dd>{meta.tenantKeys.toLocaleString('en-IN')}</dd>
            </div>
            <div className="kv-stat">
              <dt>{t.t('ap11.stat.endpoints')}</dt>
              <dd>{(health?.activeEndpoints ?? 0).toLocaleString('en-IN')}</dd>
            </div>
            <div className="kv-stat">
              <dt>{t.t('ap11.stat.backlog')}</dt>
              <dd>{(health?.pendingRetry ?? 0).toLocaleString('en-IN')}</dd>
            </div>
          </section>

          {/* THE SENTENCE THE SCHEMA COULD NOT SAY. Printed whether the count is zero or not. */}
          {meta.tenantRegistryHasNoIssuer ? (
            <Callout tone="warning">{t.t('ap11.reg.noIssuer', { owner: meta.keyIssuanceOwner })}</Callout>
          ) : null}

          {health ? (
            <>
              <p className={successClass(health.successRateBp)}>
                {t.t(successKey(health.successRateBp), {
                  pct: health.successRateBp === null ? '—' : (health.successRateBp / 100).toFixed(2),
                  attempted: health.attempted24h.toLocaleString('en-IN'),
                })}
              </p>
              {/* A pending retry is the system working. A delivery past 8 attempts is an event the tenant will never
                  receive, and no other surface on this platform mentions it again. */}
              <p className={backlogClass(health)}>
                {t.t(backlogKey(health), {
                  pending: health.pendingRetry.toLocaleString('en-IN'),
                  exhausted: health.exhausted24h.toLocaleString('en-IN'),
                })}
              </p>
            </>
          ) : null}
        </>
      ) : null}

      <nav className="kv-filters" aria-label={t.t('ap11.filterGroup')}>
        <Chip as={Link} href="/integrations" active={!registry}>{t.t('common.all')}</Chip>
        <Chip as={Link} href="/integrations?registry=partner" active={registry === 'partner'}>
          {t.t('ap11.reg.partner')}
        </Chip>
        <Chip as={Link} href="/integrations?registry=tenant" active={registry === 'tenant'}>
          {t.t('ap11.reg.tenant')}
        </Chip>
        <Chip as={Link} href="/integrations/inbound">{t.t('ap11.inboundLog')}</Chip>
        <Chip as={Link} href="/providers/health">{t.t('ap11.providerHealth')}</Chip>
      </nav>

      {keys.length === 0 && !notice ? (
        <EmptyState
          variant="empty"
          title={t.t('ap11.keys.emptyTitle')}
          body={t.t(tenantEmptyKey(Boolean(meta?.tenantRegistryHasNoIssuer)), { owner: meta?.keyIssuanceOwner ?? '' })}
        />
      ) : (
        <table className="kv-table">
          <caption className="kv-table__caption">{t.t('ap11.keys.caption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t.t('ap11.col.owner')}</th>
              <th scope="col">{t.t('ap11.col.key')}</th>
              <th scope="col">{t.t('ap11.col.scopes')}</th>
              <th scope="col">{t.t('ap11.col.rate')}</th>
              <th scope="col">{t.t('ap11.col.lastUsed')}</th>
              <th scope="col">{t.t('ap11.col.status')}</th>
              <th scope="col">{t.t('ap11.col.act')}</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => {
              const withheld = revokeWithheldKey(k);
              return (
                <tr key={`${k.registry}-${k.id}`}>
                  <td>
                    {k.ownerName ?? k.ownerId.slice(0, 8)}
                    <br /><small>{t.t(registryKey(k.registry))}</small>
                    {registryNoticeKey(k.registry) ? <><br /><StatusPill tone="neutral" icon={false} label={t.t('ap11.reg.dormantBadge')} /></> : null}
                  </td>
                  {/* THE PREFIX ONLY. The hash is never selected by the read model, let alone rendered. */}
                  <td className="kv-mono">{k.keyPrefix}<br /><small>{k.name}</small></td>
                  <td>{k.scopes.length === 0 ? t.t('ap11.noScopes') : k.scopes.join(', ')}</td>
                  <td>
                    {t.t('ap11.rate.limit', { n: k.ratePerHour.toLocaleString('en-IN') })}
                    {/* USAGE IS ABSENT AND SAYS WHY: the counter lives in Redis in another realm. */}
                    <br /><small>{t.t(usageKey(k), { n: String(k.hourlyUsage ?? 0), owner: meta?.usageCounterOwner ?? '' })}</small>
                  </td>
                  <td>{t.t(idleKey(k), { when: (k.lastUsedAt ?? '').slice(0, 10), days: String(k.idleDays ?? 0) })}</td>
                  <td><StatusPill tone={keyStateTone(k.state)} label={t.t(keyStateKey(k.state))} /></td>
                  <td>
                    {canRevoke(k) ? (
                      <form action={revokeKeyAction}>
                        <input type="hidden" name="id" value={k.id} />
                        <input type="hidden" name="registry" value={k.registry} />
                        <input className="kv-input" name="reason" required minLength={20} maxLength={300}
                          aria-label={t.t('ap11.revokeReason')} />
                        <Button type="submit">{t.t('ap11.revoke')}</Button>
                        <p className="kv-field__help">{t.t('ap11.revokeHelp')}</p>
                      </form>
                    ) : (
                      <Callout tone="info">
                        {t.t(withheld ?? 'ap11.key.revokedWithReason', { reason: k.revokedReason ?? '', when: (k.revokedAt ?? '').slice(0, 10) })}
                      </Callout>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <Callout tone="info"><small>{t.t('ap11.noIssuanceHere')}</small></Callout>
    </main>
  );
}
