// apps/web-admin/src/app/moderation/listings/[id]/page.tsx · W091, the moderation case (PC-56 ADMIN-5f).
//
// W091's evidence board and its two controls. The Remove control is ABSENT — not disabled — unless the listing is
// already held AND (below ₹1,00,000 OR a second operator is looking). Each refusal has its own sentence because the
// next move differs: hold it first, or find a colleague.
//
// THE REMOVE CONFIRM STATES ITS CONSEQUENCES, all three of which are now true rather than aspirational:
// the listing is archived (irreversible), a risk_event `fake_listing −40` is recorded against the seller, and the
// farmer is notified with an appeal path. Before 0112 the first did not happen at all — handling a report as
// `removed` wrote a status column and emitted an event no listings handler consumed.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin, adminUserId } from '../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../lib/admin-client';
import { getTranslator } from '../../../../lib/i18n';
import { adminNoticeKey } from '../../../../features/nav/nav-model';
import { holdAction, releaseAction, removeAction } from '../../actions';
import {
  HOLD_SOURCES, REASON_MIN, slaClass, slaKey, formatMinor, removeBlockedKey, valueDrift,
  orderClass, noticeClass, noticeKey, type HoldSla, type RemoveState,
} from '../../../../features/moderation/queue';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('mq.caseTitle'), robots: { index: false, follow: false } };
}

interface Order {
  id: string; action: string; source: string; sourceRef: string | null; reason: string;
  valueAtStakeMinor: string; actorAdminId: string; checkerAdminId: string | null;
  checkedAt: string | null; checkerNote: string | null; createdAt: string;
}
interface Notice {
  id: string; recipientKind: string; recipientUserId: string | null; status: string;
  detail: string | null; languageCode: string; settledAt: string | null; attempts: number;
}
interface Case {
  id: string; tenantId: string; title: string; status: string;
  priceMinor: string; quantityAvailable: string; unitCode: string; sellerUserId: string | null;
  heldAt: string | null; holdSlaDueAt: string | null; sla: HoldSla;
  holdReason: string | null; holdSource: string | null; holdActorAdminId: string | null;
  valueAtStakeMinor: string; valueAtHoldMinor: string | null;
  removalNeedsChecker: boolean; removeState: RemoveState; removeOfferable: boolean;
  thresholdMinor: string; slaHours: number;
  orders: Order[]; notices: Notice[];
}

const OK = new Set(['held', 'released', 'removed']);
const ERR = new Set(['source', 'reason', 'language', 'notHeld', 'needsChecker', 'yourOwnHold', 'elevation', 'conflict', 'invalid', 'notFound', 'generic']);
const LANGS = ['en', 'hi', 'gu'];

