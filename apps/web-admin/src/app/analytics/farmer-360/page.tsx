// apps/web-admin/src/app/analytics/farmer-360/page.tsx · W109, Farmer 360 (PC-56 ADMIN-SWEEP-b4).
//
// THE LENS THAT OPENS ONE PERSON, drawn with its disciplines visible: identity arrives masked (search results too),
// every open is recorded server-side BEFORE assembly and the page says so, tiles print UNKNOWN rather than ₹0 when
// there is nothing to look at, the assembly REFUSES with the failing source's name rather than showing partial data
// as complete (W109's own error state), and the export chain (W2161–W2165) is drawn with the delivery truth: this
// platform's exports are synchronous by decision (ADMIN-10-Q1), so the receipt is HERE, not on a queue page.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { exportProfileAction } from './actions';
import { tileText, bandTone, timelineIcon, formatMinor, EXPORT_REASON_MIN, type MoneyTile } from '../../../features/analytics/farmer360';

import { Button, EmptyState, StatusPill } from '@krishalaya/ui';
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('f360.title'), robots: { index: false, follow: false } };
}

interface Identity { userId: string; name: string | null; phone: string | null; languageCode: string | null; memberSince: string; tenants: string[] }
interface Profile {
  identity: Identity;
  gmv: MoneyTile; listed: MoneyTile; dairy30d: MoneyTile; schemesYtd: MoneyTile; wallet: MoneyTile;
  risk: { score: number; band: string } | null;
  engagement: { activeDays30: number; lastActiveAt: string | null; languageCode: string | null; basis: string };
  disputes: { raised: number; against: number; resolved: number; open: number };
  timeline: { kind: string; at: string; label: string; amountMinor: string | null; ref: string }[];
}

const ERR = new Set(['q', 'reason', 'exportGrant', 'assembly', 'notFound', 'generic']);

function Tile({ t, labelKey }: { t: MoneyTile; labelKey: string }) {
  const tr = getTranslator();
  const v = tileText(t);
  return (
    <div className="kv-facts__row">
      <dt>{tr.t(labelKey)}</dt>
      <dd>
        {v.key === 'value' ? v.text : <StatusPill tone="neutral" label={tr.t('f360.unknown')} />}
        <div className="kv-detail__muted">{t.basis}</div>
      </dd>
    </div>
  );
}

