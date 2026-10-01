// apps/web-tenant/src/app/auditor/page.tsx · W200 · THE AUDITOR OVERVIEW + the audit trail it reads (PC-56 TENANT-9c).
// Server-first, requireSession-gated, noindex, no client JS. Behind NEXT_PUBLIC_FEATURE_AUDITOR (the console switch) and the
// API's `audit_trail` flag (the authoritative gate — `AUDITOR_REALM_OFF` renders the canon's *"Flagged off"* in words).
//
// WHAT THE CANON SAYS, AND WHAT IS NOW TRUE OF IT:
//   • *"Read-only realm … not hidden, absent. The single exception: generating … exports"* — TRUE BY CONSTRUCTION now: one
//     global guard refuses an auditor session every non-GET on every route (544 of 547 in the router); the export enqueue
//     is the named exception (plus the link that fetches its file, and signing out). The banner says exactly that.
//   • *"every view taken here is itself logged"* — TRUE: every read writes `audit_read_log` first; the tile names the row.
//   • *"Ledger integrity · verified · hash chain intact · checked 02:10 today"* — REPLACED by what this read checked, as counts:
//     zero-sum over the window, and for each account the cooperative OWNS its chain, head pointer and balance = Σ; the
//     platform accounts' chains are UNVERIFIABLE from one cooperative (ADMIN-6) and the tile says so by name. No tick.
//   • "all reversals linked", "no gaps in numbering", "Open exceptions", the access window and the firm's name — refused by name.
// The trail below the overview is the existing browse, now MASKED (the API masks; the page names what it is not showing),
// BOUNDED (≤ 92 days, in the cooperative's own days) and honest about `actor_role` ("not recorded" on older rows).
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatDate, formatMoneyMinor, formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { AuditEntry, AuditWindow, AuditorOverview } from '@krishalaya/sdk-js';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { tenantHasPerm } from '../../lib/auth';
import { DataTable } from '../../components/DataTable';
import { getLang, getTranslator } from '../../lib/i18n';
import { env } from '../../lib/env';
import { validateFilters, buildAuditQuery, summarizeChange, compact, changedKeys } from '../../features/audit/viewer';
import {
  AUDITOR_HREF, EXPORTS_HREF, LEDGER_HREF, PACK_HREF, PAGE_REFUSALS, SCOPE_HREFS, footKey, integrityLines, purposeKey, realmState,
  realmStateKey, refusedKey, roleCellKey, scopeKey, windowFilters, windowRefusalKey, type RealmState,
} from '../../features/auditor/realm';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('auditor.title'), robots: { index: false, follow: false } };
}

type SP = { action?: string; entityType?: string; entityId?: string; actorUserId?: string; from?: string; to?: string; cursor?: string; entry?: string; reveal?: string; error?: string; ofrom?: string; oto?: string };

