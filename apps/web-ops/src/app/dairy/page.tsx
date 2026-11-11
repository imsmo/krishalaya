// apps/web-ops/src/app/dairy/page.tsx · the dairy desk (PC-34 OW-4). Sections, each degrading independently. PC-56 OPS-3a: (1) the pour-record
// form MOVED to the counter (`/pos/collect` — the centre in your custody, by member code, the day bounded; founder Q2-A, Q5-A, Q10-A); this page
// links it; (2) member slip lookup
// (member + date range → collections with server-priced amounts); (3) milk bills — generate for a period, preview a draft (PC-56 OPS-1a:
// approve and pay are NOT on this console — founder Q2-A; the run is read at /payout); (4) rate charts, read-only.
import type { Metadata } from 'next';
import { requireSession } from '../../lib/session';
import { opsClient } from '../../lib/api-client';
import { DataTable } from '../../components/DataTable';
import { getTranslator, getLang } from '../../lib/i18n';
import { formatDate } from '@krishalaya/i18n';
import { moneyText } from '../../features/rtl/money';   // PC-56 RTL-1e: the Indian shape, isolated, under Arabic
import { BILL_STATUSES, isBillStatus, canPreview } from '../../features/dairy/pos';
import { generateBillAction, previewBillAction } from './actions';
import Link from 'next/link';
import type { DairyMembership, DairyCollection, MilkBill, DairyRateCard } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('dairy.title'), robots: { index: false, follow: false } };
}

const OK = new Set(['bill', 'preview']);
const ERR = new Set(['bill', 'bill_member', 'bill_period', 'bill_dup', 'action', 'illegal']);

