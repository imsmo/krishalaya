// modules/identity/services/address.service.ts · user address book (owner-scoped).
//
// PC-56 HOTFIX-6 · B3 + B4 (survey STORE-4 F-3 / F-5 / B4 / B5 / E1):
//   • COPY-ON-WRITE. An address somebody is delivering to is NEVER edited in place (its VALUES — the default flag alone is a preference
//     no delivery reads, so a make-default stays in place). `update` locks the row, asks migration 0213's
//     `kv_address_in_use` (orders · shipments pickup/drop · labour bookings · d2c subscriptions, in ANY organisation — the trade invoice
//     reads the order's address, so the order covers it); in use → the edited COPY is inserted (same owner, every current value with the edit
//     applied, the default flag carried) and the old row is soft-retired with its values untouched, the NEW id returned (`copied: true`,
//     `previousId`); not in use → edited in place as before (`copied: false`). One transaction either way.
//   • `countryCode` is editable (the UPDATE omitted it).
//   • `create` and `update` are idempotent on an OPTIONAL Idempotency-Key (hashed with the owner + the act, the STORE-3a shape — varchar(120)
//     safe): a replay returns the first answer (for an edit of an address in use, the same new id — never a second copy).
//   • `remove` of an address that is not the caller's → 404 ADDRESS_NOT_FOUND (never 403, the orders precedent; it used to answer ok);
//     a repeat of the caller's own remove → ok (idempotent). Removing the DEFAULT makes the NEWEST remaining address the default (none
//     left → no default) — said in the answer (`defaultId`).
//   • the list is BOUNDED: a hard cap of 50 (ADDRESS_LIST_CAP), the default first, then newest; retired copies are never listed.
import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { uuidv7 } from '../../../core/database/uuid.util';
import { Address } from '../domain/address.entity';
import { AddressRepository } from '../repositories/address.repository';
import { CreateAddressDto, UpdateAddressDto } from '../dto/create-address.dto';
import { DomainError } from '../../../shared/errors/app-error';

export interface AddressWriteResult { ok: true; id: string; copied: boolean; previousId: string | null }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = () => new DomainError('ADDRESS_NOT_FOUND', 'Address not found', 404);
/** Every value of an address but its default flag (and its id), in a stable order — what copy-on-write protects. */
const valuesOf = (a: Address) => { const { id: _id, isDefault: _d, ...v } = a.toProps(); void _id; void _d; return JSON.stringify(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]])); };
const keyOf = (scope: string, userId: string, key: string) => createHash('sha256').update(`${scope}:${userId}:${key}`).digest('base64url');

@Injectable()
export class AddressService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    private readonly repo: AddressRepository,
  ) {}

  async create(tenantId: string, userId: string, dto: CreateAddressDto, idemKey?: string) {
    const act = async () => {
      const id = await this.uow.run(tenantId, async (tx) => {
        if (dto.isDefault) await this.repo.unsetDefaults(tx, userId);
        const a = Address.create({ id: uuidv7(), userId, tenantId: null, labelId: dto.labelId ?? null, line1: dto.line1, line2: dto.line2 ?? null, village: dto.village ?? null, regionId: dto.regionId ?? null, pincode: dto.pincode ?? null, countryCode: dto.countryCode, lat: dto.lat ?? null, lng: dto.lng ?? null, contactName: dto.contactName ?? null, contactPhone: dto.contactPhone ?? null, isDefault: dto.isDefault });
        await this.repo.insert(tx, a);
        return a.id;
      }, { userId });
      return { id };
    };
    return idemKey ? this.idem.remember(keyOf('address.create', userId, idemKey), userId, 'identity.address.create', act) : act();
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateAddressDto, idemKey?: string): Promise<AddressWriteResult> {
    if (!UUID.test(id)) throw notFound();
    const act = () => this.uow.run(tenantId, async (tx): Promise<AddressWriteResult> => {
      const a = await this.repo.getForUpdate(tx, id, userId);
      if (!a) throw new DomainError('ADDRESS_NOT_FOUND', 'Address not found', 404);
      if (dto.isDefault) await this.repo.unsetDefaults(tx, userId);
      const { isDefault, ...fields } = dto;
      const before = valuesOf(a);
      a.update(fields);
      if (isDefault === true) a.makeDefault();
      if (isDefault === false) a.unsetDefault();
      // Only the address's VALUES are protected: the default flag is the owner's preference, read by no order, shipment or invoice — a
      // make-default (or a patch that changes nothing) is written in place even on an address in use (no copy, no new id).
      const valuesChanged = valuesOf(a) !== before;
      const inUse = valuesChanged && await this.repo.isInUse(tx, id, userId);
      if (!inUse) {
        await this.repo.update(tx, a);
        return { ok: true, id, copied: false, previousId: null };
      }
      // copy-on-write: the old row keeps its values (every order / shipment / booking still points at it); the copy carries the edit and the
      // default flag (a retired default's flag moves to the copy — `unsetDefaults` above already cleared the old one when the edit sets it)
      const copy = a.copyAs(uuidv7());
      await this.repo.retire(tx, id, userId);
      await this.repo.insert(tx, copy);
      return { ok: true, id: copy.id, copied: true, previousId: id };
    }, { userId });
    return idemKey ? this.idem.remember(keyOf(`address.update:${id}`, userId, idemKey), userId, 'identity.address.update', act) : act();
  }

  list(tenantId: string, userId: string) { return this.repo.listByUser(tenantId, userId).then((rows) => rows.map((a) => a.toProps())); }

  async remove(tenantId: string, userId: string, id: string): Promise<{ ok: true; defaultId: string | null }> {
    if (!UUID.test(id)) throw notFound();
    return this.uow.run(tenantId, async (tx) => {
      const r = await this.repo.softDelete(tx, id, userId);
      if (r.outcome === 'missing') throw new DomainError('ADDRESS_NOT_FOUND', 'Address not found', 404);
      const defaultId = r.wasDefault ? await this.repo.promoteNewestDefault(tx, userId) : null;
      return { ok: true as const, defaultId };
    }, { userId });
  }
}
