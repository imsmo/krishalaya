// modules/identity/bulk/member-bulk-applier.ts · the 'members' importer W156 needs (PC-56 TENANT-1b-4).
//
// Before this file, `importType: 'members'` was a 422: only 'products' was registered, so the entire screen pointed at a
// rail that would refuse it.
//
// **THREE PROMISES FROM W156 LIVE HERE, AND EACH ONE IS A DECISION RATHER THAN A DETAIL:**
//
//   • **"Idempotent by phone number"** — a row whose normalised phone already belongs to a member of this tenant creates
//     NOTHING and reports a duplicate. The screen says it plainly: "matched by phone — skipped, never duplicated".
//   • **"imports create `pending_verification` users"** — not `active`. Somebody added them at a meeting; they have not
//     proved who they are, and `pending_verification` is precisely the state that says so. `isLoginable()` excludes it, so
//     an imported row cannot be signed into until the person verifies a phone they control.
//   • **"who get an app invite SMS in their language"** — enqueued in the SAME transaction as the member, so a member
//     created without a queued invite cannot exist. 0129's template names the inviter and the reason, in three languages.
//
// **AND THE SENTENCE THAT SHAPES THE WHOLE FILE:** "A member who never installs the app still exists for payouts and
// records — the app is a door, not a wall." So nothing here depends on the person ever responding. The user, the role and
// the money trail are complete on import; the invite is a courtesy, not a gate.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import type { BulkApplyContext, BulkRowApplier, RowVerdict } from '../../../core/bulk/bulk-applier.registry';
import { User } from '../domain/user.entity';
import { UserTenantRole } from '../domain/user-tenant-role.entity';
import { UserRepository } from '../repositories/user.repository';
import { UserTenantRoleRepository } from '../repositories/user-tenant-role.repository';
import { readMemberRow, memberImportIdemKey, MEMBER_IMPORT_COLUMNS } from '../domain/member-import-row';

export const MEMBER_INVITE_EVENT = 'member.invited';

