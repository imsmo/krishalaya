// modules/tenant-webhooks/domain/webhook-endpoint.entity.ts · a tenant's webhook endpoint as the console sees it (0002 + 0191).
// PC-56 TENANT-13a: the wire shape carries the status (active / paused — reason / disabled), the masked secret hint (last 3
// characters, stored apart — `whsec_••••8f2`), whether a rotated-out secret is still signing and until when, the developer contact,
// and the 7-day figures computed from the attempt rows. It NEVER carries secret material: the ciphertext is not even selected into
// the row this entity is built from.
import type { EndpointRow, EndpointStats } from '../repositories/webhook.repository';
import { hostOf } from './webhook-log';

export interface WebhookEndpointProps extends EndpointRow { stats?: EndpointStats }

export class WebhookEndpoint {
  constructor(private readonly props: WebhookEndpointProps) {}
  get id() { return this.props.id; }
  get url() { return this.props.url; }
  get eventTypes() { return this.props.eventTypes; }
  toProps(): WebhookEndpointProps { return this.props; }

  serialize() {
    const p = this.props;
    const s = p.stats;
    return {
      id: p.id, url: p.url, host: hostOf(p.url), eventTypes: p.eventTypes ?? [], status: p.status, pausedReason: p.pausedReason, pausedAt: p.pausedAt,
      isActive: p.status === 'active',
      secretHint: p.secretHint, secretRotatedAt: p.secretRotatedAt, previousSecretSignsUntil: p.prevExpiresAt,
      developerEmail: p.developerEmail, createdAt: p.createdAt,
      stats: s ? {
        attempts7d: s.attempts7d, okAttempts7d: s.okAttempts7d,
        // basis points of attempts that were 2xx in the last 7 days; null when nothing was attempted (never a fabricated 100%)
        successBp7d: s.attempts7d > 0 ? Math.floor((s.okAttempts7d * 10000) / s.attempts7d) : null,
        delivered7d: s.delivered7d, failedToday: s.failedToday, held: s.held, failedOpen: s.failedOpen,
      } : null,
    };
  }
}