export default async function Farmer360Page({ searchParams }: { searchParams: { q?: string; u?: string; ok?: string; error?: string; receipt?: string } }) {
  requireAdmin();
  const t = getTranslator();

  let results: Identity[] = []; let profile: Profile | undefined; let notice: string | undefined; let assemblyError: string | undefined;
  try {
    if (searchParams.u) profile = (await adminGet<Profile>(`analytics/farmer360/${encodeURIComponent(searchParams.u)}`)).data;
    else if (searchParams.q && searchParams.q.trim().length >= 2) results = (await adminGet<Identity[]>('analytics/farmer360/search', { q: searchParams.q.trim() })).data;
  } catch (e) {
    if (e instanceof AdminApiError && e.status === 503) assemblyError = e.message;   // the failing SOURCE, by name
    else notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`);
  }

  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;

  return (
    <section>
      <h1>{t.t('f360.heading')}</h1>
      <p className="kv-muted">{t.t('f360.lead')}</p>
      {notice && <p className="kv-error" role="alert">{notice}</p>}
      {/* W109's refusal state, with the source named: partial data is never shown as complete. */}
      {assemblyError && <p className="kv-error" role="alert">{t.t('f360.assemblyFailed')} — {assemblyError}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`f360.error.${errKey}`)}</p>}
      {searchParams.ok === 'exported' && (
        // W2161/W2162 as truth: no queue exists (ADMIN-10-Q1), so there is no position and no ETA — the receipt is
        // already in the register, and this line says which one.
        <p className="kv-success" role="status">{t.t('f360.exported', { id: searchParams.receipt ?? '' })}</p>
      )}

      {/* ---- search (no phone input — the b2 identity decision, held hardest here) ---- */}
      <form method="get" action="/analytics/farmer-360" className="kv-form">
        <label htmlFor="q" className="kv-field__label">{t.t('f360.searchLabel')}</label>
        <input id="q" name="q" className="kv-input" defaultValue={searchParams.q ?? ''} minLength={2} maxLength={120}
          placeholder={t.t('f360.searchPlaceholder')} />
        <Button type="submit">{t.t('f360.search')}</Button>
      </form>
      {results.length > 0 && (
        <ul className="kv-list">
          {results.map((r) => (
            <li key={r.userId}>
              <Link href={`/analytics/farmer-360?u=${r.userId}`}>{r.name ?? t.t('common.dash')}</Link>
              {' '}· {r.phone ?? t.t('common.dash')} · {r.languageCode}
            </li>
          ))}
        </ul>
      )}
      {searchParams.q && results.length === 0 && !profile && !notice && <EmptyState title={t.t('f360.noResults')} />}
      {!searchParams.q && !searchParams.u && <EmptyState title={t.t('f360.noSelection')} />}

      {profile && (
        <>
          <h2>
            {profile.identity.name ?? t.t('common.dash')}
            {profile.risk && <StatusPill tone={bandTone(profile.risk.band)} label={`${profile.risk.band} · ${profile.risk.score}`} />}
          </h2>
          <p className="kv-muted">
            {profile.identity.phone ?? t.t('common.dash')} · {profile.identity.languageCode} · {profile.identity.tenants.join(' · ') || t.t('f360.noTenant')} · {t.t('f360.memberSince', { d: profile.identity.memberSince.slice(0, 10) })}
          </p>
          {/* the access discipline, stated where the person is shown */}
          <p className="kv-detail__muted">{t.t('f360.viewRecorded', { u: profile.identity.userId.slice(-4) })}</p>

          <dl className="kv-facts">
            <Tile t={profile.gmv} labelKey="f360.tile.gmv" />
            <Tile t={profile.listed} labelKey="f360.tile.listed" />
            <Tile t={profile.dairy30d} labelKey="f360.tile.dairy" />
            <Tile t={profile.schemesYtd} labelKey="f360.tile.schemes" />
            <Tile t={profile.wallet} labelKey="f360.tile.wallet" />
          </dl>

          <h3>{t.t('f360.timelineHeading')}</h3>
          <ul className="kv-list">
            {profile.timeline.map((x) => (
              <li key={`${x.kind}:${x.ref}`}>
                {timelineIcon(x.kind)} {x.label}{x.amountMinor ? ` · ${formatMinor(x.amountMinor)}` : ''}
                <span className="kv-detail__muted"> — {x.at.slice(0, 10)} · {t.t(`f360.src.${x.kind}` as never)}</span>
              </li>
            ))}
          </ul>
          {profile.timeline.length === 0 && <EmptyState title={t.t('f360.timelineEmpty')} />}

          <h3>{t.t('f360.engagementHeading')}</h3>
          <p>
            {t.t('f360.activeDays', { n: String(profile.engagement.activeDays30) })}{' '}
            <span className="kv-detail__muted">{profile.engagement.basis}</span>
          </p>
          <p>
            {t.t('f360.disputes', {
              resolved: String(profile.disputes.resolved),
              total: String(profile.disputes.raised + profile.disputes.against),
              open: String(profile.disputes.open),
            })}
          </p>
          {/* the canon's richer engagement lines have no per-user source and are refused, not invented */}
          <p className="kv-detail__muted">{t.t('f360.engagementHonesty')}</p>

          {/* ---- the export (W2163 confirm = this form; W2164/W2165 = ok/error states) ---- */}
          <h3>{t.t('f360.exportHeading')}</h3>
          <p className="kv-error" role="note">{t.t('f360.exportConfirm')}</p>
          <form action={exportProfileAction} className="kv-form">
            <input type="hidden" name="userId" value={profile.identity.userId} />
            <label htmlFor="reason" className="kv-field__label">{t.t('f360.reasonLabel')}</label>
            <textarea id="reason" name="reason" className="kv-input" required minLength={EXPORT_REASON_MIN} maxLength={500} />
            <Button type="submit">{t.t('f360.export')}</Button>
          </form>
          <p className="kv-detail__muted">{t.t('f360.deliveryTruth')}</p>
        </>
      )}

      <p className="kv-detail__muted">{t.t('f360.discipline')}</p>
    </section>
  );
}
