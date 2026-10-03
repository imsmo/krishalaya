// apps/web-tenant/src/app/settings/team/desks/new/page.tsx · THE DESK FORM CHAIN — W2574 form-error · W2575 review · W2576 success ·
// W2577 failure · PC-56 TENANT-13b. "New desk (checker)" and "Edit permissions" (with `deskId`).
//   • edit: name / code / description, the codes FROM THE GRANTABLE LIST the API computed (the one ungrantable list and "your
//     administrators do not hold it" are applied there), the people (create) or members to add / remove (edit), the reason (20–500);
//   • review = form-error: the API's preview — the DIFF (codes added / removed, members), how many people it re-grants, who must
//     confirm, every refusal against its field; Submit only when ready → a PROPOSAL, never applied by its maker;
//   • success: the PROPOSAL CARD (what it changes, who must confirm, expires in 7 days) + the audit entry; failure: every refusal by name.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { DeskBoard, DeskReview } from '@krishalaya/sdk-js';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { getLang, getTranslator } from '../../../../../lib/i18n';
import { chainStep, chainStepKey } from '../../../../../features/forms/chain';
import {
  DESKS_HREF, NEW_DESK_HREF, deskRefusalKey, isDeskCode, isUuid, pageState, parseCodes, parseIdList, parsePermList,
} from '../../../../../features/desks/desks';
import { AuditEntryCard } from '../../../../people/ambassadors/AuditEntryCard';
import { proposeDeskAction } from '../actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('dk.form.title'), robots: { index: false, follow: false } };
}
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v.find((x) => x.trim()) : v)?.trim() ?? '';

