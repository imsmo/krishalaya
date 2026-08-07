// apps/admin-api/src/modules/impersonation/domain/grant.entity.ts · the impersonation-grant aggregate (pure, no
// I/O). Holds the act-as session: who/whom/why/scope, the hard expiry (time-box), and the lifecycle status. The
// ONLY place the grant's status transitions are applied — always via the state machine. end()/revoke() are the
// two ways a still-active grant closes early; an elapsed expiry is reconciled to 'expired' by the worker/read.
import { GrantStatus, assertTransition } from './grant.state';
import { ImpersonationScope } from './scope';

export interface GrantProps {
  id: string;
  adminUserId: string;
  targetTenantId: string;
  targetUserId: string;
  reason: string;
  scope: ImpersonationScope;
  status: GrantStatus;
  expiresAt: Date;
  endedAt: Date | null;
  endedBy: string | null;
  endReason: string | null;
  createdAt?: Date | null;
}
export interface GrantChange { from: GrantStatus; to: GrantStatus; }

export class ImpersonationGrant {
  private constructor(private p: GrantProps) {}
  static rehydrate(p: GrantProps): ImpersonationGrant { return new ImpersonationGrant(p); }

  get id(): string { return this.p.id; }
  get status(): GrantStatus { return this.p.status; }
  get expiresAt(): Date { return this.p.expiresAt; }
  // PC-56 ADMIN-9b: the close path needs to address the person being impersonated, because ending a session now emits
  // a notice to them. Exposed as getters rather than read off `toJSON()` — a caller reaching into a serialisation shape
  // to find a domain fact is a caller that breaks when the shape changes for a screen.
  get targetTenantId(): string { return this.p.targetTenantId; }
  get targetUserId(): string { return this.p.targetUserId; }
  get adminUserId(): string { return this.p.adminUserId; }
  get reason(): string { return this.p.reason; }

  isExpired(now: Date): boolean { return this.p.expiresAt.getTime() <= now.getTime(); }

  private close(to: GrantStatus, byUserId: string, reason: string, now: Date): GrantChange {
    const from = this.p.status;
    assertTransition(from, to);                 // throws IllegalGrantTransitionError (e.g. closing an already-closed grant)
    this.p.status = to; this.p.endedAt = now; this.p.endedBy = byUserId; this.p.endReason = reason;
    return { from, to };
  }
  /** Operator finished the session. */
  end(byUserId: string, reason: string, now = new Date()): GrantChange { return this.close('ended', byUserId, reason, now); }
  /** Security/oversight pulled it (e.g. suspicious use) — same effect, different intent. */
  revoke(byUserId: string, reason: string, now = new Date()): GrantChange { return this.close('revoked', byUserId, reason, now); }

  toJSON() {
    return { id: this.p.id, adminUserId: this.p.adminUserId, targetTenantId: this.p.targetTenantId, targetUserId: this.p.targetUserId,
      reason: this.p.reason, scope: this.p.scope, status: this.p.status, expiresAt: this.p.expiresAt,
      endedAt: this.p.endedAt, endedBy: this.p.endedBy, endReason: this.p.endReason, createdAt: this.p.createdAt ?? null };
  }
}
