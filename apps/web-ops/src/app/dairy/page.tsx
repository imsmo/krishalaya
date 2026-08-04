// apps/web-ops/src/app/dairy/page.tsx · dairy collection POS (PC-34 OW-4). Four sections, each degrading
// independently: (1) record a collection — member + shift + weighment + FAT/SNF quality + adulteration flags;
// the SERVER prices the slip from the rate card (the POS never computes money); (2) member slip lookup
// (member + date range → collections with server-priced amounts); (3) milk bills — generate for a period,
// then ONLY the legal step (preview → approve → pay, pay = the idempotent money run); (4) rate charts, read-only.
import type { Metadata } from 'next';
import { requireSession } from '../../lib/session';
import { opsClient } from '../../lib/api-client';
import { DataTable } from '../../components/DataTable';
import { getTranslator, getLang } from '../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import { DAIRY_SHIFTS, ADULTERATION_FLAGS, BILL_STATUSES, isBillStatus, canPreview, canApprove, canPay } from '../../features/dairy/pos';
import { recordCollectionAction, generateBillAction, billLifecycleAction } from './actions';
import type { DairyMembership, DairyCollection, MilkBill, RateCard } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('dairy.title'), robots: { index: false, follow: false } };
}

const OK = new Set(['collection', 'bill', 'preview', 'approve', 'pay']);
const ERR = new Set(['collection', 'col_member', 'col_shift', 'col_date', 'col_weight', 'col_fat', 'col_snf', 'col_dup', 'bill', 'bill_member', 'bill_period', 'bill_dup', 'action', 'illegal']);

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

  let rates: RateCard[] = [];
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

      <details className="kv-card" open>
        <summary className="kv-card__title">{t.t('dairy.record')}</summary>
        {membersFailed ? <p className="kv-error" role="alert">{t.t('dairy.loadError')}</p> : (
          <form action={recordCollectionAction} className="kv-form">
            <label htmlFor="dc-member" className="kv-field__label">{t.t('dairy.member')}</label>
            <select id="dc-member" name="membershipId" className="kv-input" required defaultValue="">
              <option value="" disabled>{t.t('dairy.memberChoose')}</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.memberCode}</option>)}
            </select>
            <fieldset className="kv-fieldset">
              <legend className="kv-field__label">{t.t('dairy.shift')}</legend>
              {DAIRY_SHIFTS.map((s, i) => (
                <label key={s} className="kv-radio"><input type="radio" name="shift" value={s} defaultChecked={i === 0} /> {t.t(`dairy.shift.${s}`)}</label>
              ))}
            </fieldset>
            <label htmlFor="dc-date" className="kv-field__label">{t.t('dairy.date')}</label>
            <input id="dc-date" name="collectedOn" type="date" className="kv-input" required />
            <label htmlFor="dc-weight" className="kv-field__label">{t.t('dairy.weight')}</label>
            <input id="dc-weight" name="weightKg" className="kv-input" required inputMode="decimal" pattern="\d{1,4}(\.\d{1,3})?" />
            <label htmlFor="dc-fat" className="kv-field__label">{t.t('dairy.fat')}</label>
            <input id="dc-fat" name="fatPct" className="kv-input" required inputMode="decimal" pattern="\d{1,2}(\.\d{1,2})?" />
            <label htmlFor="dc-snf" className="kv-field__label">{t.t('dairy.snf')}</label>
            <input id="dc-snf" name="snfPct" className="kv-input" required inputMode="decimal" pattern="\d{1,2}(\.\d{1,2})?" />
            <fieldset className="kv-fieldset">
              <legend className="kv-field__label">{t.t('dairy.exceptions')}</legend>
              <label className="kv-radio"><input type="checkbox" name="waterFlag" value="1" /> {t.t('dairy.waterFlag')}</label>
              {ADULTERATION_FLAGS.map((f) => (
                <label key={f} className="kv-radio"><input type="checkbox" name="adulteration" value={f} /> {t.t(`dairy.flag.${f}`)}</label>
              ))}
            </fieldset>
            <p className="kv-field__hint">{t.t('dairy.priceHint')}</p>
            <button type="submit" className="kv-btn">{t.t('dairy.recordBtn')}</button>
          </form>
        )}
      </details>

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
            { header: t.t('dairy.amount'), cell: (c) => <strong>{formatMoneyMinor(c.amountMinor, 'INR', lang)}</strong> },
            { header: t.t('dairy.exceptionsCol'), cell: (c) => (c.waterFlag ? t.t('dairy.waterFlag') : t.t('common.dash')) },
          ]}
        />
      ) : <p className="kv-muted">{t.t('dairy.slipsPick')}</p>}

      <h2>{t.t('dairy.bills')}</h2>
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
            { header: t.t('dairy.net'), cell: (b) => <strong>{formatMoneyMinor(b.netMinor, 'INR', lang)}</strong> },
            { header: t.t('dairy.colStatus'), cell: (b) => <span className="kv-badge">{t.t(`dairy.status.${b.status}`) || b.status}</span> },
            {
              header: t.t('dairy.colActions'),
              cell: (b) => {
                const kind = canPreview(b.status) ? 'preview' : canApprove(b.status) ? 'approve' : canPay(b.status) ? 'pay' : null;
                return kind ? (
                  <form action={billLifecycleAction} className="kv-inline-form">
                    <input type="hidden" name="id" value={b.id} />
                    <input type="hidden" name="kind" value={kind} />
                    <button type="submit" className="kv-btn--link">{t.t(`dairy.act.${kind}`)}</button>
                  </form>
                ) : t.t('common.dash');
              },
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
            { header: t.t('dairy.rateCard'), cell: (r) => (r as { defaultName?: string; id: string }).defaultName ?? r.id.slice(0, 8) },
            { header: t.t('dairy.animal'), cell: (r) => (r as { animalType?: string }).animalType ?? t.t('common.dash') },
          ]}
        />
      )}
    </section>
  );
}
