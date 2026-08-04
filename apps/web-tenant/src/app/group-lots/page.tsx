// apps/web-tenant/src/app/group-lots/page.tsx · the FPO group-lot coordinator console (P1-12). Server-first,
// requireSession-gated, behind the `group_lots` flag (NEXT_PUBLIC_FEATURE_GROUP_LOTS + the API's own flag).
// Sections — the coordinator's lots (filter by box/status + open a new pooled lot), and a selected lot's detail
// (pledges + lifecycle actions: pledge / ready / settle / cancel + a float-free settlement PREVIEW that mirrors the
// server's split). Each section degrades on its own (Law 12). Every write is a Server Action → the audited,
// RBAC-gated (group_lot.coordinate) API, which owns the state machine + the authoritative settlement math (money is
// NOT moved by settle — it records each pledger's share). Money via formatMoneyMinor; all copy via i18n; noindex.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { DataTable } from '../../components/DataTable';
import { getTranslator, getLang } from '../../lib/i18n';
import { env } from '../../lib/env';
import { notFound } from 'next/navigation';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { GROUP_LOT_STATUSES, coordinatorActions, canPledge } from '../../features/group-lots/coordinator';
import { createLotAction, pledgeAction, markReadyAction, cancelLotAction, settleAction } from './actions';
import type { GroupLot, GroupLotDetail, GroupLotStatus } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('gl.title'), robots: { index: false, follow: false } };
}

const OK = new Set(['create', 'pledge', 'ready', 'cancel', 'settle']);

