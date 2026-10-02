// apps/web-tenant/src/app/marketplace/requirements/[id]/page.tsx · W132 · REQUIREMENT DETAIL · PC-56 TENANT-11d.
// (canon slug `marketplace/requirements/[id]`; the old `/requirements/[id]` redirects here.)
//
// FOUNDER DECISION: LINKED RESPONSES, ONE ORDER PER MEMBER, PER-MEMBER CONSENT BEFORE SEND.
//   • header facts: REQ number · open of asked · urgent · buyer (short name; organisation not recorded) · budget CEILING · need by
//     · delivery pincode · posted (and by the desk, for the named buyer) · status;
//   • "Respond with member stock" (the desk) opens a pooled-quote DRAFT — a server row, so "Your draft response is kept" is true:
//     the MATCHED STOCK table (rule-based; "AI score not yet available") with "Add N" per row (≤ available, price prefilled from the
//     listing, editable on the line form W2364–W2367) → the DRAFT panel (lines · total · blended price vs the ceiling, remainder
//     shown · valid 48 h) → per-line consent state + "Record consent" → "Send quote (after member consent)" (W2368–W2370; refused by
//     name while a member has not said yes);
//   • the RESPONSES table: seller short name + masked phone · qty @ price · status · group tag · consent state · above-ceiling; the
//     buyer's shortlist / accept (by quantity) / reject — offered to the buyer, and to the desk only WITH the buyer's consent;
//     a sent pooled quote is accepted or declined as a whole;
//   • Close (with a reason for a moderator); states: not found, flagged off (the API's flag), restricted, couldn't load, consent
//     gate, and the cross-tenant note refused by name (impossible by construction under tenant RLS).
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { MemberStock, Requirement, RequirementResponse, ResponseGroup } from '@krishalaya/sdk-js';
import { formatDate, formatMoneyMinor, formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import {
  REQUIREMENTS_HREF, actHref, addable, budgetShape, consentKey, consoleState, groupStatusKey, isUuid, lineHref, minorToRupees, qtyMilli, qtyText, reqHref,
  responseStatusKey, statusKey,
} from '../../../../features/requirements/console';
import { openDraftAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('rq.detailTitle'), robots: { index: false, follow: false } };
}

