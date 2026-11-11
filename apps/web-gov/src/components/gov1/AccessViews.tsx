// apps/web-gov/src/components/gov1/AccessViews.tsx · PC-56 GOV-1a — W359 (`/access`) and the access chain (W3198–W3200), presentational
// (rendered by app/access/page.tsx and by the render tests). GOV-1 Q4-A (lead-applied; the founder may reopen): the authority's people as
// GOV-0's `GET /v1/gov/members` gives them — to the authority's own members only (the route needs `authority.members.read`, which only a
// live member of THIS authority holds); "asked by" / "approved by" resolved only from the same list; approve offered only to a head who is
// neither the requester nor the grantee; remove offered only to a head, never on their own row, with a reason, at once. No farmer, no member
// roster of an organisation, no money. PC-56 GOV-4b adds W356's "Sign-ins" section (components/gov4/SignInsViews.tsx; reads nothing).
// PC-56 GOV-6b adds W334's "The record" and W351–W354's "Outside bodies" (components/gov6/AccessSections.tsx; given only `t`; read nothing).
// All copy via i18n; no inline styles; no physical direction.
import type { GovMe, GovMembership } from '@krishalaya/sdk-js';
import { Gov1Refusals } from './Gov1Chain';
import { SignInsSection } from '../gov4/SignInsViews';
import { Gov6AccessSections } from '../gov6/AccessSections';
import {
  ACCESS_ERRORS, approverFact, atUtc, canOfferApprove, canOfferRemove, canRequest, GOV_ROLE_CODES, personLabel, rowStatus, TERM_MONTHS, whoOf,
  type AccessDone, type Who,
} from '../../features/gov1/access';
import type { Tr } from '../../features/gov1/refusals';
import { ltrOrNull, ltrText } from '../../features/rtl/span';

type Action = string | ((fd: FormData) => Promise<void>);
const form = (a: Action) => a as never;
export type AccessState = 'ok' | 'forbidden' | 'error' | 'off';

export function whoText(t: Tr, w: Who): string {
  switch (w.kind) {
    case 'you': return t.t('gov1.access.who.you');
    case 'platform': return t.t('gov1.access.who.platform');
    case 'person': return w.label;
    case 'unlisted': return t.t('gov1.access.who.unlisted');
    default: return t.t('common.dash');
  }
}
export const roleText = (t: Tr, code: string): string => ((GOV_ROLE_CODES as readonly string[]).includes(code) ? t.t(`gov1.access.role.${code}`) : code);

function endsText(t: Tr, m: GovMembership, lang = 'en'): string {
  const s = rowStatus(m);
  if (s === 'requested') return t.t('gov1.access.endsAfter', { n: m.termMonths });
  if (s === 'removed') return m.removedAt ? t.t('gov1.access.removedOn', { at: ltrOrNull(atUtc(m.removedAt), lang) ?? '' }) : t.t('common.dash');
  return ltrOrNull(atUtc(m.expiresAt), lang) ?? t.t('common.dash');
}

