// apps/web-tenant/src/app/content/templates/[id]/page.tsx · W181 — one event × channel × language: your override beside
// the platform default underneath it · PC-56 TENANT-8a.
//
// W181: *"Platform default underneath; your row wins for your members. Variables are fixed by the event — you rearrange
// words, never invent data."* · *"Edits re-verify DLT before next send; until approved, the previous version keeps
// sending."*
//
// WHAT IS TRUE HERE, AND SAID. Your words SERVE only after a second person with `notification.templates.approve`
// approves a submitted version (maker ≠ checker — the verdict and 0175's trigger). On SMS and WhatsApp that approval
// sends the version to the PROVIDER and it never serves from here: DLT registration is the platform desk's (ADMIN-11b-Q1)
// and WhatsApp has no provider on this platform at all. The canon's *"DLT ref 1107173…41 approved"*, *"Sender ID
// KRISHIV"* and *"Send test to my phone"* are refused by name — no tenant-side provider submission, no sender registry
// a tenant reads, and no real send path to test through (the notifier is the noop gateway here). The canon's own
// `{{pickup_point}}` *"your addition"* is a variable `order.delivered` does not declare; the form refuses it, exactly
// as the canon's own rule (*"never invent data"*) says it must.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { TemplateView } from '@krishalaya/sdk-js';
import { mutateRefusalKey } from '../../../../features/mutate/chain';
import { auditHref } from '../../../../features/forms/chain';
import {
  MUTATE_MODULE, TEMPLATES_HREF, actLabelKey, canStartOverride, channelKey, editOverrideHref, lifecycleKey, newOverrideHref, offeredActs, pageStateKey, providerKey,
  refusedActs, refusedKey, segmentFacts, slotStatus, slotStatusKey, sourceKey, templateActHref, templateHref, templatesTransportState, type TemplatesPageState,
} from '../../../../features/templates/override';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('templates.editor.title'), robots: { index: false, follow: false } };
}

