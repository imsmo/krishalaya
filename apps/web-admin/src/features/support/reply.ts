// apps/web-admin/src/features/support/reply.ts · a PLATFORM reply to a farmer, console side
// (PC-56 ADMIN-2d, canon W049 + W2298-2304).
//
// THE ONE THING THIS FILE EXISTS TO ENFORCE is a vocabulary. An operator has just written a message to a member of the
// public about their money; the console must not tell them it was sent until it was. So there is no `sent` anywhere in
// here, `queued` renders as "nobody contacted yet", and an unrecognised status renders as NOT delivered rather than as a
// success — because the next status this enum gains would otherwise arrive on screen as good news.
//
// The composing rules (length, language) are checked here for shape only; admin-api's `domain/platform-reply.ts` owns
// them and its 422 message is shown verbatim.

export const REPLY_STATUSES = ['queued', 'delivered', 'refused', 'failed'] as const;
export type ReplyStatus = (typeof REPLY_STATUSES)[number];

/** Languages the platform has reply TEMPLATES for (migration 0101 seeds en/hi/gu). Deliberately not every language in
 *  the registry: composing in a language whose template does not exist would frame non-English words in an English
 *  template, which reads as a mistake to the person receiving it. */
export const REPLY_LANGUAGES = ['en', 'hi', 'gu'] as const;
export type ReplyLanguage = (typeof REPLY_LANGUAGES)[number];

export const MIN_BODY = 20;
export const MAX_BODY = 4000;

export interface ReplyRow {
  id: string; ticketId?: string; ticketNo?: string | null; tenantSlug?: string | null;
  status: string; body?: string; languageCode?: string;
  authorAdminId?: string; queuedAt: string; settledAt?: string | null;
  detail?: string | null; attempts?: number; stateNote?: string | null;
}

/** ONLY `delivered` means the farmer has it. Everything else — including anything this build has never heard of — does
 *  not. The default case is the point of the function. */
export function reachedTheFarmer(status: string): boolean { return status === 'delivered'; }

/** Rows a human must act on: written, and never going to arrive without intervention. A `queued` row is WAITING, not
 *  stuck, and conflating the two would make the warning fire every minute until people stopped reading it. */
export function stuckRows(rows: readonly ReplyRow[]): ReplyRow[] {
  return rows.filter((r) => r.status === 'refused' || r.status === 'failed');
}

/** How many of these the farmer actually received — distinct from how many were written, which is what an operator
 *  would otherwise read the list as. */
export function deliveredCount(rows: readonly ReplyRow[]): number {
  return rows.filter((r) => reachedTheFarmer(r.status)).length;
}

/** The CSS status class for a delivery state. An unknown status is NOT styled as success. */
export function stateClass(status: string): string {
  switch (status) {
    case 'delivered': return 'kv-status--ok';
    case 'queued': return 'kv-status--warn';
    case 'refused':
    case 'failed': return 'kv-status--danger';
    default: return 'kv-status--danger';
  }
}

/** The i18n key for a state, falling back to a NON-success wording for anything unrecognised. */
export function stateKey(status: string): ReplyStatus {
  return (REPLY_STATUSES as readonly string[]).includes(status) ? (status as ReplyStatus) : 'failed';
}

export type FormBag = (name: string) => string;
export type Built = { ok: true; value: { body: string; languageCode: string } } | { ok: false; error: string };

/** Shape-check the compose form. The body is TRIMMED and otherwise untouched — an operator's answer about somebody's
 *  money is not the console's prose to normalise. */
export function buildReply(get: FormBag): Built {
  const body = get('body').trim();
  if (body.length < MIN_BODY) return { ok: false, error: 'body' };
  if (body.length > MAX_BODY) return { ok: false, error: 'bodyLong' };
  const languageCode = get('languageCode').trim().toLowerCase();
  if (!(REPLY_LANGUAGES as readonly string[]).includes(languageCode)) return { ok: false, error: 'language' };
  return { ok: true, value: { body, languageCode } };
}
