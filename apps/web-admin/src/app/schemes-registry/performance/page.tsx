// apps/web-admin/src/app/schemes-registry/performance/page.tsx · W078, scheme performance (PC-56 ADMIN-4b).
//
// "The number that matters: benefit money actually reaching farmers because Krishalaya existed." A founder reads this
// screen to decide where to send people and money, so every number renders its denominator or renders nothing:
//   • a rate with no denominator is BLANK, never 0%;
//   • a rate over fewer than 30 decisions shows the COUNTS instead — still true, just no longer a rate;
//   • the rejection breakdown shows its own COVERAGE, and below 50% coded it shows counts instead of percentages,
//     because "42% Aadhaar seeding" computed from 300 of 10,000 rejections is a staffing decision made on noise;
//   • the headline carries its ATTRIBUTION BASIS, because "₹38.2 Cr facilitated" on a slide is a claim somebody will
//     be asked to defend in a room.
// Permission is `schemes.registry.read` — W078's own restricted state says the report needs the lower bar and the
// per-farmer drill-in needs the applications permission. There is no drill-in on this page.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import {
  minorText, rateView, durationKey, breakdownTrustworthy, orderedSlices, sliceWidthPct, hasUnattributed,
  type Rate, type Duration, type RejectionBreakdown, type BenefitTotal,
} from '../../../features/schemes-registry/oversight';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('sov.perfTitle'), robots: { index: false, follow: false } };
}

interface TopScheme { schemeCode: string; schemeName: string; amountMinor: string; transfers: number }
interface Report {
  financialYearStart: string;
  benefits: BenefitTotal;
  applicationsFiled: number;
  assistedShare: Rate;
  approvalRate: Rate;
  medianTimeToDisbursal: Duration;
  topSchemes: TopScheme[];
  rejections: RejectionBreakdown;
  fixableShare: Rate;
  computedLive: boolean;
}

function RateCell({ r, t }: { r: Rate; t: ReturnType<typeof getTranslator> }) {
  const v = rateView(r);
  if (v.kind === 'unknown') return <>{t.t('sov.rateUnknown')}</>;
  // The counts, not the percentage. A rate over too few rows is arithmetic pretending to be information.
  if (v.kind === 'lowSample') return <>{t.t('sov.rateLowSample', { n: String(v.numerator), d: String(v.denominator) })}</>;
  return <>{t.t('sov.ratePct', { pct: String(v.pct), d: String(v.denominator) })}</>;
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="kv-card kv-stat">
      <div className="kv-stat__label">{label}</div>
      <div className="kv-stat__value">{value}</div>
      {hint && <div className="kv-detail__muted">{hint}</div>}
    </div>
  );
}

