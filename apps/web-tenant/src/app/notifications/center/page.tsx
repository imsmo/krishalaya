// apps/web-tenant/src/app/notifications/center/page.tsx · W431 — the notification center · PC-56 TENANT-8b · THE INBOX.
//
// W431: day groups, tier chips, module and tier filters, row actions (Open · Delivery detail), bulk Mark read / Archive,
// pagination, a mark-all-read confirm with its receipt, and the footer *"notifications table, one row per user × event ×
// channel … What you see here is what was actually sent"*. WHAT IS BUILT:
//   • the rows are YOUR IN-APP items (F-9) — one per delivery instance — and each row names the other channels from the
//     log (W434 is one click away). The status printed is the in-app row's own: unread / read — never "delivered" (an
//     in-app row is never delivered; W431 drew "delivered").
//   • filters are a GET form (state · tier · module · "also reached me by"), preserving nothing stale: a filter change
//     drops the cursor. Modules and tiers come from the catalogue (`notifications.inboxFilters`), never a list here.
//   • day groups are the COOPERATIVE's days (the server returns each item's local day in `countries.timezone`).
//   • keyset pager (*"Showing 1–6 of 6"* and page numbers are PARITY-DECOR: a keyset has no page numbers or totals).
//   • bulk *Mark read* is a GET form of checkboxes onto the mutate chain's confirm (W2687); *Mark all read* likewise.
// REFUSED BY NAME: *Archive* (no column; kv_app cannot write one), *Hide thread* / collapse_key (no column), *Center
// disabled (tenant-off)* (no setting), the 90-day history (the log keeps what `data_retention_policies` says — 6 months).
import type { Metadata } from 'next';
import Link from 'next/link';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { InboxFilters, InboxPage } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { getTranslator, getLang } from '../../../lib/i18n';
import {
  ACT_HREF, CENTER_HREF, INBOX_HREF, PREFS_HREF, STATE_VALUES, actHref, alsoOnLine, centerHref, channelKey, dayLabel, groupByDay, hasFilters, inappStatusKey,
  inboxTransportState, isUnread, itemBody, itemTitle, ladderHref, moduleKey, outcomeKey, pageStateKey, pickValue, refusedKey, sameOriginPath, tierKey, type InboxPageState,
} from '../../../features/notifications/inbox';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('notif.center.title'), robots: { index: false, follow: false } };
}

const one = (v: string | string[] | undefined) => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : null);
const CHANNELS = ['push', 'sms', 'whatsapp', 'email', 'ivr'] as const;

