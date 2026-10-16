// modules/identity/domain/address.entity.ts · user/tenant address book entry.
import { DomainError } from '../../../shared/errors/app-error';
export interface AddressProps {
  id: string; userId: string | null; tenantId: string | null; labelId: string | null;
  line1: string; line2: string | null; village: string | null; regionId: string | null;
  pincode: string | null; countryCode: string; lat: number | null; lng: number | null;
  contactName: string | null; contactPhone: string | null; isDefault: boolean;
}
export class Address {
  private constructor(private props: AddressProps) {}
  static create(input: Omit<AddressProps, 'isDefault'> & { isDefault?: boolean }): Address {
    if (!input.line1 || input.line1.trim().length < 3) throw new DomainError('ADDRESS_INVALID', 'line1 is required', 422);
    if (input.pincode && !/^\d{4,10}$/.test(input.pincode)) throw new DomainError('ADDRESS_INVALID', 'invalid pincode', 422);
    return new Address({ ...input, isDefault: input.isDefault ?? false });
  }
  static rehydrate(p: AddressProps): Address { return new Address(p); }
  get id() { return this.props.id; }
  toProps(): Readonly<AddressProps> { return Object.freeze({ ...this.props }); }
  // PC-56 HOTFIX-6 · B4: `countryCode` is editable (the UPDATE used to omit it — a wrong country could never be corrected). Undefined keys are
  // dropped, so a partial patch never blanks a field it did not name.
  update(patch: Partial<Pick<AddressProps,'line1'|'line2'|'village'|'regionId'|'pincode'|'countryCode'|'lat'|'lng'|'contactName'|'contactPhone'|'labelId'>>): void {
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) (this.props as unknown as Record<string, unknown>)[k] = v;
    if (!this.props.line1 || this.props.line1.trim().length < 3) throw new DomainError('ADDRESS_INVALID', 'line1 is required', 422);
    if (this.props.pincode && !/^\d{4,10}$/.test(this.props.pincode)) throw new DomainError('ADDRESS_INVALID', 'invalid pincode', 422);
  }
  /** PC-56 HOTFIX-6 · B3 (copy-on-write): the edited COPY of an address in use — a new id, the same owner, every current value (the edit
   *  already applied), the default flag carried over. The old row is retired by the repository, untouched otherwise. */
  copyAs(id: string): Address { return new Address({ ...this.props, id }); }
  unsetDefault(): void { this.props.isDefault = false; }
  makeDefault(): void { this.props.isDefault = true; }
}
