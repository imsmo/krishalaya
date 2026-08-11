// apps/web-tenant/src/app/people/[userId]/360/page.tsx · W155, Farmer 360 (PC-56 TENANT-1b-3).
//
// **THE SENTENCE AT THE FOOT OF THE CANON SCREEN IS THIS PAGE'S DESIGN CONSTRAINT, NOT ITS DECORATION:**
//
//   "This page exists to serve Ramesh P., not to surveil him. He can request his full record anytime (DPDP data access)
//    and it looks exactly like this — nothing hidden, nothing we'd be ashamed to show him."
//
// So every figure here is one the member could check from their own records. A derived number they cannot reproduce has no
// business on a page they are entitled to see.
//
// **FOUR OF THE FIVE TILES ARE REAL, WHICH WAS THIS WAVE'S SURPRISE.** `crop_seasons` (0010) has carried season, year,
// sown date and ACTUAL yield per parcel since migration 0010 with no read path at all; `land_parcels` carries area, unit
// and a verification status; `dbt_transfers` carries scheme credits; `milk_bills` carries paid dairy income.
//
// **AND THE FIFTH IS REFUSED IN THE MOST DELIBERATE WAY ON THIS PAGE.** "Credit readiness · strong · KCC-ready" has no
// lender rule behind it anywhere on this platform. A farmer told by their FPO's console that they are KCC-ready, who takes
// a day off to visit a bank that refuses them, has lost a day's wages to a number we invented. So the EVIDENCE is shown —
// settled payouts, months with income, land on file and verified, KYC — and the verdict is absent. Staff hand a banker the
// evidence; the banker decides.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import { SdkError, type Farmer360 } from '@krishalaya/sdk-js';
import { landSummary, seasonLabel, yieldLabel, hasAnySource } from '../../../../features/people/farmer360';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('f360.title'), robots: { index: false, follow: false } };
}

