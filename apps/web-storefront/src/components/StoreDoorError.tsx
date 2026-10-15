// apps/web-storefront/src/components/StoreDoorError.tsx · PC-56 STORE-2c · C1 — what a platform door says when the session's store cannot be read:
// the failure, and a Retry that reloads the same door (a read). Never a guessed store.
import { getTranslator } from '../lib/i18n';
import { reloadHref } from '../features/home/load-result';

export function StoreDoorError({ titleKey, path, searchParams }: { titleKey: string; path: string; searchParams: Record<string, string | string[] | undefined> }) {
  const t = getTranslator();
  return (
    <section className="kv-checkout">
      <h1>{t.t(titleKey)}</h1>
      <div className="kv-state kv-state--error" role="alert" data-kv-state="error">
        <p>{t.t('store2c.doorError')}</p>
        <a href={reloadHref(path, searchParams)} className="kv-btn" data-kv-retry="reload">{t.t('home.retry')}</a>
      </div>
    </section>
  );
}