export function AccessView({ t, state, me, rows, lang = 'en' }: { t: Tr; state: AccessState; me: GovMe | null; rows: readonly GovMembership[]; lang?: string }) {
  const fact = me && state === 'ok' ? approverFact(rows, me.person.userId) : null;
  return (
    <section data-kv-page="access" data-kv-state={state}>
      <h1>{t.t('gov1.access.title')}</h1>
      <p className="kv-statement" data-kv-statement="gov1.access.q4">{t.t('gov1.access.q4')}</p>
      <p className="kv-muted" data-kv-fact="first-head">{t.t('gov1.access.firstHead')}</p>
      {me ? <p className="kv-muted" data-kv-signed-in="">{t.t('gov1.access.signedIn', { authority: me.authority?.name ?? t.t('common.dash'), ends: ltrOrNull(atUtc(me.person.accessEndsAt), lang) ?? t.t('common.dash') })}</p> : null}
      {state === 'off' ? <p className="kv-notice" data-kv-notice="off">{t.t('gov1.login.off')}</p> : null}
      {state === 'forbidden' ? <p className="kv-notice" data-kv-notice="forbidden">{t.t('gov1.access.forbidden')}</p> : null}
      {state === 'error' ? (
        <div className="kv-notice" data-kv-notice="error">
          <p>{t.t('gov1.access.error')}</p>
          <p className="kv-pager"><a className="kv-btn" href="/access?act=confirm&do=reread" data-kv-retry="">{t.t('common.retry')}</a></p>
        </div>
      ) : null}
      {state === 'ok' ? (
        <>
          {fact ? <p className="kv-notice" data-kv-approver-fact={fact}>{t.t(fact === 'only_you' ? 'gov1.access.onlyYou' : 'gov1.access.noApprover')}</p> : null}
          {me && canRequest(me) ? <p className="kv-pager"><a className="kv-btn" href="/access?act=confirm&do=request" data-kv-real="request">{t.t('gov1.access.requestRole')}</a></p> : null}
          {rows.length === 0 ? <p className="kv-muted" data-kv-empty="">{t.t('gov1.access.empty')}</p> : (
            <table className="kv-table" data-kv-people={rows.length}>
              <thead><tr>
                <th scope="col">{t.t('gov1.access.col.person')}</th><th scope="col">{t.t('gov1.access.col.role')}</th>
                <th scope="col">{t.t('gov1.access.col.askedBy')}</th><th scope="col">{t.t('gov1.access.col.approvedBy')}</th>
                <th scope="col">{t.t('gov1.access.col.ends')}</th><th scope="col">{t.t('gov1.access.col.status')}</th>
                <th scope="col">{t.t('gov1.access.col.acts')}</th>
              </tr></thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.membershipId} data-kv-member={m.membershipId} data-kv-status={rowStatus(m)}>
                    <td>{m.userId === me?.person.userId ? t.t('gov1.access.youRow', { name: ltrText(personLabel(m), lang) }) : personLabel(m)}</td>
                    <td>{roleText(t, m.roleCode)}</td>
                    <td>{whoText(t, whoOf(m.requestedBy, rows, me?.person.userId ?? '', m.requestedByPlatform))}</td>
                    <td>{m.approvedAt ? whoText(t, whoOf(m.approvedBy, rows, me?.person.userId ?? '', m.requestedByPlatform && !m.approvedBy)) : t.t('common.dash')}</td>
                    <td>{endsText(t, m, lang)}</td>
                    <td>{t.t(`gov1.access.status.${rowStatus(m)}`)}</td>
                    <td>
                      {me && canOfferApprove(m, me) ? <a className="kv-link" href={`/access?act=confirm&do=approve&id=${encodeURIComponent(m.membershipId)}`} data-kv-offer="approve">{t.t('gov1.access.approve')}</a> : null}
                      {me && canOfferApprove(m, me) && canOfferRemove(m, me) ? ' · ' : null}
                      {me && canOfferRemove(m, me) ? <a className="kv-link" href={`/access?act=confirm&do=remove&id=${encodeURIComponent(m.membershipId)}`} data-kv-offer="remove">{t.t(m.status === 'requested' ? 'gov1.access.withdraw' : 'gov1.access.remove')}</a> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : null}
      {/* PC-56 GOV-4b · W356 (Q4-A): the "Sign-ins" section — it reads nothing, so it is the same in every state. */}
      <SignInsSection t={t} />
      {/* PC-56 GOV-6b · W334 (Q2-A; Q4-A once) and W351–W354 (Q3-A): "The record" and "Outside bodies" — they read nothing, so they are the same in every state. */}
      <Gov6AccessSections t={t} />
      <Gov1Refusals t={t} surface="access" />
    </section>
  );
}

/** ?act=confirm&do=request — the request form; a key minted when it is shown. */
export function RequestForm({ t, idemKey, action }: { t: Tr; idemKey: string; action: Action }) {
  return (
    <form action={form(action)} className="kv-form" data-kv-form="request">
      <input type="hidden" name="key" value={idemKey} />
      <label htmlFor="req-phone" className="kv-field__label">{t.t('gov1.access.form.phone')}</label>
      <input id="req-phone" className="kv-input" name="phone" type="tel" inputMode="tel" autoComplete="off" required />
      <p className="kv-field__hint">{t.t('gov1.access.form.phoneHint')}</p>
      <label htmlFor="req-role" className="kv-field__label">{t.t('gov1.access.form.role')}</label>
      <select id="req-role" className="kv-select" name="roleCode" required>
        {GOV_ROLE_CODES.map((r) => <option key={r} value={r}>{t.t(`gov1.access.role.${r}`)}</option>)}
      </select>
      <label htmlFor="req-term" className="kv-field__label">{t.t('gov1.access.form.term')}</label>
      <select id="req-term" className="kv-select" name="termMonths" required defaultValue="12">
        {TERM_MONTHS.map((n) => <option key={n} value={String(n)}>{t.t('gov1.access.form.months', { n })}</option>)}
      </select>
      <label htmlFor="req-reason" className="kv-field__label">{t.t('gov1.access.form.reason')}</label>
      <textarea id="req-reason" className="kv-textarea" name="reason" minLength={10} maxLength={500} required />
      <p className="kv-field__hint">{t.t('gov1.access.form.requestNote')}</p>
      <button className="kv-btn" type="submit">{t.t('gov1.access.form.send')}</button>
    </form>
  );
}

function RowFacts({ t, m, rows, me, lang = 'en' }: { t: Tr; m: GovMembership; rows: readonly GovMembership[]; me: GovMe; lang?: string }) {
  return (
    <dl className="kv-facts">
      <div className="kv-facts__row"><dt>{t.t('gov1.access.col.person')}</dt><dd>{personLabel(m)}</dd></div>
      <div className="kv-facts__row"><dt>{t.t('gov1.access.col.role')}</dt><dd>{roleText(t, m.roleCode)}</dd></div>
      <div className="kv-facts__row"><dt>{t.t('gov1.access.col.askedBy')}</dt><dd>{whoText(t, whoOf(m.requestedBy, rows, me.person.userId, m.requestedByPlatform))}</dd></div>
      <div className="kv-facts__row"><dt>{t.t('gov1.access.col.ends')}</dt><dd>{endsText(t, m, lang)}</dd></div>
    </dl>
  );
}

/** ?act=confirm&do=approve&id= — approve, offered ONLY to a head who neither asked for it nor would hold it. */
export function ApproveConfirm({ t, row, rows, me, idemKey, action, lang = 'en' }: { t: Tr; row: GovMembership | null; rows: readonly GovMembership[]; me: GovMe; idemKey: string; action: Action; lang?: string }) {
  if (!row || !canOfferApprove(row, me)) return <p className="kv-notice" data-kv-not-offered="approve">{t.t('gov1.access.approveNotOffered')}</p>;
  return (
    <form action={form(action)} className="kv-form" data-kv-form="approve">
      <input type="hidden" name="id" value={row.membershipId} />
      <input type="hidden" name="key" value={idemKey} />
      <RowFacts t={t} m={row} rows={rows} me={me} lang={lang} />
      <p className="kv-field__hint">{t.t('gov1.access.form.approveNote', { n: row.termMonths })}</p>
      <button className="kv-btn" type="submit" data-kv-offer="approve">{t.t('gov1.access.form.approve')}</button>
    </form>
  );
}

/** ?act=confirm&do=remove&id= — remove (or withdraw a pending request), offered ONLY to a head, never on their own row; a reason; at once. */
export function RemoveForm({ t, row, rows, me, idemKey, action, lang = 'en' }: { t: Tr; row: GovMembership | null; rows: readonly GovMembership[]; me: GovMe; idemKey: string; action: Action; lang?: string }) {
  if (!row || !canOfferRemove(row, me)) return <p className="kv-notice" data-kv-not-offered="remove">{t.t('gov1.access.removeNotOffered')}</p>;
  return (
    <form action={form(action)} className="kv-form" data-kv-form="remove">
      <input type="hidden" name="id" value={row.membershipId} />
      <input type="hidden" name="key" value={idemKey} />
      <RowFacts t={t} m={row} rows={rows} me={me} lang={lang} />
      <label htmlFor="rm-reason" className="kv-field__label">{t.t('gov1.access.form.reason')}</label>
      <textarea id="rm-reason" className="kv-textarea" name="reason" minLength={10} maxLength={500} required />
      <p className="kv-field__hint">{t.t('gov1.access.form.removeNote')}</p>
      <button className="kv-btn" type="submit" data-kv-offer="remove">{t.t(row.status === 'requested' ? 'gov1.access.withdraw' : 'gov1.access.remove')}</button>
    </form>
  );
}

/** ?act=success — what the SERVER did. */
export function AccessDoneNote({ t, done, expiresAt, sessionsEnded, lang = 'en' }: { t: Tr; done: AccessDone | null; expiresAt?: string | null; sessionsEnded?: number | null; lang?: string }) {
  if (done === 'requested') return <p className="kv-success" data-kv-done="requested">{t.t('gov1.access.done.requested')}</p>;
  if (done === 'approved') return <p className="kv-success" data-kv-done="approved">{t.t('gov1.access.done.approved', { at: ltrOrNull(atUtc(expiresAt), lang) ?? t.t('common.dash') })}</p>;
  if (done === 'removed') return <p className="kv-success" data-kv-done="removed">{t.t('gov1.access.done.removed', { n: sessionsEnded ?? 0 })}</p>;
  return <p className="kv-muted" data-kv-done="unknown">{t.t('gov1.access.done.unknown')}</p>;
}

/** ?act=failure — the named refusal; nothing changed. */
export function AccessFailureNote({ t, error }: { t: Tr; error: string }) {
  const code = ACCESS_ERRORS[error] ? error : 'ACCESS_FAILED';
  return (
    <>
      <p className="kv-error" role="alert" data-kv-error={code}>{t.t(ACCESS_ERRORS[code])}</p>
      <p className="kv-muted">{t.t('gov1.access.nothingChanged')}</p>
    </>
  );
}