export default async function RequirementDetailPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | undefined> }) {
  const self = reqHref(params.id);
  await requireSession(self);
  const t = getTranslator();
  const lang = getLang();
  const n = (v: number) => formatNumber(v, lang);
  const money = (m: string | null | undefined) => formatMoneyMinor(m ?? '0', 'INR', lang);
  const when = (iso: string) => formatDate(iso, lang, { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
  const whenTime = (iso: string) => formatDate(iso, lang, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  const day = (d: string) => when(`${d}T00:00:00+05:30`);
  const crumbs = (label: string) => (
    <nav className="kv-breadcrumb" aria-label={t.t('rq.breadcrumb')}>
      <Link href="/listings">{t.t('rq.breadcrumb.marketplace')}</Link> / <Link href={REQUIREMENTS_HREF}>{t.t('rq.breadcrumb.requirements')}</Link> / <span aria-current="page">{label}</span>
    </nav>
  );

  let req: Requirement | null = null; let state: string | null = isUuid(params.id) ? null : 'notFound';
  if (!state) {
    try { req = await tenantClient().requirements.get(params.id); }
    catch (e) { const se = e instanceof SdkError ? e : null; state = consoleState(se?.code, se?.status, true, se?.details); }
  }
  if (!req) {
    return <section>{crumbs(t.t('rq.detailTitle'))}<h1>{t.t('rq.detailTitle')}</h1>
      <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="status">
        <strong>{t.t(`rq.detailState.${state ?? 'error'}.title`)}</strong><p>{t.t(`rq.detailState.${state ?? 'error'}.body`)}</p>
        {state === 'error' && <p className="kv-field__hint">{t.t('rq.draftKeptNote')}</p>}
        <p><Link href={state === 'error' ? self : REQUIREMENTS_HREF} className="kv-btn--link">{t.t(state === 'error' ? 'rq.retry' : 'rq.backToList')}</Link></p>
      </div></section>;
  }
  const viewer = req.viewer ?? null;
  const desk = !!viewer?.canDesk;
  const solicits = req.status === 'open' || req.status === 'partially_matched';
  const remaining = (() => { const r = qtyMilli(req.quantity) - qtyMilli(req.fulfilledQuantity ?? '0'); const v = r > 0n ? r : 0n; return `${v / 1000n}.${(v % 1000n).toString().padStart(3, '0')}`; })();

  let responses: RequirementResponse[] = []; let respState: string | null = null; let respNext: string | null = null;
  try { const p = await tenantClient().requirements.responses(req.id, { limit: 50, cursor: typeof searchParams.rcursor === 'string' ? searchParams.rcursor : undefined }); responses = p.items; respNext = p.nextCursor; }
  catch (e) { const se = e instanceof SdkError ? e : null; respState = consoleState(se?.code, se?.status); }
  let groups: ResponseGroup[] = []; let groupState: string | null = null;
  if (desk || viewer?.isBuyer || viewer?.canModerate) {
    try { groups = await tenantClient().requirements.groups(req.id); }
    catch (e) { const se = e instanceof SdkError ? e : null; groupState = consoleState(se?.code, se?.status); }
  }
  const draft = groups.find((g) => g.status === 'draft' || g.status === 'consent_pending') ?? null;
  const sent = groups.filter((g) => g.status === 'submitted');
  let stock: MemberStock | null = null; let stockState: string | null = null;
  if (desk && solicits && (draft || searchParams.respond === '1')) {
    try { stock = await tenantClient().requirements.matches(req.id); }
    catch (e) { const se = e instanceof SdkError ? e : null; stockState = consoleState(se?.code, se?.status); }
  }
  const inDraft = new Set((draft?.lines ?? []).map((l) => l.sellerUserId));
  const unit = req.unitCode;
  const q = (x: string | null | undefined) => `${qtyText(x)} ${unit}`;
  const budget = () => {
    const s = budgetShape(req!.budgetMinMinor, req!.budgetMaxMinor);
    if (s === 'none') return t.t('rq.budget.none');
    if (s === 'range') return t.t('rq.budget.range', { min: money(req!.budgetMinMinor), max: money(req!.budgetMaxMinor), unit });
    if (s === 'max') return t.t('rq.budget.max', { max: money(req!.budgetMaxMinor), unit });
    return t.t('rq.budget.min', { min: money(req!.budgetMinMinor), unit });
  };
  const decide = viewer?.decidesAsBuyer || viewer?.decidesForBuyerWithConsent;

  return (
    <section>
      {crumbs(req.reqNo ?? t.t('rq.detailTitle'))}
      <div className="kv-page-head">
        <h1>{req.reqNo ?? t.t('rq.detailTitle')} · {req.title}</h1>
        <p className="kv-actions">
          {desk && solicits && !draft && <form action={openDraftAction}><input type="hidden" name="id" value={req.id} /><button type="submit" className="kv-btn kv-btn--primary">{t.t('rq.respond')}</button></form>}
          {viewer?.canClose && solicits && <Link href={actHref(req.id, 'close')} className="kv-btn kv-btn--muted">{t.t('rq.act.close')}</Link>}
        </p>
      </div>
      <div className="kv-card">
        <p>{t.t('rq.facts.qty', { open: q(remaining), asked: q(req.quantity) })}{req.isUrgent && <> · <strong>{t.t('rq.urgent')}</strong></>} · {req.buyerShortName ?? t.t('rq.nameNotRecorded')}
          {req.buyerPhoneMasked && <> ({req.buyerPhoneMasked})</>} · {budget()} · {req.needBy ? t.t('rq.facts.needBy', { day: day(req.needBy) }) : t.t('rq.needBy.none')}
          {req.deliveryPincode && <> · {t.t('rq.facts.delivery', { pin: req.deliveryPincode })}</>} · {req.createdAt ? t.t('rq.facts.posted', { day: when(req.createdAt) }) : ''}</p>
        <p><span className="kv-badge">{t.t(statusKey(req.status))}</span> · {t.t('rq.facts.filled', { filled: q(req.fulfilledQuantity ?? '0') })} · {t.t('rq.orgNotRecorded')}</p>
        {req.onBehalf && <p className="kv-field__hint">{t.t('rq.facts.postedByDesk', { name: req.postedByShortName ?? t.t('rq.nameNotRecorded') })}</p>}
        {req.status === 'closed' && req.closeReason && <p className="kv-field__hint">{t.t('rq.facts.closedReason', { reason: req.closeReason })}</p>}
        <p className="kv-field__hint">{t.t('rq.ceilingNote')}</p>
      </div>
      {searchParams.ok && /^[a-z]{2,20}$/.test(searchParams.ok) && <p className="kv-card kv-card--notice" role="status">{t.t(`rq.ok.${searchParams.ok}`)}</p>}

      {/* ---- the desk: matched member stock + the pooled-quote draft ---- */}
      {desk && solicits && (draft || searchParams.respond === '1') && (
        <section className="kv-card" aria-labelledby="rq-stock">
          <h2 id="rq-stock">{t.t('rq.stock.title')}</h2>
          <p className="kv-field__hint">{stock?.rule ? t.t('rq.stock.rule') : ''} {t.t('rq.stock.aiRefused')}</p>
          {stockState && <p className={stockState === 'error' ? 'kv-error' : 'kv-field__hint'}>{t.t(`rq.state.${stockState}.title`)}</p>}
          {stock && stock.items.length === 0 && <p className="kv-field__hint">{t.t('rq.stock.none', { unit })}</p>}
          {stock && stock.items.length > 0 && (
            <table className="kv-table">
              <thead><tr><th scope="col">{t.t('rq.stock.col.listing')}</th><th scope="col">{t.t('rq.stock.col.seller')}</th><th scope="col">{t.t('rq.stock.col.available')}</th>
                <th scope="col">{t.t('rq.stock.col.price')}</th><th scope="col">{t.t('rq.stock.col.distance')}</th><th scope="col">{t.t('rq.stock.col.match')}</th><th scope="col">{t.t('rq.stock.col.add')}</th></tr></thead>
              <tbody>{stock.items.map((m) => {
                const add = addable(m.quantityAvailable, stock!.remainingQuantity);
                return (
                  <tr key={m.listingId}>
                    <th scope="row">{m.title}</th>
                    <td>{m.sellerShortName ?? t.t('rq.nameNotRecorded')}{m.sellerPhoneMasked && <div className="kv-field__hint">{m.sellerPhoneMasked}</div>}</td>
                    <td>{q(m.quantityAvailable)}</td>
                    <td>{t.t('rq.perUnit', { price: money(m.priceMinor), unit })}{m.aboveCeiling && <div className="kv-field__hint">{t.t('rq.aboveCeiling')}</div>}</td>
                    <td>{m.distanceKm === null ? t.t('rq.stock.distanceUnknown') : t.t('rq.stock.km', { km: String(m.distanceKm) })}</td>
                    <td>{t.t(`rq.stock.matchedOn.${m.matchedOn}`)} · {t.t('rq.stock.scoreNotAvailable')}</td>
                    <td>{draft && !inDraft.has(m.sellerUserId) && qtyMilli(add) > 0n
                      ? <Link href={lineHref(req!.id, { mode: 'add', gid: draft.id, listingId: m.listingId, quantity: qtyText(add), price: minorToRupees(m.priceMinor) })} className="kv-btn--link">{t.t('rq.stock.add', { qty: q(add) })}</Link>
                      : inDraft.has(m.sellerUserId) ? <span className="kv-field__hint">{t.t('rq.stock.inDraft')}</span> : <span className="kv-field__hint">{t.t('rq.stock.nothingOpen')}</span>}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          )}
          <p className="kv-field__hint">{t.t(stock?.orderedBy === 'price_then_distance' ? 'rq.stock.orderedDistance' : 'rq.stock.orderedPrice')}</p>
        </section>
      )}

      {desk && draft && (
        <section className="kv-card" aria-labelledby="rq-draft">
          <h2 id="rq-draft">{t.t('rq.draft.title')} <span className="kv-badge">{t.t(groupStatusKey(draft.status))}</span></h2>
          <p className="kv-field__hint">{t.t('rq.draftKeptNote')}</p>
          {draft.lines.length === 0 ? <p className="kv-field__hint">{t.t('rq.draft.empty')}</p> : (
            <table className="kv-table">
              <thead><tr><th scope="col">{t.t('rq.draft.col.member')}</th><th scope="col">{t.t('rq.draft.col.listing')}</th><th scope="col">{t.t('rq.draft.col.qty')}</th>
                <th scope="col">{t.t('rq.draft.col.price')}</th><th scope="col">{t.t('rq.draft.col.value')}</th><th scope="col">{t.t('rq.draft.col.consent')}</th><th scope="col">{t.t('rq.draft.col.acts')}</th></tr></thead>
              <tbody>{draft.lines.map((l) => (
                <tr key={l.id}>
                  <th scope="row">{l.sellerShortName ?? t.t('rq.nameNotRecorded')}{l.sellerPhoneMasked && <div className="kv-field__hint">{l.sellerPhoneMasked}</div>}</th>
                  <td>{l.listingTitle ?? t.t('rq.listingUnknown')}</td>
                  <td>{q(l.quantity)}</td>
                  <td>{t.t('rq.perUnit', { price: money(l.priceMinor), unit })}{l.aboveCeiling && <div className="kv-field__hint">{t.t('rq.aboveCeiling')}</div>}</td>
                  <td>{money(l.valueMinor)}</td>
                  <td>{l.consent ? <>{t.t(consentKey(l.consent.channel))}{l.consent.self && <> · {t.t('rq.consent.self')}</>}{l.consent.recordedAt && <div className="kv-field__hint">{whenTime(l.consent.recordedAt)}</div>}</>
                    : <strong>{t.t('rq.consent.missing')}</strong>}</td>
                  <td>
                    {!l.consent && <><Link href={lineHref(req!.id, { mode: 'consent', gid: draft.id, lid: l.id })} className="kv-btn--link">{t.t('rq.recordConsent')}</Link>{' · '}</>}
                    <Link href={lineHref(req!.id, { mode: 'edit', gid: draft.id, lid: l.id, quantity: qtyText(l.quantity), price: minorToRupees(l.priceMinor) })} className="kv-btn--link">{t.t('rq.editLine')}</Link>{' · '}
                    <Link href={actHref(req!.id, 'removeLine', { gid: draft.id, lid: l.id })} className="kv-btn--link">{t.t('rq.removeLine')}</Link>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          )}
          {draft.lineCount > 0 && (
            <>
              <p><strong>{t.t('rq.draft.total', { qty: q(draft.totalQuantity), value: money(draft.totalValueMinor), hours: String(draft.validForHours) })}</strong></p>
              <p>{!draft.budgetMaxMinor ? t.t('rq.draft.blendedNoCeiling', { blended: money(draft.blendedPriceMinor), unit, rem: money(draft.blendedRemainderMinor) })
                : draft.aboveCeiling ? t.t('rq.draft.blendedAbove', { blended: money(draft.blendedPriceMinor), unit, ceiling: money(draft.budgetMaxMinor), rem: money(draft.blendedRemainderMinor) })
                : t.t('rq.draft.blendedUnder', { blended: money(draft.blendedPriceMinor), unit, ceiling: money(draft.budgetMaxMinor), rem: money(draft.blendedRemainderMinor) })}</p>
              <p className="kv-field__hint">{draft.fillsRequirement ? t.t('rq.draft.fills') : t.t('rq.draft.partial', { open: q(draft.remainingQuantity) })}</p>
            </>
          )}
          {draft.consentMissing.length > 0 && (
            <div className="kv-card kv-card--notice" role="status"><strong>{t.t('rq.consentGate.title')}</strong>
              <p>{t.t('rq.consentGate.body')}</p><p>{t.t('rq.consentGate.waiting', { names: draft.consentMissing.map((m) => m.sellerShortName ?? t.t('rq.nameNotRecorded')).join(', ') })}</p></div>
          )}
          <p className="kv-actions">
            <Link href={actHref(req.id, 'send', { gid: draft.id })} className={draft.lineCount > 0 && draft.consentMissing.length === 0 ? 'kv-btn kv-btn--primary' : 'kv-btn kv-btn--muted'}>{t.t('rq.act.send')}</Link>{' '}
            <Link href={actHref(req.id, 'withdraw', { gid: draft.id })} className="kv-btn--link">{t.t('rq.act.withdrawDraft')}</Link>
          </p>
          <p className="kv-field__hint">{t.t('rq.sendFoot')}</p>
        </section>
      )}
      {groupState && groupState !== 'restricted' && <p className="kv-error" role="alert">{t.t(`rq.state.${groupState}.title`)}</p>}

      {/* ---- sent pooled quotes (decided as a whole) ---- */}
      {sent.map((g) => (
        <section key={g.id} className="kv-card" aria-label={t.t('rq.group.sentTitle')}>
          <h2>{t.t('rq.group.sentTitle')} <span className="kv-badge">{t.t(groupStatusKey(g.status))}</span></h2>
          <p>{t.t('rq.group.sentFacts', { n: n(g.lineCount), qty: q(g.totalQuantity), blended: money(g.blendedPriceMinor), unit, until: g.validUntil ? whenTime(g.validUntil) : '' })}</p>
          {g.aboveCeiling && <p className="kv-field__hint">{t.t('rq.aboveCeiling')}</p>}
          {decide && solicits && <p className="kv-actions">
            <Link href={actHref(req.id, 'acceptGroup', { gid: g.id })} className="kv-btn kv-btn--primary">{t.t('rq.act.acceptGroup')}</Link>{' '}
            <Link href={actHref(req.id, 'rejectGroup', { gid: g.id })} className="kv-btn kv-btn--muted">{t.t('rq.act.rejectGroup')}</Link>
            {desk && <>{' '}<Link href={actHref(req.id, 'withdraw', { gid: g.id })} className="kv-btn--link">{t.t('rq.act.withdraw')}</Link></>}</p>}
          {viewer?.decidesForBuyerWithConsent && <p className="kv-field__hint">{t.t('rq.decideWithConsent')}</p>}
        </section>
      ))}

      {/* ---- existing responses ---- */}
      <section className="kv-card" aria-labelledby="rq-resp">
        <h2 id="rq-resp">{t.t('rq.responses.title', { n: n(req.responsesCount ?? responses.length) })}</h2>
        {respState && <p className={respState === 'error' ? 'kv-error' : 'kv-field__hint'}>{t.t(`rq.state.${respState}.title`)}</p>}
        {!respState && responses.length === 0 && (
          <div><strong>{t.t('rq.responses.empty.title')}</strong><p className="kv-field__hint">{t.t(desk ? 'rq.responses.empty.desk' : 'rq.responses.empty.body')}</p></div>
        )}
        {responses.length > 0 && (
          <table className="kv-table">
            <thead><tr><th scope="col">{t.t('rq.responses.col.seller')}</th><th scope="col">{t.t('rq.responses.col.offer')}</th><th scope="col">{t.t('rq.responses.col.status')}</th>
              <th scope="col">{t.t('rq.responses.col.group')}</th><th scope="col">{t.t('rq.responses.col.consent')}</th><th scope="col">{t.t('rq.responses.col.acts')}</th></tr></thead>
            <tbody>{responses.map((r) => {
              const live = r.status === 'submitted' || r.status === 'shortlisted';
              const own = !r.groupId;
              return (
                <tr key={r.id}>
                  <th scope="row">{r.sellerShortName ?? t.t('rq.nameNotRecorded')}{r.sellerPhoneMasked && <div className="kv-field__hint">{r.sellerPhoneMasked}</div>}</th>
                  <td>{t.t('rq.responses.offer', { qty: q(r.quantity), price: money(r.quotedPriceMinor), unit })}
                    {qtyMilli(r.quantity) < qtyMilli(req!.quantity) && <div className="kv-field__hint">{t.t('rq.responses.partialQty')}</div>}
                    {r.aboveCeiling && <div className="kv-field__hint">{t.t('rq.aboveCeiling')}</div>}
                    {r.acceptedQuantity && <div className="kv-field__hint">{t.t('rq.responses.accepted', { qty: q(r.acceptedQuantity) })}</div>}</td>
                  <td>{t.t(responseStatusKey(r.status))}{r.orderId && <div className="kv-field__hint"><Link href={`/orders/${encodeURIComponent(r.orderId)}`} className="kv-btn--link">{t.t('rq.responses.order')}</Link></div>}</td>
                  <td>{r.groupId ? t.t('rq.responses.linked') : t.t('rq.responses.ownQuote')}</td>
                  <td>{t.t(`rq.responses.consent.${r.consentState ?? 'own_quote'}`)}</td>
                  <td>{decide && solicits && live && own && <>
                    {r.status === 'submitted' && <><Link href={actHref(req!.id, 'shortlist', { rid: r.id })} className="kv-btn--link">{t.t('rq.act.shortlist')}</Link>{' · '}</>}
                    <Link href={actHref(req!.id, 'accept', { rid: r.id })} className="kv-btn--link">{t.t('rq.act.accept')}</Link>{' · '}
                    <Link href={actHref(req!.id, 'reject', { rid: r.id })} className="kv-btn--link">{t.t('rq.act.reject')}</Link></>}
                    {decide && solicits && live && !own && <span className="kv-field__hint">{t.t('rq.responses.decideAsGroup')}</span>}</td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
        {respNext && <p><Link href={reqHref(req.id, { rcursor: respNext })} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('rq.nextPage')}</Link></p>}
        <p className="kv-field__hint">{t.t('rq.crossTenantRefused')}</p>
        {!decide && !desk && <p className="kv-field__hint">{t.t('rq.restrictedDetail')}</p>}
      </section>
    </section>
  );
}
