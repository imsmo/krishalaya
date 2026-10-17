// apps/web-storefront/src/components/trace/TraceStates.tsx · PC-56 STORE-5b — the trace pages' shared states (W303 / W304 / W306): not published,
// no longer published, not found, the error with Retry (a RELOAD — W3156–W3158 are DECOR: nothing is confirmed, nothing is written).
import { getTranslator } from '../../lib/i18n';
import { reloadHref } from '../../features/home/load-result';
import type { TraceLoad } from '../../features/store5b/trace';

export function TraceState({ kind, path, sp }: { kind: TraceLoad; path: string; sp: Record<string, string | string[] | undefined> }) {
  const t = getTranslator();
  if (kind === 'not_published') {
    return (<div className="kv-state" role="status" data-kv-trace="not-published"><h1>{t.t('trace.notPublishedTitle')}</h1><p>{t.t('trace.notPublishedBody')}</p></div>);
  }
  if (kind === 'no_longer') {
    return (<div className="kv-state" role="status" data-kv-trace="no-longer"><h1>{t.t('store5b.trace.noLongerTitle')}</h1><p>{t.t('store5b.trace.noLongerBody')}</p></div>);
  }
  if (kind === 'not_found') {
    return (<div className="kv-state" role="status" data-kv-trace="not-found"><h1>{t.t('trace.notFoundTitle')}</h1><p>{t.t('store5b.trace.notFoundBody')}</p></div>);
  }
  return (
    <div className="kv-state kv-state--error" role="alert" data-kv-trace="error">
      <p>{t.t('store5b.trace.error')}</p>
      <a href={reloadHref(path, sp)} className="kv-btn" data-kv-retry="reload">{t.t('home.retry')}</a>
    </div>
  );
}