export default async function SchemePerformancePage() {
  requireAdmin();
  const t = getTranslator();

  let r: Report | undefined; let notice: string | undefined;
  try { r = (await adminGet<Report>('schemes-oversight/performance')).data; }
  catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  if (!r) {
    return (
      <section>
        <p className="kv-backlink"><Link href="/schemes-registry/schemes">{t.t('sr.backSchemes')}</Link></p>
        <h1>{t.t('sov.perfTitle')}</h1>
        <p className="kv-error" role="alert">{notice}</p>
        {/* The canon's error copy promises "KPIs are computed nightly; cached values shown". There is no cache, so
            this page does not say there is one — a comfortable lie about staleness is still a lie. */}
        <p className="kv-detail__muted">{t.t('sov.noCacheNote')}</p>
      </section>
    );
  }

  const dk = durationKey(r.medianTimeToDisbursal);
  const trust = breakdownTrustworthy(r.rejections);
  const coverage = rateView(r.rejections.coverage);

  return (
    <section>
      <p className="kv-backlink"><Link href="/schemes-registry/schemes">{t.t('sr.backSchemes')}</Link></p>
      <h1>{t.t('sov.perfTitle')}</h1>
      <p className="kv-muted">{t.t('sov.perfLead')}</p>
      <p className="kv-detail__muted">{t.t('sov.fyFrom', { from: r.financialYearStart.slice(0, 10) })}</p>

      <div className="kv-stat-row">
        <Stat
          label={t.t('sov.benefitsFacilitated')}
          value={minorText(r.benefits.amountMinor)}
          hint={t.t('sov.benefitBasis', { n: String(r.benefits.transfers) })}
        />
        <Stat label={t.t('sov.applicationsFiled')} value={String(r.applicationsFiled)} />
        <Stat label={t.t('sov.assistedShareLabel')} value={<RateCell r={r.assistedShare} t={t} />} />
        <Stat label={t.t('sov.approvalRate')} value={<RateCell r={r.approvalRate} t={t} />} hint={t.t('sov.approvalDenominator')} />
        <Stat
          label={t.t('sov.medianDisbursal')}
          // `none_disbursed` is NOT "0 days" — the fastest possible number for the slowest possible reality.
          value={dk === 'days' && r.medianTimeToDisbursal.kind === 'days'
            ? t.t('sov.days', { n: String(r.medianTimeToDisbursal.days) })
            : t.t(`sov.duration.${dk}`)}
          hint={dk === 'days' && r.medianTimeToDisbursal.kind === 'days' ? t.t('sov.medianSample', { n: String(r.medianTimeToDisbursal.sampleSize) }) : undefined}
        />
      </div>

      {/* Credits we observed but cannot attribute to a filing made here. Counted separately rather than claimed —
          the word "facilitated" has to survive somebody checking it. */}
      {hasUnattributed(r.benefits) && (
        <p className="kv-notice">{t.t('sov.unattributed', { n: String(r.benefits.unattributedTransfers), amount: minorText(r.benefits.unattributedAmountMinor) })}</p>
      )}
      {r.computedLive && <p className="kv-detail__muted">{t.t('sov.computedLive')}</p>}

      <h2>{t.t('sov.topSchemesHeading')}</h2>
      {r.topSchemes.length === 0 ? <p className="kv-empty">{t.t('sov.noBenefitData')}</p> : (
        <ul>
          {r.topSchemes.map((s) => (
            <li key={s.schemeCode}><strong>{s.schemeCode}</strong> — {minorText(s.amountMinor)} · {s.transfers} {t.t('sov.credits')}</li>
          ))}
        </ul>
      )}

      <h2>{t.t('sov.rejectionsHeading')}</h2>
      {/* THE COVERAGE LINE COMES FIRST, ABOVE THE BREAKDOWN. It is what decides whether anything below can be
          believed, and putting it underneath would let a reader form a view before reaching it. */}
      {coverage.kind === 'unknown'
        ? <p className="kv-notice">{t.t('sov.rejNoCoverage')}</p>
        : <p className={trust ? 'kv-detail__muted' : 'kv-notice'}>
            {t.t('sov.rejCoverage', { coded: String(r.rejections.coded), total: String(r.rejections.totalRejections), uncoded: String(r.rejections.uncoded) })}
          </p>}
      {!trust && r.rejections.coded > 0 && <p className="kv-notice">{t.t('sov.rejLowCoverage')}</p>}

      {r.rejections.slices.length === 0 ? <p className="kv-empty">{t.t('sov.noRejections')}</p> : (
        <ul className="kv-list">
          {orderedSlices(r.rejections).map((s) => (
            <li key={s.code}>
              {t.t(`sov.rc.${s.code}`)}{' '}
              {s.fixable && <span className="kv-status kv-status--warn">{t.t('sov.fixable')}</span>}{' '}
              {/* Percentages ONLY when coverage supports them; otherwise the count, which is always true. */}
              {trust && s.pctOfCoded !== null ? `${s.pctOfCoded}%` : t.t('sov.nApplications', { n: String(s.n) })}
              {/* A computed width is the one carve-out from this console's no-inline-styles rule — a per-row
                  percentage cannot be a class. Written the way the other five bar charts here are written, because
                  ADMIN-3c found `.kv-bar` referenced by three pages and styled by none: a bar with no width is
                  invisible and nobody notices for three waves. aria-hidden because the number is already in text. */}
              <span className="kv-bar" style={{ width: `${sliceWidthPct(s.n, r.rejections.coded)}%` }} aria-hidden="true" />
            </li>
          ))}
        </ul>
      )}
      {/* The uncoded rows, on their own line and never folded into "other" — `other` means an officer looked and none
          of the codes fitted, which is a real signal that the code list needs work. */}
      {r.rejections.uncoded > 0 && <p className="kv-detail__muted">{t.t('sov.rejUncodedRow', { n: String(r.rejections.uncoded) })}</p>}
      {trust && <p className="kv-detail__muted">{t.t('sov.fixableShare')} <RateCell r={r.fixableShare} t={t} /></p>}

      <p className="kv-backlink"><Link href="/schemes-registry/oversight-exports">{t.t('sov.exportLink')}</Link></p>
    </section>
  );
}
