// apps/web-tenant/src/app/settings/branding/history/page.tsx · W191's history drawer ("reversible with history") — PC-56 TENANT-13d.
// Every published version, newest first (µs keyset): who proposed, who confirmed, why, the contrast floor it passed; the current one
// marked; every other one offers "Roll back to this version", which is the SAME publish chain (W2797) with a second administrator.
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { BrandHistoryEntry } from '@krishalaya/sdk-js';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getLang, getTranslator } from '../../../../lib/i18n';
import { BRANDING_HREF, BRAND_HISTORY_HREF, pageState, rollbackHref } from '../../../../features/branding/branding';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('br.history.title'), robots: { index: false, follow: false } };
}

export default async function BrandHistoryPage({ searchParams }: { searchParams: { cursor?: string } }) {
  await requireSession(BRAND_HISTORY_HREF);
  const t = getTranslator();
  const lang = getLang();
  const when = (iso: string | null | undefined) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) : '');
  let items: BrandHistoryEntry[] | null = null; let next: string | null = null; let state: string | null = null;
  try { const r = await tenantClient().branding.history({ cursor: searchParams.cursor, limit: 20 }); items = r.items; next = r.nextCursor; }
  catch (e) { const err = e instanceof SdkError ? e : null; state = pageState(err?.code, err?.status); }

  return (
    <section>
      <nav aria-label={t.t('br.breadcrumb.label')} className="kv-field__hint">{t.t('br.breadcrumb.settings')} › <Link href={BRANDING_HREF} className="kv-btn--link">{t.t('br.title')}</Link> › {t.t('br.history.title')}</nav>
      <h1>{t.t('br.history.title')}</h1>
      <p>{t.t('br.history.lede')}</p>
      {state && <div className="kv-error" role="alert"><strong>{t.t(`br.state.${state}.title`)}</strong><p>{t.t(`br.state.${state}.body`)}</p></div>}
      {items && items.length === 0 && <p className="kv-card">{t.t('br.history.none')}</p>}
      {items && items.length > 0 && (
        <table className="kv-table">
          <thead><tr>
            <th scope="col">{t.t('br.history.col.version')}</th><th scope="col">{t.t('br.history.col.what')}</th><th scope="col">{t.t('br.history.col.who')}</th>
            <th scope="col">{t.t('br.history.col.why')}</th><th scope="col">{t.t('br.history.col.act')}</th>
          </tr></thead>
          <tbody>{items.map((h) => (
            <tr key={h.id}>
              <td>{formatNumber(h.version, lang)}{h.current ? <><br /><span className="kv-badge">{t.t('br.history.current')}</span></> : null}{h.rolledBackTo ? <><br /><span className="kv-field__hint">{t.t('br.history.rolledBackTo', { v: formatNumber(h.rolledBackTo, lang) })}</span></> : null}</td>
              <td>{h.values.displayName} · <code>{h.values.colours.primary}</code> <code>{h.values.colours.accent}</code></td>
              <td>{t.t('br.history.who', { maker: h.proposedByName ?? '—', checker: h.confirmedByName ?? '—', at: when(h.publishedAt) })}</td>
              <td>{h.reason}</td>
              <td>{h.current ? '' : <Link href={rollbackHref(h.version)} className="kv-btn--link">{t.t('br.history.rollback')}</Link>}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {next && <p><Link href={`${BRAND_HISTORY_HREF}?cursor=${encodeURIComponent(next)}`} className="kv-btn--link">{t.t('br.history.more')}</Link></p>}
    </section>
  );
}
