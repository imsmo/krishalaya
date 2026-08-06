// apps/web-gov/src/app/mgnrega/job-cards/page.tsx · GW-5 job-card register (PC-55 B2, canon W346).
// The register + the audit-stamped export. Two things worth knowing about this page:
//
// 1. WHOSE CARDS THESE ARE. `mgnrega_job_cards` has no tenant_id — a job card is national and belongs to a PERSON,
//    so tenant RLS cannot scope it. B2 found the oversight read returning every tenant's cardholders and fixed it in
//    the API: the list is now scoped to households who are members of THIS tenant (user_tenant_roles). The page says
//    so, because "how many job cards do we have" means something different from "how many exist in India".
//
// 2. WHY THE EXPORT LOOKS LIKE A RECEIPT AND NOT A DOWNLOAD. Ledger Appendix 5's law: every export a GW wave ships
//    returns an audit-stamped receipt. The button therefore produces a receipt id, a row count and a timestamp
//    written to the audit ledger in the same transaction as the read. No silent file appears: data leaving the
//    platform is an accountable act with a name on it.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../lib/session';
import { govClient } from '../../../lib/api-client';
import { DataTable } from '../../../components/DataTable';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatDate } from '@krishalaya/i18n';
import { exportAction } from '../actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('mg.cards.title'), robots: { index: false, follow: false } };
}

const ERR = new Set(['export', 'export_report', 'forbidden', 'conflict', 'notfound', 'invalid']);

type Card = { id: string; jobCardNo: string; regionId: string | null; daysUsedFy: number; lastSyncedAt: string | null };

export default async function JobCardRegisterPage({ searchParams }: {
  searchParams: { ok?: string; error?: string; receipt?: string; rows?: string; at?: string };
}) {
  await requireSession('/mgnrega/job-cards');
  const t = getTranslator();
  const lang = getLang();

  let cards: Card[] = []; let failed = false; let forbidden = false;
  try { cards = await govClient().labour.jobCards({ limit: 100 }); }
  catch (e) { forbidden = (e as { status?: number }).status === 403; failed = !forbidden; }

  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('mg.cards.title')}</h1>
        <Link href="/mgnrega" className="kv-btn--link">← {t.t('mg.title')}</Link>
      </div>
      <p className="kv-field__hint">{t.t('mg.cards.hint')}</p>

      {searchParams.ok === 'exported' && (
        <p className="kv-success" role="status">
          {t.t('mg.export.ok', { rows: String(searchParams.rows ?? '0'), receipt: String(searchParams.receipt ?? '') })}
          {searchParams.at ? ` · ${formatDate(searchParams.at, lang, { dateStyle: 'medium', timeStyle: 'short' })}` : ''}
        </p>
      )}
      {errKey && <p className="kv-error" role="alert">{t.t(`mg.error.${errKey}`)}</p>}

      {forbidden && <p className="kv-error" role="alert">{t.t('mg.forbidden')}</p>}
      {failed && <p className="kv-error" role="alert">{t.t('mg.loadError')}</p>}
      {!forbidden && !failed && (
        <DataTable
          rows={cards}
          empty={t.t('mg.cards.empty')}
          columns={[
            { header: t.t('mg.colJobCard'), cell: (c) => <Link href={`/mgnrega/job-cards/${c.id}`} className="kv-link">{c.jobCardNo}</Link> },
            { header: t.t('mg.colDaysUsed'), cell: (c) => `${c.daysUsedFy} / 100` },
            { header: t.t('mg.colLastSynced'), cell: (c) => (c.lastSyncedAt ? formatDate(c.lastSyncedAt, lang, { dateStyle: 'medium', timeStyle: 'short' }) : <span className="kv-badge">{t.t('mg.neverSynced')}</span>) },
          ]}
        />
      )}

      <div className="kv-actions">
        <form action={exportAction} className="kv-inline-form">
          <input type="hidden" name="report" value="job_cards" />
          <input type="hidden" name="from" value="/mgnrega/job-cards" />
          <button type="submit" className="kv-btn kv-btn--muted">{t.t('mg.exportCardsBtn')}</button>
        </form>
        <form action={exportAction} className="kv-inline-form">
          <input type="hidden" name="report" value="works" />
          <input type="hidden" name="from" value="/mgnrega/job-cards" />
          <button type="submit" className="kv-btn kv-btn--muted">{t.t('mg.exportWorksBtn')}</button>
        </form>
      </div>
      <p className="kv-field__hint">{t.t('mg.exportNote')}</p>
      <p className="kv-field__hint kv-note">{t.t('mg.cards.membershipNote')}</p>
    </section>
  );
}