export default async function GroupLotsPage({ searchParams }: { searchParams: { ok?: string; error?: string; lot?: string; box?: string; status?: string } }) {
  if (!env.featureGroupLots) notFound();
  await requireSession('/group-lots');
  const t = getTranslator();
  const lang = getLang();
  const selected = searchParams.lot || null;
  const box = searchParams.box === 'mine' ? 'mine' : 'all';
  const statusFilter = (searchParams.status && (GROUP_LOT_STATUSES as readonly string[]).includes(searchParams.status)) ? searchParams.status as GroupLotStatus : undefined;

  let lots: GroupLot[] = []; let lotsFailed = false;
  let lot: GroupLotDetail | null = null; let detailFailed = false;
  const lRes = await Promise.allSettled([tenantClient().groupLots.list({ box, status: statusFilter, limit: 100 })]);
  if (lRes[0].status === 'fulfilled') lots = lRes[0].value.items; else lotsFailed = true;
  if (selected) {
    const dRes = await Promise.allSettled([tenantClient().groupLots.get(selected)]);
    if (dRes[0].status === 'fulfilled') lot = dRes[0].value; else detailFailed = true;
  }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errorKey = searchParams.error || null;
  const money = (m: string) => formatMoneyMinor(m, 'INR', lang);
  const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;

  const actions = lot ? coordinatorActions(lot.status) : [];
  const openForPledge = lot ? canPledge(lot.status, lot.pledgeDeadline) : false;

  return (
    <section>
      <h1>{t.t('gl.title')}</h1>
      <p className="kv-muted">{t.t('gl.subtitle')}</p>
      {okKey && <p className="kv-success" role="status">{t.t(`gl.ok.${okKey}`)}</p>}
      {errorKey && <p className="kv-error" role="alert">{t.t('gl.error')}: {errorKey}</p>}

      {/* ---- coordinator's lots ---- */}
      <h2 className="kv-section-title">{t.t('gl.lots.title')}</h2>
      <form method="get" className="kv-form kv-form--inline">
        <label className="kv-label">{t.t('gl.lots.box')}
          <select className="kv-input" name="box" defaultValue={box}>
            <option value="all">{t.t('gl.lots.boxAll')}</option>
            <option value="mine">{t.t('gl.lots.boxMine')}</option>
          </select>
        </label>
        <label className="kv-label">{t.t('gl.lots.status')}
          <select className="kv-input" name="status" defaultValue={statusFilter ?? ''}>
            <option value="">{t.t('gl.lots.allStatuses')}</option>
            {GROUP_LOT_STATUSES.map((s) => <option key={s} value={s}>{t.t(`gl.status.${s}`)}</option>)}
          </select>
        </label>
        <button type="submit" className="kv-btn kv-btn--muted kv-btn--sm">{t.t('gl.lots.filter')}</button>
      </form>
      {lotsFailed ? <p className="kv-error" role="alert">{t.t('gl.loadError')}</p> : (
        <DataTable
          rows={lots}
          empty={t.t('gl.lots.empty')}
          columns={[
            { header: t.t('gl.lots.lot'), cell: (g) => <Link href={`/group-lots?lot=${encodeURIComponent(g.id)}`}><code className="kv-code kv-code--inline">{g.id.slice(0, 8)}</code></Link> },
            { header: t.t('gl.lots.product'), cell: (g) => <code className="kv-code kv-code--inline">{g.productId.slice(0, 8)}</code> },
            { header: t.t('gl.lots.pledged'), cell: (g) => `${g.pledgedQuantity} / ${g.targetQuantity} ${g.unitCode}` },
            { header: t.t('gl.lots.progress'), cell: (g) => pct(g.progressBps) },
            { header: t.t('gl.status'), cell: (g) => <span className="kv-badge">{t.t(`gl.status.${g.status}`)}</span> },
          ]}
        />
      )}

      {/* ---- open a new pooled lot ---- */}
      <details className="kv-disclosure">
        <summary>{t.t('gl.new.title')}</summary>
        <form action={createLotAction} className="kv-form kv-form--grid">
          <label className="kv-label">{t.t('gl.new.product')}<input className="kv-input" name="productId" required maxLength={64} /></label>
          <label className="kv-label">{t.t('gl.new.target')}<input className="kv-input" name="targetQuantity" inputMode="decimal" placeholder="1000.000" required /></label>
          <label className="kv-label">{t.t('gl.new.unit')}<input className="kv-input" name="unitCode" maxLength={16} placeholder="kg" required /></label>
          <label className="kv-label">{t.t('gl.new.deadline')}<input className="kv-input" name="pledgeDeadline" type="datetime-local" required /></label>
          <label className="kv-label">{t.t('gl.new.fee')} ({t.t('gl.bps')})<input className="kv-input" name="coordinationFeeBps" type="number" min={0} max={10000} placeholder="0" /></label>
          <button type="submit" className="kv-btn">{t.t('gl.new.create')}</button>
        </form>
      </details>

      {/* ---- selected lot ---- */}
      {selected && (
        <>
          <h2 className="kv-section-title">{t.t('gl.detail.title')} · <Link href="/group-lots">{t.t('gl.detail.clear')}</Link></h2>
          {detailFailed || !lot ? <p className="kv-error" role="alert">{t.t('gl.loadError')}</p> : (
            <>
              <p className="kv-muted kv-fine">
                {t.t('gl.status')}: <span className="kv-badge">{t.t(`gl.status.${lot.status}`)}</span>
                {' · '}{t.t('gl.lots.pledged')}: {lot.pledgedQuantity} / {lot.targetQuantity} {lot.unitCode} ({pct(lot.progressBps)})
                {' · '}{t.t('gl.detail.fee')}: {pct(lot.coordinationFeeBps)}
                {' · '}{t.t('gl.detail.deadline')}: {lot.pledgeDeadline}
              </p>

              <span className="kv-actions">
                {actions.includes('ready') && (
                  <form action={markReadyAction}><input type="hidden" name="id" value={lot.id} /><button type="submit" className="kv-btn kv-btn--sm">{t.t('gl.action.ready')}</button></form>
                )}
                {actions.includes('cancel') && (
                  <form action={cancelLotAction}><input type="hidden" name="id" value={lot.id} /><button type="submit" className="kv-btn kv-btn--sm kv-btn--muted">{t.t('gl.action.cancel')}</button></form>
                )}
              </span>

              {/* pledges */}
              <h3 className="kv-section-title">{t.t('gl.pledges.title')}</h3>
              <DataTable
                rows={lot.pledges}
                empty={t.t('gl.pledges.empty')}
                columns={[
                  { header: t.t('gl.pledges.farmer'), cell: (p) => <code className="kv-code kv-code--inline">{p.farmerUserId.slice(0, 8)}</code> },
                  { header: t.t('gl.pledges.quantity'), cell: (p) => `${p.quantity} ${lot!.unitCode}` },
                  { header: t.t('gl.pledges.share'), cell: (p) => p.settledShareMinor ? money(p.settledShareMinor) : t.t('common.dash') },
                ]}
              />
              {openForPledge && actions.includes('pledge') && (
                <details className="kv-disclosure"><summary>{t.t('gl.pledges.add')}</summary>
                  <form action={pledgeAction} className="kv-form kv-form--grid">
                    <input type="hidden" name="id" value={lot.id} />
                    <label className="kv-label">{t.t('gl.pledges.farmer')}<input className="kv-input" name="farmerUserId" required maxLength={64} /></label>
                    <label className="kv-label">{t.t('gl.pledges.quantity')}<input className="kv-input" name="quantity" inputMode="decimal" placeholder="25.000" required /></label>
                    <button type="submit" className="kv-btn">{t.t('gl.pledges.record')}</button>
                  </form>
                </details>
              )}

              {/* settle */}
              {actions.includes('settle') && (
                <details className="kv-disclosure"><summary>{t.t('gl.settle.title')}</summary>
                  <p className="kv-fine kv-muted">{t.t('gl.settle.help')}</p>
                  <form action={settleAction} className="kv-form">
                    <input type="hidden" name="id" value={lot.id} />
                    <label className="kv-label">{t.t('gl.settle.gross')} ({t.t('gl.minor')})<input className="kv-input" name="grossProceedsMinor" inputMode="numeric" pattern="[0-9]*" required /></label>
                    <button type="submit" className="kv-btn">{t.t('gl.settle.run')}</button>
                  </form>
                </details>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
