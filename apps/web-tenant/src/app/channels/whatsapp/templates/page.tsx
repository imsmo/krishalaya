// apps/web-tenant/src/app/channels/whatsapp/templates/page.tsx · W427 — WhatsApp templates · PC-56 TENANT-8e.
//
// 8a's template override plane, FILTERED to `channel = whatsapp` — the only honest reading of this screen. The rows are the
// catalogue's WhatsApp slots (event × language, for the events that list WhatsApp as a channel), each with what serves
// (nothing: zero WhatsApp templates exist) and the cooperative's own override when it has one, authored through 8a's
// chain — where a WhatsApp version parks at *"with the provider"* (`submitted_to_provider`) and NEVER serves, by 0175's
// rule, because no provider exists. The canon's own banner — *"Approval is Meta's decision"* — is true and goes one step
// further here: there is no Meta to decide (ADMIN-11b-Q1 owns the provider).
//   • *Fix & resubmit* / row → 8a's editor (W181) of that slot; *New template* → 8a's form (W2786) aimed at WhatsApp;
//   • *Archive override* → 8a's `retire` act; *Duplicate* — refused by name (8a has no copy act; a new override from the
//     platform default is the honest equivalent);
//   • Category, Quality, `provider_template_ref`, the Lifecycle filter as DELTA-052 — refused by name (no columns; the 0072
//     lifecycle columns are read and written by nothing); the pager → keyset *Next*.
// States: data · empty (no WhatsApp slot) · restricted · flagged off · couldn't load + Retry · loading.
import type { Metadata } from 'next';
import Link from 'next/link';
import { formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { TemplateIndex, WhatsAppHub } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { WhatsAppRefusals } from '../../../../components/WhatsAppRefusals';
import { SCREEN_REFUSALS, WA_EDITOR_HREF, WA_HUB_HREF, WA_TEMPLATES_HREF, transportState } from '../../../../features/comms/broadcasts';
import { canStartOverride, lifecycleKey, newOverrideHref, slotHref, slotStatus, slotStatusKey, templateActHref } from '../../../../features/templates/override';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('wa.templates.title'), robots: { index: false, follow: false } }; }

export default async function WhatsAppTemplatesPage({ searchParams }: { searchParams: { cursor?: string } }) {
  await requireSession(WA_TEMPLATES_HREF);
  const t = getTranslator();
  const lang = getLang();
  const c = tenantClient().notifications;
  let idx: TemplateIndex | null = null; let hub: WhatsAppHub | null = null; let state = 'data';
  try { [idx, hub] = await Promise.all([c.templateIndex({ channel: 'whatsapp', cursor: searchParams.cursor, limit: 50 }), c.whatsappHub()]); }
  catch (e) { const err = e instanceof SdkError ? e : null; state = transportState(err?.code, err?.status); }

  return (
    <section>
      <nav aria-label={t.t('wa.breadcrumb')} className="kv-field__hint"><Link href={WA_HUB_HREF}>{t.t('wa.hub.title')}</Link></nav>
      <h1>{t.t('wa.templates.title')} <span lang="gu" className="kv-field__hint">વોટ્સએપ ટેમ્પલેટ</span></h1>
      <p className="kv-field__hint">{t.t('wa.templates.lead')}</p>
      {!idx && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <p>{t.t(`wa.state.${state}`)}</p>
          {state === 'error' && <p><Link href={WA_TEMPLATES_HREF} className="kv-btn--link">{t.t('bc.retry')}</Link></p>}
        </div>
      )}
      {idx && hub && (
        <>
          <div className="kv-card kv-card--notice" role="status">
            <p>{t.t('wa.templates.serving', { n: formatNumber(idx.summary.whatsappServing, lang), events: formatNumber(idx.summary.whatsappEvents, lang) })}</p>
            <p className="kv-field__hint">{t.t('wa.templates.neverServes')}</p>
            {idx.canAuthor && <p><Link href={`${newOverrideHref()}?channel=whatsapp`} className="kv-btn kv-btn--secondary">{t.t('wa.templates.new')}</Link> <span className="kv-field__hint">{t.t('wa.templates.newHint')}</span></p>}
          </div>
          {idx.items.length === 0 ? (
            <div className="kv-card kv-card--notice" role="status"><p>{t.t('wa.templates.empty')}</p></div>
          ) : (
            <table className="kv-table">
              <caption className="kv-sr-only">{t.t('wa.templates.title')}</caption>
              <thead><tr><th scope="col">{t.t('wa.templates.col.event')}</th><th scope="col">{t.t('wa.templates.col.lang')}</th><th scope="col">{t.t('wa.templates.col.status')}</th><th scope="col">{t.t('wa.templates.col.latest')}</th><th scope="col">{t.t('wa.templates.col.act')}</th></tr></thead>
              <tbody>
                {idx.items.map((s) => {
                  const href = slotHref(s);
                  return (
                    <tr key={`${s.eventCode}:${s.languageCode}`}>
                      <th scope="row"><code>{s.eventCode}</code></th>
                      <td lang={s.languageCode}>{s.languageCode}</td>
                      <td>{t.t(slotStatusKey(slotStatus(s)))}</td>
                      <td>{s.override.latestLifecycle ? t.t(lifecycleKey(s.override.latestLifecycle)) : <span className="kv-field__hint">{t.t('common.dash')}</span>}</td>
                      <td>
                        {s.locked ? <span className="kv-field__hint">{t.t('wa.templates.locked')}</span> : (
                          <>
                            {href && <Link href={href} className="kv-btn--link">{t.t(s.override.templateId ? 'wa.templates.openOverride' : 'wa.templates.openDefault')}</Link>}
                            {canStartOverride(s) && idx!.canAuthor && <> · <Link href={newOverrideHref(s)} className="kv-btn--link">{t.t('wa.templates.startOverride')}</Link></>}
                            {s.override.templateId && idx!.canApprove && <> · <Link href={templateActHref(s.override.templateId, 'retire')} className="kv-btn--link">{t.t('wa.templates.archive')}</Link></>}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {idx.nextCursor && <p><Link href={`${WA_TEMPLATES_HREF}?cursor=${encodeURIComponent(idx.nextCursor)}`} className="kv-btn--link">{t.t('bc.next')}</Link></p>}
          <WhatsAppRefusals all={hub.refused} codes={SCREEN_REFUSALS.templates} />
          <p className="kv-field__hint">{t.t('wa.templates.decor')} <Link href={WA_EDITOR_HREF} className="kv-btn--link">{t.t('wa.editor.title')}</Link></p>
        </>
      )}
    </section>
  );
}
