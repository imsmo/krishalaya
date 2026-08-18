// apps/web-admin/src/app/moderation/risk/accounts/[userId]/page.tsx · W094, the risk profile (PC-56 ADMIN-5d).
//
// W094 prints the promise this page is built to keep: "Every point is traceable to an event — 'the computer says no'
// is never the answer we give anyone." Three consequences, all of them refusals:
//
//   1. THE EQUATION IS RENDERED ONLY WHEN IT CLOSES. If base + Σweights ≠ score, the page shows a failure notice
//      naming both figures instead of a line of arithmetic that is visibly wrong under a caption claiming every
//      point is traceable. Today it almost always shows "unavailable", because the scorer stores a weighted TOTAL
//      rather than the events behind it — the panel has never had data. Naming that beats inventing a breakdown,
//      which on this screen would be fabricated evidence about a named person.
//   2. THE BAND EFFECTS ARE LABELLED ADVISORY. Nothing on the platform reads a band. Drawing "payout delay 48h" as
//      though it applies tells a safety operator the problem is handled, and takes away the attention that was the
//      only thing actually protecting anybody.
//   3. THE ONE PROMISE THE PLATFORM DOES KEEP IS SHOWN AS KEPT: wallet funds remain withdrawable. Money is never
//      confiscated, no code path confiscates it, and that is the line a blocked person most needs to read.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../../lib/admin-client';
import { getTranslator } from '../../../../../lib/i18n';
import { adminNoticeKey } from '../../../../../features/nav/nav-model';
import { changeBandAction } from '../../../actions';
import { Button, StatusPill } from '@krishalaya/ui';
import {
  RISK_BANDS, bandTone, readingTone, equationRenderable, equationText, factorNoticeKey,
  effectTone, advisoryBannerVisible, type BandReading, type FactorPanel, type BandEffect,
} from '../../../../../features/trust/trust-safety';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ts.profile.title'), robots: { index: false, follow: false } };
}

interface Profile {
  userId: string; tenantId: string | null; score: number | null; band: string | null;
  name: string | null; phone: string | null; computedAt: string | null;
  reading: BandReading; factors: FactorPanel;
  effects: BandEffect[]; effectsEnforced: boolean; ladderAdvisory: string;
  events: { eventCode: string; weight: number; createdAt: string; referenceType: string | null }[];
  eventLimit: number;
}

const OK = new Set(['bandChanged']);
const ERR = new Set(['band', 'sameBand', 'reason', 'elevation', 'conflict', 'invalid', 'notFound', 'generic']);

