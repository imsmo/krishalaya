// apps/web-storefront/src/app/(platform)/help/page.tsx · static "Help" FAQ page. Localized copy; semantic <dl> for the
// question/answer pairs (screen-reader friendly). No SDK call — buyer support FAQs are static marketing copy.
import type { Metadata } from 'next';
import { getTranslator } from '../../../lib/i18n';

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('help.title'), description: t.t('help.lead') };
}

export default function HelpPage() {
  const t = getTranslator();
  const faqs = ['1', '2', '3', '4'].map((n) => ({ q: t.t(`help.q${n}`), a: t.t(`help.a${n}`) }));
  return (
    <article className="kv-prose">
      <h1>{t.t('help.title')}</h1>
      <p className="kv-prose__lead">{t.t('help.lead')}</p>
      <dl className="kv-faq">
        {faqs.map((f) => (
          <div key={f.q} className="kv-faq__item">
            <dt className="kv-faq__q">{f.q}</dt>
            <dd className="kv-faq__a">{f.a}</dd>
          </div>
        ))}
      </dl>
      <p className="kv-prose__note">{t.t('help.contact')}</p>
    </article>
  );
}
