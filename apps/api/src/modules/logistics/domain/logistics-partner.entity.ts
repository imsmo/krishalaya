// modules/logistics/domain/logistics-partner.entity.ts · a carrier in the fleet registry: a 3PL, a tenant's own
// fleet, or an individual rider (0007 logistics_partners). Pure TS — invariants only. Tenant-scoped (tenant_id);
// platform 3PLs (tenant_id NULL) are written in apps/admin-api (Law 11) and only browsed here. No money.
import { InvalidPartnerError, FleetAlreadyInStateError } from './logistics.errors';
import type { DomainEvent } from './logistics.events';

export const PARTNER_KINDS = ['3pl', 'tenant_fleet', 'rider'] as const;
export type PartnerKind = (typeof PARTNER_KINDS)[number];
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

export interface LogisticsPartnerProps {
  id: string; tenantId: string; partnerKind: PartnerKind | string; providerCode: string | null; defaultName: string;
  riderUserId: string | null; supportsColdChain: boolean; isActive: boolean; createdAt?: Date | null;
  /** PC-56 TENANT-SW-e: the carrier's business contact (E.164; printed masked), the reason of the last (de)activation, and the
   *  microsecond instant the list cursor is minted from (F-14). */
  contactPhone?: string | null; statusReason?: string | null; createdUs?: string | null;
}
export type PartnerPatch = { defaultName?: string; providerCode?: string | null; supportsColdChain?: boolean; contactPhone?: string | null };

function assertName(v: string): string {
  const s = v.trim();
  if (!s) throw new InvalidPartnerError('default_name is required');
  if (s.length > 150) throw new InvalidPartnerError('default_name exceeds 150 chars');
  if (/[<>]/.test(s) || CONTROL_RE.test(s)) throw new InvalidPartnerError('default_name must be plain text');
  return s;
}

export class LogisticsPartner {
  private readonly events: DomainEvent[] = [];
  private constructor(private p: LogisticsPartnerProps) {}

  static create(input: Omit<LogisticsPartnerProps, 'isActive'>): LogisticsPartner {
    if (!(PARTNER_KINDS as readonly string[]).includes(input.partnerKind)) throw new InvalidPartnerError(`partner_kind must be one of ${PARTNER_KINDS.join('|')}`);
    if (input.partnerKind === 'rider' && !input.riderUserId) throw new InvalidPartnerError('rider partner requires rider_user_id');
    const name = assertName(input.defaultName);
    const e = new LogisticsPartner({ ...input, defaultName: name, isActive: true });
    e.events.push({ type: 'logistics.partner_registered', payload: { partnerId: e.p.id, tenantId: input.tenantId, partnerKind: input.partnerKind } });
    return e;
  }
  static rehydrate(p: LogisticsPartnerProps): LogisticsPartner { return new LogisticsPartner(p); }

  get id() { return this.p.id; }
  get isActive() { return this.p.isActive; }
  toProps(): Readonly<LogisticsPartnerProps> { return Object.freeze({ ...this.p }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }

  update(patch: PartnerPatch): { old: Record<string, unknown>; new: Record<string, unknown> } {
    const old: Record<string, unknown> = {}; const next: Record<string, unknown> = {};
    if (patch.defaultName !== undefined) { const v = assertName(patch.defaultName); if (v !== this.p.defaultName) { old.defaultName = this.p.defaultName; next.defaultName = v; this.p.defaultName = v; } }
    if (patch.providerCode !== undefined && patch.providerCode !== this.p.providerCode) { old.providerCode = this.p.providerCode; next.providerCode = patch.providerCode; this.p.providerCode = patch.providerCode; }
    if (patch.supportsColdChain !== undefined && patch.supportsColdChain !== this.p.supportsColdChain) { old.supportsColdChain = this.p.supportsColdChain; next.supportsColdChain = patch.supportsColdChain; this.p.supportsColdChain = patch.supportsColdChain; }
    // the contact is audited by its LAST FOUR only (a phone number never lands in the audit trail whole)
    if (patch.contactPhone !== undefined && patch.contactPhone !== (this.p.contactPhone ?? null)) { old.contactPhoneTail = this.p.contactPhone ? this.p.contactPhone.slice(-4) : null; next.contactPhoneTail = patch.contactPhone ? patch.contactPhone.slice(-4) : null; this.p.contactPhone = patch.contactPhone; }
    if (Object.keys(next).length === 0) throw new FleetAlreadyInStateError('partner');
    return { old, new: next };
  }

  setActive(to: boolean, reason?: string | null): { action: 'activated' | 'deactivated'; old: { isActive: boolean }; new: { isActive: boolean } } {
    if (this.p.isActive === to) throw new FleetAlreadyInStateError('partner');
    const from = this.p.isActive; this.p.isActive = to;
    if (reason !== undefined) this.p.statusReason = reason;
    return { action: to ? 'activated' : 'deactivated', old: { isActive: from }, new: { isActive: to } };
  }
}
