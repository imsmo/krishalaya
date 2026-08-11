// modules/identity/services/member-pii.service.ts · the reveal W153 promises (PC-56 TENANT-1b).
//
// W153: "PII stays masked — **full reveal is per-field, recorded, and reasoned**."
//
// Three words, three separate controls, and each one is a decision:
//
//   • **PER-FIELD.** Revealing a phone number does not reveal an Aadhaar reference. A single "show PII" toggle would make
//     every reveal maximal, and the reason a staff member gives for needing to call a farmer is not a reason to see
//     their identity document.
//   • **RECORDED.** The audit row is written BEFORE the value is returned, and if it cannot be written the reveal does
//     not happen. This is the ADMIN-9b rule and it applies for the same reason: here the log IS the control. A reveal
//     nobody can prove happened is indistinguishable from a leak, and a platform that keeps 75M households' phone
//     numbers has to be able to say who looked at one.
//   • **REASONED.** A free-text reason of real length, stored on the audit row. "Support call" is not a reason; the field
//     exists so a reviewer six months later can tell a legitimate callback from a curious browse.
//
// **AND THE REVEAL IS SINGULAR BY CONSTRUCTION.** There is no bulk endpoint and no list variant. A staff member may
// reveal one field of one member at a time, which is what makes the audit trail readable and what makes exfiltration
// expensive rather than convenient. The export path is a different, separately-granted act (W2326/W2327).
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AUDIT_WRITER, AuditWriter } from '../../../core/audit/audit.writer';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { ForbiddenError, NotFoundError, BadRequestError } from '../../../shared/errors/app-error';

/** The fields a tenant's staff may ever unmask. **A CLOSED LIST, NOT A COLUMN NAME FROM THE REQUEST** — an open
 *  parameter here would be a SQL-shaped hole with an audit row attached, and "reveal me `pan_vault_ref`" must be a
 *  refusal rather than a lookup. */
export const REVEALABLE_FIELDS = ['phone', 'email', 'aadhaar_last4'] as const;
export type RevealableField = (typeof REVEALABLE_FIELDS)[number];

export function isRevealableField(v: string): v is RevealableField {
  return (REVEALABLE_FIELDS as readonly string[]).includes(v);
}

/** Twenty characters, the same floor every reasoned act on this platform uses. A reveal of somebody's phone number is
 *  not a smaller decision than a platform setting change. */
export const MIN_REASON_LENGTH = 20;

export interface RevealActor {
  userId: string;
  /** `member.pii.reveal` — its own permission, never implied by the roster read. Seeing that a member EXISTS and seeing
   *  how to phone them are different grants, and W153's restricted state says exactly that. */
  canRevealPii: boolean;
  ip: string | null;
  requestId: string | null;
}

@Injectable()
export class MemberPiiService {
  private readonly log = new Logger(MemberPiiService.name);

  constructor(
    @Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider,
    @Inject(AUDIT_WRITER) private readonly audit: AuditWriter,
  ) {}

  /**
   * Unmask ONE field of ONE member, with a reason, recorded.
   *
   * **THE ORDER IS: AUTHORISE → FIND → RECORD → RETURN.** The record is written before the value leaves this method, and
   * a failure to record refuses the reveal. `AuditWriter.log()` exists for precisely this shape — a read event with no
   * business transaction — so there is no transaction to abort and nothing else to roll back; the only thing that can go
   * wrong is the audit insert, and that must fail the request rather than be swallowed.
   *
   * Contrast the price-anomaly recorder in ADMIN-SWEEP, which never throws: there the breaker was the control and the
   * row was the report. Here the row IS the control.
   */
  async revealField(
    tenantId: string,
    actor: RevealActor,
    userId: string,
    field: string,
    reason: string,
  ): Promise<{ field: RevealableField; value: string | null }> {
    if (!actor.canRevealPii) throw new ForbiddenError('requires member.pii.reveal');
    if (!isRevealableField(field)) {
      // Named refusal rather than a 500 from an unknown column: the closed list is the control, and a caller probing it
      // deserves a clear no.
      throw new BadRequestError(`'${field}' is not a revealable field`);
    }
    const trimmed = reason.trim();
    if (trimmed.length < MIN_REASON_LENGTH) {
      throw new BadRequestError(`a reason of at least ${MIN_REASON_LENGTH} characters is required to reveal a member's ${field}`);
    }

    // **THE MEMBERSHIP CHECK IS THE TENANT BOUNDARY, AND IT IS NOT OPTIONAL.** Without it, a tenant's staff could reveal
    // the phone number of any user on the platform by id — every farmer of every other FPO. RLS is the net; this join is
    // the intent, and Law 1 wants both.
    const r = await this.replica.forTenant(tenantId).query<Record<string, string | null>>(
      `SELECT u.phone, u.email, u.aadhaar_last4
         FROM users u
        WHERE u.id = $1 AND u.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM user_tenant_roles utr
                       WHERE utr.user_id = u.id AND utr.tenant_id = $2
                         AND utr.is_active = true AND utr.deleted_at IS NULL)`,
      [userId, tenantId]);
    const row = r.rows[0];
    // 404 and not 403: telling a caller "that person exists but is not yours" is an enumeration oracle across tenants.
    if (!row) throw new NotFoundError('member not found in this organisation');

    const value = row[field] ?? null;

    // RECORDED BEFORE RETURNED. No try/catch: if this throws, the caller gets an error and no PII.
    await this.audit.log({
      tenantId,
      actorUserId: actor.userId,
      action: 'member.pii_revealed',
      entityType: 'user',
      entityId: userId,
      // **THE VALUE IS NOT IN THE AUDIT ROW.** Logging the revealed number would turn the audit log — which is retained
      // for years and read by more people than the roster — into a second copy of the PII it exists to police.
      newValue: { field, revealed: value !== null },
      reason: trimmed,
      ip: actor.ip,
      requestId: actor.requestId,
    });

    // A member with no value in that field is a real answer, not an error: plenty of farmers have no email, and telling
    // staff "nothing on file" saves them asking twice.
    return { field, value };
  }
}
