// apps/web-gov/src/app/mgnrega/job-cards/[id]/page.tsx · GW-5 the 100-day ledger + muster view (PC-55 B2).
// One household's card, and the number that decides whether they may be given more work this year.
//
// TWO COUNTS, NEVER MERGED INTO A COMFORTABLE ONE:
//   • what THIS PLATFORM observed (Σ attended day-fractions from real musters), and
//   • what the STATE ledger says (`days_used_fy`, mirrored — raise-only, never invented).
// The higher of the two is what the cap is computed from, because overstating a worker's remaining entitlement is
// the error that gets someone turned away at a worksite after travelling there. The page labels which side is
// higher and, when no state sync exists, says plainly that the state's own register is authoritative and pending.
//
// The muster list below is the evidence for the platform's count — day by day, with the source of each row, so a
// number an officer disputes can be traced to the attendance entry that produced it. Wages shown are informational
// only: MGNREGA wages are paid BANK-SIDE by the state, and this platform never pays them.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '../../../../lib/session';
import { govClient } from '../../../../lib/api-client';
import { DataTable } from '../../../../components/DataTable';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { formatDate, formatMoneyMinor } from '@krishalaya/i18n';
import { capView, ledgerClaim } from '../../../../features/mgnrega/program';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('mg.card.title'), robots: { index: false, follow: false } };
}

type Ledger = Awaited<ReturnType<ReturnType<typeof govClient>['labour']['mgnregaCardLedger']>> & {
  jobCard?: { id: string; jobCardNo: string; daysUsedFyMirrored: number; lastSyncedAt: string | null };
  musters?: Array<{ attended: boolean; dayFraction: number; attendedOn: string; workId: string; wageMinor: string | null; source: string }>;
};

export default async function JobCardLedgerPage({ params }: { params: { id: string } }) {
  await requireSession(`/mgnrega/job-cards/${params.id}`);
  const t = getTranslator();
  const lang = getLang();

  let l: Ledger;
  try { l = (await govClient().labour.mgnregaCardLedger(params.id)) as Ledger; }
  catch { notFound(); }   // 404 and 403 both land here: a card outside this tenant's membership simply does not exist here

  const observed = l.observedByPlatform.days;
  const mirrored = l.jobCard?.daysUsedFyMirrored ?? null;
  const cap = capView(observed, mirrored, l.guaranteeDays);
  const claim = ledgerClaim(l.stateLedger);
  const musters = l.musters ?? [];

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('mg.card.title')}{l.jobCard ? ` · ${l.jobCard.jobCardNo}` : ''}</h1>
        <Link href="/mgnrega/job-cards" className="kv-btn--link">← {t.t('mg.cards.title')}</Link>
      </div>

      <dl className="kv-facts">
        <div className="kv-facts__row"><dt>{t.t('mg.guarantee')}</dt><dd>{l.guaranteeDays}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('mg.observedByPlatform')}</dt><dd>{observed} · {t.t('mg.musterCount', { n: String(l.observedByPlatform.musterCount) })}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('mg.mirroredByState')}</dt><dd>{mirrored ?? t.t('common.dash')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('mg.usedForCap')}</dt><dd>{cap.usedForCap} · {t.t(`mg.higher.${cap.higher}`)}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('mg.daysRemaining')}</dt><dd><strong>{l.daysRemaining}</strong></dd></div>
        <div className="kv-facts__row"><dt>{t.t('mg.colLastSynced')}</dt><dd>{l.jobCard?.lastSyncedAt ? formatDate(l.jobCard.lastSyncedAt, lang, { dateStyle: 'medium', timeStyle: 'short' }) : <span className="kv-badge">{t.t('mg.neverSynced')}</span>}</dd></div>
      </dl>

      <p className={claim === 'synced' ? 'kv-field__hint' : 'kv-notice'} role="note">
        {claim === 'synced' ? t.t('mg.card.syncedNote') : t.t('mg.card.pendingNote')}
      </p>
      {l.stateLedger?.note && <p className="kv-field__hint">{l.stateLedger.note}</p>}
      <p className="kv-field__hint">{t.t('mg.capNote')}</p>

      <h2 className="kv-section-title">{t.t('mg.musters')}</h2>
      <DataTable
        rows={musters}
        empty={t.t('mg.mustersEmpty')}
        columns={[
          { header: t.t('mg.colAttendedOn'), cell: (m) => formatDate(m.attendedOn, lang) },
          { header: t.t('mg.colAttended'), cell: (m) => (m.attended ? `${t.t('mg.attendedYes')} · ${m.dayFraction}` : t.t('mg.attendedNo')) },
          { header: t.t('mg.colWork'), cell: (m) => m.workId.slice(0, 8) + '…' },
          { header: t.t('mg.colWage'), cell: (m) => (m.wageMinor ? formatMoneyMinor(m.wageMinor, 'INR', lang) : t.t('common.dash')) },
          { header: t.t('mg.colSource'), cell: (m) => t.t(`mg.source.${m.source}`) || m.source },
        ]}
      />
      <p className="kv-field__hint kv-note">{t.t('mg.wageNote')}</p>
    </section>
  );
}
