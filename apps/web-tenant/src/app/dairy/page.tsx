// apps/web-tenant/src/app/dairy/page.tsx · the dairy cooperative MCC-operator console (P1-12). Server-first,
// requireSession-gated, behind the `dairy` flag (NEXT_PUBLIC_FEATURE_DAIRY + the API's own flag). Five sections —
// MCCs, rate cards, members, counter collection-entry, and the per-cycle milk-bill settlement workflow
// (generate → preview → approve → pay) — each loads independently and degrades on its own (Law 12). Every write is
// a Server Action → the audited, RBAC-gated API, which is authoritative for money + pricing (Law 2/11). Money via
// formatMoneyMinor; all copy via i18n; noindex.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { DataTable } from '../../components/DataTable';
import { getTranslator, getLang } from '../../lib/i18n';
import { env } from '../../lib/env';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { ANIMAL_TYPES, PRICING_MODELS, PAYMENT_CYCLES, MILK_SHIFTS, nextBillActions } from '../../features/dairy/calc';
import {
  createMccAction, setMccActiveAction, enrolMemberAction, createRateCardAction,
  recordCollectionAction, generateBillAction, previewBillAction, approveBillAction, payBillAction,
} from './actions';
import type { DairyMcc, DairyMembership, DairyRateCard, MilkBill } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('dairy.title'), robots: { index: false, follow: false } };
}

const OK = new Set(['mcc', 'mcc.on', 'mcc.off', 'member', 'ratecard', 'collection', 'bill', 'bill.previewed', 'bill.approved', 'bill.paid']);
const MINOR = /^\d{1,15}$/;

