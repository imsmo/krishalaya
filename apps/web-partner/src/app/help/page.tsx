// apps/web-partner/src/app/help/page.tsx · partner help & support (PC-2C). Static, honest: real support
// channels + what to include in an escalation. API credentials + partner webhooks are named here with their
// true status (no partner-realm endpoints yet — PC-54) instead of dead settings screens.
import type { Metadata } from 'next';
import { requirePartner } from '../../lib/session';
import { getTranslator } from '../../lib/i18n';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('help.title'), robots: { index: false, follow: false } };
}

export default async function HelpPage() {
  await requirePartner();
  const t = getTranslator();
  return (
    <section>
      <h1>{t.t('help.title')}</h1>

      <div className="kv-card">
        <h2 className="kv-card__title">{t.t('help.contact')}</h2>
        <p>{t.t('help.contactBody')} <a className="kv-link" href="mailto:support@krishalaya.com">support@krishalaya.com</a></p>
        <p className="kv-field__hint">{t.t('help.include')}</p>
      </div>

      <div className="kv-card">
        <h2 className="kv-card__title">{t.t('help.integration')}</h2>
        <p>{t.t('help.integrationBody')}</p>
      </div>
    </section>
  );
}
