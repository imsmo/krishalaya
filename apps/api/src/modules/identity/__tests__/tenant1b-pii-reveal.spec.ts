// modules/identity/__tests__/tenant1b-pii-reveal.spec.ts · PC-56 TENANT-1b.
//
// W153: "PII stays masked — **full reveal is per-field, recorded, and reasoned**." Three words, three controls, and this
// suite holds each one down separately — because a reveal that is recorded but not per-field, or per-field but not
// recorded, is not the control the screen describes.
import { MemberPiiService, REVEALABLE_FIELDS, isRevealableField, MIN_REASON_LENGTH } from '../services/member-pii.service';

const MEMBER = { phone: '+919611411114', email: 'kanji@example.com', aadhaar_last4: '4321' };

// **`null` MEANS NO ROW AND `undefined` WOULD NOT.** Passing `undefined` to a defaulted parameter selects the DEFAULT —
// so the "member outside the tenant" test initially exercised the happy path and passed a reveal it was asserting could
// not happen. A default that swallows the very case you are testing is worth spelling out rather than fixing quietly.
function harness(row: Record<string, string | null> | null = MEMBER, auditThrows = false) {
  const query = jest.fn().mockResolvedValue({ rows: row ? [row] : [] });
  const replica = { forTenant: jest.fn(() => ({ query })) };
  // The parameter is DECLARED on the implementation so `calls[0][0]` is typed — an untyped `jest.fn(async () => …)`
  // infers a zero-argument tuple, and every assertion in this suite is about the audit ENTRY.
  const log = jest.fn(async (entry: Record<string, unknown>) => {
    void entry;   // declared for its TYPE: an untyped jest.fn() infers a zero-arg tuple and `calls[0][0]` becomes never
    if (auditThrows) throw new Error('audit_log unreachable');
  });
  const svc = new MemberPiiService(replica as any, { log } as any);
  return { svc, query, log };
}

const actor = { userId: 'staff-1', canRevealPii: true, ip: '10.0.0.9', requestId: 'req-1' };
const REASON = 'Farmer called about a stuck payout and asked for a callback today.';

describe('TENANT-1b · PER-FIELD', () => {
  it('reveals exactly the field asked for', async () => {
    const h = harness();
    expect(await h.svc.revealField('t1', actor, 'u1', 'phone', REASON))
      .toEqual({ field: 'phone', value: '+919611411114' });
    expect(await h.svc.revealField('t1', actor, 'u1', 'email', REASON))
      .toEqual({ field: 'email', value: 'kanji@example.com' });
  });

  // **A CLOSED LIST, NOT A COLUMN NAME FROM THE REQUEST.** An open parameter would be a SQL-shaped hole with an audit
  // row attached, and `pan_vault_ref` must be a refusal rather than a lookup.
  it('refuses a field that is not on the list', async () => {
    const h = harness();
    for (const bad of ['pan_vault_ref', 'aadhaar_vault_ref', 'password', 'id']) {
      await expect(h.svc.revealField('t1', actor, 'u1', bad, REASON)).rejects.toThrow(/not a revealable field/);
    }
    expect(h.log).not.toHaveBeenCalled();
    expect(isRevealableField('phone')).toBe(true);
    expect(isRevealableField('pan_vault_ref')).toBe(false);
  });

  it('never selects a vault reference, even for a field that is allowed', async () => {
    const h = harness();
    await h.svc.revealField('t1', actor, 'u1', 'phone', REASON);
    const sql = h.query.mock.calls[0][0];
    // The raw Aadhaar and PAN never leave the vault (0003's own rule); the query must not even name their refs.
    expect(sql).not.toMatch(/aadhaar_vault_ref|pan_vault_ref/);
    expect(sql).toMatch(/u\.phone, u\.email, u\.aadhaar_last4/);
  });

  it('returns "nothing on file" as a value rather than an error', async () => {
    // Plenty of farmers have no email. Telling staff so saves them asking twice.
    const h = harness({ ...MEMBER, email: null });
    expect(await h.svc.revealField('t1', actor, 'u1', 'email', REASON)).toEqual({ field: 'email', value: null });
  });
});

