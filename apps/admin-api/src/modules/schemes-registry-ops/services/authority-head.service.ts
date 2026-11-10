// apps/admin-api/src/modules/schemes-registry-ops/services/authority-head.service.ts · PC-56 GOV-0 · THE PLATFORM APPOINTS AN AUTHORITY'S
// FIRST HEAD (GOV-1 Q4-A, lead-applied 2026-11-10; the founder may reopen). Law 11: the god-mode realm, behind `schemes.registry.manage` +
// FIDO2 (HardwareKeyGuard) + step-up (StepUpReauthGuard) at the route, with an audit row in the same transaction.
//
// What it does: ONE `authority_head` membership in `authority_memberships`, born active, ending `termMonths` (1–12) from now — the end date
// is written by 0239's guard, never by this code — for an EXISTING platform account named by phone, and only while the authority has NO
// current (active, unexpired) head. After that the authority grants its own roles with a second person (the gov console). The checks here
// give a clean answer; 0239's guard re-checks "no current head" under a per-authority advisory lock, so two operators racing end in one head.
// What it never does: edit or remove a membership (kv_admin holds no UPDATE on the table), appoint an officer, or create a person.
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';

class AuthorityHeadError extends HttpException {
  constructor(code: string, message: string, status: HttpStatus) { super({ code, message }, status); }
}
export const AUTHORITY_HEAD_REFUSALS = Object.freeze({
  AUTHORITY_NOT_FOUND: () => new AuthorityHeadError('AUTHORITY_NOT_FOUND', 'No authority with this id exists.', HttpStatus.NOT_FOUND),
  GOV_AUTHORITY_HAS_HEAD: () => new AuthorityHeadError('GOV_AUTHORITY_HAS_HEAD', 'This authority already has a current head. Its people grant further roles.', HttpStatus.CONFLICT),
  GOV_PERSON_UNKNOWN: () => new AuthorityHeadError('GOV_PERSON_UNKNOWN', 'No platform account holds this phone number.', HttpStatus.NOT_FOUND),
  GOV_TERM_INVALID: () => new AuthorityHeadError('GOV_TERM_INVALID', 'The term is a whole number of months from 1 to 12.', HttpStatus.UNPROCESSABLE_ENTITY),
  GOV_REASON_REQUIRED: () => new AuthorityHeadError('GOV_REASON_REQUIRED', 'A reason of 10 to 500 characters is required.', HttpStatus.UNPROCESSABLE_ENTITY),
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const E164 = /^\+[1-9][0-9]{7,14}$/;
const maskTail = (p: string) => `${'•'.repeat(6)}${p.replace(/[^0-9]/g, '').slice(-3)}`;

/** 1–12 whole months and a 10–500-character reason, or the refusal's code. Pure (unit-tested). */
export function headAppointmentRefusal(dto: { termMonths: unknown; reason: unknown }): keyof typeof AUTHORITY_HEAD_REFUSALS | null {
  const t = dto.termMonths;
  if (!Number.isInteger(t) || (t as number) < 1 || (t as number) > 12) return 'GOV_TERM_INVALID';
  const n = typeof dto.reason === 'string' ? dto.reason.trim().length : 0;
  if (n < 10 || n > 500) return 'GOV_REASON_REQUIRED';
  return null;
}

@Injectable()
export class AuthorityHeadService {
  constructor(private readonly pool: AdminPool, private readonly audit: AdminAuditWriter) {}

  async appoint(actor: AdminRequestContext, authorityId: string, dto: { phone: string; termMonths: number; reason: string }) {
    if (!UUID.test(authorityId)) throw AUTHORITY_HEAD_REFUSALS.AUTHORITY_NOT_FOUND();
    const refusal = headAppointmentRefusal(dto);
    if (refusal) throw AUTHORITY_HEAD_REFUSALS[refusal]();
    const phone = String(dto.phone ?? '').trim();
    if (!E164.test(phone)) throw AUTHORITY_HEAD_REFUSALS.GOV_PERSON_UNKNOWN();
    try {
      return await this.pool.withTx(async (c: PoolClient) => {
        const a = await c.query(`SELECT id FROM scheme_authorities WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [authorityId]);
        if (!a.rows[0]) throw AUTHORITY_HEAD_REFUSALS.AUTHORITY_NOT_FOUND();
        const heads = await c.query<{ n: number }>(`SELECT gov_authority_live_heads($1) AS n`, [authorityId]);
        if (Number(heads.rows[0]?.n ?? 0) > 0) throw AUTHORITY_HEAD_REFUSALS.GOV_AUTHORITY_HAS_HEAD();
        const u = await c.query<{ id: string }>(`SELECT id FROM users WHERE phone = $1 AND deleted_at IS NULL`, [phone]);
        if (!u.rows[0]) throw AUTHORITY_HEAD_REFUSALS.GOV_PERSON_UNKNOWN();
        const ins = await c.query<{ id: string; expires_at: string }>(
          `INSERT INTO authority_memberships (authority_id, user_id, role_id, status, term_months, requested_by_admin_id, request_reason)
           SELECT $1, $2, r.id, 'active', $3, $4, $5 FROM roles r WHERE r.code = 'authority_head' AND r.scope = 'authority'
           RETURNING id, expires_at`,
          [authorityId, u.rows[0].id, dto.termMonths, actor.userId, dto.reason.trim()]);
        const row = ins.rows[0];
        await this.audit.write(c, {
          actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
          action: 'schemes_registry.authority_head_appointed', entityType: 'authority_membership', entityId: row.id,
          newValue: { authorityId, userId: u.rows[0].id, phone: maskTail(phone), roleCode: 'authority_head', termMonths: dto.termMonths, expiresAt: row.expires_at },
          reason: dto.reason.trim(), ip: actor.ip, requestId: actor.requestId || null,
        });
        return { data: { id: row.id, authorityId, roleCode: 'authority_head' as const, status: 'active' as const, expiresAt: new Date(row.expires_at).toISOString(), phoneMasked: maskTail(phone) } };
      });
    } catch (e) {
      const m = /\[(GOV_AUTHORITY_HAS_HEAD)\]/.exec(String((e as Error)?.message ?? ''));
      if (m) throw AUTHORITY_HEAD_REFUSALS.GOV_AUTHORITY_HAS_HEAD();
      throw e;
    }
  }
}
