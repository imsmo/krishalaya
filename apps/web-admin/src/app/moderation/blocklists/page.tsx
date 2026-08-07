// apps/web-admin/src/app/moderation/blocklists/page.tsx · W096 (PC-56 ADMIN-5d).
//
// W096's two rules are enforced rather than displayed: every block carries an expiry or a review date, and raw
// identifiers are never shown after entry. The second one has a consequence this screen has to live with — once
// hashed, a block cannot be explained by looking at it, so the REASON column carries the entire justification for
// shutting somebody out, which is why the form refuses a short one.
//
// THE ATTEMPTS COLUMN IS A DASH, NOT A NUMBER. W096 shows "1,204 attempts blocked" as the evidence a block is
// working. Nothing on this platform reads the blocklist — there is no gateway check and no cache — so the counter has
// never been incremented by anything. Rendering "0" would say the block is installed and nobody has tried; the truth
// is that nothing is checking. Those are opposite statements about whether the platform is defended.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin, adminUserId } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { addBlockAction, countersignBlockAction, liftBlockAction } from '../actions';
import {
  IDENTIFIER_TYPES, blockStateClass, attemptsText, countersignOfferable, type BlockRow,
} from '../../../features/trust/trust-safety';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ts.bl.title'), robots: { index: false, follow: false } };
}

interface Meta { counts: Record<string, number>; userBlockCount: number | null; nextCursor: string | null }

const OK = new Set(['added', 'alreadyBlocked', 'countersigned', 'lifted']);
const ERR = new Set(['identifierType', 'identifier', 'looksHashed', 'reason', 'auditNote', 'expiry', 'elevation', 'conflict', 'invalid', 'notFound', 'generic']);