describe('TENANT-1b · RECORDED — and the record is the control', () => {
  it('writes the audit row with the actor, the reason, the ip and the field', async () => {
    const h = harness();
    await h.svc.revealField('t1', actor, 'u1', 'phone', REASON);
    expect(h.log).toHaveBeenCalledTimes(1);
    expect(h.log.mock.calls[0]![0]).toMatchObject({
      tenantId: 't1', actorUserId: 'staff-1', action: 'member.pii_revealed',
      entityType: 'user', entityId: 'u1', reason: REASON, ip: '10.0.0.9', requestId: 'req-1',
    });
  });

  // **THE REVEALED VALUE IS NOT IN THE AUDIT ROW.** Logging it would turn the audit log — retained for years and read by
  // more people than the roster — into a second copy of the PII it exists to police.
  it('records THAT a field was revealed, never the value', async () => {
    const h = harness();
    await h.svc.revealField('t1', actor, 'u1', 'phone', REASON);
    const entry = h.log.mock.calls[0]![0];
    expect(entry.newValue).toEqual({ field: 'phone', revealed: true });
    expect(JSON.stringify(entry)).not.toContain('9611411114');
  });

  // **AND A FAILURE TO RECORD REFUSES THE REVEAL.** The ADMIN-9b rule, and here for the same reason: a reveal nobody can
  // prove happened is indistinguishable from a leak. Deliberately the OPPOSITE of ADMIN-SWEEP's circuit recorder, which
  // never throws — there the breaker was the control and the row was the report; here the row IS the control.
  it('returns NO PII when the audit write fails', async () => {
    const h = harness(MEMBER, true);
    await expect(h.svc.revealField('t1', actor, 'u1', 'phone', REASON)).rejects.toThrow(/audit_log unreachable/);
  });
});

describe('TENANT-1b · REASONED', () => {
  it('demands a reason of real length', async () => {
    const h = harness();
    for (const bad of ['', 'support', 'called him', 'x'.repeat(MIN_REASON_LENGTH - 1)]) {
      await expect(h.svc.revealField('t1', actor, 'u1', 'phone', bad)).rejects.toThrow(/reason of at least/);
    }
    expect(h.log).not.toHaveBeenCalled();
  });

  it('trims before measuring, so whitespace is not a reason', async () => {
    const h = harness();
    await expect(h.svc.revealField('t1', actor, 'u1', 'phone', '   '.repeat(20))).rejects.toThrow(/reason of at least/);
  });

  it('stores the trimmed reason', async () => {
    const h = harness();
    await h.svc.revealField('t1', actor, 'u1', 'phone', `  ${REASON}  `);
    expect(h.log.mock.calls[0]![0].reason).toBe(REASON);
  });
});

describe('TENANT-1b · the grant and the tenant boundary', () => {
  it('refuses without member.pii.reveal, before touching the database', async () => {
    // Seeing that a member exists and seeing how to telephone them are different acts. One grant covering both would
    // make the masking a formality.
    const h = harness();
    await expect(h.svc.revealField('t1', { ...actor, canRevealPii: false }, 'u1', 'phone', REASON))
      .rejects.toThrow(/member\.pii\.reveal/);
    expect(h.query).not.toHaveBeenCalled();
    expect(h.log).not.toHaveBeenCalled();
  });

  /**
   * **WITHOUT THE MEMBERSHIP JOIN, A TENANT'S STAFF COULD REVEAL ANY USER'S PHONE BY ID** — every farmer of every other
   * FPO on the platform. RLS is the net; this join is the intent, and Law 1 wants both.
   */
  it('requires an ACTIVE role in THIS tenant', async () => {
    const h = harness();
    await h.svc.revealField('t1', actor, 'u1', 'phone', REASON);
    const sql = h.query.mock.calls[0][0];
    expect(sql).toMatch(/EXISTS \(SELECT 1 FROM user_tenant_roles utr/);
    expect(sql).toMatch(/utr\.tenant_id = \$2/);
    expect(sql).toMatch(/utr\.is_active = true/);
    expect(h.query.mock.calls[0][1]).toEqual(['u1', 't1']);
  });

  it('404s a member outside the tenant rather than 403ing them', async () => {
    // "That person exists but is not yours" is an enumeration oracle across tenants.
    const h = harness(null);
    await expect(h.svc.revealField('t1', actor, 'u-other', 'phone', REASON)).rejects.toThrow(/not found in this organisation/);
    expect(h.log).not.toHaveBeenCalled();
  });

  it('exposes exactly three revealable fields', () => {
    // A list that grows silently is a list nobody reviews. If a fourth field is ever added, this assertion is the
    // conversation.
    expect([...REVEALABLE_FIELDS]).toEqual(['phone', 'email', 'aadhaar_last4']);
  });
});