export default async function CenterPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession(CENTER_HREF);
  const t = getTranslator();
  const lang = getLang();
  const c = tenantClient().notifications;
  const f = { state: one(searchParams.state), tier: one(searchParams.tier), module: one(searchParams.module), channel: one(searchParams.channel) };
  const cursor = one(searchParams.cursor);

  let page: InboxPage | null = null; let state: InboxPageState | null = null; let filters: InboxFilters | null = null;
  try {
    [page, filters] = await Promise.all([
      c.inboxPage({ state: f.state === 'unread' || f.state === 'read' ? f.state : undefined, tier: f.tier ?? undefined, module: f.module ?? undefined, channel: f.channel ?? undefined, cursor: cursor ?? undefined, limit: 25 }),
      c.inboxFilters(),
    ]);
  } catch (e) { state = e instanceof SdkError ? inboxTransportState(e.code, e.status) : 'error'; }
  const zone = page?.zone ?? undefined;
  const time = (iso: string | undefined) => (iso ? formatDate(iso, lang, { timeStyle: 'short', timeZone: zone }) : t.t('common.dash'));
  const eventLabel = (code: string) => { const k = `notif.event.${code.toLowerCase()}`; const l = t.t(k); return l === k ? code : l; };
  const groups = page ? groupByDay(page.items) : [];
  const dayText = (d: string | null) => {
    const l = dayLabel(d, page?.today);
    if (l.kind === 'today') return t.t('notif.day.today');
    if (l.kind === 'yesterday') return t.t('notif.day.yesterday');
    if (l.kind === 'date') return formatDate(`${l.date}T12:00:00Z`, lang, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
    return t.t('common.dash');
  };
  const filtered = hasFilters(f);

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('notif.center.title')}</h1>
        <nav className="kv-notif-filters" aria-label={t.t('notif.nav')}>
          <Link href={INBOX_HREF} className="kv-btn--link">{t.t('notif.title')}</Link>
          <Link href={PREFS_HREF} className="kv-btn--link">{t.t('notif.managePrefs')}</Link>
          {page && <Link href={actHref('readAll')} className="kv-btn">{t.t('notif.act.readAll')}</Link>}
        </nav>
      </div>
      <p className="kv-field__hint">{t.t('notif.center.lead')}</p>
      <p className="kv-field__hint">{t.t('notif.center.scoped')}</p>

      {state !== null && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <p>{t.t(pageStateKey(state))}</p>
          {state === 'error' && <p><Link href={centerHref(f, cursor)} className="kv-btn--link">{t.t('common.retry')}</Link> · <span className="kv-field__hint">{t.t('notif.center.deliveryUnaffected')}</span></p>}
        </div>
      )}

      {page && filters && (
        <form action={CENTER_HREF} method="get" className="kv-card kv-notif-filterform" aria-label={t.t('notif.filters')}>
          <label className="kv-field" htmlFor="f-state"><span>{t.t('notif.filter.state')}</span>
            <select id="f-state" name="state" defaultValue={f.state ?? ''}>
              <option value="">{t.t('notif.all')}</option>
              {STATE_VALUES.map((s) => <option key={s} value={s}>{t.t(`notif.filter.state.${s}`)}</option>)}
            </select>
          </label>
          <label className="kv-field" htmlFor="f-tier"><span>{t.t('notif.filter.tier')}</span>
            <select id="f-tier" name="tier" defaultValue={f.tier ?? ''}>
              <option value="">{t.t('notif.all')}</option>
              {filters.tiers.map((x) => <option key={x} value={x}>{t.t(tierKey(x))}</option>)}
            </select>
          </label>
          <label className="kv-field" htmlFor="f-module"><span>{t.t('notif.filter.module')}</span>
            <select id="f-module" name="module" defaultValue={f.module ?? ''}>
              <option value="">{t.t('notif.all')}</option>
              {filters.modules.map((m) => { const k = moduleKey(m); const l = t.t(k); return <option key={m} value={m}>{l === k ? m : l}</option>; })}
            </select>
          </label>
          <label className="kv-field" htmlFor="f-channel"><span>{t.t('notif.filter.channel')}</span>
            <select id="f-channel" name="channel" defaultValue={f.channel ?? ''}>
              <option value="">{t.t('notif.all')}</option>
              {CHANNELS.map((ch) => <option key={ch} value={ch}>{t.t(channelKey(ch))}</option>)}
            </select>
          </label>
          <button type="submit" className="kv-btn--link">{t.t('notif.filter.apply')}</button>
          {filtered && <Link href={CENTER_HREF} className="kv-btn--link">{t.t('notif.filter.clear')}</Link>}
        </form>
      )}

      {page && page.items.length === 0 && (
        <div className="kv-card kv-card--notice" role="status">
          <p>{t.t(filtered ? 'notif.center.noMatch' : 'notif.center.zero')}</p>
          {filtered && <p><Link href={CENTER_HREF} className="kv-btn--link">{t.t('notif.filter.clear')}</Link></p>}
        </div>
      )}

      {page && page.items.length > 0 && (
        <form action={ACT_HREF} method="get">
          <input type="hidden" name="step" value="confirm" />
          <input type="hidden" name="act" value="read" />
          <table className="kv-table">
            <caption className="kv-field__hint">{t.t('notif.center.caption')}</caption>
            <thead><tr><th scope="col"><span className="kv-sr-only">{t.t('notif.col.select')}</span></th><th scope="col">{t.t('notif.col.tier')}</th><th scope="col">{t.t('notif.col.notification')}</th><th scope="col">{t.t('notif.col.module')}</th><th scope="col">{t.t('notif.col.time')}</th><th scope="col">{t.t('notif.col.status')}</th><th scope="col">{t.t('notif.col.actions')}</th></tr></thead>
            {groups.map((g) => (
              <tbody key={g.day ?? 'none'}>
                <tr><th scope="rowgroup" colSpan={7}>{dayText(g.day)}</th></tr>
                {g.items.map((it) => {
                  const deep = sameOriginPath(it.payload.deepLink);
                  const ladder = ladderHref(it);
                  const mk = moduleKey(it.module ?? ''); const ml = t.t(mk);
                  return (
                    <tr key={it.id} className={isUnread(it) ? 'kv-notif-row--unread' : undefined}>
                      <td>{isUnread(it) && <input type="checkbox" name="pick" value={pickValue(it)} aria-label={t.t('notif.col.selectOne', { title: itemTitle(it) ?? eventLabel(it.eventCode) })} />}</td>
                      <td><span className="kv-badge">{t.t(tierKey(it.tier))}</span></td>
                      <td>
                        <strong>{itemTitle(it) ?? eventLabel(it.eventCode)}</strong>
                        {itemBody(it) && <div>{itemBody(it)}</div>}
                        {(it.alsoOn ?? []).length > 0 && <div className="kv-field__hint">{t.t('notif.alsoOn')} {alsoOnLine(it.alsoOn ?? []).map((a) => `${t.t(channelKey(a.channel))} · ${t.t(outcomeKey(a.outcome))}`).join(' — ')}</div>}
                      </td>
                      <td>{ml === mk ? it.module : ml}</td>
                      <td>{it.localTime ?? time(it.createdAt)}</td>
                      <td>{t.t(inappStatusKey(it))}{it.readAt ? ` · ${time(it.readAt)}` : ''}</td>
                      <td>
                        {deep && <><Link href={deep} className="kv-link">{t.t('notif.open')}</Link>{' '}</>}
                        {ladder && <><Link href={ladder} className="kv-link">{t.t('notif.deliveryDetail')}</Link>{' '}</>}
                        {isUnread(it) && <Link href={actHref('read', [it])} className="kv-link">{t.t('notif.act.read')}</Link>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
          <p>
            <button type="submit" className="kv-btn--link">{t.t('notif.act.readSelected')}</button>
            {' · '}<span className="kv-field__hint">{t.t(refusedKey('archive'))}</span>
          </p>
        </form>
      )}

      {page?.nextCursor && <p className="kv-pager"><Link href={centerHref(f, page.nextCursor)} className="kv-btn--link" rel="next">{t.t('common.nextPage')}</Link></p>}

      {page && (
        <div className="kv-card">
          <p className="kv-field__hint">{t.t(refusedKey('collapse'))}</p>
          <p className="kv-field__hint">{t.t(refusedKey('centerDisabled'))}</p>
          <p className="kv-field__hint">{t.t('notif.center.retention')}</p>
          <p className="kv-field__hint">{t.t('notif.center.footer', { n: formatNumber(page.items.length, lang) })}</p>
        </div>
      )}
    </section>
  );
}
