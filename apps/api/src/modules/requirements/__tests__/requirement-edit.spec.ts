// modules/requirements/__tests__/requirement-edit.spec.ts · pure-domain tests for the W4-01 buyer-edit
// path: Requirement.editDetails (open-only, invariants re-validated, Updated emitted). The PATCH endpoint
// + RLS are covered by the module integration spec.
import { Requirement } from '../domain/requirement.entity';
import { RequirementEventType } from '../domain/requirements.events';
import { InvalidRequirementError, RequirementNotOpenError } from '../domain/requirements.errors';

function open() {
  return Requirement.post({ id: 'r1', tenantId: 't1', buyerUserId: 'b1', categoryId: 'c1', title: 'Need wheat', quantity: '10', unitCode: 'kg', budgetMinMinor: 100n, budgetMaxMinor: 200n });
}

describe('Requirement.editDetails', () => {
  it('updates fields + clears nullable target, and emits Updated', () => {
    const r = open(); r.pullEvents();
    r.editDetails({ title: 'Need durum wheat', quantity: '12', categoryId: null, productId: 'p9', isUrgent: true });
    const p = r.toProps();
    expect(p.title).toBe('Need durum wheat');
    expect(p.quantity).toBe('12');
    expect(p.categoryId).toBeNull();
    expect(p.productId).toBe('p9');
    expect(p.isUrgent).toBe(true);
    expect(r.pullEvents().map((e) => e.type)).toContain(RequirementEventType.Updated);
  });
  it('re-validates invariants (bad qty, budget min>max)', () => {
    expect(() => open().editDetails({ quantity: '0' })).toThrow(InvalidRequirementError);
    expect(() => open().editDetails({ budgetMinMinor: 500n, budgetMaxMinor: 100n })).toThrow(InvalidRequirementError);
    expect(() => open().editDetails({ title: '   ' })).toThrow(InvalidRequirementError);
  });
  it('PC-56 TENANT-11d · a partly filled requirement cannot shrink to what buyers already accepted', () => {
    const r = open(); r.recordAccepted(4_000n, ['resp1']);
    expect(() => r.editDetails({ quantity: '4' })).toThrow(InvalidRequirementError);
    r.editDetails({ quantity: '4.5' }); expect(r.toProps().quantity).toBe('4.5');
  });
  it('refuses to edit once the requirement has left the accepting state', () => {
    const r = open(); r.recordAccepted(10_000n, ['resp1']);
    expect(() => r.editDetails({ title: 'too late' })).toThrow(RequirementNotOpenError);
  });
});
