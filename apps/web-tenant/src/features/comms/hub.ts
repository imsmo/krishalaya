// apps/web-tenant/src/features/comms/hub.ts · PURE validation for the comms hub (PC-27). Mirrors the API DTOs
// (CreateBroadcastSchema: title ≤160, body ≤2000, optional role code; UpsertTemplateSchema: event/channel/lang/
// body ≤4000). The server re-validates + gates by comm.manage. No IO → unit-tested.

export const NOTIF_CHANNELS = ['whatsapp', 'sms', 'push', 'email', 'inapp', 'ivr'] as const;

export type BroadcastResult =
  | { ok: true; value: { title: string; body: string; audienceRoleCode?: string } }
  | { ok: false; error: 'title' | 'body' };

export function buildBroadcast(raw: { title: string; body: string; audienceRoleCode: string }): BroadcastResult {
  const title = raw.title.trim();
  if (!title || title.length > 160) return { ok: false, error: 'title' };
  const body = raw.body.trim();
  if (!body || body.length > 2000) return { ok: false, error: 'body' };
  const role = raw.audienceRoleCode.trim();
  const value: { title: string; body: string; audienceRoleCode?: string } = { title, body };
  if (role) value.audienceRoleCode = role;
  return { ok: true, value };
}

export type TemplateResult =
  | { ok: true; value: { eventCode: string; channel: string; languageCode: string; subject?: string; body: string; isActive: boolean } }
  | { ok: false; error: 'event' | 'channel' | 'lang' | 'body' | 'subject' };

export function buildTemplate(raw: { eventCode: string; channel: string; languageCode: string; subject: string; body: string; isActive: boolean }): TemplateResult {
  const eventCode = raw.eventCode.trim();
  if (!eventCode || eventCode.length > 80) return { ok: false, error: 'event' };
  if (!(NOTIF_CHANNELS as readonly string[]).includes(raw.channel)) return { ok: false, error: 'channel' };
  const languageCode = raw.languageCode.trim();
  if (!/^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(languageCode)) return { ok: false, error: 'lang' };
  const subject = raw.subject.trim();
  if (subject.length > 250) return { ok: false, error: 'subject' };
  const body = raw.body.trim();
  if (!body || body.length > 4000) return { ok: false, error: 'body' };
  const out: { eventCode: string; channel: string; languageCode: string; subject?: string; body: string; isActive: boolean } =
    { eventCode, channel: raw.channel, languageCode, body, isActive: !!raw.isActive };
  if (subject) out.subject = subject;
  return { ok: true, value: out };
}
