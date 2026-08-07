// apps/web-admin/src/app/impersonation/page.tsx · god-mode act-as register — the highest-sensitivity surface.
// Server component: requireAdmin gates, adminGet hits GET /v1/impersonation/grants (admin/target/status filter,
// keyset). A prominent warning frames the page. The mint form (POST grants) is READ-ONLY scope, time-boxed, and
// demands a ≥8-char justification; admin-api requires FIDO2 + step-up and returns the act-as token ONCE — that
// token is handled server-side only and is NEVER shown here. Degrade-never-die. No inline styles.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../lib/admin-client';
import { DataTable, Column } from '../../components/DataTable';
import { getTranslator } from '../../lib/i18n';
import { adminNoticeKey } from '../../features/nav/nav-model';
import {
  GRANT_STATUSES, grantStatusKey, TTL_DEFAULT_SEC, isElapsedButActive, minutesLeft, type GrantRow,
} from '../../features/impersonation/grant';
import { startGrantAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('imp.title'), robots: { index: false, follow: false } };
}

const ST_CLASS: Record<string, string> = { active: 'kv-status--danger', ended: 'kv-status--muted', expired: 'kv-status--muted', revoked: 'kv-status--warn' };
const ERR = new Set(['targetTenantId', 'targetUserId', 'reason', 'ttlSec', 'scope', 'disabled', 'privileged', 'targetNotFound', 'activeExists', 'self', 'elevation', 'conflict', 'notFound', 'generic']);

export default async function ImpersonationPage({ searchParams }: { searchParams: { cursor?: string; status?: string; ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();
  const status = (GRANT_STATUSES as readonly string[]).includes(searchParams.status ?? '') ? searchParams.status : undefined;

  let rows: GrantRow[] = []; let nextCursor: string | undefined; let notice: string | undefined;
  let staleActive = 0;
  try {
    const res = await adminGet<GrantRow[]>('impersonation/grants', { cursor: searchParams.cursor, status, limit: 50 });
    rows = res.data ?? [];
    nextCursor = (res.meta?.nextCursor as string | undefined) ?? undefined;
  } catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }
  try {
    // The elapsed-but-unreconciled backlog. Its own read, so a failure here costs the count and not the register.
    const st = await adminGet<{ count: number }>('impersonation/stale-active');
    staleActive = Number(st.data?.count ?? 0);
  } catch { staleActive = 0; }
  const nowMs = Date.now();

  const okMinted = searchParams.ok === 'minted';
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const cols: Column<GrantRow>[] = [
    { header: t.t('imp.grant'), cell: (r) => <Link href={`/impersonation/grants/${encodeURIComponent(r.id)}`}>{r.id}</Link> },
    { header: t.t('imp.operator'), cell: (r) => r.adminUserId },
    { header: t.t('imp.targetUser'), cell: (r) => r.targetUserId },
    { header: t.t('imp.status'), cell: (r) => { const s = grantStatusKey(r.status); return <span className={`kv-status ${ST_CLASS[s]}`}>{t.t(`imp.state.${s}`)}</span>; } },
    {
      header: t.t('imp.expiresAt'),
      cell: (r) => {
        // **AN ELAPSED GRANT THAT STILL READS `active` IS A DIFFERENT FACT FROM A LIVE ONE.** Expiry had no writer at
        // all before this wave, so this row could have been showing "active" for hours — and holding the
        // one-active-per-(operator, target) slot the whole time.
        if (isElapsedButActive(r.status, r.expiresAt ?? null, nowMs)) {
          return <span className="kv-status kv-status--warn">{t.t('imp.elapsedNotReconciled')}</span>;
        }
        const left = r.status === 'active' ? minutesLeft(r.expiresAt ?? null, nowMs) : null;
        return (
          <>
            {r.expiresAt ?? t.t('common.dash')}
            {left !== null ? <><br /><small>{t.t('imp.minutesLeft', { n: String(left) })}</small></> : null}
          </>
        );
      },
    },
  ];
  const filterHref = (s?: string) => `/impersonation${s ? `?status=${encodeURIComponent(s)}` : ''}`;

  return (
    <section>
      <h1>{t.t('imp.title')}</h1>
      <p className="kv-error" role="note">{t.t('imp.warning')}</p>
      <p className="kv-muted">{t.t('imp.lead')}</p>
      {/* PC-56 ADMIN-9b · WHAT IS ACTUALLY ENFORCED, at the top, because every other claim on this page depends on it.
          Until this wave `apps/api` had no verifier: the token was inert, "read_only" was a stored string, the action
          log was the operator self-reporting, and the target tenant was told nothing. */}
      <p className="kv-note is-ok">{t.t('imp.enforce.full')}</p>
      <p className="kv-note">{t.t('imp.transparency')}</p>
      {staleActive > 0 && (
        <p className="kv-note is-warn" role="status">{t.t('imp.staleActive', { n: String(staleActive) })}</p>
      )}
      {okMinted && <p className="kv-success" role="status">{t.t('imp.ok.minted')}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`imp.error.${errKey}`)}</p>}

      <nav className="kv-filters" aria-label={t.t('imp.filterStatus')}>
        <Link href={filterHref()} className={`kv-chip${!status ? ' is-active' : ''}`} aria-current={!status ? 'true' : undefined}>{t.t('imp.filterAll')}</Link>
        {GRANT_STATUSES.map((s) => (
          <Link key={s} href={filterHref(s)} className={`kv-chip${status === s ? ' is-active' : ''}`} aria-current={status === s ? 'true' : undefined}>{t.t(`imp.state.${s}`)}</Link>
        ))}
      </nav>

      {notice ? <p className="kv-error" role="alert">{notice}</p> : (
        <>
          <DataTable columns={cols} rows={rows} empty={t.t('imp.empty')} />
          {nextCursor && <p className="kv-pager"><Link className="kv-btn" href={`/impersonation?cursor=${encodeURIComponent(nextCursor)}${status ? `&status=${status}` : ''}`}>{t.t('common.nextPage')}</Link></p>}
        </>
      )}

      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('imp.mint')}</summary>
        <p className="kv-field__hint">{t.t('imp.mintHint')}</p>
        <form action={startGrantAction} className="kv-form">
          <label htmlFor="targetTenantId" className="kv-field__label">{t.t('imp.targetTenant')}</label>
          <input id="targetTenantId" name="targetTenantId" className="kv-input" required placeholder={t.t('imp.uuidHint')} />
          <label htmlFor="targetUserId" className="kv-field__label">{t.t('imp.targetUser')}</label>
          <input id="targetUserId" name="targetUserId" className="kv-input" required placeholder={t.t('imp.uuidHint')} />
          <label htmlFor="ttlSec" className="kv-field__label">{t.t('imp.ttl')}</label>
          <input id="ttlSec" name="ttlSec" className="kv-input" inputMode="numeric" defaultValue={String(TTL_DEFAULT_SEC)} placeholder={t.t('imp.ttlHint')} />
          <label htmlFor="scope" className="kv-field__label">{t.t('imp.scope')}</label>
          <input id="scope" name="scope" className="kv-input" value="read_only" readOnly aria-readonly="true" />
          <label htmlFor="mintReason" className="kv-field__label">{t.t('imp.reason')}</label>
          <input id="mintReason" name="reason" className="kv-input" required minLength={8} maxLength={1000} />
          <button type="submit" className="kv-btn kv-btn--danger">{t.t('imp.mintSubmit')}</button>
        </form>
      </details>
    </section>
  );
}
