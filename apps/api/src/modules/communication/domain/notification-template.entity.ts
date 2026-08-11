// modules/communication/domain/notification-template.entity.ts · a per event×channel×language template
// (+ optional tenant override). Owns the {{variable}} render — the ONLY place body interpolation happens.
import { NotifChannel } from './communication.events';

export interface NotificationTemplateProps {
  id: string; eventCode: string; channel: NotifChannel; languageCode: string; tenantId: string | null;
  subject: string | null; body: string; providerTemplateRef: string | null; isActive: boolean; createdAt?: Date;
  /** The immutable version (0122) these words came from. Recorded on the delivery row: it is the only thing that can
   *  answer "what did the message say" once somebody edits the template. NULL only for a row no version points at. */
  versionId?: string | null;
  versionNo?: number | null;
}
// Conservative, ReDoS-safe token: {{ alphanum/underscore/dot path }} only.
const TOKEN = /\{\{\s*([a-zA-Z0-9_.]{1,64})\s*\}\}/g;

export class NotificationTemplate {
  private constructor(private readonly props: NotificationTemplateProps) {}
  static rehydrate(p: NotificationTemplateProps): NotificationTemplate { return new NotificationTemplate(p); }
  get id() { return this.props.id; }
  get channel() { return this.props.channel; }
  get languageCode() { return this.props.languageCode; }
  get providerTemplateRef() { return this.props.providerTemplateRef; }
  get versionId() { return this.props.versionId ?? null; }
  get versionNo() { return this.props.versionNo ?? null; }
  get isTenantOverride() { return this.props.tenantId !== null; }

  /** Interpolate {{vars}} from the payload. Missing keys render as '' (never leak '{{x}}' to a user). */
  render(vars: Record<string, unknown>): { subject: string | null; body: string } {
    const sub = (s: string | null) => (s == null ? null : s.replace(TOKEN, (_m, k: string) => stringify(pick(vars, k))));
    return { subject: sub(this.props.subject), body: this.props.body.replace(TOKEN, (_m, k: string) => stringify(pick(vars, k))) };
  }
  get createdAt() { return this.props.createdAt; }
  toJSON() { return { ...this.props }; }
}
function pick(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, k) => (acc != null && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined), obj);
}
function stringify(v: unknown): string { return v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); }
