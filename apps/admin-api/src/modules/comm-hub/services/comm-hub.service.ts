// apps/admin-api/src/modules/comm-hub/services/comm-hub.service.ts · W050 (PC-56 ADMIN-SWEEP-b2).
//
// Transactions and audit; the rules live in domain/. Replies are DELIBERATELY NOT here: the hub links each ticket
// into the W049 case page, whose reply already goes through the ADMIN-2d platform-reply rail (queued, delivered by
// the apps/api executor, never claimed sent at commit). A second reply path would be a second place for that
// honesty to rot.
import { Injectable } from '@nestjs/common';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { CommHubRepository } from '../repositories/comm-hub.repository';
import {
  presenceOf, assertMayClaim, presenceTransition, principalView, channelStanding, hubSla,
  CARRIED_CHANNELS, HubRuleError,
} from '../domain/comm-hub';
import { HubNotClaimableError, HubPrincipalNotFoundError } from '../domain/comm-hub.errors';

@Injectable()
export class CommHubService {
  constructor(
    private readonly pool: AdminPool,
    private readonly audit: AdminAuditWriter,
    private readonly repo: CommHubRepository,
  ) {}

  /** The unified inbox: one row per principal, worst deadline first, identity masked at the domain boundary. */
  async inbox(q: { cursor?: { k: string; id: string }; limit: number }, viewer: string) {
    const now = new Date();
    const rows = await this.repo.principals({ cursor: q.cursor, limit: q.limit + 1 });
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    const [orphans, myLoad, unclaimed, presenceRow] = await Promise.all([
      this.repo.orphanCount(), this.repo.myLoad(viewer), this.repo.unclaimedCount(), this.repo.presence(viewer),
    ]);
    return {
      items: page.map((r) => ({
        ...principalView(r),
        openTickets: r.openTickets, tenants: r.tenants,
        channels: r.channels.map((c) => ({ channel: c, standing: channelStanding(c) })),
        worstSeverity: r.worstSeverity,
        sla: hubSla(r.worstDueAt, now),
        latestTicketId: r.latestTicketId, latestSubject: r.latestSubject, latestChannel: r.latestChannel,
        waitingSince: r.waitingSince,
      })),
      nextCursor: rows.length > q.limit && last
        ? Buffer.from(`${last.worstDueAt ?? ''}|${last.userId}`).toString('base64') : null,
      // The header facts, all server-computed: the decor "My load: 6 open" becomes a real number here.
      myLoad, unclaimed, orphans,
      presence: presenceOf(presenceRow), presenceSince: presenceRow?.since ?? null,
      carriedChannels: [...CARRIED_CHANNELS],
    };
  }

  /** One thread per principal — the deepest support read there is, so it is the route behind `support.hub`. */
  async principal(userId: string, viewer: string) {
    const who = await this.repo.principalIdentity(userId);
    if (!who) throw new HubPrincipalNotFoundError();
    const tickets = await this.repo.ticketsForPrincipal(userId);
    // Opening one person's cross-tenant support file is a read somebody may later have to account for — same
    // doctrine as the risk profile read (ADMIN-5d).
    await this.audit.log({
      actorUserId: viewer, actorRole: null,
      action: 'support.hub_principal_read', entityType: 'user', entityId: userId,
      oldValue: null, newValue: { tickets: tickets.length }, reason: 'comm hub thread', ip: null, requestId: null,
    });
    const now = new Date();
    return {
      ...principalView(who),
      tickets: tickets.map((t) => ({
        ...t,
        standing: channelStanding(t.channel),
        sla: t.status === 'resolved' || t.status === 'closed' ? null : hubSla(t.slaFirstResponseDue, now),
        mine: t.claimedByAdminId === viewer,
      })),
    };
  }

  /** "Next in queue" — presence-gated, atomic, audited. Nothing to claim is an ANSWER (the two counts let the
   *  console say WHICH nothing: inbox zero, or everything already owned). */
  async takeNext(actor: AdminRequestContext) {
    const presence = presenceOf(await this.repo.presence(actor.userId));
    try { assertMayClaim(presence); } catch (e) {
      if (e instanceof HubRuleError) throw new HubNotClaimableError(e);
      throw e;
    }
    return this.pool.withTx(async (c) => {
      const claimed = await this.repo.claimNext(c, actor.userId);
      if (!claimed) return { claimed: false as const };
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'support.hub_claimed', entityType: 'support_ticket', entityId: claimed.id,
        oldValue: { claimedByAdminId: null }, newValue: { claimedByAdminId: actor.userId },
        reason: 'next in queue', ip: actor.ip, requestId: actor.requestId || null,
      });
      return { claimed: true as const, ticketId: claimed.id, requesterUserId: claimed.requesterUserId };
    });
  }

  /** "Take a break 🌾" / "I'm back" — a recorded, audited fact, because the claim gate reads it. */
  async setPresence(actor: AdminRequestContext, status: 'available' | 'break') {
    const before = presenceOf(await this.repo.presence(actor.userId));
    if (presenceTransition(before, status) === 'noop') return { status, changed: false };
    await this.pool.withTx(async (c) => {
      await this.repo.setPresence(c, actor.userId, status);
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: status === 'break' ? 'support.hub_break' : 'support.hub_available',
        entityType: 'support_hub_presence', entityId: actor.userId,
        oldValue: { status: before }, newValue: { status },
        reason: status === 'break' ? 'take a break' : 'back from break', ip: actor.ip, requestId: actor.requestId || null,
      });
    });
    return { status, changed: true };
  }
}
