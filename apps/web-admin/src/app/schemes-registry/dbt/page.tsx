// apps/web-admin/src/app/schemes-registry/dbt/page.tsx · W076, the DBT / PFMS monitor (PC-56 ADMIN-4b).
//
// THE LEAD LINE IS A CONSTRAINT, NOT A CAPTION: "We OBSERVE and notify; the money moves government → farmer bank
// directly, never through our ledger." Every number on this page is an OBSERVATION of a payment the platform had no
// part in moving, and the page says so — because the plausible mistake is somebody reconciling these totals against
// the wallet, finding correctly that they do not balance, and "fixing" it.
//
// AND ITS RESTRICTED STATE IS A COLUMN LAW: "bank fields never shown here at all." Not masked, not gated — absent.
// admin-api enumerates every column by hand and runs `assertNoBankFields` over the payload on the way out, so a future
// `SELECT *` fails loudly here instead of disclosing quietly. `pfms_ref` IS shown and is not a bank field: it is the
// government's own transaction handle, the string an operator quotes to PFMS to ask what happened to a credit.
//
// The canon's fourth tile — "Celebration SMS sent 14,020" — is reported as NOT BUILT. Rendering 0 would say we tried
// 14,204 times and failed.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { DataTable, Column } from '../../../components/DataTable';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { minorText, instalmentLabel, bounceClass, seedingText, notificationKnown, type NotifyGap } from '../../../features/schemes-registry/oversight';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('sov.dbtTitle'), robots: { index: false, follow: false } };
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="kv-card kv-stat">
      <div className="kv-stat__label">{label}</div>
      <div className="kv-stat__value">{value}</div>
      {hint && <div className="kv-detail__muted">{hint}</div>}
    </div>
  );
}

interface SchemeRollup { schemeCode: string; schemeName: string; transfers: number; amountMinor: string; farmers: number; latestInstalment: number | null; lastCreditedOn: string | null }
interface BounceReason { reasonCode: string; open: number; total: number; amountMinor: string }
interface Monitor {
  windowDays: number; creditsObserved: number; amountMinor: string; farmers: number; lastCreditedOn: string | null;
  byScheme: SchemeRollup[]; bouncesByReason: BounceReason[];
  aadhaarSeedingFailures: { open: number; total: number; amountMinor: string } | null;
  celebrationNotify: NotifyGap; doctrine: { writesLedger: boolean; reason: string };
}
interface CreditRow {
  id: string; creditedOn: string; instalmentNo: number | null; amountMinor: string; pfmsRef: string | null;
  govtAppRef: string | null; schemeCode: string; tenantName: string | null;
  farmer: { nameMasked: string | null; phoneMasked: string | null } | null; notified: null;
}

