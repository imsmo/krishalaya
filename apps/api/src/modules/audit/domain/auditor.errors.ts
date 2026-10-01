// modules/audit/domain/auditor.errors.ts · PC-56 TENANT-9c · typed errors, stable codes → HTTP. Each one is a STATE the
// auditor pages render in words (6e-1's lesson: a disabled flag answered with a bare 404 renders as "couldn't load").
import { DomainError } from '../../../shared/errors/app-error';

/** The `audit_trail` flag is off for this tenant — W200's *"Flagged off — Auditor Console disabled"*. */
export class AuditorRealmOffError extends DomainError { constructor() { super('AUDITOR_REALM_OFF', 'The auditor console is not switched on for this tenant', 404, {}); } }
/** W200's *"Auditor scope only"* — the caller lacks the read the surface needs. Names the code it needs. */
export class AuditorScopeError extends DomainError { constructor(required: string) { super('AUDITOR_SCOPE_ONLY', `This surface needs ${required}`, 403, { required }); } }
/** A window the canon's bound refuses (≤ 92 days live, ≤ 366 for an export), or a day that is not a day. */
export class AuditWindowRefusedError extends DomainError { constructor(code: string, maxDays: number) { super('AUDIT_WINDOW_REFUSED', `Window refused: ${code}`, 422, { code, maxDays }); } }
/** A reveal the rules refuse: no `member.pii.reveal`, or a reason under 20 characters. */
export class AuditRevealRefusedError extends DomainError { constructor(code: 'NO_PERMISSION' | 'REVEAL_REASON_TOO_SHORT', min?: number) { super('AUDIT_REVEAL_REFUSED', `Reveal refused: ${code}`, code === 'NO_PERMISSION' ? 403 : 422, { code, ...(min ? { min } : {}) }); } }
export class AuditEntryNotFoundError extends DomainError { constructor(id: string) { super('AUDIT_ENTRY_NOT_FOUND', 'Audit entry not found', 404, { id }); } }
