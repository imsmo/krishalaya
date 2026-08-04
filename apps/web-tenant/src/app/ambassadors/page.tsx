// apps/web-tenant/src/app/ambassadors/page.tsx · the ambassadors admin console (P1-12). Server-first,
// requireSession-gated, behind the `ambassadors` flag (NEXT_PUBLIC_FEATURE_AMBASSADORS + the API's own flag).
// Sections — the ambassador roster (+ enroll, suspend/reinstate), and a selected ambassador's detail (profile
// edit, earnings ledger with an unpaid payout PREVIEW + the commission payout, set-target, activate-referral).
// Each section degrades on its own (Law 12). Every write is a Server Action → the audited, RBAC-gated API, which
// owns the state machines + computes/moves all commission via the wallet (Law 2/11). Money via formatMoneyMinor;
// all copy via i18n; noindex.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { DataTable } from '../../components/DataTable';
import { getTranslator, getLang } from '../../lib/i18n';
import { env } from '../../lib/env';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { TARGET_METRICS, previewUnpaidMinor, canPayout } from '../../features/ambassadors/admin';
import {
  enrollAmbassadorAction, setAmbassadorActiveAction, updateAmbassadorAction,
  payoutAmbassadorAction, activateReferralAction, setTargetAction,
} from './actions';
import type { AmbassadorProfile, AmbassadorEarning } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('amb.title'), robots: { index: false, follow: false } };
}

const OK = new Set(['enrolled', 'suspended', 'reinstated', 'updated', 'paid', 'activated', 'target']);