export default async function DbtMonitorPage({ searchParams }: { searchParams: { days?: string; schemeId?: string; cursor?: string } }) {
  requireAdmin();
  const t = getTranslator();
  const days = /^[0-9]{1,3}$/.test(searchParams.days ?? '') ? searchParams.days : undefined;
  const schemeId = searchParams.schemeId?.trim() || undefined;

  let m: Monitor | undefined; let notice: string | undefined;
  try { m = (await adminGet<Monitor>('schemes-oversight/dbt', { days })).data; }
  catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  // The credit stream degrades independently of the tiles (Law 12) — the canon's own error copy for this screen says
  // "Government disbursement runs continue unaffected — only this monitor view failed to load."
  let credits: CreditRow[] = []; let nextCursor: string | undefined; let notifyKnown = false; let streamNotice: string | undefined;
  try {
    const res = await adminGet<CreditRow[]>('schemes-oversight/dbt/credits', { days, schemeId, cursor: searchParams.cursor, limit: 50 });
    credits = res.data ?? [];
    nextCursor = (res.meta?.nextCursor as string | undefined) ?? undefined;
    notifyKnown = notificationKnown(res.meta as { notificationStateAvailable?: boolean } | undefined);
  } catch (e) { streamNotice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const seeding = seedingText(m?.aadhaarSeedingFailures);
  const cols: Column<CreditRow>[] = [
    { header: t.t('sov.creditedOn'), cell: (r) => r.creditedOn },
    { header: t.t('sov.applicant'), cell: (r) => <span className="kv-masked">{r.farmer ? `${r.farmer.nameMasked ?? t.t('sov.noName')} · ${r.farmer.phoneMasked ?? t.t('sov.noPhone')}` : t.t('sov.noFarmerLink')}</span> },
    { header: t.t('sov.scheme'), cell: (r) => r.schemeCode },
    { header: t.t('sov.instalment'), cell: (r) => instalmentLabel(r.instalmentNo) ?? t.t('sov.unnumbered') },
    { header: t.t('sov.amount'), cell: (r) => minorText(r.amountMinor) },
    // The government's handle, shown in full: it identifies a disbursement rather than an account, and a masked one is
    // useless for the only thing it is for.
    { header: t.t('sov.pfmsRef'), cell: (r) => r.pfmsRef ?? t.t('common.dash') },
    { header: t.t('sov.application'), cell: (r) => r.govtAppRef ?? t.t('common.dash') },
    // The canon's row shows "SMS gu ✓ 🎉". There is no notification record, so the cell says the state is unknown
    // rather than rendering an unticked box, which would claim a failed attempt.
    { header: t.t('sov.notified'), cell: () => (notifyKnown ? t.t('common.dash') : <span className="kv-detail__muted">{t.t('sov.notifyUnknown')}</span>) },
  ];

  return (
    <section>
      <p className="kv-backlink"><Link href="/schemes-registry/schemes">{t.t('sr.backSchemes')}</Link></p>
      <h1>{t.t('sov.dbtTitle')}</h1>
      <p className="kv-muted">{t.t('sov.dbtLead')}</p>
      {/* The doctrine, on screen, where a future reconciler will read it. */}
      <p className="kv-notice">{t.t('sov.dbtDoctrine')}</p>
      <p className="kv-notice">{t.t('sov.noBankFields')}</p>

      {notice ? <p className="kv-error" role="alert">{notice}</p> : m && (
        <>
          <div className="kv-stat-row">
            <Stat label={t.t('sov.creditsObserved', { days: String(m.windowDays) })} value={String(m.creditsObserved)} hint={t.t('sov.farmersReached', { n: String(m.farmers) })} />
            <Stat label={t.t('sov.benefitTotal')} value={minorText(m.amountMinor)} />
            <Stat
              label={t.t('sov.seedingFailures')}
              // NULL is not 0. "No such reason in the bounce data" and "zero seeding failures" are different facts.
              value={seeding.known ? String(seeding.open) : t.t('common.dash')}
              hint={seeding.known ? t.t('sov.seedingOpenOf', { total: String(seeding.total) }) : t.t('sov.seedingUnknown')}
            />
          </div>

          {/* THE TILE THE CANON SHOWS AND THE PLATFORM CANNOT HONESTLY FILL. */}
          {!m.celebrationNotify.available && (
            <>
              <p className="kv-notice">{t.t('sov.notifyNotBuilt')}</p>
              <ul className="kv-detail__muted">
                {(m.celebrationNotify.missing ?? []).map((k) => <li key={k}>{t.t(`sov.notifyMissing.${k}`)}</li>)}
              </ul>
            </>
          )}

          <h2>{t.t('sov.bySchemeHeading')}</h2>
          {m.byScheme.length === 0 ? <p className="kv-empty">{t.t('sov.noTransfers')}</p> : (
            <ul>
              {m.byScheme.map((s) => (
                <li key={s.schemeCode}>
                  <strong>{s.schemeCode}</strong> — {s.transfers} {t.t('sov.credits')} · {minorText(s.amountMinor)} · {t.t('sov.farmersReached', { n: String(s.farmers) })}
                  {instalmentLabel(s.latestInstalment) ? ` · ${t.t('sov.latestInstalment', { n: instalmentLabel(s.latestInstalment) as string })}` : ''}
                </li>
              ))}
            </ul>
          )}

          <h2>{t.t('sov.bouncesHeading')}</h2>
          {m.bouncesByReason.length === 0 ? <p className="kv-empty">{t.t('sov.allQuiet')}</p> : (
            <ul>
              {m.bouncesByReason.map((b) => (
                <li key={b.reasonCode}>
                  <span className={bounceClass(b.open, b.total)}>{t.t(`sov.bounce.${b.reasonCode}`)}</span>{' '}
                  {t.t('sov.bounceCounts', { open: String(b.open), total: String(b.total) })} · {minorText(b.amountMinor)}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <h2>{t.t('sov.creditStreamHeading')}</h2>
      <p className="kv-backlink"><Link href="/schemes-registry/oversight-exports">{t.t('sov.exportLink')}</Link></p>
      {streamNotice ? <p className="kv-error" role="alert">{streamNotice}</p> : (
        <>
          <DataTable columns={cols} rows={credits} empty={t.t('sov.noCredits')} />
          {nextCursor && (
            <p className="kv-pager">
              <Link className="kv-btn" href={`/schemes-registry/dbt?${new URLSearchParams({ ...(days ? { days } : {}), ...(schemeId ? { schemeId } : {}), cursor: nextCursor }).toString()}`}>
                {t.t('common.nextPage')}
              </Link>
            </p>
          )}
        </>
      )}
    </section>
  );
}