export default async function Farmer360Page({ params }: { params: { userId: string } }) {
  await requireSession(`/people/${params.userId}/360`);
  const t = getTranslator();
  const lang = getLang();

  let f: Farmer360 | null = null;
  let restricted = false;
  let failed = false;
  try {
    f = await tenantClient().members.view360(params.userId);
  } catch (e) {
    if (e instanceof SdkError && e.status === 404) notFound();
    // **403 IS ITS OWN STATE, NOT AN ERROR.** W155's restricted state says "Needs `member.view360` — the deepest
    // per-person view in your console, so the narrowest grant", and a staff member who lacks it needs to be told which
    // grant to ask for, not shown a retry button that will fail identically.
    if (e instanceof SdkError && e.status === 403) restricted = true;
    else failed = true;
  }

  if (restricted) {
    return (
      <section>
        <h1>{t.t('f360.title')}</h1>
        <p className="kv-notice" role="status">{t.t('f360.restricted')}</p>
        <p><Link href={`/people/${params.userId}`} className="kv-link">{t.t('f360.back')}</Link></p>
      </section>
    );
  }
  if (failed || !f) {
    return (
      <section>
        <h1>{t.t('f360.title')}</h1>
        {/* W155: "One or more module reads failed — partial data is never shown as complete." */}
        <p className="kv-error" role="alert">{t.t('f360.loadError')}</p>
        <p><Link href={`/people/${params.userId}`} className="kv-link">{t.t('f360.back')}</Link></p>
      </section>
    );
  }

  const land = landSummary(f.land.byUnit);

  return (
    <section>
      <nav aria-label={t.t('member.breadcrumb')} className="kv-fine">
        <Link href="/people" className="kv-link">{t.t('people.title')}</Link> ›{' '}
        <Link href={`/people/${f.userId}`} className="kv-link">{f.fullName ?? t.t('people.unnamed')}</Link> › 360
      </nav>

      <div className="kv-page-head">
        <h1>{t.t('f360.heading', { name: f.fullName ?? t.t('people.unnamed') })}</h1>
        <p className="kv-muted">{t.t('f360.subtitle')}</p>
      </div>

      {/* ---------------------------------------------------------------- the tiles */}
      <div className="kv-cards">
        <div className="kv-card">
          <span className="kv-card__title">{t.t('f360.tile.income')}</span>
          <strong>
            {/* **THE TOTAL IS ABSENT WHEN DAIRY IS UNKNOWN**, because a total that silently treats unknown as zero is a
                wrong number wearing a confident face. The crop figure is still shown on its own line below. */}
            {f.income.totalRealizedMinor === null
              ? formatMoneyMinor(f.income.cropRealizedMinor, 'INR', lang)
              : formatMoneyMinor(f.income.totalRealizedMinor, 'INR', lang)}
          </strong>
          <span className="kv-fine">
            {t.t('f360.tile.incomeCrops', {
              amount: formatMoneyMinor(f.income.cropRealizedMinor, 'INR', lang), n: f.income.cropPayoutCount,
            })}
            {' · '}
            {f.income.dairyRealizedMinor === null
              ? t.t('f360.tile.incomeNoDairy')
              : t.t('f360.tile.incomeDairy', {
                  amount: formatMoneyMinor(f.income.dairyRealizedMinor, 'INR', lang), n: f.income.dairyBillCount,
                })}
          </span>
          <span className="kv-fine">{t.t('f360.tile.incomeNote')}</span>
        </div>

        <div className="kv-card">
          <span className="kv-card__title">{t.t('f360.tile.land')}</span>
          {/* **AREAS ARE PRINTED PER UNIT AND NEVER ADDED TOGETHER.** A hectare is 2.47 acres, so summing a 2-acre and a
              1-hectare parcel gives "3", which is a quantity in no unit — and a silent conversion is how a 4.2-acre
              holding becomes a 10.4-acre one on a loan application. */}
          <strong>{land.length === 0 ? t.t('common.dash') : land.map((l) => `${l.area} ${l.unit}`).join(' + ')}</strong>
          <span className="kv-fine">
            {t.t('f360.tile.landNote', {
              parcels: land.reduce((n, l) => n + l.parcels, 0),
              verified: land.reduce((n, l) => n + l.verifiedParcels, 0),
              records: f.land.parcelsWithRecord,
            })}
            {f.land.irrigation.length > 0 ? ` · ${f.land.irrigation.join(', ')}` : ''}
          </span>
        </div>

        <div className="kv-card">
          <span className="kv-card__title">{t.t('f360.tile.schemes')}</span>
          <strong>{formatMoneyMinor(f.schemesYtdTotalMinor, 'INR', lang)}</strong>
          <span className="kv-fine">
            {f.schemesYtd.length === 0
              ? t.t('f360.tile.schemesNone')
              : f.schemesYtd.map((s) => `${s.schemeName} ${formatMoneyMinor(s.creditedMinor, 'INR', lang)}`).join(' + ')}
          </span>
          <span className="kv-fine">{t.t('f360.tile.schemesNote')}</span>
        </div>

        {/* THE REFUSAL, drawn as evidence rather than as a verdict. */}
        <div className="kv-card">
          <span className="kv-card__title">{t.t('f360.tile.credit')}</span>
          <strong>{t.t('common.dash')}</strong>
          <span className="kv-fine">
            {t.t('f360.tile.creditEvidence', {
              payouts: f.credit.settledPayouts12mo,
              months: f.credit.monthsWithIncome12mo,
              parcels: f.credit.landParcelsOnFile,
              verified: f.credit.landParcelsVerified,
            })}
            {' · '}
            {f.credit.allRolesKycVerified ? t.t('f360.tile.creditKycYes') : t.t('f360.tile.creditKycNo')}
          </span>
          <span className="kv-fine">{t.t('f360.tile.creditAbsent')}</span>
        </div>
      </div>

      {/* ---------------------------------------------------------------- the season timeline */}
      <h2 className="kv-section-title">{t.t('f360.seasons')}</h2>
      {f.seasons.length === 0 ? (
        <p className="kv-empty-state">{t.t('f360.noSeasons')}</p>
      ) : (
        <>
          <table className="kv-table">
            <thead>
              <tr>
                <th scope="col">{t.t('f360.colSeason')}</th>
                <th scope="col">{t.t('f360.colCrop')}</th>
                <th scope="col">{t.t('f360.colArea')}</th>
                <th scope="col">{t.t('f360.colSown')}</th>
                <th scope="col">{t.t('f360.colYield')}</th>
              </tr>
            </thead>
            <tbody>
              {f.seasons.map((s, i) => (
                <tr key={`${s.season}-${s.year}-${i}`}>
                  <td>{seasonLabel(s, t)}</td>
                  <td>{s.productName ?? t.t('f360.unknownCrop')}</td>
                  <td>{s.parcelArea} {s.parcelAreaUnit}</td>
                  <td>{s.sownOn ? formatDate(s.sownOn, lang) : t.t('common.dash')}</td>
                  {/* **A MISSING ACTUAL YIELD SAYS "not recorded" AND NEVER FALLS BACK TO THE EXPECTED FIGURE.** W155
                      states the rule itself: "Yields are his records + FPO weighbridge — never estimated without saying
                      so." Substituting the expectation would make a bad season look average on a document a banker reads. */}
                  <td>{yieldLabel(s, t)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* The link the canon draws between a harvest and a sale does not exist in the schema, and the page says so
              rather than implying the two columns explain each other. */}
          <p className="kv-fine kv-note">{t.t('f360.seasonsNote')}</p>
        </>
      )}

      {/* ---------------------------------------------------------------- the advisory panel, disclosed as absent */}
      <h2 className="kv-section-title">{t.t('f360.advisory')}</h2>
      <p className="kv-notice">{t.t('f360.advisoryAbsent')}</p>

      {/* ---------------------------------------------------------------- access & dignity */}
      <h2 className="kv-section-title">{t.t('f360.dignity')}</h2>
      <p className="kv-fine">{t.t('f360.dignityNote')}</p>
      {/* W155 prints "This view is recorded · Farmer-360 access". The timestamp is the one the server WROTE, not one the
          browser made up — so the sentence on the screen and the row in the audit log agree. */}
      <p className="kv-fine kv-note">{t.t('f360.recorded', { at: formatDate(f.viewedAt, lang) })}</p>
      {!hasAnySource(f) && <p className="kv-notice">{t.t('f360.nothingOnFile')}</p>}

      <p><Link href={`/people/${f.userId}`} className="kv-link">{t.t('f360.back')}</Link></p>
    </section>
  );
}