export default async function DeskFormPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession(NEW_DESK_HREF);
  const t = getTranslator();
  const lang = getLang();
  const when = (iso: string | null | undefined) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) : '');
  const step = chainStep(one(searchParams.step) || undefined);
  const deskId = isUuid(one(searchParams.deskId)) ? one(searchParams.deskId) : '';
  const kind: 'create' | 'edit' = deskId ? 'edit' : 'create';
  const v = {
    code: isDeskCode(one(searchParams.code)) ? one(searchParams.code) : '', name: one(searchParams.name).slice(0, 120), description: one(searchParams.description).slice(0, 400),
    templateCode: /^[a-z]{2,20}$/.test(one(searchParams.templateCode)) ? one(searchParams.templateCode) : '',
    permissions: parsePermList(searchParams.permissions), members: parseIdList(searchParams.members), removeMembers: parseIdList(searchParams.removeMembers),
    reason: one(searchParams.reason).slice(0, 500),
  };
  const failed = parseCodes(one(searchParams.error));
  const proposalId = isUuid(one(searchParams.proposal)) ? one(searchParams.proposal) : '';

  let b: DeskBoard | null = null; let state: string | null = null;
  try { b = await tenantClient().desks.board(); } catch (e) { const err = e instanceof SdkError ? e : null; state = pageState(err?.code, err?.status); }
  const desk = deskId && b ? b.desks.find((d) => d.id === deskId) ?? null : null;
  if (deskId && b && !desk) state = 'notFound';
  // the template the suggestion row asked for: its installable codes pre-ticked
  const tpl = v.templateCode && b ? b.templates.find((x) => x.code === v.templateCode) : undefined;
  const ticked = v.permissions.length ? v.permissions : desk ? desk.permissions : tpl ? tpl.installs : [];
  let review: DeskReview | null = null;
  if (b && step === 'review') {
    try {
      review = await tenantClient().desks.preview({ kind, deskId: deskId || null, code: v.code || null, name: v.name || null, description: v.description || null,
        templateCode: v.templateCode || null, permissions: v.permissions, members: { add: v.members, remove: v.removeMembers }, reason: v.reason || null });
    } catch (e) { const err = e instanceof SdkError ? e : null; state = pageState(err?.code, err?.status, true); }
  }
  let proposal: Awaited<ReturnType<ReturnType<typeof tenantClient>['desks']['proposal']>> | null = null;
  if (step === 'success' && proposalId) { try { proposal = await tenantClient().desks.proposal(proposalId); } catch { proposal = null; } }
  const showForm = b && !state && (step === 'edit' || (step === 'review' && review && !review.ready));
  const backQs = new URLSearchParams({ step: 'edit', ...(deskId ? { deskId } : {}), ...(v.code ? { code: v.code } : {}), ...(v.name ? { name: v.name } : {}),
    ...(v.description ? { description: v.description } : {}), ...(v.permissions.length ? { permissions: v.permissions.join(',') } : {}),
    ...(v.members.length ? { members: v.members.join(',') } : {}), ...(v.reason ? { reason: v.reason } : {}) }).toString();
  const refusalsFor = (f: string | null) => (review?.refusals ?? []).filter((r) => r.field === f);
  const personName = (u: string) => b?.people.find((p) => p.userId === u)?.name ?? u.slice(0, 8);

  return (
    <section>
      <nav aria-label={t.t('dk.breadcrumb.label')} className="kv-field__hint">{t.t('dk.breadcrumb.settings')} › {t.t('dk.breadcrumb.team')} › <Link href={DESKS_HREF} className="kv-btn--link">{t.t('dk.title')}</Link> › {t.t(kind === 'edit' ? 'dk.form.editTitle' : 'dk.form.title')}</nav>
      <h1>{t.t(kind === 'edit' ? 'dk.form.editTitle' : 'dk.form.title')}{desk ? <> · {desk.name}</> : null}</h1>
      <p className="kv-field__hint">{t.t(chainStepKey(step, (review?.refusals.length ?? 0) > 0))} · {t.t('dk.form.module')}</p>
      {state && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert">
          <strong>{t.t(`dk.state.${state}.title`)}</strong><p>{t.t(`dk.state.${state}.body`)}</p>
          <p><Link href={DESKS_HREF} className="kv-btn--link">{t.t('dk.form.backToScreen')}</Link></p>
        </div>
      )}

      {showForm && (
        <form action={NEW_DESK_HREF} method="get" className="kv-form">
          <input type="hidden" name="step" value="review" />
          {deskId && <input type="hidden" name="deskId" value={deskId} />}
          {v.templateCode && <input type="hidden" name="templateCode" value={v.templateCode} />}
          {refusalsFor(null).map((r) => <p key={r.code} className="kv-error" role="alert">{t.t(deskRefusalKey(r.code))}</p>)}
          {kind === 'create' && (
            <>
              <label className="kv-field" htmlFor="dk-name"><span>{t.t('dk.form.name')}</span>
                <input id="dk-name" name="name" className="kv-input" minLength={2} maxLength={80} required defaultValue={v.name} /></label>
              {refusalsFor('name').map((r) => <p key={r.code} className="kv-error">{t.t(deskRefusalKey(r.code))}</p>)}
              <label className="kv-field" htmlFor="dk-code"><span>{t.t('dk.form.code')}</span>
                <input id="dk-code" name="code" className="kv-input" pattern="[a-z][a-z0-9_]{1,39}" required defaultValue={v.code} /></label>
              <p className="kv-field__hint">{t.t('dk.form.codeHint')}</p>
              {refusalsFor('code').map((r) => <p key={r.code} className="kv-error">{t.t(deskRefusalKey(r.code))}</p>)}
              <label className="kv-field" htmlFor="dk-desc"><span>{t.t('dk.form.description')}</span>
                <input id="dk-desc" name="description" className="kv-input" maxLength={300} defaultValue={v.description} /></label>
            </>
          )}
          <fieldset className="kv-fieldset">
            <legend>{t.t('dk.form.codes')}</legend>
            {b!.grantable.map((c) => (
              <label key={c} className="kv-check"><input type="checkbox" name="permissions" value={c} defaultChecked={ticked.includes(c)} /> <code>{c}</code></label>
            ))}
            {desk && desk.permissions.filter((c) => !b!.grantable.includes(c)).map((c) => (
              <p key={c} className="kv-field__hint">{t.t('dk.form.notGrantableNow', { code: c })}</p>
            ))}
          </fieldset>
          <p className="kv-field__hint">{t.t('dk.form.codesHint')}</p>
          {refusalsFor('permissions').map((r, i) => <p key={`${r.code}-${i}`} className="kv-error">{t.t(deskRefusalKey(r.code))}{r.detail?.code ? <> — <code>{String(r.detail.code)}</code></> : null}</p>)}
          <fieldset className="kv-fieldset">
            <legend>{t.t(kind === 'edit' ? 'dk.form.membersAdd' : 'dk.form.members')}</legend>
            {b!.people.filter((p) => !desk || !desk.members.some((m) => m.userId === p.userId)).slice(0, 200).map((p) => (
              <label key={p.userId} className="kv-check"><input type="checkbox" name="members" value={p.userId} defaultChecked={v.members.includes(p.userId)} /> {p.name ?? p.userId.slice(0, 8)} <span className="kv-field__hint">({p.roles.join(', ')})</span></label>
            ))}
          </fieldset>
          {desk && desk.members.length > 0 && (
            <fieldset className="kv-fieldset">
              <legend>{t.t('dk.form.membersRemove')}</legend>
              {desk.members.map((m) => <label key={m.userId} className="kv-check"><input type="checkbox" name="removeMembers" value={m.userId} defaultChecked={v.removeMembers.includes(m.userId)} /> {m.name ?? m.userId.slice(0, 8)}</label>)}
            </fieldset>
          )}
          {refusalsFor('members').map((r, i) => <p key={`${r.code}-${i}`} className="kv-error">{t.t(deskRefusalKey(r.code))}</p>)}
          <label className="kv-field" htmlFor="dk-reason"><span>{t.t('dk.form.reason')}</span>
            <textarea id="dk-reason" name="reason" className="kv-textarea" rows={2} minLength={20} maxLength={500} required defaultValue={v.reason} /></label>
          {refusalsFor('reason').map((r) => <p key={r.code} className="kv-error">{t.t(deskRefusalKey(r.code))}</p>)}
          <p className="kv-field__hint">{t.t('dk.form.checkerHint')}</p>
          <button type="submit" className="kv-btn kv-btn--primary">{t.t('dk.form.toReview')}</button>{' '}
          <Link href={DESKS_HREF} className="kv-btn--link">{t.t('dk.form.cancel')}</Link>
        </form>
      )}

      {step === 'review' && review && review.ready && (
        <div className="kv-card">
          <p>{t.t('dk.form.reviewLede')}</p>
          <dl className="kv-facts">
            {kind === 'create' && <div className="kv-facts__row"><dt>{t.t('dk.form.name')}</dt><dd>{v.name} (<code>{v.code}</code>)</dd></div>}
            <div className="kv-facts__row"><dt>{t.t('dk.form.diffAdd')}</dt><dd><code>{review.diff.add.join(' · ') || '—'}</code></dd></div>
            <div className="kv-facts__row"><dt>{t.t('dk.form.diffRemove')}</dt><dd><code>{review.diff.remove.join(' · ') || '—'}</code></dd></div>
            <div className="kv-facts__row"><dt>{t.t('dk.form.membersAdd')}</dt><dd>{review.diff.members.add.map(personName).join(', ') || '—'}</dd></div>
            {kind === 'edit' && <div className="kv-facts__row"><dt>{t.t('dk.form.membersRemove')}</dt><dd>{review.diff.members.remove.map(personName).join(', ') || '—'}</dd></div>}
            <div className="kv-facts__row"><dt>{t.t('dk.form.regrants')}</dt><dd>{t.t('dk.form.regrantsN', { n: formatNumber(review.reGranted, lang) })}</dd></div>
          </dl>
          <p>{t.t('dk.form.confirmerRule', { n: formatNumber(review.admins, lang) })}</p>
          <form action={proposeDeskAction} className="kv-form">
            <input type="hidden" name="kind" value={kind} /><input type="hidden" name="deskId" value={deskId} />
            <input type="hidden" name="code" value={v.code} /><input type="hidden" name="name" value={v.name} /><input type="hidden" name="description" value={v.description} />
            <input type="hidden" name="permissions" value={v.permissions.join(',')} /><input type="hidden" name="members" value={v.members.join(',')} />
            <input type="hidden" name="removeMembers" value={v.removeMembers.join(',')} /><input type="hidden" name="reason" value={v.reason} />
            <input type="hidden" name="idempotencyKey" value={randomUUID()} />
            <button type="submit" className="kv-btn kv-btn--primary">{t.t('dk.form.submit')}</button>{' '}
            <Link href={`${NEW_DESK_HREF}?${backQs}`} className="kv-btn--link">{t.t('dk.form.backToEdit')}</Link>
          </form>
        </div>
      )}

      {step === 'success' && (
        <>
          <div className="kv-card kv-success" role="status">
            <strong>{t.t('dk.form.proposed')}</strong>
            {proposal ? <p>{t.t('dk.form.proposedCard', { add: proposal.diff.add.join(', ') || '—', remove: proposal.diff.remove.join(', ') || '—', at: when(proposal.expiresAt), n: formatNumber(proposal.admins, lang) })}</p> : null}
            <p><Link href={DESKS_HREF} className="kv-btn kv-btn--primary">{t.t('dk.form.backToScreen')}</Link></p>
          </div>
          {proposalId && <AuditEntryCard t={t} lang={lang} entityType="desk_change_proposal" entityId={proposalId} action="desk.change_proposed" />}
        </>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <strong>{t.t('dk.form.failure.title')}</strong>
          <ul className="kv-list">{(failed.length ? failed : ['unknown']).map((c) => <li key={c}>{t.t(deskRefusalKey(c))}</li>)}</ul>
          <p>{t.t('dk.form.failure.untouched')}</p>
          <p><Link href={`${NEW_DESK_HREF}?${backQs.replace('step=edit', 'step=review')}`} className="kv-btn--link">{t.t('dk.form.failure.retry')}</Link>{' · '}<Link href={DESKS_HREF} className="kv-btn--link">{t.t('dk.form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