export default async function RiskProfilePage({ params, searchParams }: { params: { userId: string }; searchParams: { ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();

  let p: Profile | undefined; let notice: string | undefined;
  try { p = (await adminGet<Profile>(`trust/risk/accounts/${encodeURIComponent(params.userId)}`)).data; }
  catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;

  if (!p) {
    return (
      <section>
        <p className="kv-backlink"><Link href="/moderation/risk">{t.t('ts.backRisk')}</Link></p>
        <h1>{t.t('ts.profile.heading')}</h1>
        {/* W094's own empty state: profiles appear after the first scored event. Reported as an absence, never as a
            default "standard · 50" — that would invent a fact about somebody. */}
        <p className="kv-error" role="alert">{notice}</p>
      </section>
    );
  }

  const eq = equationText(p.factors);
  const factorNotice = factorNoticeKey(p.factors);

  return (
    <section>
      <p className="kv-backlink"><Link href="/moderation/risk">{t.t('ts.backRisk')}</Link></p>
      <h1>{p.name ?? t.t('ts.risk.noName')}</h1>
      <p className="kv-muted">{p.phone ?? t.t('common.dash')} · {p.userId}</p>
      {okKey && <p className="kv-success" role="status">{t.t(`ts.profile.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`ts.error.${errKey}`)}</p>}

      <dl className="kv-facts">
        <div className="kv-facts__row"><dt>{t.t('ts.risk.col.score')}</dt><dd>{p.score === null ? t.t('common.dash') : p.score}</dd></div>
        <div className="kv-facts__row">
          <dt>{t.t('ts.risk.col.band')}</dt>
          <dd><StatusPill tone={bandTone(p.band)} label={p.band ? t.t(`ts.band.${p.band}`) : t.t('common.unknown')} /></dd>
        </div>
        <div className="kv-facts__row">
          <dt>{t.t('ts.risk.col.reading')}</dt>
          <dd><StatusPill tone={readingTone(p.reading)} label={t.t(`ts.reading.${p.reading?.kind ?? 'unknown'}`)} /></dd>
        </div>
        <div className="kv-facts__row"><dt>{t.t('ts.risk.col.computed')}</dt><dd>{p.computedAt ?? t.t('common.dash')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('ts.profile.tenant')}</dt><dd>{p.tenantId ?? t.t('common.dash')}</dd></div>
      </dl>

      {p.reading?.kind === 'ladder_drift' && (
        <p className="kv-error" role="alert">
          {t.t('ts.profile.ladderDrift', { band: t.t(`ts.band.${p.reading.band}`), canon: t.t(`ts.band.${p.reading.canon}`), score: String(p.reading.score) })}
        </p>
      )}
      {p.reading?.kind === 'inconsistent' && (
        <p className="kv-error" role="alert">
          {t.t('ts.profile.inconsistent', { band: String(p.reading.band), expected: t.t(`ts.band.${p.reading.expected}`), score: String(p.reading.score) })}
        </p>
      )}

      <h2>{t.t('ts.profile.factorsHeading')}</h2>
      {equationRenderable(p.factors) && eq ? (
        <>
          <p className="kv-pre"><code>{eq}</code></p>
          <ul className="kv-list">
            {p.factors.kind === 'closed' && p.factors.factors.map((f, i) => (
              <li key={`${f.event}-${i}`} >
                <strong>{f.event}</strong> {f.weight > 0 ? `+${f.weight}` : f.weight}
                {f.detail ? ` — ${f.detail}` : ''}
              </li>
            ))}
          </ul>
          <p className="kv-detail__muted">{t.t('ts.profile.traceable')}</p>
        </>
      ) : (
        <p className={factorNotice === 'doesNotClose' ? 'kv-error' : 'kv-muted'} role={factorNotice === 'doesNotClose' ? 'alert' : undefined}>
          {factorNotice === 'doesNotClose' && p.factors.kind === 'does_not_close'
            ? t.t('ts.profile.doesNotClose', { sum: String(p.factors.sum), score: String(p.factors.score) })
            : (p.factors && p.factors.kind === 'unavailable' ? p.factors.reason : t.t('ts.profile.factorsUnavailable'))}
        </p>
      )}

      <h2>{t.t('ts.profile.effectsHeading')}</h2>
      {advisoryBannerVisible(p.effects) && <p className="kv-error" role="alert">{p.ladderAdvisory}</p>}
      <ul className="kv-list">
        {p.effects.map((e) => (
          <li key={e.key} >
            <StatusPill tone={effectTone(e)} label={e.enforced ? t.t('ts.profile.enforced') : t.t('ts.profile.notEnforced')} />{' '}
            {t.t(`ts.effect.${e.key}`)}
            {e.enforcedBy && <span className="kv-detail__muted"> — {e.enforcedBy}</span>}
          </li>
        ))}
      </ul>

      <h2>{t.t('ts.profile.eventsHeading')}</h2>
      <table className="kv-table">
        <thead><tr><th>{t.t('ts.profile.col.when')}</th><th>{t.t('ts.rules.col.event')}</th><th>{t.t('ts.rules.col.weight')}</th><th>{t.t('ts.profile.col.ref')}</th></tr></thead>
        <tbody>
          {p.events.map((e, i) => (
            <tr key={`${e.createdAt}-${i}`}><td>{e.createdAt}</td><td>{e.eventCode}</td><td>{e.weight}</td><td>{e.referenceType ?? t.t('common.dash')}</td></tr>
          ))}
        </tbody>
      </table>
      {p.events.length === 0 && <p className="kv-muted">{t.t('ts.profile.noEvents')}</p>}
      {p.events.length >= p.eventLimit && <p className="kv-detail__muted">{t.t('ts.profile.eventsCapped', { n: String(p.eventLimit) })}</p>}

      <h2>{t.t('ts.profile.changeHeading')}</h2>
      <p className="kv-muted">{t.t('ts.profile.changeLead')}</p>
      <form action={changeBandAction} className="kv-form">
        <input type="hidden" name="userId" value={p.userId} />
        <input type="hidden" name="currentBand" value={p.band ?? ''} />
        <label className="kv-field__label">
          {t.t('ts.risk.col.band')}
          <select className="kv-input" name="band" required defaultValue="">
            <option value="" disabled>{t.t('common.choose')}</option>
            {RISK_BANDS.map((bd) => <option key={bd} value={bd}>{t.t(`ts.band.${bd}`)}</option>)}
          </select>
        </label>
        {/* The reason is SENT TO THE PERSON and is what an appeal is judged against — W089's second principle. */}
        <label className="kv-field__label">{t.t('ts.profile.reason')}<textarea className="kv-input" name="reason" required minLength={20} maxLength={1000} /></label>
        <p className="kv-detail__muted">{t.t('ts.profile.blockedNeedsChecker')}</p>
        <Button type="submit" variant="danger">{t.t('ts.profile.change')}</Button>
      </form>
      <p className="kv-detail__muted">{t.t('ts.profile.moneyNeverConfiscated')}</p>
    </section>
  );
}