export default async function ModerationCasePage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();
  const viewer = adminUserId();

  let c: Case | undefined; let notice: string | undefined;
  try { c = (await adminGet<Case>(`moderation/listings/${encodeURIComponent(params.id)}`)).data; }
  catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;

  if (!c) {
    return (
      <section>
        <p className="kv-backlink"><Link href="/moderation/listings">{t.t('mq.backQueue')}</Link></p>
        <h1>{t.t('mq.caseHeading')}</h1>
        <p className="kv-error" role="alert">{notice}</p>
      </section>
    );
  }

  const isHeld = !!c.heldAt;
  const blocked = removeBlockedKey(c.removeState, c.holdActorAdminId, viewer);
  const drift = valueDrift(c.valueAtStakeMinor, c.valueAtHoldMinor);

  return (
    <section>
      <p className="kv-backlink"><Link href="/moderation/listings">{t.t('mq.backQueue')}</Link></p>
      <h1>{c.title}</h1>
      {okKey && <p className="kv-success" role="status">{t.t(`mq.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`mq.error.${errKey}`)}</p>}

      <dl className="kv-facts">
        <div className="kv-facts__row"><dt>{t.t('mq.col.status')}</dt><dd>{c.status}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('mq.col.tenant')}</dt><dd>{c.tenantId}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('mq.seller')}</dt><dd>{c.sellerUserId ?? t.t('common.dash')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('mq.qty')}</dt><dd>{c.quantityAvailable} {c.unitCode} @ {formatMinor(c.priceMinor)}</dd></div>
        <div className="kv-facts__row">
          <dt>{t.t('mq.col.value')}</dt>
          <dd>
            {formatMinor(c.valueAtStakeMinor)}
            {c.removalNeedsChecker && <span className="kv-status kv-status--warn">{t.t('mq.needsChecker')}</span>}
          </dd>
        </div>
        {isHeld && (
          <>
            <div className="kv-facts__row"><dt>{t.t('mq.heldAt')}</dt><dd>{c.heldAt}</dd></div>
            <div className="kv-facts__row">
              <dt>{t.t('mq.col.deadline')}</dt>
              <dd>{c.holdSlaDueAt} <span className={slaClass(c.sla)}>{t.t(`mq.sla.${slaKey(c.sla)}`)}</span></dd>
            </div>
            <div className="kv-facts__row"><dt>{t.t('mq.col.source')}</dt><dd>{c.holdSource ? t.t(`mq.source.${c.holdSource}`) : t.t('common.dash')}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('mq.holdReason')}</dt><dd>{c.holdReason ?? t.t('common.dash')}</dd></div>
          </>
        )}
      </dl>

      {/* The value moved since the hold, so the threshold was judged on the older figure. Shown before Remove. */}
      {drift.known && drift.drifted && (
        <p className="kv-error" role="alert">
          {t.t('mq.valueDriftDetail', { now: formatMinor(c.valueAtStakeMinor), then: formatMinor(c.valueAtHoldMinor) })}
        </p>
      )}

      <h2>{t.t('mq.ordersHeading')}</h2>
      <table className="kv-table">
        <thead><tr><th>{t.t('mq.col.when')}</th><th>{t.t('mq.col.act')}</th><th>{t.t('mq.holdReason')}</th><th>{t.t('mq.col.value')}</th><th>{t.t('mq.col.who')}</th></tr></thead>
        <tbody>
          {c.orders.map((o) => (
            <tr key={o.id}>
              <td>{o.createdAt}</td>
              <td><span className={orderClass(o.action)}>{t.t(`mq.act.${o.action}`)}</span></td>
              <td>{o.reason}</td>
              <td>{formatMinor(o.valueAtStakeMinor)}</td>
              <td>
                {o.actorAdminId}
                {o.checkerAdminId && <div className="kv-detail__muted">{t.t('mq.checkedBy', { who: o.checkerAdminId })}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {c.orders.length === 0 && <p className="kv-empty">{t.t('mq.noOrders')}</p>}

      <h2>{t.t('mq.noticesHeading')}</h2>
      <p className="kv-muted">{t.t('mq.noticesLead')}</p>
      <ul className="kv-list">
        {c.notices.map((n) => (
          <li key={n.id}>
            <span className={noticeClass(n.status)}>{t.t(`mq.notice.${noticeKey(n.status)}`)}</span>{' '}
            {t.t(`mq.recipient.${n.recipientKind}`)} · {n.languageCode}
            {n.detail && <span className="kv-detail__muted"> — {n.detail}</span>}
          </li>
        ))}
      </ul>
      {c.notices.length === 0 && <p className="kv-empty">{t.t('mq.noNotices')}</p>}

      {/* ---------------- ACTIONS ---------------- */}
      {!isHeld ? (
        <>
          <h2>{t.t('mq.holdHeading')}</h2>
          <p className="kv-muted">{t.t('mq.holdLead', { h: String(c.slaHours) })}</p>
          <form action={holdAction} className="kv-form">
            <input type="hidden" name="id" value={c.id} />
            <label htmlFor="source" className="kv-field__label">{t.t('mq.col.source')}</label>
            <select id="source" name="source" className="kv-input" required defaultValue="">
              <option value="" disabled>{t.t('common.choose')}</option>
              {HOLD_SOURCES.map((s) => <option key={s} value={s}>{t.t(`mq.source.${s}`)}</option>)}
            </select>
            <label htmlFor="sourceRef" className="kv-field__label">{t.t('mq.sourceRef')}</label>
            <input id="sourceRef" name="sourceRef" className="kv-input" />
            <label htmlFor="reason" className="kv-field__label">{t.t('mq.reasonLabel')}</label>
            <textarea id="reason" name="reason" className="kv-input" required minLength={REASON_MIN} maxLength={2000} />
            <label htmlFor="lang" className="kv-field__label">{t.t('mq.language')}</label>
            <select id="lang" name="languageCode" className="kv-input" required defaultValue="en">
              {LANGS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            <button type="submit" className="kv-btn">{t.t('mq.hold')}</button>
          </form>
        </>
      ) : (
        <>
          <h2>{t.t('mq.decideHeading')}</h2>
          <form action={releaseAction} className="kv-form">
            <input type="hidden" name="id" value={c.id} />
            <label htmlFor="rreason" className="kv-field__label">{t.t('mq.releaseReason')}</label>
            <textarea id="rreason" name="reason" className="kv-input" required minLength={REASON_MIN} maxLength={2000} />
            <label htmlFor="rlang" className="kv-field__label">{t.t('mq.language')}</label>
            <select id="rlang" name="languageCode" className="kv-input" required defaultValue="en">
              {LANGS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            <label htmlFor="rrep" className="kv-field__label">{t.t('mq.reporterUserId')}</label>
            <input id="rrep" name="reporterUserId" className="kv-input" />
            {/* Release is the ordinary outcome and is drawn first: most holds are wrong by design, which is the whole
                reason for holding rather than removing. */}
            <button type="submit" className="kv-btn">{t.t('mq.release')}</button>
          </form>

          {blocked ? (
            <p className="kv-error" role="alert">{t.t(`mq.removeBlocked.${blocked}`)}</p>
          ) : (
            <form action={removeAction} className="kv-form">
              <input type="hidden" name="id" value={c.id} />
              {/* W091's confirm, and all three consequences are now real. */}
              <p className="kv-error" role="note">
                {t.t('mq.removeConfirm', { value: formatMinor(c.valueAtStakeMinor), threshold: formatMinor(c.thresholdMinor) })}
              </p>
              <label htmlFor="xreason" className="kv-field__label">{t.t('mq.removeReason')}</label>
              <textarea id="xreason" name="reason" className="kv-input" required minLength={REASON_MIN} maxLength={2000} />
              <label htmlFor="xlang" className="kv-field__label">{t.t('mq.language')}</label>
              <select id="xlang" name="languageCode" className="kv-input" required defaultValue="en">
                {LANGS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
              <label htmlFor="xrep" className="kv-field__label">{t.t('mq.reporterUserId')}</label>
              <input id="xrep" name="reporterUserId" className="kv-input" />
              {c.removalNeedsChecker && (
                <>
                  <label htmlFor="xnote" className="kv-field__label">{t.t('mq.checkerNote')}</label>
                  <input id="xnote" name="checkerNote" className="kv-input" />
                </>
              )}
              <button type="submit" className="kv-btn kv-btn--danger">{t.t('mq.remove')}</button>
            </form>
          )}
        </>
      )}
      <p className="kv-detail__muted">{t.t('mq.holdDoctrine')}</p>
    </section>
  );
}