export default async function DairyPosPage({ searchParams }: { searchParams: { ok?: string; error?: string; slipMember?: string; slipFrom?: string; slipTo?: string; billStatus?: string } }) {
  await requireSession('/dairy');
  const t = getTranslator();
  const lang = getLang();
  const client = opsClient();

  let members: DairyMembership[] = []; let membersFailed = false;
  try { members = (await client.dairy.listMemberships({ box: 'all', limit: 100 })).items; }
  catch { membersFailed = true; }

  const slipMember = (searchParams.slipMember ?? '').trim();
  const slipFrom = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.slipFrom ?? '') ? String(searchParams.slipFrom) : '';
  const slipTo = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.slipTo ?? '') ? String(searchParams.slipTo) : '';
  let slips: DairyCollection[] = []; let slipsFailed = false;
  if (slipMember && slipFrom && slipTo) {
    try { slips = (await client.dairy.listCollections({ membershipId: slipMember, from: slipFrom, to: slipTo, limit: 62 })).items; }
    catch { slipsFailed = true; }
  }

  const billStatus = isBillStatus(searchParams.billStatus) ? searchParams.billStatus : undefined;
  let bills: MilkBill[] = []; let billsFailed = false;
  try { bills = (await client.dairy.listBills({ box: 'all', status: billStatus as MilkBill['status'], limit: 50 })).items; }
  catch { billsFailed = true; }

  let rates: DairyRateCard[] = [];
  try { rates = await client.dairy.listRateCards({ activeOnly: true }); } catch { rates = []; }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const memberCode = (id: string) => members.find((m) => m.id === id)?.memberCode ?? id.slice(0, 8);

  return (
    <section>
      <h1>{t.t('dairy.title')}</h1>
      <p className="kv-field__hint">{t.t('dairy.hint')}</p>
      {okKey && <p className="kv-success" role="status">{t.t(`dairy.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`dairy.error.${errKey}`)}</p>}

      {/* PC-56 OPS-3a (founder Q2-A; one write, one path — the 6d-4 rule): the pour-record form MOVED to the counter, `/pos/collect`, which lists
          only the centre in your custody by member code and bounds the day. This page keeps the member's pours, the bills and the cards. */}
      <p className="kv-statement" data-kv-statement="ops3.pos.dairyMoved">{t.t('ops3.pos.dairyMoved')} <Link href="/pos/home" className="kv-btn--link" data-kv-real="pos">{t.t('ops3.pos.dairyMovedLink')}</Link></p>

      <h2>{t.t('dairy.slips')}</h2>
      <form method="get" action="/dairy" className="kv-inline-form" role="search" aria-label={t.t('dairy.slips')}>
        <label htmlFor="sl-member" className="kv-field__label">{t.t('dairy.member')}</label>
        <select id="sl-member" name="slipMember" className="kv-input" defaultValue={slipMember}>
          <option value="">{t.t('dairy.memberChoose')}</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.memberCode}</option>)}
        </select>
        <label htmlFor="sl-from" className="kv-field__label">{t.t('dairy.from')}</label>
        <input id="sl-from" name="slipFrom" type="date" className="kv-input" defaultValue={slipFrom} />
        <label htmlFor="sl-to" className="kv-field__label">{t.t('dairy.to')}</label>
        <input id="sl-to" name="slipTo" type="date" className="kv-input" defaultValue={slipTo} />
        <button type="submit" className="kv-btn kv-btn--muted">{t.t('dairy.show')}</button>
      </form>
      {slipsFailed ? <p className="kv-error" role="alert">{t.t('dairy.loadError')}</p> : slipMember && slipFrom && slipTo ? (
        <DataTable
          rows={slips}
          empty={t.t('dairy.slipsEmpty')}
          columns={[
            { header: t.t('dairy.date'), cell: (c) => formatDate(c.collectedOn, lang) },
            { header: t.t('dairy.shiftCol'), cell: (c) => t.t(`dairy.shift.${c.shift}`) },
            { header: t.t('dairy.amount'), cell: (c) => <strong>{moneyText(c.amountMinor, 'INR', lang)}</strong> },
            { header: t.t('dairy.exceptionsCol'), cell: (c) => (c.waterFlag ? t.t('dairy.waterFlag') : t.t('common.dash')) },
          ]}
        />
      ) : <p className="kv-muted">{t.t('dairy.slipsPick')}</p>}

      <h2>{t.t('dairy.bills')}</h2>
      <p className="kv-statement" data-kv-statement="ops1.payout.statement">{t.t('ops1.payout.statement')} <Link href="/payout" className="kv-btn--link" data-kv-real="payout">{t.t('ops1.payout.dairyLink')}</Link></p>
      <form method="get" action="/dairy" className="kv-inline-form" role="search" aria-label={t.t('dairy.bills')}>
        <label htmlFor="bl-status" className="kv-field__label">{t.t('dairy.colStatus')}</label>
        <select id="bl-status" name="billStatus" className="kv-input" defaultValue={billStatus ?? ''}>
          <option value="">{t.t('dairy.status.any')}</option>
          {BILL_STATUSES.map((s) => <option key={s} value={s}>{t.t(`dairy.status.${s}`)}</option>)}
        </select>
        <button type="submit" className="kv-btn kv-btn--muted">{t.t('dairy.show')}</button>
      </form>
      {billsFailed ? <p className="kv-error" role="alert">{t.t('dairy.loadError')}</p> : (
        <DataTable
          rows={bills}
          empty={t.t('dairy.billsEmpty')}
          columns={[
            { header: t.t('dairy.member'), cell: (b) => memberCode(b.membershipId) },
            { header: t.t('dairy.period'), cell: (b) => `${formatDate(b.periodStart, lang)} – ${formatDate(b.periodEnd, lang)}` },
            { header: t.t('dairy.litres'), cell: (b) => b.totalLitres },
            { header: t.t('dairy.net'), cell: (b) => <strong>{moneyText(b.netMinor, 'INR', lang)}</strong> },
            { header: t.t('dairy.colStatus'), cell: (b) => <span className="kv-badge">{t.t(`dairy.status.${b.status}`) || b.status}</span> },
            {
              header: t.t('dairy.colActions'),
              // PC-56 OPS-1a (Q2-A): only PREVIEW is offered here (a state step, no ledger posting); approve and pay are not on this console.
              cell: (b) => canPreview(b.status) ? (
                <form action={previewBillAction} className="kv-inline-form">
                  <input type="hidden" name="id" value={b.id} />
                  <button type="submit" className="kv-btn--link">{t.t('dairy.act.preview')}</button>
                </form>
              ) : t.t('common.dash'),
            },
          ]}
        />
      )}

      <details className="kv-card">
        <summary className="kv-card__title">{t.t('dairy.generate')}</summary>
        <form action={generateBillAction} className="kv-form">
          <label htmlFor="gb-member" className="kv-field__label">{t.t('dairy.member')}</label>
          <select id="gb-member" name="membershipId" className="kv-input" required defaultValue="">
            <option value="" disabled>{t.t('dairy.memberChoose')}</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.memberCode}</option>)}
          </select>
          <label htmlFor="gb-start" className="kv-field__label">{t.t('dairy.from')}</label>
          <input id="gb-start" name="periodStart" type="date" className="kv-input" required />
          <label htmlFor="gb-end" className="kv-field__label">{t.t('dairy.to')}</label>
          <input id="gb-end" name="periodEnd" type="date" className="kv-input" required />
          <p className="kv-field__hint">{t.t('dairy.generateHint')}</p>
          <button type="submit" className="kv-btn">{t.t('dairy.generateBtn')}</button>
        </form>
      </details>

      <h2>{t.t('dairy.rates')}</h2>
      {rates.length === 0 ? <p className="kv-muted">{t.t('dairy.ratesEmpty')}</p> : (
        <DataTable
          rows={rates}
          empty={t.t('dairy.ratesEmpty')}
          columns={[
            // PC-56 OPS-3c · OPS3-B17 (E13): the SDK `DairyRateCard` carries every `toJSON` field, so the casts are gone. The full read is `/rates`.
            { header: t.t('dairy.rateCard'), cell: (r) => r.defaultName },
            { header: t.t('dairy.animal'), cell: (r) => r.animalType },
          ]}
        />
      )}
    </section>
  );
}
