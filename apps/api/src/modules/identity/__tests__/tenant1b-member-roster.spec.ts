// modules/identity/__tests__/tenant1b-member-roster.spec.ts · PC-56 TENANT-1b.
//
// W153 is the most-used screen in an FPO console and it did not exist — `/members` in web-tenant is PC-28's paid
// membership-TIER manager, a different object sharing a word. This suite pins the two things the roster must not get
// wrong: **the phone is masked before it leaves the database layer**, and **every query is bounded for a platform aiming
// at 75M households**.
import { MemberRosterReadModel, maskPhone } from '../read-models/member-roster.read-model';

function harness(rows: any[] = []) {
  const query = jest.fn().mockResolvedValue({ rows });
  const replica = { forTenant: jest.fn(() => ({ query })) };
  return { rm: new MemberRosterReadModel(replica as any), query };
}

describe('TENANT-1b · the phone is masked in the read model, not in the template', () => {
  // Masking in a component would mean the full number crossed the wire and sat in a server-rendered payload, a browser
  // cache and a log. Masking here means the console cannot leak what it never received.
  // **PINNED TO THE EXACT STRING, and a mutation run is why.** Replacing the hidden middle with the real digits passed
  // an earlier, looser version of this test — because that version only checked "starts with +91, ends with 114,
  // contains a dot", which the leaking version also satisfies. Worse, it revealed that the implementation and its own
  // doc comment disagreed: the comment claimed the canon's `+91 96••• ••114` and the code produced `+91 ••••• ••114`.
  // The canon's format won (every screen uses it; a field officer needs two leading digits to tell two Bhais apart), and
  // the assertion is now the whole string so neither can drift again.
  it('masks to the canon’s exact shape', () => {
    expect(maskPhone('+919611411114')).toBe('+91 96••• ••114');
    expect(maskPhone('+919788111881')).toBe('+91 97••• ••881');
    // No country code on the input: no country code invented on the output.
    expect(maskPhone('9611411114')).toBe('96••• ••114');
  });

  it('keeps only the last three digits, whatever the input formatting', () => {
    for (const raw of ['+91 96114 11114', '919611411114', '96114-11114']) {
      const masked = maskPhone(raw);
      expect(masked).toMatch(/114$/);
      // Five of ten digits at most, and never four in a row on screen — the middle five are always hidden, so the
      // number cannot be read off the mask however it was formatted on the way in.
      expect(masked).not.toMatch(/[0-9]{4,}/);
      expect(masked).toContain('••• ••');
    }
  });

  it('reveals NOTHING from a number too short to mask meaningfully', () => {
    // A malformed row must not leak by falling through to "print it".
    expect(maskPhone('12345')).toBe('•••');
    expect(maskPhone('1234567')).toBe('•••');   // seven digits cannot show 2 + 3 and still hide a middle
    expect(maskPhone('')).toBe('•••');
    expect(maskPhone('abc')).toBe('•••');
  });

  it('never returns the raw phone on a roster row', async () => {
    const h = harness([{
      user_id: 'u1', full_name: 'Kanji Bhai R.', phone: '+919611411114', village_name: 'Bhesan',
      language_code: 'gu', last_active_at: null, roles: [], received_minor: '3820000',
    }]);
    const rows = await h.rm.list('t1', { limit: 25 });
    expect(rows[0].phoneMasked).not.toContain('9611411');
    expect(JSON.stringify(rows[0])).not.toContain('+919611411114');
    // Money crosses as a STRING of minor units (Law 2) — never a JS number on a value that will be summed.
    expect(rows[0].lifetimeReceivedMinor).toBe('3820000');
    expect(typeof rows[0].lifetimeReceivedMinor).toBe('string');
  });
});

