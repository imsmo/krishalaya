// modules/identity/services/user.service.ts · user profile + lifecycle (admin status changes audited).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { pgDateOrNull } from '../../../core/database/pg-date';
import { UserNotFoundError } from '../domain/identity.errors';
import { User } from '../domain/user.entity';
import { UserStatus } from '../domain/user.state';
import { UserRepository } from '../repositories/user.repository';
import { UserTenantRoleRepository } from '../repositories/user-tenant-role.repository';
import { UpdateUserDto } from '../dto/update-user.dto';
import { CreateUserDto } from '../dto/create-user.dto';
import { normalizePhoneE164 } from '../../../shared/utils/phone';
import { InvalidPhoneError } from '../domain/identity.errors';

/** The editable profile fields, as the audit may compare them: the raw values for change detection, the email ALSO masked for the row. */
interface ProfileAuditView { fullName: unknown; gender: unknown; dob: unknown; languageCode: unknown; email: unknown; emailMasked: unknown; photoMediaId: unknown }
const PROFILE_AUDIT_FIELDS = ['fullName', 'gender', 'dob', 'languageCode', 'email', 'photoMediaId'] as const;
/** A date column may arrive as a Date or an ISO string (pg's type parser) — compared as the calendar day (core/database/pg-date's one rule). */
const dayOf = (v: unknown): string | null => pgDateOrNull(v);
/** Only these values are WRITTEN to the row (masked where personal); every other changed field is named, never valued. */
function auditView(u: User): ProfileAuditView {
  const p = u.toProps(); const pub = u.toPublic();
  return { fullName: p.fullName, gender: p.gender, dob: dayOf(p.dob as unknown), languageCode: p.languageCode, email: p.email, emailMasked: pub.email, photoMediaId: p.photoMediaId };
}
/** PC-56 STORE-4a · B4 — PURE: what a self-edit's audit row says. The NAMES of the fields that changed; a value only where it is not personal
 *  (`languageCode`) or only MASKED (`email` as `toPublic()` masks it, `a***@x.in`). A name, a gender, a date of birth and a photo id are never
 *  written — the row says they changed, not to what. */
export function profileAuditValues(before: ProfileAuditView, after: ProfileAuditView): { fields: string[]; oldValue: Record<string, unknown>; newValue: Record<string, unknown> } {
  const fields: string[] = [];
  const oldValue: Record<string, unknown> = {}; const newValue: Record<string, unknown> = {};
  for (const f of PROFILE_AUDIT_FIELDS) {
    if ((before[f] ?? null) === (after[f] ?? null)) continue;
    fields.push(f);
    if (f === 'languageCode') { oldValue[f] = before[f] ?? null; newValue[f] = after[f] ?? null; }
    if (f === 'email') { oldValue[f] = before.emailMasked ?? null; newValue[f] = after.emailMasked ?? null; }
  }
  return { fields, oldValue: { fields, ...oldValue }, newValue: { fields, ...newValue } };
}

@Injectable()
export class UserService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    private readonly audit: AuditWriter,
    private readonly users: UserRepository,
    private readonly utr: UserTenantRoleRepository,
  ) {}

  async getById(tenantId: string, id: string) {
    const u = await this.users.findById(tenantId, id);
    if (!u) throw new UserNotFoundError(id);
    return u.toPublic();
  }

  /** Self-read enriched with the caller's ACTIVE role codes in this tenant (S6-prep contract fix:
   * the mobile app's UserProfile assumed a `roles` field that GET /v1/users/me never carried —
   * after a reinstall the client had no way to learn its own roles. Additive; same shape the
   * onboarding grant response already returns). */
  async getMe(tenantId: string, userId: string) {
    const base = await this.getById(tenantId, userId);
    const rows = await this.utr.list(tenantId, { userId, pendingOnly: false });
    const roles = rows.filter((r: any) => r.is_active).map((r: any) => r.role_code as string);
    // PC-56 STORE-4a · B4 (survey C-4): the SDK's `UserProfile` promises `displayName` and `locale`, which this read never carried — every
    // client printed "—" for a person whose name the platform holds. They are the person's own `fullName` and `languageCode`, said twice.
    return { ...base, displayName: base.fullName ?? null, locale: base.languageCode ?? null, roles };
  }

  /** Admin read of another user — SCOPED to the caller's tenant. A non-member returns
   *  404 (not 403) so an admin cannot enumerate users from other tenants. Self is always allowed. */
  async getByIdInTenant(tenantId: string, requesterId: string, targetId: string) {
    if (targetId !== requesterId) {
      const member = await this.utr.isMember(tenantId, targetId);
      if (!member) throw new UserNotFoundError(targetId);
    }
    return this.getById(tenantId, targetId);
  }

  /** PC-56 STORE-4a · B4 (survey F-18): the self-edit is AUDITED (`user.profile_updated`) in its transaction — the NAMES of the fields that
   *  changed, and their values MASKED where they are personal (`profileAuditValues`): no name, no raw email ever lands in the audit log. */
  async updateProfile(tenantId: string, userId: string, dto: UpdateUserDto, ip: string | null = null) {
    await this.uow.run(tenantId, async (tx) => {
      const u = await this.users.getForUpdate(tx, userId);
      if (!u) throw new UserNotFoundError(userId);
      const before = auditView(u);
      u.updateProfile(dto);
      await this.users.update(tx, u);
      const audit = profileAuditValues(before, auditView(u));
      if (audit.fields.length) {
        await this.audit.write(tx, { tenantId, actorUserId: userId, action: 'user.profile_updated', entityType: 'user', entityId: userId, oldValue: audit.oldValue, newValue: audit.newValue, ip });
      }
    }, { userId });
    return this.getById(tenantId, userId);
  }

  /** Ambassador/admin-assisted onboarding of a user who can't self-register. */
  async adminCreate(tenantId: string, actorUserId: string, dto: CreateUserDto, ip: string | null) {
    const phone = normalizePhoneE164(dto.phone);
    if (!phone) throw new InvalidPhoneError();
    const id = await this.uow.run(tenantId, async (tx) => {
      const existing = await this.users.getByPhoneForUpdate(tx, phone);
      if (existing) return existing.id;
      const u = User.register({ id: uuidv7(), phone, fullName: dto.fullName ?? null, languageCode: dto.languageCode, countryCode: dto.countryCode });
      await this.users.insert(tx, u);
      await this.flush(tx, u.id, u.pullEvents());
      await this.audit.write(tx, { tenantId, actorUserId, action: 'user.created_assisted', entityType: 'user', entityId: u.id, ip });
      return u.id;
    }, { userId: actorUserId });
    return this.getById(tenantId, id);
  }

  async changeStatus(tenantId: string, actorUserId: string, targetUserId: string, status: UserStatus, reason: string | null, ip: string | null) {
    await this.uow.run(tenantId, async (tx) => {
      const u = await this.users.getForUpdate(tx, targetUserId);
      if (!u) throw new UserNotFoundError(targetUserId);
      const from = u.toProps().status;
      u.changeStatus(status, actorUserId);
      await this.users.update(tx, u);
      await this.flush(tx, u.id, u.pullEvents());
      await this.audit.write(tx, { tenantId, actorUserId, action: 'user.status_changed', entityType: 'user', entityId: u.id, oldValue: { status: from }, newValue: { status }, reason, ip });
    }, { userId: actorUserId });
    return this.getById(tenantId, targetUserId);
  }

  private async flush(tx: TxContext, userId: string, events: { type: string; payload: Record<string, unknown> }[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId: null, aggregateType: 'user', aggregateId: userId, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