export default async function AmbassadorsPage({ searchParams }: { searchParams: { ok?: string; error?: string; ambassador?: string } }) {
  if (!env.featureAmbassadors) notFound();
  await requireSession('/ambassadors');
  const t = getTranslator();
  const lang = getLang();
  const selected = searchParams.ambassador || null;

  let roster: AmbassadorProfile[] = []; let rosterFailed = false;
  let profile: AmbassadorProfile | null = null; let earnings: AmbassadorEarning[] = []; let detailFailed = false;
  const [rRes] = await Promise.allSettled([tenantClient().ambassadors.list({ limit: 100 })]);
  if (rRes.status === 'fulfilled') roster = rRes.value.items; else rosterFailed = true;
  if (selected) {
    const [pRes, eRes] = await Promise.allSettled([
      tenantClient().ambassadors.get(selected),
      tenantClient().ambassadors.earnings(selected, { limit: 100 }),
    ]);
    if (pRes.status === 'fulfilled') profile = pRes.value; else detailFailed = true;
    if (eRes.status === 'fulfilled') earnings = eRes.value.items;
  }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errorKey = searchParams.error || null;
  const money = (m: string) => formatMoneyMinor(m, 'INR', lang);
  const unpaid = previewUnpaidMinor(earnings);

  return (
    <section>
      <h1>{t.t('amb.title')}</h1>
      <p className="kv-muted">{t.t('amb.subtitle')}</p>
      {okKey && <p className="kv-success" role="status">{t.t(`amb.ok.${okKey}`)}</p>}
      {errorKey && <p className="kv-error" role="alert">{t.t('amb.error')}: {errorKey}</p>}

      {/* ---- roster ---- */}
      <h2 className="kv-section-title">{t.t('amb.roster.title')}</h2>
      {rosterFailed ? <p className="kv-error" role="alert">{t.t('amb.loadError')}</p> : (
        <DataTable
          rows={roster}
          empty={t.t('amb.roster.empty')}
          columns={[
            { header: t.t('amb.roster.user'), cell: (a) => <Link href={`/ambassadors?ambassador=${encodeURIComponent(a.id)}`}><code className="kv-code kv-code--inline">{a.userId}</code></Link> },
            { header: t.t('amb.roster.stipend'), cell: (a) => money(a.monthlyStipendMinor) },
            { header: t.t('amb.roster.training'), cell: (a) => a.trainingCompletedAt ? t.t('amb.yes') : t.t('amb.no') },
            { header: t.t('amb.status'), cell: (a) => <span className="kv-badge">{a.isActive ? t.t('amb.active') : t.t('amb.suspended')}</span> },
            { header: '', cell: (a) => (
              <form action={setAmbassadorActiveAction}>
                <input type="hidden" name="id" value={a.id} />
                <input type="hidden" name="active" value={a.isActive ? 'false' : 'true'} />
                <button type="submit" className="kv-btn kv-btn--muted kv-btn--sm">{a.isActive ? t.t('amb.suspend') : t.t('amb.reinstate')}</button>
              </form>
            ) },
          ]}
        />
      )}
      <details className="kv-disclosure">
        <summary>{t.t('amb.enroll.title')}</summary>
        <form action={enrollAmbassadorAction} className="kv-form kv-form--grid">
          <label className="kv-label">{t.t('amb.enroll.user')}<input className="kv-input" name="userId" required placeholder="user UUID" /></label>
          <label className="kv-label">{t.t('amb.enroll.stipend')} ({t.t('amb.minor')})<input className="kv-input" name="monthlyStipendMinor" inputMode="numeric" pattern="[0-9]*" defaultValue="0" /></label>
          <label className="kv-check"><input type="checkbox" name="kioskEnabled" /> {t.t('amb.enroll.kiosk')}</label>
          <label className="kv-check"><input type="checkbox" name="aepsEnabled" /> {t.t('amb.enroll.aeps')}</label>
          <button type="submit" className="kv-btn">{t.t('amb.enroll.submit')}</button>
        </form>
      </details>

      {/* ---- selected ambassador detail ---- */}
      {selected && (
        <>
          <h2 className="kv-section-title">{t.t('amb.detail.title')} · <Link href="/ambassadors">{t.t('amb.detail.clear')}</Link></h2>
          {detailFailed || !profile ? <p className="kv-error" role="alert">{t.t('amb.loadError')}</p> : (
            <>
              <p className="kv-muted kv-fine">
                {t.t('amb.detail.unpaid')}: <strong>{money(unpaid)}</strong>
                {canPayout(profile, unpaid) && (
                  <> · <span className="kv-actions"><form action={payoutAmbassadorAction}><input type="hidden" name="id" value={profile.id} /><button type="submit" className="kv-btn kv-btn--sm">{t.t('amb.detail.payout')}</button></form></span></>
                )}
              </p>

              <h3 className="kv-section-title">{t.t('amb.earnings.title')}</h3>
              <DataTable
                rows={earnings}
                empty={t.t('amb.earnings.empty')}
                columns={[
                  { header: t.t('amb.earnings.event'), cell: (e) => e.eventCode },
                  { header: t.t('amb.earnings.amount'), cell: (e) => money(e.amountMinor) },
                  { header: t.t('amb.earnings.status'), cell: (e) => e.payoutId ? t.t('amb.earnings.paid') : t.t('amb.earnings.unpaid') },
                ]}
              />

              <details className="kv-disclosure">
                <summary>{t.t('amb.update.title')}</summary>
                <form action={updateAmbassadorAction} className="kv-form kv-form--grid">
                  <input type="hidden" name="id" value={profile.id} />
                  <label className="kv-label">{t.t('amb.enroll.stipend')} ({t.t('amb.minor')})<input className="kv-input" name="monthlyStipendMinor" inputMode="numeric" pattern="[0-9]*" defaultValue={profile.monthlyStipendMinor} /></label>
                  <label className="kv-check"><input type="checkbox" name="kioskEnabled" defaultChecked={profile.kioskEnabled} /> {t.t('amb.enroll.kiosk')}</label>
                  <label className="kv-check"><input type="checkbox" name="aepsEnabled" defaultChecked={profile.aepsEnabled} /> {t.t('amb.enroll.aeps')}</label>
                  <label className="kv-check"><input type="checkbox" name="trainingCompleted" defaultChecked={!!profile.trainingCompletedAt} /> {t.t('amb.update.training')}</label>
                  <button type="submit" className="kv-btn">{t.t('amb.save')}</button>
                </form>
              </details>

              <details className="kv-disclosure">
                <summary>{t.t('amb.target.title')}</summary>
                <form action={setTargetAction} className="kv-form kv-form--grid">
                  <input type="hidden" name="ambassadorId" value={profile.id} />
                  <label className="kv-label">{t.t('amb.target.metric')}
                    <select className="kv-input" name="metric" defaultValue="onboardings">{TARGET_METRICS.map((m) => <option key={m} value={m}>{t.t(`amb.metric.${m}`)}</option>)}</select>
                  </label>
                  <label className="kv-label">{t.t('amb.target.start')}<input className="kv-input" name="periodStart" type="date" required /></label>
                  <label className="kv-label">{t.t('amb.target.end')}<input className="kv-input" name="periodEnd" type="date" required /></label>
                  <label className="kv-label">{t.t('amb.target.value')}<input className="kv-input" name="targetValue" inputMode="numeric" pattern="[0-9]*" required /></label>
                  <button type="submit" className="kv-btn">{t.t('amb.target.submit')}</button>
                </form>
              </details>

              <details className="kv-disclosure">
                <summary>{t.t('amb.referral.title')}</summary>
                <p className="kv-fine kv-muted">{t.t('amb.referral.help')}</p>
                <form action={activateReferralAction} className="kv-form kv-form--grid">
                  <input type="hidden" name="ambassadorId" value={profile.id} />
                  <label className="kv-label">{t.t('amb.referral.id')}<input className="kv-input" name="referralId" required placeholder="referral UUID" /></label>
                  <button type="submit" className="kv-btn">{t.t('amb.referral.activate')}</button>
                </form>
              </details>
            </>
          )}
        </>
      )}
    </section>
  );
}
