// apps/web-storefront/src/components/sweep/ContactScreen.tsx · PC-56 STORE-SWEEP-a · C2 (canon W312; founders D3 / D6 / D7) — THE PLATFORM'S CONTACT
// PAGE (`/contact` on the platform; on a store's own host `/contact` is the STORE's page — StoreContactScreen). Every way to reach the platform
// that is published, and the rest refused by name (RefusalList `contact`):
//   • an order or a lot → message the organisation that sells it (the 4b door lives on the order and lot pages);
//   • organisations → open the storefront yourself (`/for-organisations`, 1c);
//   • the five mailboxes (general, press, partners, security, grievance) ONLY from the platform-facts read (0223): each printed when set, "not
//     published yet" when empty — no `@` and no domain is ever typed in code, catalogues or tests (D7); a failed read is said, with a reload;
//   • the grievance details live on Trust & your data (`/trust-data#grievances`); the legal entity and the registered office from the facts.
import type { PlatformFacts } from '@krishalaya/sdk-js';
import { getTranslator } from '../../lib/i18n';
import { RefusalList } from '../RefusalList';
import { reloadHref, type LoadResult } from '../../features/home/load-result';
import { legalLines, mailboxLines } from '../../features/sweep/facts';
import { FactItem, FactsError } from './Facts';

export function ContactScreen({ facts }: { facts: LoadResult<PlatformFacts> }) {
  const t = getTranslator();
  return (
    <article className="kv-prose" data-kv-contact="platform">
      <h1>{t.t('sweep.contact.title')}</h1>
      <p className="kv-prose__lead">{t.t('sweep.contact.lead')}</p>
      <section data-kv-contact-section="buyers" aria-labelledby="kv-contact-buyers">
        <h2 id="kv-contact-buyers">{t.t('sweep.contact.buyersTitle')}</h2>
        <p>{t.t('sweep.contact.buyers')} <a href="/orders" className="kv-btn--link" data-kv-link="orders">{t.t('help.link.orders')}</a></p>
      </section>
      <section data-kv-contact-section="organisations" aria-labelledby="kv-contact-orgs">
        <h2 id="kv-contact-orgs">{t.t('sweep.contact.orgsTitle')}</h2>
        <p>{t.t('sweep.contact.orgs')} <a href="/for-organisations" className="kv-btn--link" data-kv-link="signup">{t.t('help.link.signup')}</a></p>
      </section>
      <section data-kv-contact-section="mailboxes" aria-labelledby="kv-contact-mail">
        <h2 id="kv-contact-mail">{t.t('sweep.contact.mailboxesTitle')}</h2>
        {facts.ok
          ? <ul className="kv-facts">{mailboxLines(facts.data).map((m) => <FactItem key={m.id} id={`mailbox.${m.id}`} label={t.t(`sweep.fact.mailbox.${m.id}`)} line={m.line} />)}</ul>
          : <FactsError retryHref={reloadHref('/contact')} />}
      </section>
      <section data-kv-contact-section="grievances" aria-labelledby="kv-contact-griev">
        <h2 id="kv-contact-griev">{t.t('sweep.contact.grievancesTitle')}</h2>
        <p>{t.t('sweep.contact.grievances')} <a href="/trust-data#grievances" className="kv-btn--link" data-kv-link="grievances">{t.t('sweep.contact.grievancesLink')}</a></p>
      </section>
      <section data-kv-contact-section="office" aria-labelledby="kv-contact-office">
        <h2 id="kv-contact-office">{t.t('sweep.contact.officeTitle')}</h2>
        {facts.ok && <ul className="kv-facts">{legalLines(facts.data).map((l) => <FactItem key={l.id} id={`legal.${l.id}`} label={t.t(`sweep.fact.${l.id}`)} line={l.line} />)}</ul>}
      </section>
      <RefusalList surface="contact" />
    </article>
  );
}
