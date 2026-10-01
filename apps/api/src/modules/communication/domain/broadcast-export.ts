// modules/communication/domain/broadcast-export.ts · PC-56 TENANT-8e · W2839/W2840's file — the rows and what the file admits. PURE.
//
// The canon draws an export on the WhatsApp hub (*"Export queue"*). There is no WhatsApp data on this platform to export
// (no conversation, no message, no WhatsApp send has ever existed — F-15), so a `whatsapp.*` dataset would be a file of
// zero rows labelled as something it is not. What CAN be exported, and is: the cooperative's broadcast history — the in-app
// announcements — with every count read from the delivery log at the moment the file was made. The first note says, in
// the file's own receipt, that no WhatsApp dataset exists.
import type { BroadcastCounts } from './broadcast-counts';

export const BROADCAST_EXPORT_HEADER = [
  'broadcast_id', 'status', 'channel', 'audience_role', 'title', 'created_at_utc', 'scheduled_at_utc', 'send_requested_at_utc', 'fanned_out_at_utc',
  'eligible_at_send', 'recipients', 'inapp_items', 'sent_rows', 'read_rows', 'held_rows', 'suppressed_rows', 'failed_rows', 'failure_reason', 'cancel_reason',
] as const;

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

export interface ExportableBroadcast {
  id: string; status: string; channel: string; audienceRoleCode: string | null; title: string; createdAt?: Date | string;
  scheduledAt: Date | string | null; sendRequestedAt: Date | string | null; fannedOutAt: Date | string | null; eligibleCount: number;
  failureReason: string | null; cancelReason: string | null;
}

/** One row. A broadcast that never fanned out has NO log counts — empty cells, never zeros (unknown is not zero). */
export function broadcastExportRow(b: ExportableBroadcast, c: BroadcastCounts | null): Array<string | number | null> {
  return [
    b.id, b.status, b.channel, b.audienceRoleCode ?? 'everyone', b.title, iso(b.createdAt), iso(b.scheduledAt), iso(b.sendRequestedAt), iso(b.fannedOutAt),
    b.sendRequestedAt ? b.eligibleCount : null,
    c ? c.recipients : null, c ? c.inapp : null, c ? c.sent : null, c ? c.read : null, c ? c.held : null, c ? c.suppressed : null, c ? c.failed : null,
    b.failureReason, b.cancelReason,
  ];
}

export function broadcastExportNotes(input: { rows: number }): string[] {
  const notes = [
    'no WhatsApp dataset exists: this platform has no WhatsApp provider, number or inbound sink, and has never sent or received a WhatsApp message — this file is the cooperative\'s in-app announcements (tenant.broadcast: an in-app item, plus push where a member has a device)',
    'every count is the delivery log\'s (notifications, joined through tenant_broadcast_recipients) at the moment this file was made; a held row is a push waiting for that member\'s quiet hours to end and may since have been sent',
    'sent_rows counts every channel row the log says left, was delivered or was read; inapp_items counts members holding the announcement itself',
    'a broadcast that never fanned out (draft, scheduled, cancelled, failed before sending) has empty count cells, not zeros',
    'instants are UTC (ISO-8601); the console prints them in the cooperative\'s own zone',
  ];
  if (input.rows === 0) notes.push('no broadcast yet: the file has a header and no rows');
  return notes;
}
