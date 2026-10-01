// apps/web-tenant/src/features/comms/broadcasts.ts · PC-56 TENANT-8e · the console's PURE helpers for the broadcast plane
// (W429 history + receipt, the form chain W2841–W2844, the mutate chain W2845–W2847) and the WhatsApp surfaces (W425–W430,
// W2839/W2840). No IO — unit-tested in `test/tenant8e-whatsapp.spec.ts`.
//
// WHAT A "BROADCAST" IS HERE, SAID ONCE: an IN-APP ANNOUNCEMENT from the cooperative to its members (the `tenant.broadcast`
// event — an in-app item, plus push where the member has a device). This platform has NO WhatsApp provider; every WhatsApp
// surface the canon draws is a refusal by name that says what exists instead and who owns the gap.
//
// [PC-27's `buildBroadcast` is gone with the inline form it served: the form minted a fresh Idempotency-Key per click
// (F-17), took the audience as free text (F-16), and recorded "sent" for whatever happened (F-2).]
import type { BroadcastCounts, BroadcastStatus, TenantBroadcast } from '@krishalaya/sdk-js';
import { chainHref } from '../forms/chain';

/* --------------------------------------------------------------------------------------------------------- */
/* ROUTES                                                                                                    */
/* --------------------------------------------------------------------------------------------------------- */

export const COMMS_HREF = '/comms';
export const BROADCAST_FORM_HREF = '/comms/new';
export const WA_HUB_HREF = '/channels/whatsapp';
export const WA_CONVERSATION_HREF = '/channels/whatsapp/conversation';
export const WA_TEMPLATES_HREF = '/channels/whatsapp/templates';
export const WA_EDITOR_HREF = '/channels/whatsapp/templates/editor';
export const WA_BROADCAST_HREF = '/channels/whatsapp/broadcast';
export const WA_SETTINGS_HREF = '/channels/whatsapp/settings';
export const WA_POLICY_FORM_HREF = '/channels/whatsapp/settings/edit';
export const INAPP_INBOX_HREF = '/inbox';
export const TEMPLATES_HREF = '/content/templates';

export const broadcastHref = (id: string) => `${COMMS_HREF}/${encodeURIComponent(id)}`;
export const broadcastActPath = (id: string) => `${broadcastHref(id)}/act`;
export const broadcastActHref = (id: string, act: BroadcastActKey) => `${broadcastActPath(id)}?step=confirm&act=${act}`;
export const broadcastEditHref = (id: string) => `${BROADCAST_FORM_HREF}?id=${encodeURIComponent(id)}`;
export const exportHref = (id: string) => `${WA_HUB_HREF}/exports/${encodeURIComponent(id)}`;
export const exportDownloadHref = (id: string, token: string) => `${exportHref(id)}/download?token=${encodeURIComponent(token)}`;

/** The history's status chips — GET links; an unknown status is no filter. */
export const HISTORY_STATUSES = ['draft', 'scheduled', 'queued', 'sending', 'sent', 'failed', 'cancelled'] as const;
export function historyHref(status?: string | null, cursor?: string | null): string {
  const q = new URLSearchParams();
  if (status && (HISTORY_STATUSES as readonly string[]).includes(status)) q.set('status', status);
  if (cursor) q.set('cursor', cursor);
  const s = q.toString();
  return s ? `${COMMS_HREF}?${s}` : COMMS_HREF;
}
export const isHistoryStatus = (s: unknown): s is BroadcastStatus => typeof s === 'string' && (HISTORY_STATUSES as readonly string[]).includes(s);

/* --------------------------------------------------------------------------------------------------------- */
/* THE FORM AND THE ACTS                                                                                     */
/* --------------------------------------------------------------------------------------------------------- */

export const BROADCAST_FIELDS = ['title', 'body', 'audienceRoleCode', 'scheduledAt'] as const;
/** 7b's ceiling: a Gujarati announcement percent-encodes ~9 bytes a letter, and 2,000 letters must survive the URL. */
export const MAX_CARRIED_BROADCAST = 7000;
export const BROADCAST_ACT_KEYS = ['send', 'cancel'] as const;
export type BroadcastActKey = (typeof BROADCAST_ACT_KEYS)[number];
export const isBroadcastAct = (a: unknown): a is BroadcastActKey => typeof a === 'string' && (BROADCAST_ACT_KEYS as readonly string[]).includes(a);
export const POLICY_FIELDS = ['consentStatement'] as const;

/** A failed or cancelled broadcast's *Retry* is a NEW draft from its words — a person decides again; nothing auto-resends. */
export function retryAsDraftHref(b: Pick<TenantBroadcast, 'status' | 'title' | 'body' | 'audienceRoleCode'>): string | null {
  if (b.status !== 'failed' && b.status !== 'cancelled') return null;
  return chainHref(BROADCAST_FORM_HREF, 'edit', { title: b.title, body: b.body, audienceRoleCode: b.audienceRoleCode ?? '' }, MAX_CARRIED_BROADCAST);
}
/** The draft's acts are offered where they can be: send a draft; cancel a draft or a scheduled one. */
export function offeredActs(status: string): BroadcastActKey[] {
  if (status === 'draft') return ['send', 'cancel'];
  if (status === 'scheduled') return ['cancel'];
  return [];
}

