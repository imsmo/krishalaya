// apps/web-storefront/src/components/trace/DairyTraceScreen.tsx · PC-56 STORE-5b · C5 — canon W306 "Dairy Trace", REFUSED (founder D6 / Q16).
// For ANY lot: the honest sentence "a dairy trace is not available yet — no record links a jar to its collections, coolers or cows", a link back
// to the lot's trace, and the refusals by name (the cow count, the member litres, the bilona churn, the cold-chain chart, the split). No read:
// there is nothing to read. A dairy-lineage backend is queued (named in the STORE-5b report).
import Link from 'next/link';
import { getTranslator } from '../../lib/i18n';
import type { AccountChrome } from '../../features/store4a/account';
import { chromeField } from '../../features/store4a/account';
import { isTraceToken, traceHref } from '../../features/store5b/trace';
import { RefusalList } from '../RefusalList';

export function DairyTraceScreen({ chrome, qrToken }: { chrome: AccountChrome; qrToken: string }) {
  const t = getTranslator();
  return (
    <article className="kv-prose" data-kv-screen="dairy-trace" data-kv-chrome={chromeField(chrome)} data-kv-dairy="refused">
      <h1>{t.t('store5b.dairy.title')}</h1>
      <div className="kv-state" role="status" data-kv-state="not-available"><p>{t.t('store5b.dairy.body')}</p></div>
      {isTraceToken(qrToken) && <p><Link href={traceHref(chrome, qrToken)} className="kv-btn" data-kv-cta="trace">{t.t('store5b.dairy.back')}</Link></p>}
      <RefusalList surface="dairy_trace" />
    </article>
  );
}
