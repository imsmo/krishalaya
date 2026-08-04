// apps/mobile/src/features/notifications/notif-detail.ts · PURE presentation for the notification-detail screen
// (172). No React/native — unit-tested. The server delivers a NotificationItem with an opaque, server-TEMPLATED
// `payload: Record<string, unknown>` (localized copy + whatever structured fields the template chose to include).
// These helpers read that bag DEFENSIVELY over a small allowlist of known keys — so when the sender includes the
// money breakdown / order / buyer, the design's rich card renders from REAL data; when it doesn't, those rows are
// simply omitted (Law 12 degrade, §13 never fake). Money stays a bigint minor-unit string (Law 2).
import type { NotificationItem } from '@krishalaya/sdk-js';
import { eventIcon, eventCategory, type NotifCategory } from './notif-prefs';
import { internalDeepLink } from './present';

export interface NotifMoneyRow { labelKey: string; minor: string; negative: boolean }
export interface NotifInfoRow { labelKey: string; value: string }
export interface NotifAction { key: string; labelKey: string; variant: 'primary' | 'outline' | 'ghost'; href: string }
export interface NotificationDetailView {
  icon: string;
  category: NotifCategory;
  title: string;
  body: string;
  heroMinor: string | null;
  moneyRows: NotifMoneyRow[];
  infoRows: NotifInfoRow[];
  timeText: string;
  deepLink: string | null;
  createdAt?: string;
}

const str = (v: unknown): string =>
  typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';

/** A minor-unit money STRING (Law 2) from a payload value: accept only an integer string (optional leading '-')
 *  or a safe integer number — never a float/decimal (that would violate Law 2). null otherwise. Pure. */
export function moneyMinorOf(v: unknown): string | null {
  if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) return v.trim();
  if (typeof v === 'number' && Number.isInteger(v)) return String(v);
  return null;
}

const HERO_KEYS = ['amountMinor', 'creditedMinor', 'saleAmountMinor', 'netMinor', 'walletCreditMinor'];
const MONEY_ROWS: Array<{ keys: string[]; labelKey: string; negative: boolean }> = [
  { keys: ['saleAmountMinor', 'grossMinor', 'saleMinor'], labelKey: 'notifDetail.row.saleAmount', negative: false },
  { keys: ['feeMinor', 'platformFeeMinor', 'commissionMinor'], labelKey: 'notifDetail.row.fee', negative: true },
  { keys: ['creditedMinor', 'netMinor', 'walletCreditMinor'], labelKey: 'notifDetail.row.credited', negative: false },
];
const INFO_ROWS: Array<{ keys: string[]; labelKey: string }> = [
  { keys: ['from', 'sender', 'fromName'], labelKey: 'notifDetail.row.from' },
  { keys: ['orderNo', 'orderRef', 'order'], labelKey: 'notifDetail.row.order' },
  { keys: ['item', 'lineItem', 'itemText'], labelKey: 'notifDetail.row.item' },
  { keys: ['buyer', 'buyerName', 'counterparty'], labelKey: 'notifDetail.row.buyer' },
];

function pick(p: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) { const v = p[k]; if (v !== undefined && v !== null && v !== '') return v; }
  return undefined;
}

export function presentNotificationDetail(n: NotificationItem): NotificationDetailView {
  const p = n.payload ?? {};
  const title = str(p.title) || str(p.subject) || n.eventCode;
  const body = str(p.body) || str(p.message) || str(p.text);
  const moneyRows: NotifMoneyRow[] = [];
  for (const m of MONEY_ROWS) {
    const minor = moneyMinorOf(pick(p, m.keys));
    if (minor !== null) moneyRows.push({ labelKey: m.labelKey, minor, negative: m.negative });
  }
  const infoRows: NotifInfoRow[] = [];
  for (const r of INFO_ROWS) {
    const value = str(pick(p, r.keys));
    if (value) infoRows.push({ labelKey: r.labelKey, value });
  }
  return {
    icon: eventIcon(n.eventCode),
    category: eventCategory(n.eventCode),
    title,
    body,
    heroMinor: moneyMinorOf(pick(p, HERO_KEYS)),
    moneyRows,
    infoRows,
    timeText: str(p.time) || str(p.at), // free-text time from the template, if any (else screen falls back to createdAt)
    deepLink: internalDeepLink(p.deepLink ?? p.link ?? p.url),
    createdAt: n.createdAt,
  };
}

/** The quick-action buttons for a notification. The deep-link action appears only when the server templated a
 *  valid IN-APP link (never an external URL, §4); Open-wallet / Withdraw appear only for money-category events and
 *  route to fixed in-app destinations (UI chrome, not fabricated data). Pure. */
export function notifActions(view: NotificationDetailView): NotifAction[] {
  const actions: NotifAction[] = [];
  if (view.deepLink) actions.push({ key: 'deep', labelKey: 'notifDetail.action.view', variant: 'primary', href: view.deepLink });
  if (view.category === 'money') {
    actions.push({ key: 'wallet', labelKey: 'notifDetail.action.wallet', variant: view.deepLink ? 'outline' : 'primary', href: '/(farmer)/wallet' });
    actions.push({ key: 'withdraw', labelKey: 'notifDetail.action.withdraw', variant: 'ghost', href: '/(farmer)/wallet/withdraw' });
  }
  return actions;
}
