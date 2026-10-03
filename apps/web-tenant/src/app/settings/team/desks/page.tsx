// apps/web-tenant/src/app/settings/team/desks/page.tsx · W185 · DESKS — PC-56 TENANT-13b.
//
// The canon's screen, printed as built (founder decision: tenant desk bundles, no new global roles, no separate owner role):
//   • desk cards — name, status, members (add directly; remove with a reason — audited), the permission codes, and the template's honest
//     sentence: each canon label as the real code it rides, or refused by name ("no route carries this yet" / "rides <verb>"), and each
//     guarantee the canon makes (built, or not — e.g. KYC recusal is not built; rate cards are NOT behind a checker today);
//   • "New desk (checker)" → the form chain (W2574–W2577); edit permissions / disable / enable → proposals a second administrator
//     confirms (W2578–W2580); "Install templates" when none are installed — ONE proposal;
//   • the suggestion row is a REAL count: labour bookings this season created by tenant_admin holders, printed only when > 0 and no
//     labour desk is active;
//   • pending proposals with Confirm / Refuse; the note; states: no desks · couldn't load (Retry) · restricted (desk.manage) · flagged off
//     (`tenancy`) · needs a second administrator · loading.
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { DeskBoard } from '@krishalaya/sdk-js';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getLang, getTranslator } from '../../../../lib/i18n';
import {
  DESKS_HREF, NEW_DESK_HREF, deskActHref, deskProposalHref, deskRefusalKey, editDeskHref, kindKey, labelLine, pageState, parseCodes,
} from '../../../../features/desks/desks';
import { addMemberAction, removeMemberAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('dk.title'), robots: { index: false, follow: false } };
}