/* --------------------------------------------------------------------------------------------------------- */
/* WHAT A BROADCAST SAYS ABOUT ITSELF                                                                        */
/* --------------------------------------------------------------------------------------------------------- */

export const statusKey = (s: string) => `bc.status.${isHistoryStatus(s) ? s : 'other'}`;
export function statusTone(s: string): 'muted' | 'info' | 'success' | 'danger' {
  if (s === 'sent') return 'success';
  if (s === 'failed') return 'danger';
  if (s === 'queued' || s === 'sending' || s === 'scheduled') return 'info';
  return 'muted';
}
export const failureKey = (code: string | null | undefined) => `bc.failure.${['no_template', 'no_recipients', 'role_retired'].includes(code ?? '') ? code : 'unrecorded'}`;
export const channelKey = (c: string) => `bc.channel.${['inapp', 'push', 'sms', 'whatsapp', 'email', 'ivr'].includes(c) ? c : 'other'}`;

/** The receipt's result line, in the canon's order ("1,384 delivered · 3 failed"), only the parts the log has. Unknown ≠ 0:
 *  a broadcast that never fanned out has NO result (null), never "0 delivered". */
export function resultParts(c: BroadcastCounts | null | undefined): Array<{ key: string; n: number }> | null {
  if (!c) return null;
  const parts: Array<{ key: string; n: number }> = [{ key: 'bc.result.inapp', n: c.inapp }];
  const push = c.channels.find((x) => x.channel === 'push');
  if (push) {
    const sent = push.sent + push.delivered + push.read;
    if (sent > 0) parts.push({ key: 'bc.result.pushSent', n: sent });
    if (push.held > 0) parts.push({ key: 'bc.result.pushHeld', n: push.held });
    if (push.suppressed > 0) parts.push({ key: 'bc.result.pushSuppressed', n: push.suppressed });
    if (push.failed > 0) parts.push({ key: 'bc.result.pushFailed', n: push.failed });
  }
  return parts;
}
export const failedByKey = (code: string) => `bc.failedBy.${['no_device', 'no_template', 'no_tokens', 'push_failed', 'push_unavailable', 'no_address'].includes(code) ? code : 'other'}`;
export const suppressedByKey = (code: string) => `bc.suppressedBy.${['opted_out', 'routine_collapsed', 'channel_off', 'quiet_hours'].includes(code) ? code : 'other'}`;

/** `channel:language` → its two parts, for the templates line ("push · gu"). */
export function gapParts(gap: string): { channel: string; language: string } {
  const [channel, language] = gap.split(':');
  return { channel: channel ?? gap, language: language ?? '' };
}

/* --------------------------------------------------------------------------------------------------------- */
/* WHATSAPP, BY NAME                                                                                         */
/* --------------------------------------------------------------------------------------------------------- */

export const refusedKey = (code: string) => `wa.refused.${code}`;
export const ownerKey = (owner: string) => `wa.owner.${['founder_provider_decision', 'admin_11b_q1', 'tenant_support_desk', 'platform_whatsapp_bot'].includes(owner) ? owner : 'other'}`;
/** The register's rows for one screen, by code, in the order given (missing codes are skipped — never an empty row). */
export function refusalsFor<T extends { code: string }>(all: readonly T[], codes: readonly string[]): T[] {
  return codes.map((c) => all.find((r) => r.code === c)).filter((r): r is T => r !== undefined);
}
/** Per screen: which refused-by-name entries it prints. */
export const SCREEN_REFUSALS: Record<'hub' | 'conversation' | 'templates' | 'editor' | 'broadcast' | 'settings', readonly string[]> = {
  hub: ['inbox', 'window', 'assign', 'markResolved', 'whatsappExport'],
  conversation: ['conversation', 'freeformSend', 'aiDraft', 'window', 'marketingOptin'],
  templates: ['templateCategory', 'metaSubmission', 'qualityRating'],
  editor: ['templateCategory', 'metaSubmission'],
  broadcast: ['whatsappBroadcast', 'marketingOptin'],
  settings: ['businessNumber', 'channelToggle', 'qualityRating', 'messagingLimits', 'webhookHealth'],
};

/** A page's transport state from an SdkError (6e-1: a switched-off module is "flagged off", not "couldn't load"). */
export function transportState(code: string | null | undefined, status?: number): 'notEnabled' | 'restricted' | 'notFound' | 'error' {
  if (status === 404 && (code === 'BROADCAST_NOT_FOUND' || code === 'EXPORT_JOB_NOT_FOUND')) return 'notFound';
  if (status === 404) return 'notEnabled';
  if (status === 403 || code === 'COMM_FORBIDDEN') return 'restricted';
  return 'error';
}