export default async function DairyPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  if (!env.featureDairy) notFound();
  await requireSession('/dairy');
  const t = getTranslator();
  const lang = getLang();

  let mccs: DairyMcc[] = []; let cards: DairyRateCard[] = []; let members: DairyMembership[] = []; let bills: MilkBill[] = [];
  let mccsFailed = false; let cardsFailed = false; let membersFailed = false; let billsFailed = false;
  const [mRes, cRes, meRes, bRes] = await Promise.allSettled([
    tenantClient().dairy.listMccs({ activeOnly: false, limit: 100 }),
    tenantClient().dairy.listRateCards({ activeOnly: false }),
    tenantClient().dairy.listMemberships({ box: 'all', limit: 100 }),
    tenantClient().dairy.listBills({ box: 'all', limit: 100 }),
  ]);
  if (mRes.status === 'fulfilled') mccs = mRes.value.items; else mccsFailed = true;
  if (cRes.status === 'fulfilled') cards = cRes.value; else cardsFailed = true;
  if (meRes.status === 'fulfilled') members = meRes.value.items; else membersFailed = true;
  if (bRes.status === 'fulfilled') bills = bRes.value.items; else billsFailed = true;

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errorKey = searchParams.error || null;
  const money = (m: string) => formatMoneyMinor(m, 'INR', lang);

  return (
    <section>
      <h1>{t.t('dairy.title')}</h1>
      <p className="kv-muted">{t.t('dairy.subtitle')}</p>
      {okKey && <p className="kv-success" role="status">{t.t(`dairy.ok.${okKey}`)}</p>}
      {errorKey && <p className="kv-error" role="alert">{t.t('dairy.error')}: {errorKey}</p>}

      {/* ---- MCCs ---- */}
      <h2 className="kv-section-title">{t.t('dairy.mcc.title')}</h2>
      {mccsFailed ? <p className="kv-error" role="alert">{t.t('dairy.loadError')}</p> : (
        <DataTable
          rows={mccs}
          empty={t.t('dairy.mcc.empty')}
          columns={[
            { header: t.t('dairy.mcc.code'), cell: (m) => m.code },
            { header: t.t('dairy.mcc.name'), cell: (m) => m.defaultName },
            { header: t.t('dairy.status'), cell: (m) => m.isActive ? t.t('dairy.active') : t.t('dairy.inactive') },
            { header: '', cell: (m) => (
              <form action={setMccActiveAction}>
                <input type="hidden" name="id" value={m.id} />
                <input type="hidden" name="isActive" value={m.isActive ? 'false' : 'true'} />
                <button type="submit" className="kv-btn kv-btn--muted kv-btn--sm">{m.isActive ? t.t('dairy.disable') : t.t('dairy.enable')}</button>
              </form>
            ) },
          ]}
        />
      )}
      <details className="kv-disclosure">
        <summary>{t.t('dairy.mcc.add')}</summary>
        <form action={createMccAction} className="kv-form kv-form--grid">
          <label className="kv-label">{t.t('dairy.mcc.code')}<input className="kv-input" name="code" required maxLength={40} /></label>
          <label className="kv-label">{t.t('dairy.mcc.name')}<input className="kv-input" name="defaultName" required maxLength={150} /></label>
          <label className="kv-label">{t.t('dairy.mcc.capacity')}<input className="kv-input" name="capacityLitresShift" inputMode="decimal" placeholder="2000" /></label>
          <button type="submit" className="kv-btn">{t.t('dairy.mcc.create')}</button>
        </form>
      </details>

      {/* ---- rate cards ---- */}
      <h2 className="kv-section-title">{t.t('dairy.rate.title')}</h2>
      <p className="kv-muted kv-fine">{t.t('dairy.rate.help')}</p>
      {cardsFailed ? <p className="kv-error" role="alert">{t.t('dairy.loadError')}</p> : (
        <DataTable
          rows={cards}
          empty={t.t('dairy.rate.empty')}
          columns={[
            { header: t.t('dairy.rate.name'), cell: (c) => c.defaultName },
            { header: t.t('dairy.rate.animal'), cell: (c) => t.t(`dairy.animal.${c.animalType}`) },
            { header: t.t('dairy.rate.model'), cell: (c) => t.t(`dairy.model.${c.pricingModel}`) },
            { header: t.t('dairy.rate.fat'), cell: (c) => c.ratePerKgFatMinor ? money(c.ratePerKgFatMinor) : t.t('common.dash') },
            { header: t.t('dairy.rate.snf'), cell: (c) => c.ratePerKgSnfMinor ? money(c.ratePerKgSnfMinor) : t.t('common.dash') },
            { header: t.t('dairy.rate.from'), cell: (c) => c.effectiveFrom },
            { header: t.t('dairy.status'), cell: (c) => c.isActive ? t.t('dairy.active') : t.t('dairy.inactive') },
          ]}
        />
      )}
      <details className="kv-disclosure">
        <summary>{t.t('dairy.rate.add')}</summary>
        <form action={createRateCardAction} className="kv-form kv-form--grid">
          <label className="kv-label">{t.t('dairy.rate.name')}<input className="kv-input" name="defaultName" maxLength={120} /></label>
          <label className="kv-label">{t.t('dairy.rate.animal')}
            <select className="kv-input" name="animalType" defaultValue="cow">{ANIMAL_TYPES.map((a) => <option key={a} value={a}>{t.t(`dairy.animal.${a}`)}</option>)}</select>
          </label>
          <label className="kv-label">{t.t('dairy.rate.model')}
            <select className="kv-input" name="pricingModel" defaultValue="two_axis">{PRICING_MODELS.map((p) => <option key={p} value={p}>{t.t(`dairy.model.${p}`)}</option>)}</select>
          </label>
          <label className="kv-label">{t.t('dairy.rate.fat')} ({t.t('dairy.minor')})<input className="kv-input" name="ratePerKgFatMinor" inputMode="numeric" pattern="[0-9]*" /></label>
          <label className="kv-label">{t.t('dairy.rate.snf')} ({t.t('dairy.minor')})<input className="kv-input" name="ratePerKgSnfMinor" inputMode="numeric" pattern="[0-9]*" /></label>
          <label className="kv-label">{t.t('dairy.rate.base')} ({t.t('dairy.minor')})<input className="kv-input" name="baseRatePerLitreMinor" inputMode="numeric" pattern="[0-9]*" /></label>
          <label className="kv-label">{t.t('dairy.rate.from')}<input className="kv-input" name="effectiveFrom" type="date" required /></label>
          <button type="submit" className="kv-btn">{t.t('dairy.rate.create')}</button>
        </form>
      </details>

      {/* ---- members ---- */}
      <h2 className="kv-section-title">{t.t('dairy.member.title')}</h2>
      {membersFailed ? <p className="kv-error" role="alert">{t.t('dairy.loadError')}</p> : (
        <DataTable
          rows={members}
          empty={t.t('dairy.member.empty')}
          columns={[
            { header: t.t('dairy.member.code'), cell: (m) => m.memberCode },
            { header: t.t('dairy.member.cycle'), cell: (m) => t.t(`dairy.cycle.${m.paymentCycle}`) },
            { header: t.t('dairy.member.animal'), cell: (m) => m.defaultAnimalType ? t.t(`dairy.animal.${m.defaultAnimalType}`) : t.t('common.dash') },
            { header: t.t('dairy.status'), cell: (m) => m.isActive ? t.t('dairy.active') : t.t('dairy.inactive') },
          ]}
        />
      )}
      <details className="kv-disclosure">
        <summary>{t.t('dairy.member.add')}</summary>
        <form action={enrolMemberAction} className="kv-form kv-form--grid">
          <label className="kv-label">{t.t('dairy.member.farmer')}<input className="kv-input" name="farmerUserId" required placeholder="user UUID" /></label>
          <label className="kv-label">{t.t('dairy.mcc.title')}
            <select className="kv-input" name="mccId" required defaultValue="">
              <option value="" disabled>{t.t('dairy.member.pickMcc')}</option>
              {mccs.filter((m) => m.isActive).map((m) => <option key={m.id} value={m.id}>{m.defaultName}</option>)}
            </select>
          </label>
          <label className="kv-label">{t.t('dairy.member.code')}<input className="kv-input" name="memberCode" required maxLength={40} /></label>
          <label className="kv-label">{t.t('dairy.member.cycle')}
            <select className="kv-input" name="paymentCycle" defaultValue="weekly">{PAYMENT_CYCLES.map((c) => <option key={c} value={c}>{t.t(`dairy.cycle.${c}`)}</option>)}</select>
          </label>
          <button type="submit" className="kv-btn">{t.t('dairy.member.enrol')}</button>
        </form>
      </details>

      {/* ---- counter collection entry ---- */}
      <h2 className="kv-section-title">{t.t('dairy.collect.title')}</h2>
      <p className="kv-muted kv-fine">{t.t('dairy.collect.help')}</p>
      {members.length === 0 ? <p className="kv-muted">{t.t('dairy.collect.needMember')}</p> : (
        <form action={recordCollectionAction} className="kv-form kv-form--grid">
          <label className="kv-label">{t.t('dairy.member.title')}
            <select className="kv-input" name="membershipId" required defaultValue="">
              <option value="" disabled>{t.t('dairy.collect.pickMember')}</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.memberCode}</option>)}
            </select>
          </label>
          <label className="kv-label">{t.t('dairy.collect.shift')}
            <select className="kv-input" name="shift" defaultValue="morning">{MILK_SHIFTS.map((s) => <option key={s} value={s}>{t.t(`dairy.shift.${s}`)}</option>)}</select>
          </label>
          <label className="kv-label">{t.t('dairy.collect.date')}<input className="kv-input" name="collectedOn" type="date" required /></label>
          <label className="kv-label">{t.t('dairy.collect.weight')}<input className="kv-input" name="weightKg" inputMode="decimal" required placeholder="12.5" /></label>
          <label className="kv-label">{t.t('dairy.collect.fat')}<input className="kv-input" name="fatPct" inputMode="decimal" required placeholder="4.2" /></label>
          <label className="kv-label">{t.t('dairy.collect.snf')}<input className="kv-input" name="snfPct" inputMode="decimal" required placeholder="8.5" /></label>
          <label className="kv-check"><input type="checkbox" name="waterFlag" /> {t.t('dairy.collect.water')}</label>
          <button type="submit" className="kv-btn">{t.t('dairy.collect.record')}</button>
        </form>
      )}

      {/* ---- milk bills (settlement) ---- */}
      <h2 className="kv-section-title">{t.t('dairy.bill.title')}</h2>
      <p className="kv-muted kv-fine">{t.t('dairy.bill.help')}</p>
      {billsFailed ? <p className="kv-error" role="alert">{t.t('dairy.loadError')}</p> : (
        <DataTable
          rows={bills}
          empty={t.t('dairy.bill.empty')}
          columns={[
            { header: t.t('dairy.bill.period'), cell: (b) => `${b.periodStart} → ${b.periodEnd}` },
            { header: t.t('dairy.bill.litres'), cell: (b) => b.totalLitres },
            { header: t.t('dairy.bill.gross'), cell: (b) => money(b.grossMinor) },
            { header: t.t('dairy.bill.net'), cell: (b) => money(b.netMinor) },
            { header: t.t('dairy.status'), cell: (b) => <span className="kv-badge">{t.t(`dairy.billStatus.${b.status}`)}</span> },
            { header: '', cell: (b) => (
              <span className="kv-actions">
                {nextBillActions(b.status).map((a) => (
                  <form key={a} action={a === 'preview' ? previewBillAction : a === 'approve' ? approveBillAction : payBillAction}>
                    <input type="hidden" name="id" value={b.id} />
                    <button type="submit" className="kv-btn kv-btn--sm">{t.t(`dairy.bill.${a}`)}</button>
                  </form>
                ))}
              </span>
            ) },
          ]}
        />
      )}
      <details className="kv-disclosure">
        <summary>{t.t('dairy.bill.add')}</summary>
        <form action={generateBillAction} className="kv-form kv-form--grid">
          <label className="kv-label">{t.t('dairy.member.title')}
            <select className="kv-input" name="membershipId" required defaultValue="">
              <option value="" disabled>{t.t('dairy.collect.pickMember')}</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.memberCode}</option>)}
            </select>
          </label>
          <label className="kv-label">{t.t('dairy.bill.from')}<input className="kv-input" name="periodStart" type="date" required /></label>
          <label className="kv-label">{t.t('dairy.bill.to')}<input className="kv-input" name="periodEnd" type="date" required /></label>
          <button type="submit" className="kv-btn">{t.t('dairy.bill.generate')}</button>
        </form>
      </details>
    </section>
  );
}
