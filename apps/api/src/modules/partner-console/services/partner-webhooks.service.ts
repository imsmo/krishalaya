// modules/partner-console/services/partner-webhooks.service.ts · PC-56 PARTNER-1b · founder D2 — THE PARTNER'S OWN ENDPOINTS AND DELIVERIES, READ-ONLY.
//
//   endpoints   — `partner.webhooks.read`: id, the URL as stored (it is the partner's own), the subscribed event types, active, created —
//                 never `secret_enc`, never a hash (0227 `partner_console_endpoints()`); + the subscribable vocabulary = 0090's allow-list
//                 (`PARTNER_WEBHOOK_EVENT_TYPES`) — never an application or consent event (refused by name in the console);
//   deliveries  — keyset, newest first, the rail's 90-day retention window; filters endpoint / state (the rail's own states) / event type;
//                 limit ≤ 100: id, endpoint, event type, state, attempts, last HTTP code, last error class, created, last attempt, delivered —
//                 NO payload body (the partner received it on the wire) and NEVER the originating tenant (0227's column grant holds neither);
//   delivery    — one row + its attempts (attempt no, outcome, status code, duration, error, signed-at; never the signature).
// Not audited: the partner's own delivery log, not applicant data. Add / rotate / activate / pause / replay / ping are DECOR (W3017–W3023):
// endpoints are registered and changed by the platform's partner operations; a replay is run by them on request.
import { Injectable } from '@nestjs/common';
import { decodeKeyset, encodeKeyset, UUID_RE } from '../../../shared/pagination/us-keyset';
import { RETENTION_DAYS } from '../../tenant-webhooks/domain/webhook-rail.state';
import { PARTNER_WEBHOOK_EVENT_TYPES } from '../../partner-api/domain/partner-webhook.rules';
import { PartnerConsoleRepository } from '../repositories/partner-console.repository';
import { isDeliveryState, projectAttempt, projectDelivery, projectEndpoint } from '../domain/partner-keys.rules';
import { clampPartnerLimit } from '../domain/partner-console.rules';
import { partnerRefused } from '../domain/partner-console.errors';
import { PartnerSession } from '../guards/partner-session.guard';

@Injectable()
export class PartnerWebhooksService {
  constructor(private readonly repo: PartnerConsoleRepository) {}

  async endpoints(s: PartnerSession) {
    const rows = await this.repo.endpoints(s.partnerId);
    return { items: rows.map(projectEndpoint), subscribableEvents: [...PARTNER_WEBHOOK_EVENT_TYPES], retentionDays: RETENTION_DAYS, computedAt: new Date().toISOString() };
  }

  async deliveries(s: PartnerSession, q: { endpointId?: string; state?: string; eventType?: string; cursor?: string; limit?: number }) {
    const limit = clampPartnerLimit(q.limit);
    const cursor = decodeKeyset(q.cursor, UUID_RE);
    const filter = {
      endpointId: q.endpointId && UUID_RE.test(q.endpointId) ? q.endpointId : undefined,
      state: isDeliveryState(q.state) ? q.state : undefined,
      eventType: q.eventType ? q.eventType : undefined,
      cursor, limit, windowDays: RETENTION_DAYS,
    };
    const per: Array<Array<Record<string, unknown> & { created_us: string; id: string }>> = [];
    for (let i = 0; i < this.repo.shards; i++) per.push(await this.repo.deliveriesShard(i, s.partnerId, filter));
    const rows = per.flat()
      .sort((a, b) => (a.created_us < b.created_us ? 1 : a.created_us > b.created_us ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
      .slice(0, limit);
    const last = rows[rows.length - 1];
    return {
      items: rows.map(projectDelivery),
      nextCursor: rows.length === limit && last ? encodeKeyset(last.created_us, last.id) : null,
      limit, retentionDays: RETENTION_DAYS, computedAt: new Date().toISOString(),
    };
  }

  async delivery(s: PartnerSession, id: string) {
    const found = UUID_RE.test(id) ? await this.repo.deliveryDetail(s.partnerId, id) : null;
    if (!found) throw partnerRefused('PARTNER_DELIVERY_NOT_FOUND');
    return { ...projectDelivery(found.delivery), attemptsList: found.attempts.map(projectAttempt) };
  }
}