export default async function BlocklistsPage({ searchParams }: { searchParams: { type?: string; cursor?: string; ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();
  const viewer = adminUserId();

  const type = searchParams.type && (IDENTIFIER_TYPES as readonly string[]).includes(searchParams.type) ? searchParams.type : undefined;

  let rows: BlockRow[] = []; let meta: Meta | undefined; let notice: string | undefined;
  try {
    const r = await adminGet<BlockRow[]>('trust/blocklists', { type, cursor: searchParams.cursor });
    rows = r.data; meta = r.meta as unknown as Meta;
  } catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  // Filters are preserved in the pager link — a cursor that drops the tab silently pages into every type.
  const q = (extra: Record<string, string>) => new URLSearchParams({ ...(type ? { type } : {}), ...extra }).toString();

  return (
    <section>
      <p className="kv-backlink"><Link href="/moderation">{t.t('ts.backOverview')}</Link></p>
      <h1>{t.t('ts.bl.heading')}</h1>
      <p className="kv-muted">{t.t('ts.bl.lead')}</p>
      {okKey && <p className="kv-success" role="status">{t.t(`ts.bl.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`ts.error.${errKey}`)}</p>}
      {notice && <p className="kv-error" role="alert">{notice}</p>}

      <nav className="kv-filters">
        <Link href="/moderation/blocklists" className={!type ? 'kv-chip is-active' : 'kv-chip'}>{t.t('ts.bl.tab.all')}</Link>
        {IDENTIFIER_TYPES.map((ty) => (
          <Link key={ty} href={`/moderation/blocklists?type=${ty}`} className={type === ty ? 'kv-chip is-active' : 'kv-chip'}>
            {t.t(`ts.bl.type.${ty}`)} {meta?.counts?.[ty] ?? 0}
          </Link>
        ))}
        {/* W096's fourth tab is user↔user chat blocks. A COUNT ONLY — who blocked whom is a private safety decision
            and the platform board has no business listing the pairs. */}
        <span className="kv-chip">
          {t.t('ts.bl.tab.userBlocks')} {meta?.userBlockCount === null || meta?.userBlockCount === undefined ? t.t('common.dash') : meta.userBlockCount}
        </span>
      </nav>

      <table className="kv-table">
        <thead><tr>
          <th>{t.t('ts.bl.col.added')}</th><th>{t.t('ts.bl.col.identifier')}</th><th>{t.t('ts.bl.col.origin')}</th>
          <th>{t.t('ts.bl.col.reason')}</th><th>{t.t('ts.bl.col.expiry')}</th>
          <th>{t.t('ts.bl.col.attempts')}</th><th>{t.t('ts.bl.col.state')}</th><th>{t.t('ts.bl.col.actions')}</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => {
            const at = attemptsText(r.attempts);
            const canSign = countersignOfferable(r.createdBy, viewer, !!r.checkedBy);
            return (
              <tr key={r.id}>
                <td>{r.createdAt}</td>
                {/* Derived from the HASH. The canon's `ip_103.24.…/29` shows real octets; on a range that narrows the
                    search space for anybody reading the screen. */}
                <td><code>{r.identifier}</code></td>
                <td>{r.originRef ?? t.t('common.dash')}</td>
                <td>{r.reason}</td>
                <td>
                  {r.expiresAt ?? (r.reviewAt ? t.t('ts.bl.reviewOn', { d: r.reviewAt }) : <span className="kv-status kv-status--danger">{t.t('ts.bl.noExpiry')}</span>)}
                  {r.reviewDue && <span className="kv-status kv-status--warn">{t.t('ts.bl.reviewDue')}</span>}
                </td>
                <td>
                  {at.known ? at.text : (
                    <span className="kv-detail__muted" title={r.attempts && r.attempts.known === false ? r.attempts.reason : undefined}>
                      {t.t('ts.bl.attemptsUncounted')}
                    </span>
                  )}
                </td>
                <td><span className={blockStateClass(r.state)}>{t.t(`ts.bl.state.${r.state}`)}</span></td>
                <td>
                  {r.checkedBy
                    ? <span className="kv-status kv-status--ok">{t.t('ts.bl.countersigned')}</span>
                    : <span className="kv-status kv-status--warn">{t.t('ts.bl.awaitingCountersign')}</span>}
                  {/* ABSENT, not disabled, when the viewer added it. */}
                  {canSign && (
                    <form action={countersignBlockAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <label className="kv-field__label">{t.t('ts.bl.countersignNote')}<input className="kv-input" name="note" required maxLength={1000} /></label>
                      <button type="submit" className="kv-btn">{t.t('ts.bl.countersign')}</button>
                    </form>
                  )}
                  {!canSign && !r.checkedBy && <div className="kv-detail__muted">{t.t('ts.bl.countersignYourOwn')}</div>}
                  {r.state !== 'lifted' && (
                    <form action={liftBlockAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <label className="kv-field__label">{t.t('ts.bl.liftReason')}<input className="kv-input" name="reason" required maxLength={300} /></label>
                      <button type="submit" className="kv-btn">{t.t('ts.bl.lift')}</button>
                    </form>
                  )}
                  {r.liftReason && <div className="kv-detail__muted">{t.t('ts.bl.liftedFor', { reason: r.liftReason })}</div>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && !notice && <p className="kv-empty">{t.t('ts.bl.empty')}</p>}
      {meta?.nextCursor && <p className="kv-pager"><Link href={`/moderation/blocklists?${q({ cursor: meta.nextCursor })}`}>{t.t('common.next')}</Link></p>}

      <h2>{t.t('ts.bl.addHeading')}</h2>
      <p className="kv-muted">{t.t('ts.bl.addLead')}</p>
      <form action={addBlockAction} className="kv-form">
        <label className="kv-field__label">
          {t.t('ts.bl.col.identifier')}
          <select className="kv-input" name="identifierType" required defaultValue="">
            <option value="" disabled>{t.t('common.choose')}</option>
            {IDENTIFIER_TYPES.map((ty) => <option key={ty} value={ty}>{t.t(`ts.bl.type.${ty}`)}</option>)}
          </select>
        </label>
        {/* The RAW value. It is hashed server-side and never stored — and the form refuses a 64-hex string, because
            pasting a displayed identifier back in produces a block that matches nothing and cannot be spotted later. */}
        <label className="kv-field__label">{t.t('ts.bl.rawIdentifier')}<input className="kv-input" name="identifier" required maxLength={200} /></label>
        <label className="kv-field__label">{t.t('ts.bl.col.origin')}<input className="kv-input" name="originRef" maxLength={60} /></label>
        <label className="kv-field__label">{t.t('ts.bl.col.reason')}<input className="kv-input" name="reason" required minLength={12} maxLength={300} /></label>
        <label className="kv-field__label">{t.t('ts.bl.expiresAt')}<input className="kv-input" name="expiresAt" type="datetime-local" /></label>
        <label className="kv-field__label">{t.t('ts.bl.reviewAt')}<input className="kv-input" name="reviewAt" type="datetime-local" /></label>
        <p className="kv-detail__muted">{t.t('ts.bl.expiryRule')}</p>
        <label className="kv-field__label">{t.t('ts.bl.auditNote')}<textarea className="kv-input" name="auditNote" required minLength={12} maxLength={1000} /></label>
        <button type="submit" className="kv-btn kv-btn--danger">{t.t('ts.bl.add')}</button>
      </form>
      <p className="kv-detail__muted">{t.t('ts.bl.enforcementGap')}</p>
    </section>
  );
}
