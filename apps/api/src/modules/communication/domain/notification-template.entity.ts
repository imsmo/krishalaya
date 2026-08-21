// modules/communication/domain/notification-template.entity.ts · a per event×channel×language template
// (+ optional tenant override). Owns the {{variable}} render — the ONLY place body interpolation happens.
import { NotifChannel } from './communication.events';
import { isLangMap, pickLang } from '../../../core/i18n/lang-map';

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

  /**
   * Interpolate {{vars}} from the payload. Missing keys render as '' (never leak '{{x}}' to a user).
   *
   * **[PC-56 TENANT-6d-7] A PAYLOAD VALUE MAY BE A PER-LANGUAGE MAP, AND THIS TEMPLATE'S OWN LANGUAGE CHOOSES FROM
   * IT.** A domain event is emitted once and rendered for every recipient, so `{ shift: 'evening' }` in a payload had
   * already decided that the Gujarati SMS would contain an English word — which is exactly what TENANT-6b-1's
   * *"{{mcc}} માં {{shift}} નું તમારું દૂધ"* sent. `{ shift: { en: 'evening', gu: 'સાંજ', hi: 'shaam' } }` renders the
   * right word in each of the three bodies with no change to the copy and no second interpolation site: this is still
   * the only place a template body is filled in.
   */
  render(vars: Record<string, unknown>): { subject: string | null; body: string } {
    const value = (k: string) => {
      const v = pick(vars, k);
      return isLangMap(v) ? pickLang(v, this.props.languageCode) : v;
    };
    const sub = (s: string | null) => (s == null ? null : s.replace(TOKEN, (_m, k: string) => stringify(value(k))));
    return { subject: sub(this.props.subject), body: this.props.body.replace(TOKEN, (_m, k: string) => stringify(value(k))) };
  }
  get createdAt() { return this.props.createdAt; }
  toJSON() { return { ...this.props }; }
}
function pick(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, k) => (acc != null && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined), obj);
}
function stringify(v: unknown): string { return v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); }
