// apps/admin-api/src/modules/support-oversight/domain/platform-reply.ts · rules for a PLATFORM reply to a farmer
// (PC-56 ADMIN-2d, closes ADMIN-2-Q3's reply half). No I/O → unit-provable.
//
// A reply here is a message the PLATFORM sends to a farmer about their own money problem, and it travels the
// notification spine rather than the ticket's conversation (0101's header explains why at length: a platform operator has
// no `users` row in the tenant, so a conversation message would require inventing a cross-tenant identity).
//
// THREE RULES, EACH PROTECTING THE PERSON RECEIVING IT:
//   1. A REPLY MUST BE LONG ENOUGH TO BE AN ANSWER. Twenty characters. "ok" and "noted" are not answers to somebody
//      asking where their money went, and a notification containing them is worse than silence because it consumes the
//      one message the farmer will read.
//   2. THE LANGUAGE MUST BE STATED, NOT GUESSED. The spine renders per language. A reply composed in English and
//      delivered under a Hindi template is a message the farmer cannot read wearing a label saying they can. There is no
//      default: an operator choosing a language is the operator taking responsibility for it.
//   3. NOTHING IS EVER CALLED "SENT" HERE. The vocabulary below has no such word. `queued` means recorded and not yet
//      attempted; `delivered` means the spine wrote per-recipient notifications. The gap between them is the whole
//      reason this wave exists as two realms rather than one function call.
import { InvalidPlatformReplyError } from './support-oversight.errors';

/** The status vocabulary, mirroring 0101's enum. Note the absence of "sent": a platform that cannot prove a delivery
 *  does not get to claim one. */
export const REPLY_STATUSES = ['queued', 'delivered', 'refused', 'failed'] as const;
export type ReplyStatus = (typeof REPLY_STATUSES)[number];
export function isReplyStatus(v: string): v is ReplyStatus {
  return (REPLY_STATUSES as readonly string[]).includes(v);
}

/** Statuses in which the farmer has NOT been contacted. Used by every surface that must not imply otherwise. */
const NOT_YET_DELIVERED = new Set<ReplyStatus>(['queued', 'refused', 'failed']);
export function reachedTheFarmer(status: string): boolean {
  return status === 'delivered';
}
export function awaitingOrStuck(status: string): boolean {
  return NOT_YET_DELIVERED.has(status as ReplyStatus);
}

/** A reply that will not be retried again: the executor gives up after MAX_ATTEMPTS, and a refusal is terminal by
 *  nature. These are the rows a human has to do something about. */
export function needsAHuman(row: { status: string; attempts?: number }): boolean {
  return row.status === 'refused' || row.status === 'failed';
}

export const MIN_BODY = 20;
export const MAX_BODY = 4000;

/** Languages a reply may be composed in. Deliberately the languages the platform has TEMPLATES for (0101 seeds en/hi/gu)
 *  rather than every language in the registry: composing in a language whose template does not exist would fall back to
 *  English framing around non-English words, which reads as a mistake to the person receiving it. */
export const REPLY_LANGUAGES = ['en', 'hi', 'gu'] as const;
export type ReplyLanguage = (typeof REPLY_LANGUAGES)[number];

export interface ReplyInput { body: string; languageCode: string }
export interface Reply { body: string; languageCode: ReplyLanguage }

/** Validate a reply. The body is trimmed but otherwise UNTOUCHED — no normalising, no truncation, no tidying. An
 *  operator's answer about somebody's money is not the platform's prose to edit. */
export function assertReply(input: ReplyInput): Reply {
  const body = String(input.body ?? '').trim();
  if (body.length < MIN_BODY) {
    throw new InvalidPlatformReplyError(
      `a reply must be at least ${MIN_BODY} characters — a notification saying "noted" consumes the one message the farmer will read`);
  }
  if (body.length > MAX_BODY) {
    throw new InvalidPlatformReplyError(`a reply must be at most ${MAX_BODY} characters`);
  }
  const languageCode = String(input.languageCode ?? '').trim().toLowerCase();
  if (!(REPLY_LANGUAGES as readonly string[]).includes(languageCode)) {
    throw new InvalidPlatformReplyError(
      `languageCode must be one of ${REPLY_LANGUAGES.join('|')} — the platform has reply templates only in these, and framing non-English words in an English template reads as a mistake to the person receiving it`);
  }
  return { body, languageCode: languageCode as ReplyLanguage };
}

export interface ReplyRow {
  id: string; ticketId: string; status: string; body: string; languageCode: string;
  authorAdminId: string; queuedAt: string; settledAt?: string | null;
  detail?: string | null; attempts?: number; recipientUserId?: string | null;
}

/**
 * One sentence saying what has actually happened to a reply. Returned from the API rather than assembled in the console,
 * so a second consumer cannot invent a cheerier wording for the same row.
 */
export function describeReplyState(row: Pick<ReplyRow, 'status' | 'detail' | 'attempts'>): string {
  switch (row.status) {
    case 'queued':
      return (row.attempts ?? 0) === 0
        ? 'Recorded. Nobody has been contacted yet.'
        : `Recorded and retrying (attempt ${row.attempts}). Nobody has been contacted yet.`;
    case 'delivered':
      return 'Delivered — the farmer has a notification carrying these words.';
    case 'refused':
      return `NOT sent, and it will not be retried: ${row.detail ?? 'no reason recorded'}`;
    case 'failed':
      return `NOT sent after repeated attempts: ${row.detail ?? 'no reason recorded'}`;
    default:
      // an unrecognised status must not read as a success
      return 'The delivery state of this reply is not recognised, so it must not be assumed delivered.';
  }
}

/** How many replies on this ticket the farmer has actually received. Distinct from the count of replies WRITTEN, which
 *  is what an operator would otherwise assume they are looking at. */
export function deliveredCount(rows: readonly ReplyRow[]): number {
  return rows.filter((r) => reachedTheFarmer(r.status)).length;
}

/** Rows an operator has to act on. */
export function stuckRows(rows: readonly ReplyRow[]): ReplyRow[] {
  return rows.filter(needsAHuman);
}