@Injectable()
export class MemberBulkApplier implements BulkRowApplier {
  readonly importType = 'members';
  /** **ONLY `phone`.** A file with no names is a usable file — an SHG register often has numbers first and names later —
   *  while a file with no phone column has no way to identify anybody, and every row would be a duplicate of nothing. */
  readonly requiredColumns = ['phone'];

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider,
    private readonly audit: AuditWriter,
    private readonly users: UserRepository,
    private readonly utr: UserTenantRoleRepository,
  ) {}

  /**
   * THE VALIDATION PASS FOR ONE ROW — reads only, writes nothing.
   *
   * **THE DUPLICATE CHECK IS AGAINST MEMBERSHIP OF THIS TENANT, NOT AGAINST THE `users` TABLE.** A farmer who belongs to a
   * DIFFERENT FPO already exists globally, and reporting them as "already a member" would tell this organisation that
   * somebody they have never met is on their register — and skipping them would leave them off it. So a known person who
   * is not yet a member here is a `create`: the user is reused, a new role is granted.
   */
  async validateRow(ctx: BulkApplyContext, _rowIndex: number, row: Record<string, string>): Promise<RowVerdict> {
    const roles = await this.roleCodes(ctx.tenantId);
    const read = readMemberRow(row, roles);
    if (!read.ok) {
      // A blank row is INVALID and silent-ish; a bad phone or an unknown role is something a human fixes in the file.
      if (read.code === 'ROW_EMPTY' || read.code === 'PHONE_MISSING') {
        return { kind: 'invalid', code: read.code, message: read.message };
      }
      return {
        kind: 'fixable', code: read.code, message: read.message,
        ...('suggestion' in read && read.suggestion ? { suggestion: read.suggestion } : {}),
      };
    }

    const existing = await this.memberByPhone(ctx.tenantId, read.phone);
    if (existing) return { kind: 'duplicate', existingId: existing };
    return { kind: 'create' };
  }

  /**
   * APPLY ONE ROW, in one transaction.
   *
   * **THE ROW IS RE-READ AND RE-CHECKED HERE RATHER THAN TRUSTING THE VALIDATION PASS.** Minutes pass between the triage
   * and the confirm — an ambassador may have registered the same farmer from the app in between — so the duplicate check
   * runs again under the transaction. A validate-first pass is a preview, never a promise about the future.
   */
  async applyRow(ctx: BulkApplyContext, rowIdemKey: string, row: Record<string, string>): Promise<{ id?: string }> {
    const roles = await this.roleCodes(ctx.tenantId);
    const read = readMemberRow(row, roles);
    if (!read.ok) {
      // Thrown so the processor records it against the row and carries on with the file — one bad row must not stop 213
      // good ones. `code` travels onto `bulk_import_errors.error_code`.
      throw Object.assign(new Error(read.message), { code: read.code });
    }

    return this.uow.run(ctx.tenantId, async (tx) => {
      const roleId = await this.roleIdFor(tx, read.roleCode);
      if (!roleId) throw Object.assign(new Error(`role "${read.roleCode}" not found`), { code: 'ROLE_UNKNOWN' });

      // **LOCK BY PHONE, WHICH IS THE IDENTITY.** `getByPhoneForUpdate` is the same lock the OTP path takes when it
      // decides whether to register somebody, so an import racing a self-registration cannot produce two users.
      let user = await this.users.getByPhoneForUpdate(tx, read.phone);
      let created = false;
      if (!user) {
        user = User.register({ id: uuidv7(), phone: read.phone, fullName: read.fullName });
        // **`pending_verification`, NEVER `active`.** Somebody added them at a meeting; they have not proved who they are.
        user.changeStatus('pending_verification');
        await this.users.insert(tx, user);
        created = true;
      }

      // Already a member with this role? Then this row has nothing to do — the second half of "never duplicated".
      const already = await this.utr.findExisting(ctx.tenantId, user.id, roleId);
      if (already) return { id: user.id };

      // **THE ROLE IS ACTIVE AND THE USER IS `pending_verification`, WHICH IS NOT A CONTRADICTION.** The ORGANISATION added
      // this person deliberately, through a staff member holding the import grant — the import IS the approval, so
      // `requiresApproval: false`. What has NOT happened is the PERSON proving the number is theirs, which is what
      // `pending_verification` records and what `isLoginable()` blocks. Requiring a second approval instead would leave
      // 214 members off their own roster with nobody knowing why the count was wrong.
      const grant = UserTenantRole.assign({
        id: uuidv7(), userId: user.id, tenantId: ctx.tenantId, roleId, roleCode: read.roleCode,
        requiresApproval: false,
      });
      await this.utr.insert(tx, grant);

      await this.audit.write(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.actorUserId || null,
        action: 'member.imported',
        entityType: 'user',
        entityId: user.id,
        // The row's own reference travels onto the audit entry, so a member can be traced back to the FILE they arrived in
        // — which is the question somebody asks when a farmer says "I never joined this FPO".
        newValue: { roleCode: read.roleCode, createdUser: created, rowKey: rowIdemKey },
        reason: 'bulk member import',
      });

      // **THE INVITE RIDES THE OUTBOX, IN THE SAME TRANSACTION AS THE MEMBER.**
      //
      // The first version of this file injected `NotificationService` directly, and that was a DEFECT rather than a style
      // choice: `IdentityModule` does not import `CommunicationModule`, so Nest could not have resolved it — the unit tests
      // never boot the container, so nothing would have failed until the app started. Adding the import would also have
      // been wrong, because the platform already has the right mechanism: `NOTIFICATION_EVENT_MAP` bridges an outbox event
      // type to a notification code, so a module emits a fact and the communication module decides who hears about it.
      //
      // Same transaction, so a member created without a queued invite cannot exist — the promise W156's "consent matters"
      // paragraph makes. The relay's dedupe is per outbox event, so a re-run of the file cannot send a second message.
      // `userId` is IN the payload rather than assumed: ADMIN-6b's finding was a map row pointing at a payload with no
      // recipient, which looks fixed and changes nothing.
      await this.outbox.write(tx, {
        tenantId: ctx.tenantId,
        aggregateType: 'user',
        aggregateId: user.id,
        eventType: 'identity.member_imported',
        payload: {
          v: 1,
          userId: user.id,
          role_name: read.roleCode,
          reason: 'bulk member import',
          ...(read.languageCode ? { languageCode: read.languageCode } : {}),
        },
      });

      return { id: user.id };
    }, { userId: ctx.actorUserId || undefined });
  }

  /** The role codes this tenant actually uses. Read fresh per row from the replica, which is cheap and cached upstream —
   *  and correct if an administrator adds a role while a 220-row file is being validated. */
  private async roleCodes(tenantId: string): Promise<string[]> {
    const r = await this.replica.forTenant(tenantId).query<{ code: string }>(
      `SELECT code FROM roles WHERE deleted_at IS NULL ORDER BY code`);
    return r.rows.map((x) => String(x.code));
  }

  /** Is this phone already a member of THIS tenant? Returns the user id, which the console links to. */
  private async memberByPhone(tenantId: string, phone: string): Promise<string | null> {
    const r = await this.replica.forTenant(tenantId).query<{ id: string }>(
      `SELECT u.id FROM users u
        WHERE u.phone = $2 AND u.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM user_tenant_roles utr
                       WHERE utr.user_id = u.id AND utr.tenant_id = $1 AND utr.deleted_at IS NULL)
        LIMIT 1`,
      [tenantId, phone]);
    return r.rows[0] ? String(r.rows[0].id) : null;
  }

  private async roleIdFor(tx: { query: <T = any>(sql: string, p?: readonly unknown[]) => Promise<{ rows: T[] }> }, code: string): Promise<string | null> {
    const r = await tx.query<{ id: string }>(`SELECT id FROM roles WHERE code = $1 AND deleted_at IS NULL LIMIT 1`, [code]);
    return r.rows[0] ? String(r.rows[0].id) : null;
  }
}

/** Re-exported so the console and the template generator share one list. */
export { MEMBER_IMPORT_COLUMNS };
