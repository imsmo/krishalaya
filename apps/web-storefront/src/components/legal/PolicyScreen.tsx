// apps/web-storefront/src/components/legal/PolicyScreen.tsx · PC-56 LEGAL-1 — ONE POLICY PAGE (terms / privacy / refunds / shipping), under the
// platform's chrome (`/terms`) or a store's (`/<slug>/terms`). The route files are thin: `policyMetadata` + `renderPolicyRoute` below.
// The three states (lib/policy-data.ts):
//   • PUBLISHED — the title (h1), "Version N · published <date>" (the date in the page's language), a notice when the body is in another
//     language than the one asked for (`fallbackLanguage`), then the body: safe markdown (features/legal/markdown.ts) with the platform's facts
//     substituted into its tokens (features/legal/tokens.ts; a failed facts read = every token "not published yet");
//   • NOT FOUND (404 — nothing published) — the page's localized name and "This page has not been published yet". NEVER placeholder legal text;
//   • UNAVAILABLE — "could not be loaded" + a Retry that reloads the same URL (a read: no confirm — load-result.ts `reloadHref`).
// No flag: migration 0223's named Law 10 exception (legal / info pages have no kill-switch).
import type { Metadata } from 'next';
import type { PolicyPage, PolicySlug } from '@krishalaya/sdk-js';
import { formatDate, getRegistryEntry } from '@krishalaya/i18n';
import { getLang, getTranslator } from '../../lib/i18n';
import { loadPolicy } from '../../lib/policy-data';
import { reloadHref } from '../../features/home/load-result';
import { PLATFORM_CHROME, tenantChrome, type AccountChrome } from '../../features/store4a/account';
import { policyHref } from '../../features/legal/pages';
import { parseMarkdown } from '../../features/legal/markdown';
import { substituteTokens } from '../../features/legal/tokens';
import type { PolicyRead } from '../../lib/policy-data';
import { PolicyBody } from './PolicyBody';

/** A language's own name (the registry's native name), or the code itself for one the platform has never named. */
function languageName(code: string | null | undefined): string {
  const c = String(code ?? '');
  return getRegistryEntry(c)?.nameNative ?? c;
}

/** "Version N · published <date>" — the date in the page's language; a date the API sent unreadable prints the version alone. */
function versionLine(p: PolicyPage, lang: string): string {
  const t = getTranslator();
  const d = new Date(p.publishedAt);
  const version = String(p.version);
  return Number.isNaN(d.getTime()) ? t.t('legal.versionOnly', { version }) : t.t('legal.versionLine', { version, date: formatDate(d, lang, { dateStyle: 'long' }) });
}

export function PolicyScreen({ slug, chrome, read }: { slug: PolicySlug; chrome: AccountChrome; read: PolicyRead }) {
  const t = getTranslator();
  const lang = getLang();
  const title = t.t(`legal.${slug}.title`);
  const r = read.policy;
  if (!r.ok) {
    return (
      <article className="kv-prose" data-kv-policy={slug} data-kv-chrome={chrome.kind} data-kv-policy-state={r.kind}>
        <h1>{title}</h1>
        {r.kind === 'not_found'
          ? <p className="kv-state" role="status" data-kv-state="policy-unpublished">{t.t('legal.notPublished')}</p>
          : (
            <div className="kv-state kv-state--error" role="status" data-kv-state="policy-error">
              <p>{t.t('legal.error')}</p>
              <a href={reloadHref(policyHref(chrome, slug))} className="kv-btn" data-kv-retry="reload">{t.t('legal.retry')}</a>
            </div>
          )}
      </article>
    );
  }
  const p = r.data;
  const doc = parseMarkdown(p.body);
  const blocks = substituteTokens(doc.blocks, read.facts);
  return (
    <article className="kv-prose" data-kv-policy={slug} data-kv-chrome={chrome.kind} data-kv-policy-state="published" data-kv-policy-source={p.source}>
      <h1 lang={p.language ?? undefined}>{p.title}</h1>
      <p className="kv-prose__lead" data-kv-policy-version={String(p.version)}>{versionLine(p, lang)}</p>
      {p.fallbackLanguage && (
        <p className="kv-state" role="note" data-kv-state="policy-fallback" data-kv-fallback-language={p.fallbackLanguage}>
          {t.t('legal.fallbackNotice', { requested: languageName(p.requestedLanguage ?? lang), shown: languageName(p.fallbackLanguage) })}
        </p>
      )}
      <div data-kv-policy-body="" lang={p.language ?? undefined}>
        <PolicyBody blocks={blocks} />
      </div>
      {doc.truncated && <p className="kv-state" role="status" data-kv-state="policy-truncated">{t.t('legal.truncated')}</p>}
    </article>
  );
}

/** The route's `<title>` and description, in the page's language. */
export function policyMetadata(slug: PolicySlug): Metadata {
  const t = getTranslator();
  return { title: t.t(`legal.${slug}.title`), description: t.t(`legal.${slug}.description`) };
}

/** A whole policy route: the platform's (`tenantSlug` absent) or a store's. */
export async function renderPolicyRoute(slug: PolicySlug, tenantSlug?: string): Promise<JSX.Element> {
  const chrome = tenantSlug ? tenantChrome(tenantSlug) : PLATFORM_CHROME;
  const read = await loadPolicy(slug, getLang(), chrome.kind === 'tenant' ? chrome.slug : undefined);
  return <PolicyScreen slug={slug} chrome={chrome} read={read} />;
}