export default async function DesksPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  await requireSession(DESKS_HREF);
  const t = getTranslator();
  const lang = getLang();
  const when = (iso: string | null | undefined) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) : '');
  let b: DeskBoard | null = null; let state: string | null = null;
  try { b = await tenantClient().desks.board(); }
  catch (e) { const err = e instanceof SdkError ? e : null; state = pageState(err?.code, err?.status); }
  const memberErrors = parseCodes(searchParams.memberError);
  const anyInstalled = b ? b.templates.some((x) => x.installed) : false;

  return (
    <section>
      <nav aria-label={t.t('dk.breadcrumb.label')} className="kv-field__hint">{t.t('dk.breadcrumb.settings')} › {t.t('dk.breadcrumb.team')} › {t.t('dk.title')}</nav>
      <h1>{t.t('dk.title')}</h1>
      <p>{t.t('dk.lede')}</p>
      {b && <p><Link href={NEW_DESK_HREF} className="kv-btn kv-btn--primary">{t.t('dk.new')}</Link></p>}

      {state && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert">
          <strong>{t.t(`dk.state.${state}.title`)}</strong><p>{t.t(`dk.state.${state}.body`)}</p>
          {state === 'error' && <p><Link href={DESKS_HREF} className="kv-btn--link">{t.t('dk.state.retry')}</Link></p>}
        </div>
      )}
      {b && b.admins.count < 2 && (
        <div className="kv-card kv-card--notice" role="note"><strong>{t.t('dk.secondAdmin.title')}</strong><p>{t.t('dk.secondAdmin.body', { n: formatNumber(b.admins.count, lang) })}</p></div>
      )}
      {searchParams.memberOk && <p className="kv-success" role="status">{t.t(searchParams.memberOk === 'removed' ? 'dk.member.removed' : 'dk.member.added')}</p>}
      {memberErrors.length > 0 && <div className="kv-error" role="alert"><ul className="kv-list">{memberErrors.map((c) => <li key={c}>{t.t(deskRefusalKey(c))}</li>)}</ul></div>}

      {b && b.desks.length === 0 && (
        <div className="kv-card">
          <strong>{t.t('dk.empty.title')}</strong><p>{t.t('dk.empty.body')}</p>
          {!b.pending.some((p) => p.kind === 'install_templates') && <p><Link href={deskActHref('install_templates')} className="kv-btn kv-btn--primary">{t.t('dk.install')}</Link></p>}
        </div>
      )}

      {b && b.desks.map((d) => {
        const tpl = d.templateCode ? b!.templates.find((x) => x.code === d.templateCode) : undefined;
        return (
          <div key={d.id} className="kv-card">
            <h2>{d.name} <span className="kv-field__hint">· {t.t('dk.card.staff', { n: formatNumber(d.members.length, lang) })}</span> {d.status === 'disabled' && <span className="kv-badge kv-badge--muted">{t.t('dk.card.disabled')}</span>}</h2>
            {d.description && <p>{d.description}</p>}
            <p><code>{d.permissions.join(' · ') || '—'}</code></p>
            {tpl && (
              <ul className="kv-list">
                {tpl.labels.map((l) => { const x = labelLine(l); return <li key={l.label} className="kv-field__hint">{t.t(x.key, x.vars)}</li>; })}
                {tpl.guarantees.map((g) => <li key={g.key} className="kv-field__hint">{t.t(`dk.guarantee.${g.key}`)} — {t.t(g.built ? 'dk.guarantee.built' : 'dk.guarantee.notBuilt')}</li>)}
              </ul>
            )}
            <p className="kv-field__hint">{t.t('dk.card.madeBy', { at: when(d.createdAt) })}</p>
            <ul className="kv-list">
              {d.members.map((m) => (
                <li key={m.userId}>
                  {m.name ?? m.userId.slice(0, 8)} <span className="kv-field__hint">· {t.t('dk.member.since', { at: when(m.addedAt) })}</span>
                  <form action={removeMemberAction} className="kv-form kv-form--inline">
                    <input type="hidden" name="deskId" value={d.id} /><input type="hidden" name="userId" value={m.userId} />
                    <label className="kv-field" htmlFor={`rm-${d.id}-${m.userId}`}><span>{t.t('dk.member.removeReason')}</span>
                      <input id={`rm-${d.id}-${m.userId}`} name="reason" className="kv-input" minLength={3} maxLength={300} required /></label>
                    <button type="submit" className="kv-btn--link">{t.t('dk.member.remove')}</button>
                  </form>
                </li>
              ))}
            </ul>
            {d.status === 'active' && (
              <form action={addMemberAction} className="kv-form kv-form--inline">
                <input type="hidden" name="deskId" value={d.id} />
                <label className="kv-field" htmlFor={`add-${d.id}`}><span>{t.t('dk.member.add')}</span>
                  <select id={`add-${d.id}`} name="userId" className="kv-select" required defaultValue="">
                    <option value="" disabled>{t.t('dk.member.pick')}</option>
                    {b!.people.filter((p) => !d.members.some((m) => m.userId === p.userId)).map((p) => <option key={p.userId} value={p.userId}>{p.name ?? p.userId.slice(0, 8)} ({p.roles.join(', ')})</option>)}
                  </select></label>
                <button type="submit" className="kv-btn">{t.t('dk.member.addButton')}</button>
              </form>
            )}
            <p className="kv-field__hint">{t.t('dk.member.direct')}</p>
            {d.pendingProposal ? (
              <p className="kv-badge kv-badge--warn">{t.t('dk.card.pending', { kind: t.t(kindKey(d.pendingProposal.kind)), name: d.pendingProposal.proposedByName ?? t.t('dk.someone') })}</p>
            ) : (
              <p>
                <Link href={editDeskHref(d.id)} className="kv-btn--link">{t.t('dk.card.edit')}</Link>{' · '}
                <Link href={deskActHref(d.status === 'active' ? 'disable' : 'enable', d.id)} className="kv-btn--link">{t.t(d.status === 'active' ? 'dk.card.disable' : 'dk.card.enable')}</Link>
              </p>
            )}
          </div>
        );
      })}

      {b && b.suggestion && (
        <div className="kv-card kv-card--notice">
          <strong>{t.t('dk.suggestion.title')}</strong>
          <p>{t.t('dk.suggestion.body', { n: formatNumber(b.suggestion.adminBookings, lang), season: t.t(`dk.season.${b.suggestion.season}`) })}</p>
          <p><Link href={`${NEW_DESK_HREF}?step=edit&templateCode=labour&code=labour&name=labour`} className="kv-btn">{t.t('dk.suggestion.enable')}</Link></p>
        </div>
      )}

      {b && b.desks.length > 0 && !anyInstalled && !b.pending.some((p) => p.kind === 'install_templates') && (
        <p><Link href={deskActHref('install_templates')} className="kv-btn--link">{t.t('dk.install')}</Link></p>
      )}

      {b && (
        <details className="kv-card">
          <summary>{t.t('dk.templates.title')}</summary>
          {b.templates.map((tp) => (
            <div key={tp.code}>
              <h3>{tp.code} {tp.installed && <span className="kv-badge">{t.t('dk.templates.installed')}</span>}</h3>
              <ul className="kv-list">
                {tp.labels.map((l) => { const x = labelLine(l); return <li key={l.label}>{t.t(x.key, x.vars)}</li>; })}
                {tp.guarantees.map((g) => <li key={g.key}>{t.t(`dk.guarantee.${g.key}`)} — {t.t(g.built ? 'dk.guarantee.built' : 'dk.guarantee.notBuilt')}</li>)}
              </ul>
            </div>
          ))}
        </details>
      )}

      {b && b.pending.length > 0 && (
        <div className="kv-card">
          <h2>{t.t('dk.pending.title')}</h2>
          <ul className="kv-list">
            {b.pending.map((p) => (
              <li key={p.id}>
                {t.t(kindKey(p.kind))} · {t.t('dk.pending.by', { name: p.proposedByName ?? t.t('dk.someone'), at: when(p.proposedAt) })}
                <br /><span className="kv-field__hint">{t.t('dk.pending.diff', { add: p.diff.add.join(', ') || '—', remove: p.diff.remove.join(', ') || '—' })}</span>
                <br /><span className="kv-field__hint">{t.t('dk.pending.reason', { reason: p.reason })}</span>
                <p>
                  {p.canConfirm ? <Link href={deskProposalHref(p.id, 'confirm')} className="kv-btn kv-btn--primary">{t.t('dk.pending.confirm')}</Link> : <span className="kv-field__hint">{t.t('dk.pending.youProposed')}</span>}
                  {' · '}<Link href={deskProposalHref(p.id, 'refuse')} className="kv-btn--link">{t.t(p.youProposed ? 'dk.pending.withdraw' : 'dk.pending.refuse')}</Link>
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {b && <p className="kv-field__hint">{t.t('dk.note')}</p>}
    </section>
  );
}