describe('TENANT-1b · every query is bounded for 75M households', () => {
  it('pages by keyset and never by OFFSET', async () => {
    const h = harness();
    await h.rm.list('t1', { limit: 25, cursor: { name: 'Meera Ben J.', id: 'u9' } });
    const sql = h.query.mock.calls[0][0];
    expect(sql).not.toMatch(/OFFSET/i);
    // The tie-break on id is what makes the page stable when two members share a name — and in a roster of Bhais and
    // Bens, they do.
    expect(sql).toMatch(/\(u\.full_name, u\.id\) >/);
  });

  it('picks the page FIRST and joins roles to it, rather than aggregating the whole table', async () => {
    const h = harness();
    await h.rm.list('t1', { limit: 25 });
    const sql = h.query.mock.calls[0][0];
    expect(sql).toMatch(/WITH page AS \(/);
    expect(sql).toMatch(/LIMIT \$\d+\s*\)/);
    // Roles come back as ONE json aggregate — the alternative is a query per row, which is 25 round trips on this page
    // and an outage at scale.
    expect(sql).toMatch(/json_agg\(json_build_object\('roleCode'/);
    expect(h.query).toHaveBeenCalledTimes(1);
  });

  it('scopes every query to the tenant (Law 1) and reads the replica', async () => {
    const h = harness();
    await h.rm.list('t1', { limit: 25 });
    expect(h.query.mock.calls[0][1][0]).toBe('t1');
    expect(h.query.mock.calls[0][0]).toMatch(/utr\.tenant_id = \$1/);
  });

  it('searches name and phone through the indexed columns', async () => {
    const h = harness();
    await h.rm.list('t1', { limit: 25, q: 'કાનજી' });
    const sql = h.query.mock.calls[0][0];
    // ILIKE over the trigram-indexed full_name is what makes a Gujarati spelling variant findable (W153's own claim);
    // the phone is matched on the same term so one box serves both.
    expect(sql).toMatch(/u\.full_name ILIKE/);
    expect(sql).toMatch(/u\.phone LIKE/);
    expect(h.query.mock.calls[0][1]).toContain('%કાનજી%');
  });

  it('filters by role and by KYC status as "has an active role like this"', async () => {
    const h = harness();
    await h.rm.list('t1', { limit: 25, roleCode: 'farmer', kycStatus: 'pending' });
    const sql = h.query.mock.calls[0][0];
    expect(sql).toMatch(/EXISTS \(SELECT 1 FROM user_tenant_roles x/);
    expect(sql).toMatch(/y\.kyc_status = \$\d+::kyc_status/);
    // A KYC filter that meant "the person is pending" would be meaningless on a multi-role member — which is the whole
    // reason this screen says "kyc: pending" rather than "member: pending".
    expect(sql).toMatch(/y\.is_active/);
  });

  it('treats a member with no address as a member, not a broken row', async () => {
    const h = harness();
    await h.rm.list('t1', { limit: 25 });
    // LEFT JOIN: paper-first onboarding is the norm in an SHG federation, and a missing address must not drop the person
    // off the roster their payouts depend on.
    expect(h.query.mock.calls[0][0]).toMatch(/LEFT JOIN addresses ad/);
    expect(h.query.mock.calls[0][0]).toMatch(/ad\.is_default = true/);
  });
});

describe('TENANT-1b · the census counts what W153 claims it counts', () => {
  it('counts fully verified as EVERY active role verified', async () => {
    const h = harness([{ active_members: 1284, fully_verified: 1146, active_30d: 918, dormant: 61 }]);
    const c = await h.rm.census('t1');
    expect(c).toMatchObject({ activeMembers: 1284, fullyVerified: 1146, activeLast30d: 918 });
    const sql = h.query.mock.calls[0][0];
    // The comparison is the whole point: counting people with ANY verified role would produce the flattering number the
    // old money gate implied, and would have told a tenant that a worker-verified member was compliant while his farmer
    // verification sat pending.
    expect(sql).toMatch(/active_roles = verified_roles/);
    expect(sql).toMatch(/FILTER \(WHERE utr\.is_active AND utr\.kyc_status = 'verified'\)/);
  });

  it('returns the voice-first share as NULL, because nothing records modality', async () => {
    // W153 prints "Voice-first users · 64%". `users.language_code` says which LANGUAGE, not which modality — a share
    // derived from it would be a different quantity wearing this one's label. Eighth refusal of that substitution.
    const h = harness([{ active_members: 1, fully_verified: 1, active_30d: 1, dormant: 0 }]);
    expect((await h.rm.census('t1')).voiceFirstShare).toBeNull();
  });
});