export default async function AuditorPage({ searchParams }: { searchParams: SP }) {
  if (!env.featureAuditor) notFound();
  await requireSession('/auditor');
  const t = getTranslator();
  const lang = getLang();

  // ---- W200: the overview (auditor scope — ledger.read) ----
  const ow = windowFilters({ from: searchParams.ofrom, to: searchParams.oto });
  let ov: AuditorOverview | null = null; let ovState: RealmState | null = null; let ovWindowCode: unknown = null;
  try { ov = await tenantClient().auditor.overview({ from: ow.from, to: ow.to }); }
  catch (e) { const err = e instanceof SdkError ? e : null; ovState = realmState(err?.code, err?.status); ovWindowCode = (err?.details as { code?: unknown } | undefined)?.code; }
  const zone = ov?.clock.zone;
  const when = (iso: string) => formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short', ...(zone ? { timeZone: zone } : {}) });
  const money = (minor: string, ccy?: string | null) => formatMoneyMinor(minor, ccy ?? ov?.clock.currency ?? 'XXX', lang);

  // ---- the trail ----
  const form = { action: searchParams.action, entityType: searchParams.entityType, entityId: searchParams.entityId, actorUserId: searchParams.actorUserId, from: searchParams.from, to: searchParams.to };
  const invalid = validateFilters(form);
  const selected = searchParams.entry || null;
  const grant = typeof searchParams.reveal === 'string' && /^\d{1,19}$/.test(searchParams.reveal) ? searchParams.reveal : undefined;
  let entries: AuditEntry[] = []; let nextCursor: string | null = null; let trailState: RealmState | null = null; let trailWindow: AuditWindow | null = null; let trailWindowCode: unknown = null;
  let entry: AuditEntry | null = null; let detailFailed = false;
  if (!invalid) {
    try { const r = await tenantClient().audit.list({ ...buildAuditQuery(form), cursor: searchParams.cursor, limit: 50 }); entries = r.items; nextCursor = r.nextCursor; trailWindow = r.window; }
    catch (e) { const err = e instanceof SdkError ? e : null; trailState = realmState(err?.code, err?.status); trailWindowCode = (err?.details as { code?: unknown } | undefined)?.code; }
  }
  if (selected) {
    try { entry = await tenantClient().audit.get(selected, undefined, { revealGrant: grant }); } catch { detailFailed = true; }
  }
  const canReveal = tenantHasPerm('member.pii.reveal');
  const qp = new URLSearchParams();
  for (const [k, v] of Object.entries(form)) if (v) qp.set(k, v);
  const nextHref = nextCursor ? `/auditor?${new URLSearchParams({ ...Object.fromEntries(qp), cursor: nextCursor }).toString()}` : null;

  return (
    <section>
      <h1>{t.t('auditor.title')}</h1>
      <p className="kv-field__hint">{t.t('auditor.lead')}</p>

      {/* The banner — every clause of it now true, and the exceptions named. */}
      <div className="kv-card kv-card--notice" role="note">
        <p><strong>{t.t('auditor.banner.title')}</strong></p>
        <p>{t.t('auditor.banner.body')}</p>
        <p className="kv-field__hint">{t.t('auditor.banner.logged')}</p>
      </div>

      <p>
        <Link href={PACK_HREF} className="kv-btn kv-btn--secondary">{t.t('auditor.link.pack')}</Link>{' '}
        <Link href={EXPORTS_HREF} className="kv-btn kv-btn--secondary">{t.t('auditor.link.exports')}</Link>{' '}
        <Link href={LEDGER_HREF} className="kv-btn kv-btn--secondary">{t.t('auditor.link.ledger')}</Link>
      </p>

      {/* ---- the overview's states ---- */}
      {ovState && (
        <div className={ovState === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={ovState === 'error' ? 'alert' : 'status'}>
          <p>{t.t(realmStateKey(ovState))}</p>
          {ovState === 'window' && <p className="kv-field__hint">{t.t(windowRefusalKey(ovWindowCode))}</p>}
          {ovState === 'restricted' && <p className="kv-field__hint">{t.t('auditor.state.restricted.trailBelow')}</p>}
          {ovState === 'error' && <p className="kv-field__hint">{t.t('auditor.state.error.safe')} <Link href={AUDITOR_HREF} className="kv-btn--link">{t.t('auditor.reload')}</Link> <span className="kv-field__hint">{t.t(refusedKey('retry'))}</span></p>}
        </div>
      )}

      {ov && (
        <>
          <p className="kv-field__hint">
            {t.t('auditor.signedIn', { roles: ov.session.roles.join(', ') || t.t('common.dash') })}
            {' · '}{t.t('auditor.clock', { zone: ov.clock.zone, currency: ov.clock.currency })}
            {' · '}{ov.clock.fiscalYear.declared ? t.t('auditor.fy.declared', { label: ov.clock.fiscalYear.label ?? '', start: ov.clock.fiscalYear.start ?? '' }) : t.t('auditor.fy.notDeclared')}
          </p>
          <form method="get" className="kv-form kv-form--grid" aria-label={t.t('auditor.window.label')}>
            <label className="kv-label">{t.t('auditor.window.from')}<input className="kv-input" name="ofrom" type="date" defaultValue={ow.from ?? ov.window.from} /></label>
            <label className="kv-label">{t.t('auditor.window.to')}<input className="kv-input" name="oto" type="date" defaultValue={ow.to ?? ov.window.to} /></label>
            <span className="kv-actions"><button type="submit" className="kv-btn kv-btn--sm">{t.t('auditor.window.apply')}</button></span>
            <p className="kv-field__hint">{t.t('auditor.window.bound', { days: formatNumber(ov.window.days, lang), max: formatNumber(ov.window.maxDays, lang), from: ov.window.from, to: ov.window.to })}</p>
          </form>

          <div className="kv-grid kv-grid--tiles">
            <div className="kv-card">
              <h2 className="kv-section-title">{t.t('auditor.tile.integrity')}</h2>
              <ul className="kv-list">
                {integrityLines(ov.integrity).map((l, i) => (
                  <li key={i}><span className={`kv-badge kv-badge--${l.tone === 'ok' ? 'ok' : l.tone === 'danger' ? 'danger' : 'muted'}`}>{t.t(`auditor.tone.${l.tone}`)}</span> {t.t(l.key, Object.fromEntries(Object.entries(l.params).map(([k, v]) => [k, typeof v === 'number' ? formatNumber(v, lang) : v])))}</li>
                ))}
              </ul>
              <p className="kv-field__hint">{t.t('auditor.integrity.when')} · {t.t(refusedKey('recordedCheck'))}</p>
            </div>
            <div className="kv-card">
              <h2 className="kv-section-title">{t.t('auditor.tile.transactions')}</h2>
              <p><strong>{formatNumber(ov.transactions.count, lang)}</strong></p>
              <p className="kv-field__hint">{t.t('auditor.tile.transactions.basis', { from: ov.window.from, to: ov.window.to })} · {t.t(refusedKey('reversalsLinked'))}</p>
            </div>
            <div className="kv-card">
              <h2 className="kv-section-title">{t.t('auditor.tile.privileged')}</h2>
              {ov.privilegedActions ? (
                <>
                  <p><strong>{formatNumber(ov.privilegedActions.total, lang)}</strong></p>
                  <p className="kv-field__hint">{t.t('auditor.tile.privileged.basis', { role: formatNumber(ov.privilegedActions.withRole, lang), reason: formatNumber(ov.privilegedActions.withReason, lang) })}</p>
                </>
              ) : <p className="kv-field__hint">{t.t('auditor.state.restricted')}</p>}
            </div>
            <div className="kv-card">
              <h2 className="kv-section-title">{t.t('auditor.tile.exceptions')}</h2>
              <p className="kv-field__hint">{t.t(refusedKey('exceptionRegister'))}</p>
              <p className="kv-field__hint">{t.t(refusedKey('numberingGaps'))}</p>
            </div>
            <div className="kv-card">
              <h2 className="kv-section-title">{t.t('auditor.tile.logged')}</h2>
              <p>{t.t(purposeKey(ov.logged.purpose))} · <code>{ov.logged.readId}</code></p>
              <p className="kv-field__hint">{t.t('auditor.tile.logged.basis')}</p>
            </div>
          </div>

          <h2 className="kv-section-title">{t.t('auditor.explorer.title')}</h2>
          <DataTable
            rows={ov.latest}
            empty={t.t('auditor.explorer.empty')}
            columns={[
              { header: t.t('auditor.explorer.when'), cell: (x) => when(x.createdAt) },
              { header: t.t('auditor.explorer.txn'), cell: (x) => <code className="kv-code kv-code--inline">{x.txnId.slice(0, 8)}…{x.txnId.slice(-4)}</code> },
              { header: t.t('auditor.explorer.type'), cell: (x) => x.txnType ?? t.t('common.dash') },
              { header: t.t('auditor.explorer.amount'), cell: (x) => money(x.legs.filter((l) => l.side === 'Cr').reduce((a, l) => a + BigInt(l.amountMinor), 0n).toString(), x.currencyCode) },
              { header: t.t('auditor.explorer.entries'), cell: (x) => <>{t.t('auditor.explorer.legs', { n: formatNumber(x.foot.legsVisible, lang), total: formatNumber(x.foot.legsTotal, lang) })} · {t.t(footKey(x.foot))}</> },
            ]}
          />
          <p className="kv-field__hint">{t.t('auditor.explorer.basis')} <Link href={LEDGER_HREF} className="kv-btn--link">{t.t('auditor.explorer.drill')}</Link></p>

          <div className="kv-card">
            <h2 className="kv-section-title">{t.t('auditor.scope.title')}</h2>
            <ul className="kv-list">
              {ov.scope.map((s) => (
                <li key={s.code}>{s.held ? '✓' : '✕'} {s.held ? <Link href={SCOPE_HREFS[s.code] ?? AUDITOR_HREF}>{t.t(scopeKey(s.code))}</Link> : t.t(scopeKey(s.code))} <code className="kv-code kv-code--inline">{s.permission}</code></li>
              ))}
              <li>✕ {t.t('auditor.scope.pii')}</li>
              <li>✕ {t.t('auditor.scope.outside')}</li>
            </ul>
          </div>
          <div className="kv-card">
            <h2 className="kv-section-title">{t.t('auditor.chain.title')}</h2>
            <p>{t.t('auditor.chain.body')}</p>
            <p className="kv-field__hint">{t.t(refusedKey('sharedChain'))}</p>
          </div>
          <div className="kv-card">
            <h2 className="kv-section-title">{t.t('auditor.access.title')}</h2>
            {PAGE_REFUSALS.overview.filter((r) => r === 'accessWindow' || r === 'firmIdentity').map((r) => <p key={r} className="kv-field__hint">{t.t(refusedKey(r))}</p>)}
          </div>
        </>
      )}

      {/* ---- the trail (masked, bounded, recorded) ---- */}
      <h2 className="kv-section-title" id="trail">{t.t('aud.title')}</h2>
      <p className="kv-muted">{t.t('aud.subtitle')}</p>
      {invalid && <p className="kv-error" role="alert">{t.t('aud.error')}: {invalid}</p>}
      <form method="get" className="kv-form kv-form--grid">
        <label className="kv-label">{t.t('aud.filter.action')}<input className="kv-input" name="action" defaultValue={form.action ?? ''} maxLength={120} placeholder="kyc.approved" /></label>
        <label className="kv-label">{t.t('aud.filter.entityType')}<input className="kv-input" name="entityType" defaultValue={form.entityType ?? ''} maxLength={60} placeholder="order" /></label>
        <label className="kv-label">{t.t('aud.filter.entityId')}<input className="kv-input" name="entityId" defaultValue={form.entityId ?? ''} placeholder="UUID" /></label>
        <label className="kv-label">{t.t('aud.filter.actor')}<input className="kv-input" name="actorUserId" defaultValue={form.actorUserId ?? ''} placeholder="UUID" /></label>
        <label className="kv-label">{t.t('aud.filter.from')}<input className="kv-input" name="from" type="date" defaultValue={form.from ?? ''} /></label>
        <label className="kv-label">{t.t('aud.filter.to')}<input className="kv-input" name="to" type="date" defaultValue={form.to ?? ''} /></label>
        <span className="kv-actions">
          <button type="submit" className="kv-btn kv-btn--sm">{t.t('aud.filter.apply')}</button>
          <Link href="/auditor" className="kv-btn kv-btn--muted kv-btn--sm">{t.t('aud.filter.clear')}</Link>
        </span>
      </form>
      {trailWindow && <p className="kv-field__hint">{t.t('auditor.trail.window', { from: trailWindow.from, to: trailWindow.to, zone: trailWindow.zone, max: formatNumber(trailWindow.maxDays, lang) })} · {t.t('auditor.trail.masked')}</p>}

      <h3 className="kv-section-title">{t.t('aud.list.title')}</h3>
      {trailState ? (
        <div className={trailState === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={trailState === 'error' ? 'alert' : 'status'}>
          <p>{t.t(realmStateKey(trailState))}</p>
          {trailState === 'window' && <p className="kv-field__hint">{t.t(windowRefusalKey(trailWindowCode))}</p>}
        </div>
      ) : (
        <DataTable
          rows={entries}
          empty={t.t('aud.list.empty')}
          columns={[
            { header: t.t('aud.list.when'), cell: (e) => <Link href={`/auditor?entry=${encodeURIComponent(e.id)}`}>{formatDate(e.createdAt, lang, { dateStyle: 'medium', timeStyle: 'medium', ...(trailWindow ? { timeZone: trailWindow.zone } : {}) })}</Link> },
            { header: t.t('aud.list.action'), cell: (e) => <code className="kv-code kv-code--inline">{e.action}</code> },
            { header: t.t('aud.list.entity'), cell: (e) => e.entityType ? `${e.entityType}${e.entityId ? ` · ${e.entityId.slice(0, 8)}` : ''}` : t.t('common.dash') },
            { header: t.t('aud.list.actor'), cell: (e) => <>{e.actorUserId ? e.actorUserId.slice(0, 8) : t.t('aud.list.system')} <span className="kv-field__hint">({roleCellKey(e) ? t.t(roleCellKey(e)!) : e.actorRole})</span></> },
            { header: t.t('aud.list.change'), cell: (e) => <span className="kv-fine kv-muted">{summarizeChange(e.oldValue, e.newValue)}{(e.maskedFields?.length ?? 0) > 0 ? ` · ${t.t('auditor.trail.maskedCount', { n: formatNumber(e.maskedFields!.length, lang) })}` : ''}</span> },
          ]}
        />
      )}
      {nextHref && <p><Link href={nextHref} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('aud.list.next')}</Link></p>}

      {selected && (
        <>
          <h3 className="kv-section-title">{t.t('aud.detail.title')} · <Link href="/auditor">{t.t('aud.detail.clear')}</Link></h3>
          {detailFailed || !entry ? <p className="kv-error" role="alert">{t.t('aud.loadError')}</p> : (
            <div className="kv-card">
              <p className="kv-fine kv-muted">
                {t.t('aud.list.action')}: <code className="kv-code kv-code--inline">{entry.action}</code>
                {' · '}{t.t('aud.list.when')}: {formatDate(entry.createdAt, lang, { dateStyle: 'medium', timeStyle: 'medium', ...(trailWindow ? { timeZone: trailWindow.zone } : {}) })}
                {' · '}{t.t('aud.list.actor')}: {entry.actorUserId ? entry.actorUserId.slice(0, 8) : t.t('aud.list.system')} ({roleCellKey(entry) ? t.t(roleCellKey(entry)!) : entry.actorRole})
                {entry.entityType ? ` · ${t.t('aud.list.entity')}: ${entry.entityType}${entry.entityId ? ` (${entry.entityId})` : ''}` : ''}
                {entry.reason ? ` · ${t.t('aud.detail.reason')}: ${entry.reason}` : ''}
                {entry.requestId ? ` · ${t.t('aud.detail.request')}: ${entry.requestId}` : ''}
              </p>
              {entry.masked === false
                ? <p className="kv-card kv-card--notice" role="status">{t.t('auditor.reveal.shown')}</p>
                : (entry.maskedFields?.length ?? 0) > 0 && (
                  <div className="kv-card kv-card--notice" role="note">
                    <p>{t.t('auditor.reveal.masked', { fields: entry.maskedFields!.join(', ') })}</p>
                    {canReveal
                      ? <p><Link href={`/auditor/reveal?entry=${encodeURIComponent(entry.id)}`} className="kv-btn--link">{t.t('auditor.reveal.start')}</Link></p>
                      : <p className="kv-field__hint">{t.t('auditor.reveal.restricted')}</p>}
                  </div>
                )}
              <h4 className="kv-section-title">{t.t('aud.detail.changed')}</h4>
              {changedKeys(entry.oldValue, entry.newValue).length === 0 ? <p className="kv-muted kv-fine">{t.t('aud.detail.noChange')}</p> : (
                <DataTable
                  rows={changedKeys(entry.oldValue, entry.newValue).map((k) => ({ k }))}
                  empty={t.t('aud.detail.noChange')}
                  columns={[
                    { header: t.t('aud.detail.field'), cell: (r) => <code className="kv-code kv-code--inline">{r.k}</code> },
                    { header: t.t('aud.detail.before'), cell: (r) => <span className="kv-fine">{compact((entry!.oldValue as Record<string, unknown> | null)?.[r.k]) || t.t('common.dash')}</span> },
                    { header: t.t('aud.detail.after'), cell: (r) => <span className="kv-fine">{compact((entry!.newValue as Record<string, unknown> | null)?.[r.k]) || t.t('common.dash')}</span> },
                  ]}
                />
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
