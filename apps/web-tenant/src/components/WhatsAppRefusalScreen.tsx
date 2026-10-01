// apps/web-tenant/src/components/WhatsAppRefusalScreen.tsx · PC-56 TENANT-8e · one shape for the WhatsApp screens that are
// refusals by name (W426 conversation, W428 template editor, W429 WhatsApp broadcast): the screen's title, what the canon
// draws and why this platform cannot do it, WHAT EXISTS INSTEAD (a real route), the register's rows with their owners, and
// what on the canon page is PARITY-DECOR. It reads the hub so the page has the house states — flagged off (404),
// restricted (403), couldn't load (+ Retry as a page load) — rather than pretending a refusal needs no backend.
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { WhatsAppHub } from '@krishalaya/sdk-js';
import { tenantClient } from '../lib/api-client';
import { getTranslator } from '../lib/i18n';
import { WhatsAppRefusals } from './WhatsAppRefusals';
import { SCREEN_REFUSALS, WA_HUB_HREF, transportState } from '../features/comms/broadcasts';

export async function WhatsAppRefusalScreen({ screen, href, gu, instead }: {
  screen: 'conversation' | 'editor' | 'broadcast'; href: string; gu: string; instead: Array<{ href: string; key: string }>;
}) {
  const t = getTranslator();
  let hub: WhatsAppHub | null = null; let state = 'data';
  try { hub = await tenantClient().notifications.whatsappHub(); }
  catch (e) { const err = e instanceof SdkError ? e : null; state = transportState(err?.code, err?.status); }
  return (
    <section>
      <nav aria-label={t.t('wa.breadcrumb')} className="kv-field__hint"><Link href={WA_HUB_HREF}>{t.t('wa.hub.title')}</Link></nav>
      <h1>{t.t(`wa.${screen}.title`)} <span lang="gu" className="kv-field__hint">{gu}</span></h1>
      {!hub && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <p>{t.t(`wa.state.${state}`)}</p>
          {state === 'error' && <p><Link href={href} className="kv-btn--link">{t.t('bc.retry')}</Link></p>}
        </div>
      )}
      {hub && (
        <>
          <div className="kv-card kv-card--notice" role="status">
            <h2>{t.t(`wa.${screen}.refusal`)}</h2>
            <p>{t.t(`wa.${screen}.why`)}</p>
          </div>
          <div className="kv-card">
            <h2>{t.t('wa.instead.heading')}</h2>
            <ul className="kv-list">{instead.map((i) => <li key={i.key}><Link href={i.href} className="kv-btn--link">{t.t(i.key)}</Link> — {t.t(`${i.key}.what`)}</li>)}</ul>
          </div>
          <WhatsAppRefusals all={hub.refused} codes={SCREEN_REFUSALS[screen]} />
          <p className="kv-field__hint">{t.t(`wa.${screen}.decor`)}</p>
        </>
      )}
    </section>
  );
}