export default async function TemplateEditorPage({ params }: { params: { id: string } }) {
  await requireSession(templateHref(params.id));
  const t = getTranslator();
  const lang = getLang();

  let v: TemplateView | null = null;
  let state: TemplatesPageState | null = null;
  try { v = await tenantClient().notifications.templateView(params.id); }
  catch (e) { state = e instanceof SdkError ? templatesTransportState(e.code, e.status) : 'error'; }

  if (!v) {
    return (
      <section>
        <h1>{t.t('templates.editor.title')}</h1>
        <p className="kv-field__hint"><Link href={TEMPLATES_HREF} className="kv-btn--link">{t.t('templates.backToList')}</Link></p>
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <p>{t.t(pageStateKey(state ?? 'error'))}</p>
          {state === 'notFound' && <p><Link href={TEMPLATES_HREF} className="kv-btn--link">{t.t('templates.editor.pickEvent')}</Link></p>}
          {state === 'error' && <p><Link href={templateHref(params.id)} className="kv-btn--link">{t.t('templates.retry')}</Link></p>}
        </div>
      </section>
    );
  }

  const s = v.slot;
  const st = slotStatus(s);
  const seg = segmentFacts(v.override?.segments ?? null);
  const openSeg = segmentFacts(v.open?.segments ?? null);
  const ownVersionNo = v.override?.words?.versionNo ?? null;

  return (
    <section>
      <p className="kv-field__hint"><Link href={TEMPLATES_HREF} className="kv-btn--link">{t.t('templates.backToList')}</Link></p>
      <div className="kv-page-head">
        <h1><code>{s.eventCode}</code> × {t.t(channelKey(s.channel))} × {s.languageCode}</h1>
        <span className="kv-badge">{t.t(slotStatusKey(st))}</span>
      </div>
      <p className="kv-field__hint">{v.event.defaultName} · {t.t(sourceKey(s.source))}
        {s.override.servingSince && <> · {t.t('templates.editor.since', { date: formatDate(s.override.servingSince, lang) })}</>}
      </p>
      <p className="kv-field__hint">{t.t('templates.editor.lead')}</p>

      {s.locked && <div className="kv-card kv-card--notice" role="status"><p>{t.t('templates.editor.locked')}</p></div>}
      {!s.channelIsDefault && <div className="kv-card kv-card--notice" role="status"><p>{t.t('templates.editor.notDefault', { channels: s.defaultChannels.join(' · ') })}</p></div>}
      {v.provider !== 'none' && <div className="kv-card kv-card--notice" role="status"><p>{t.t(providerKey(v.provider))}</p></div>}

      {/* ---- W181's two buttons: Save (the template-form chain) and Send test (refused by name) ---- */}
      <div className="kv-actions">
        {v.canAuthor && !s.locked && v.override && !v.open && <Link href={editOverrideHref(v.override.templateId)} className="kv-btn">{t.t('templates.editor.save')}</Link>}
        {v.canAuthor && canStartOverride(s) && <Link href={newOverrideHref(s)} className="kv-btn">{t.t('templates.overrideThis')}</Link>}
      </div>
      {v.open && <p className="kv-field__hint">{t.t('templates.editor.openWaits', { v: String(v.open.versionNo), state: t.t(lifecycleKey(v.open.lifecycle)) })}</p>}
      <p className="kv-field__hint">{t.t(refusedKey('sendTest'))}</p>

      {/* ---- the words: yours (serving) · the one waiting · the platform default underneath ---- */}
      <div className="kv-template-compare">
        <div className="kv-card">
          <h2>{t.t('templates.editor.yours')}</h2>
          {v.override?.words ? (
            <>
              <p className="kv-field__hint">{t.t('templates.editor.servingVersion', { v: String(v.override.words.versionNo) })}</p>
              {v.override.words.subject && <p><strong>{v.override.words.subject}</strong></p>}
              <p className="kv-template-body kv-template-body--mine" lang={s.languageCode}>{v.override.words.body}</p>
              {seg && <p className="kv-field__hint">{t.t('templates.segments', { chars: formatNumber(seg.characters, lang), segs: formatNumber(seg.segments, lang), per: formatNumber(seg.perSegment, lang), enc: t.t(seg.encodingKey) })} · {t.t(seg.withinBudget ? 'templates.segments.within' : 'templates.segments.over')}</p>}
            </>
          ) : <p className="kv-field__hint">{t.t(v.override ? 'templates.editor.noneServing' : 'templates.editor.noOverride')}</p>}
          {v.open && (
            <>
              <h3>{t.t('templates.editor.waiting', { v: String(v.open.versionNo), state: t.t(lifecycleKey(v.open.lifecycle)) })}</h3>
              <p className="kv-template-body kv-template-body--mine" lang={s.languageCode}>{v.versions.find((x) => x.id === v!.open!.id)?.body}</p>
              {openSeg && <p className="kv-field__hint">{t.t('templates.segments', { chars: formatNumber(openSeg.characters, lang), segs: formatNumber(openSeg.segments, lang), per: formatNumber(openSeg.perSegment, lang), enc: t.t(openSeg.encodingKey) })}</p>}
              <p className="kv-field__hint">{t.t(v.open.authoredByYou ? 'templates.editor.youWrote' : 'templates.editor.colleagueWrote')}</p>
            </>
          )}
        </div>
        <div className="kv-card">
          <h2>{t.t('templates.editor.platform')}</h2>
          {v.platform.words ? (
            <>
              <p className="kv-field__hint">{t.t('templates.serving.platform', { v: String(v.platform.words.versionNo) })}</p>
              {v.platform.words.subject && <p><strong>{v.platform.words.subject}</strong></p>}
              <p className="kv-template-body" lang={s.languageCode}>{v.platform.words.body}</p>
              <p className="kv-field__hint">{t.t('templates.editor.fallsBackHere')}</p>
            </>
          ) : <p className="kv-field__hint">{t.t('templates.editor.noPlatform')}</p>}
        </div>
      </div>

      {/* ---- Variables (fixed by the event) — or "not declared", never an empty table ---- */}
      <h2>{t.t('templates.editor.variables')}</h2>
      {v.variables.length === 0 ? (
        <p className="kv-field__hint">{t.t('templates.editor.variablesUndeclared')}</p>
      ) : (
        <table className="kv-table">
          <thead><tr><th>{t.t('templates.col.variable')}</th><th>{t.t('templates.col.sample')}</th><th>{t.t('templates.col.source')}</th><th>{t.t('templates.col.required')}</th></tr></thead>
          <tbody>
            {v.variables.map((x) => (
              <tr key={x.name}><td><code>{`{{${x.name}}}`}</code></td><td>{x.sampleValue}</td><td className="kv-field__hint">{x.sourceRef}</td><td>{t.t(x.isRequired ? 'templates.required.yes' : 'templates.required.no')}</td></tr>
            ))}
          </tbody>
        </table>
      )}

      {/* ---- the preview: the real render() over the declared samples ---- */}
      {(v.override?.rendered || v.platform.rendered) && (
        <>
          <h2>{t.t('templates.editor.preview')}</h2>
          <p className="kv-template-body" lang={s.languageCode}>{v.override?.rendered ?? v.platform.rendered}</p>
          <p className="kv-field__hint">{t.t('templates.editor.previewNote')}</p>
        </>
      )}

      {/* ---- the acts: offered as links to the confirm step, refused with their first reason ---- */}
      {v.override && (
        <>
          <h2>{t.t('templates.editor.acts')}</h2>
          <ul className="kv-list">
            {offeredActs(v.acts).map((a) => (
              <li key={a.act}><Link href={templateActHref(v!.override!.templateId, a.act, v!.open?.id)} className="kv-btn--link">{t.t(actLabelKey(a.act))}</Link></li>
            ))}
            {refusedActs(v.acts).map((a) => (
              <li key={a.act} className="kv-field__hint">{t.t(actLabelKey(a.act))} — {t.t(mutateRefusalKey(MUTATE_MODULE, a.refusals[0]))}</li>
            ))}
          </ul>
          <p className="kv-field__hint">{t.t('templates.editor.makerChecker')}</p>
        </>
      )}

      {/* ---- the version history (W181 "No draft history yet") ---- */}
      <h2>{t.t('templates.editor.history')}</h2>
      {v.versions.length === 0 ? <p className="kv-field__hint">{t.t('templates.editor.noHistory')}</p> : (
        <table className="kv-table">
          <thead><tr><th>{t.t('templates.col.version')}</th><th>{t.t('templates.col.status')}</th><th>{t.t('templates.col.author')}</th><th>{t.t('templates.col.decided')}</th><th>{t.t('templates.col.reason')}</th></tr></thead>
          <tbody>
            {v.versions.map((x) => (
              <tr key={x.id}>
                <td>v{x.versionNo}{x.versionNo === ownVersionNo && <span className="kv-badge"> {t.t('templates.source.override')}</span>}</td>
                <td>{t.t(lifecycleKey(x.lifecycle))}{x.rejectionReason && <div className="kv-field__hint">{x.rejectionReason}</div>}</td>
                <td>{x.authoredByYou ? t.t('templates.you') : (x.authorName ?? t.t('common.dash'))}<div className="kv-field__hint">{formatDate(x.createdAt, lang)}</div></td>
                <td>
                  {x.approvedAt ? <>{x.approvedByAdmin ? t.t('templates.platformDesk') : (x.approverName ?? t.t('common.dash'))}<div className="kv-field__hint">{formatDate(x.approvedAt, lang)}</div></> : null}
                  {x.rejectedAt ? <>{x.rejecterName ?? t.t('common.dash')}<div className="kv-field__hint">{formatDate(x.rejectedAt, lang)}</div></> : null}
                  {!x.approvedAt && !x.rejectedAt && <span className="kv-field__hint">{t.t('common.dash')}</span>}
                </td>
                <td className="kv-field__hint">{x.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {v.override && <p><Link href={auditHref('notification_template', v.override.templateId)} className="kv-btn--link">{t.t('form.viewAudit')}</Link></p>}

      {/* ---- W181's guard rails, each a fact of this platform (or refused) ---- */}
      <h2>{t.t('templates.editor.guardRails')}</h2>
      <ul className="kv-list">
        <li>{t.t('templates.guard.variables')}</li>
        <li>{t.t('templates.guard.segments')}</li>
        <li>{t.t('templates.guard.previousKeepsSending')}</li>
        <li className="kv-field__hint">{t.t(refusedKey('dltReverify'))}</li>
      </ul>
      <p className="kv-field__hint">{t.t('templates.editor.recorded')}</p>
    </section>
  );
}
