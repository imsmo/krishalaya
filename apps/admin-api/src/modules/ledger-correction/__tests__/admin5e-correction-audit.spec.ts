// PC-56 ADMIN-5e · the manual correction (W068) and the audit trail (W039/W040). Pure domain only.
// The central claims: a correction cannot be posted unbalanced, by one person, or with money expressed as a
// JavaScript number; and an audit row with no recorded values must never render as "nothing changed".
import {
  DRAFT_STATUSES, OWNER_KINDS, FOUNDER_THRESHOLD_MINOR, REASON_MIN, CORRECTION_TXN_TYPE,
  balanceOf, assertLeg, parseMinor, submitState, assertSubmittable, approveState, assertApprovable,
  buildPost, formatMinor, type DraftLeg, type CorrectionDraft,
} from '../domain/correction';
import { InvalidCorrectionError, CorrectionNotApprovableError } from '../domain/ledger-correction.errors';
import { SecondPersonRequiredError } from '../../../core/approval/two-person-rule';
import {
  parseEntityRef, formatEntityRef, diffOf, diffIsEmpty, MASK, isWriteAction, isMoneyAction, matchesView,
  checkWindow, MAX_LIVE_WINDOW_DAYS, RETENTION_CLAIM, MONEY_ACTION_PREFIXES,
} from '../../compliance-ops/domain/audit-trail';

const leg = (over: Partial<DraftLeg> = {}): DraftLeg => ({
  ownerKind: 'platform', ownerId: null, accountCode: 'suspense', amountMinor: -1_245_000n, legNote: null, ...over,
});
const pair = (): DraftLeg[] => [
  leg(),
  leg({ ownerKind: 'user', ownerId: '11111111-1111-1111-1111-111111111111', accountCode: 'main', amountMinor: 1_245_000n }),
];
const draft = (over: Partial<CorrectionDraft> = {}): CorrectionDraft => ({
  id: 'd1', investigationId: 'i1', tenantId: 't1', status: 'drafting', currencyCode: 'INR',
  reason: 'Gateway capture confirmed; webhook exhausted during the 02:14 network event.',
  sourceDocument: null, idempotencyKey: 'correction:abc', makerId: 'op-a',
  submittedAt: null, checkerId: null, checkedAt: null, checkerNote: null,
  postedTxnId: null, postedAt: null, grossMinor: null, legs: pair(), ...over,
});

/* ================================================================================================ */
describe('ADMIN-5e · money is never a JavaScript number', () => {
  it('REFUSES a number outright rather than coercing it', () => {
    // Coercion is how a lossy value gets laundered into the ledger. 2^53 minor units is ~₹90,071,992,547 — reachable
    // by a platform aiming at ₹1.5 lakh crore GMV — and a float that lost its last digit still looks like money.
    expect(() => parseMinor(1245000)).toThrow(InvalidCorrectionError);
    expect(() => parseMinor(0)).toThrow(InvalidCorrectionError);
  });
  it('accepts a string of minor units and a bigint', () => {
    expect(parseMinor('1245000')).toBe(1_245_000n);
    expect(parseMinor('-1245000')).toBe(-1_245_000n);
    expect(parseMinor(' 42 ')).toBe(42n);
    expect(parseMinor(9_007_199_254_740_993n)).toBe(9_007_199_254_740_993n);
  });
  it('a value beyond float precision SURVIVES as a string', () => {
    // The number path would have returned 9007199254740992. This is the whole reason for the rule.
    expect(parseMinor('9007199254740993')).toBe(9_007_199_254_740_993n);
    expect(parseMinor('9007199254740993').toString()).toBe('9007199254740993');
  });
  it('refuses junk, decimals and absurd lengths', () => {
    expect(() => parseMinor('12.50')).toThrow(InvalidCorrectionError);
    expect(() => parseMinor('1,245,000')).toThrow(InvalidCorrectionError);
    expect(() => parseMinor('')).toThrow(InvalidCorrectionError);
    expect(() => parseMinor(null)).toThrow(InvalidCorrectionError);
    expect(() => parseMinor('1'.repeat(19))).toThrow(InvalidCorrectionError);
  });
  it('formats for display without ever becoming a number', () => {
    expect(formatMinor(1_245_000n)).toBe('₹12,450.00');
    expect(formatMinor(-1_245_000n)).toBe('−₹12,450.00');
    expect(formatMinor(5n)).toBe('₹0.05');
    expect(formatMinor(0n)).toBe('₹0.00');
  });
});

describe('ADMIN-5e · the legs', () => {
  it('a PLATFORM leg has no owner and a user leg must have one', () => {
    // Getting this wrong credits the platform suspense account instead of a named farmer's wallet. It balances
    // perfectly, the wallet-service accepts it, and it is completely wrong.
    expect(() => assertLeg({ ownerKind: 'platform', ownerId: 'u1', accountCode: 'suspense', amountMinor: '-1' })).toThrow(InvalidCorrectionError);
    expect(() => assertLeg({ ownerKind: 'user', accountCode: 'main', amountMinor: '1' })).toThrow(InvalidCorrectionError);
    expect(assertLeg({ ownerKind: 'platform', accountCode: 'suspense', amountMinor: '-1' }).ownerId).toBeNull();
  });
  it('REFUSES a zero leg — it moves nothing and the wallet-service refuses it too', () => {
    expect(() => assertLeg({ ownerKind: 'platform', accountCode: 'suspense', amountMinor: '0' })).toThrow(InvalidCorrectionError);
  });
  it('refuses an unknown owner kind and a malformed account code', () => {
    expect(() => assertLeg({ ownerKind: 'bank', accountCode: 'main', amountMinor: '1' })).toThrow(InvalidCorrectionError);
    expect(() => assertLeg({ ownerKind: 'platform', accountCode: 'Main Account', amountMinor: '1' })).toThrow(InvalidCorrectionError);
    expect(() => assertLeg({ ownerKind: 'platform', accountCode: '', amountMinor: '1' })).toThrow(InvalidCorrectionError);
  });
  it('offers exactly the three owner kinds and five statuses', () => {
    expect([...OWNER_KINDS]).toEqual(['user', 'tenant', 'platform']);
    expect([...DRAFT_STATUSES]).toEqual(['drafting', 'awaiting_checker', 'posted', 'rejected', 'withdrawn']);
  });
});

describe('ADMIN-5e · the balance', () => {
  it('a matched pair balances and reports the SIZE, not the absolute movement', () => {
    // A balanced transfer of ₹12,450 has ₹24,900 of absolute movement and is a ₹12,450 correction.
    const b = balanceOf(pair());
    expect(b).toEqual({ sumMinor: 0n, balanced: true, legCount: 2, grossMinor: 1_245_000n });
  });
  it('an unbalanced set reports the real Σ, which the screen prints', () => {
    const b = balanceOf([leg({ amountMinor: 1_245_000n })]);
    expect(b.sumMinor).toBe(1_245_000n);
    expect(b.balanced).toBe(false);
  });
  it('ONE leg is never balanced even at zero — a correction is a transfer', () => {
    // Σ = 0 with a single leg is arithmetically true and financially meaningless. Without the leg-count rule a
    // one-legged draft with a zero amount would pass, and the zero-amount guard is the only other thing stopping it.
    expect(balanceOf([]).balanced).toBe(false);
    expect(balanceOf([leg({ amountMinor: 1n })]).balanced).toBe(false);
  });
  it('handles a three-legged correction', () => {
    const b = balanceOf([leg({ amountMinor: -1000n }), leg({ amountMinor: 600n }), leg({ amountMinor: 400n })]);
    expect(b).toEqual({ sumMinor: 0n, balanced: true, legCount: 3, grossMinor: 1000n });
  });
});

describe('ADMIN-5e · SUBMITTING — the form that will not submit unbalanced', () => {
  it('REFUSES an unbalanced draft and names the shortfall', () => {
    const d = draft({ legs: [leg({ amountMinor: 1_245_000n }), leg({ amountMinor: 1n })] });
    const s = submitState(d);
    expect(s.ok).toBe(false);
    expect(!s.ok && s.reason === 'unbalanced' && s.sumMinor).toBe(1_245_001n);
    expect(() => assertSubmittable(d)).toThrow(/1245001/);
  });
  it('REFUSES a one-legged draft', () => {
    const s = submitState(draft({ legs: [leg()] }));
    expect(!s.ok && s.reason).toBe('too_few_legs');
    expect(() => assertSubmittable(draft({ legs: [leg()] }))).toThrow(InvalidCorrectionError);
  });
  it('REFUSES a thin reason — it is the only account of why money moved by hand', () => {
    expect(REASON_MIN).toBe(20);
    const s = submitState(draft({ reason: 'webhook issue' }));
    expect(!s.ok && s.reason).toBe('no_reason');
    expect(() => assertSubmittable(draft({ reason: '   ' }))).toThrow(InvalidCorrectionError);
  });
  it('REFUSES a draft that is no longer drafting', () => {
    expect(submitState(draft({ status: 'awaiting_checker' }))).toEqual({ ok: false, reason: 'not_drafting' });
    expect(submitState(draft({ status: 'posted' }))).toEqual({ ok: false, reason: 'not_drafting' });
  });
  it('ALLOWS a balanced, reasoned draft and flags the founder threshold', () => {
    expect(FOUNDER_THRESHOLD_MINOR).toBe(5_000_000n);
    const small = assertSubmittable(draft());
    expect(small).toEqual({ gross: 1_245_000n, needsFounderConfirmation: false });
    const big = assertSubmittable(draft({ legs: [leg({ amountMinor: -5_000_000n }), leg({ ownerKind: 'user', ownerId: 'u', accountCode: 'main', amountMinor: 5_000_000n })] }));
    // AT the threshold, not merely above it — "corrections above ₹50,000" read strictly would let exactly ₹50,000
    // through unannounced, which is the amount somebody would choose.
    expect(big.needsFounderConfirmation).toBe(true);
  });
});

describe('ADMIN-5e · APPROVING — the eighth maker-checker site', () => {
  const submitted = () => draft({ status: 'awaiting_checker', submittedAt: '2026-08-07T09:00:00.000Z' });
  it('REFUSES the maker approving their own correction', () => {
    expect(() => assertApprovable(submitted(), 'op-a', false)).toThrow(SecondPersonRequiredError);
    expect(() => assertApprovable(submitted(), 'op-b', false)).not.toThrow();
  });
  it('RE-VERIFIES the balance at approval time, not at submission', () => {
    // The checker approves what is in front of them NOW. A draft that balanced yesterday and does not today must
    // not post on the strength of yesterday's check.
    const drifted = draft({ status: 'awaiting_checker', legs: [leg(), leg({ amountMinor: 1n })] });
    const s = approveState(drifted);
    expect(!s.ok && s.reason).toBe('unbalanced');
    expect(() => assertApprovable(drifted, 'op-b', false)).toThrow(CorrectionNotApprovableError);
  });
  it('REFUSES a draft that was never submitted, and one already decided', () => {
    expect(approveState(draft())).toEqual({ ok: false, reason: 'not_submitted' });
    expect(approveState(draft({ status: 'awaiting_checker', checkerId: 'op-b' }))).toEqual({ ok: false, reason: 'already_decided' });
    expect(() => assertApprovable(draft(), 'op-b', false)).toThrow(CorrectionNotApprovableError);
  });
  it('REFUSES a high-value correction without the founder confirmation', () => {
    // The platform cannot page anybody, so this is a person saying they informed the founder. A weaker control than
    // paging, and an honest one — the alternative is a green tick meaning nothing on the biggest corrections.
    const big = draft({
      status: 'awaiting_checker',
      legs: [leg({ amountMinor: -7_500_000n }), leg({ ownerKind: 'user', ownerId: 'u', accountCode: 'main', amountMinor: 7_500_000n })],
    });
    expect(() => assertApprovable(big, 'op-b', false)).toThrow(CorrectionNotApprovableError);
    expect(() => assertApprovable(big, 'op-b', true)).not.toThrow();
    // …and a SMALL one does not demand it.
    expect(() => assertApprovable(submitted(), 'op-b', false)).not.toThrow();
  });
  it('an UNKNOWN maker does not create a permanent dead end', () => {
    expect(() => assertApprovable(draft({ status: 'awaiting_checker', makerId: '' as unknown as string }), 'op-b', false)).not.toThrow();
  });
  it('an unidentifiable approver is refused', () => {
    expect(() => assertApprovable(submitted(), '', false)).toThrow(SecondPersonRequiredError);
  });
});

describe('ADMIN-5e · the post', () => {
  it('maps the approved legs UNCHANGED — the posted txn is the reviewed one', () => {
    const p = buildPost(draft({ status: 'awaiting_checker' }));
    expect(p.txnType).toBe(CORRECTION_TXN_TYPE);
    expect(p.idempotencyKey).toBe('correction:abc');
    expect(p.referenceType).toBe('recon_investigation');
    expect(p.referenceId).toBe('i1');
    expect(p.legs).toHaveLength(2);
    expect(p.legs[0]).toEqual({ ownerKind: 'platform', accountCode: 'suspense', amountMinor: -1_245_000n });
    expect(p.legs[1].ownerId).toBe('11111111-1111-1111-1111-111111111111');
    // The verbatim reason travels with the money, so the ledger entry explains itself.
    expect(p.description).toContain('webhook exhausted');
  });
  it('REFUSES to build an unbalanced post — the fifth check on the same fact', () => {
    expect(() => buildPost(draft({ legs: [leg()] }))).toThrow(InvalidCorrectionError);
  });
  it('the idempotency key is the DRAFT’s, so a retry cannot post twice', () => {
    const d = draft();
    expect(buildPost(d).idempotencyKey).toBe(buildPost(d).idempotencyKey);
  });
});

/* ================================================================================================ */
describe('ADMIN-5e · W040 entity references', () => {
  it('parses the canon display form', () => {
    expect(parseEntityRef('listing/LST-2026-084497')).toEqual({ entityType: 'listing', entityId: 'LST-2026-084497' });
    expect(formatEntityRef({ entityType: 'listing', entityId: 'X' })).toBe('listing/X');
  });
  it('refuses a PATH rather than drilling into the wrong entity', () => {
    // Taking the first segment of `listing/x/y` would open a different entity's history and look like it worked.
    expect(parseEntityRef('listing/LST-1/extra')).toBeNull();
  });
  it('refuses the malformed and the empty', () => {
    expect(parseEntityRef('listing')).toBeNull();
    expect(parseEntityRef('/LST-1')).toBeNull();
    expect(parseEntityRef('listing/')).toBeNull();
    expect(parseEntityRef('Listing/LST-1')).toBeNull();   // types are lower_snake
    expect(parseEntityRef(null)).toBeNull();
    expect(parseEntityRef(42)).toBeNull();
  });
});

describe('ADMIN-5e · THE DIFF — an unrecorded change is not an unchanged row', () => {
  it('NOT_RECORDED when neither value column was written — the state of nearly every row', () => {
    // Most audit writers pass newValue only; many pass neither. "No changes" would tell an auditor that a
    // privileged action changed nothing, when the truth is nobody wrote down what it changed.
    expect(diffOf(null, null, true)).toEqual({ kind: 'not_recorded' });
    expect(diffOf(undefined, undefined, true)).toEqual({ kind: 'not_recorded' });
    expect(diffIsEmpty({ kind: 'not_recorded' })).toBe(true);
  });
  it('CREATED when only a new value exists — there is no before-state to diff', () => {
    const p = diffOf(null, { status: 'rejected' }, true);
    expect(p.kind).toBe('created');
    expect(p.kind === 'created' && p.lines).toEqual([{ kind: 'added', key: 'status', before: null, after: '"rejected"' }]);
  });
  it('renders W040s diff: changed, added and REMOVED', () => {
    const p = diffOf({ status: 'pending_qc', draft: true }, { status: 'rejected', rejected_reason: 'price 4.2x above mandi band' }, true);
    expect(p.kind).toBe('diff');
    const lines = p.kind === 'diff' ? p.lines : [];
    expect(lines).toEqual([
      // A key present in BEFORE and absent from AFTER is a removal — the direction a naive diff that iterates the
      // new object silently drops. A field that stopped existing is a change.
      { kind: 'removed', key: 'draft', before: 'true', after: null },
      { kind: 'added', key: 'rejected_reason', before: null, after: '"price 4.2x above mandi band"' },
      { kind: 'changed', key: 'status', before: '"pending_qc"', after: '"rejected"' },
    ]);
  });
  it('omits UNCHANGED keys — a diff padded with untouched fields is one nobody reads', () => {
    const p = diffOf({ a: 1, b: 2 }, { a: 1, b: 3 }, true);
    expect(p.kind === 'diff' && p.lines.map((l) => l.key)).toEqual(['b']);
  });
  it('a recorded-but-identical pair is EMPTY and that is a real, distinct state', () => {
    // A privileged action that wrote an audit row and changed nothing is reportable, and it is not `not_recorded`.
    const p = diffOf({ a: 1 }, { a: 1 }, true);
    expect(p.kind).toBe('diff');
    expect(diffIsEmpty(p)).toBe(true);
  });
  it('key order does not manufacture a change', () => {
    expect(diffIsEmpty(diffOf({ a: { x: 1, y: 2 } }, { a: { y: 2, x: 1 } }, true))).toBe(true);
  });
  it('MASKS values but keeps field names when the viewer lacks audit.values.read', () => {
    // `{"status": ▪▪▪}` says the status changed without saying to what — most of the value at none of the risk.
    // The keys in these blobs are column names our own writers chose, not user content.
    const p = diffOf({ status: 'pending_qc', phone: '+919812345210' }, { status: 'rejected' }, false);
    expect(p).toEqual({ kind: 'masked', keys: ['phone', 'status'] });
    expect(MASK).toBe('▪▪▪');
    // …and the masked panel MUST NOT carry the values anywhere in it.
    expect(JSON.stringify(p)).not.toContain('9812345210');
    expect(JSON.stringify(p)).not.toContain('pending_qc');
  });
  it('masking applies even when only ONE side was recorded', () => {
    expect(diffOf(null, { phone: '+919812345210' }, false)).toEqual({ kind: 'masked', keys: ['phone'] });
  });
  it('a non-object value is shown OPAQUE rather than given an invented field name', () => {
    const p = diffOf('before', 'after', true);
    expect(p).toEqual({ kind: 'opaque', before: '"before"', after: '"after"' });
    expect(diffOf(null, [1, 2], true).kind).toBe('opaque');
  });
});

describe('ADMIN-5e · W039 saved views', () => {
  it('WRITES ONLY defaults an unclassified action to a write', () => {
    // The asymmetry is deliberate: a new privileged action nobody has classified shows up in the view designed to
    // catch privileged actions. The opposite default would hide it.
    expect(isWriteAction('ledger.correction_posted')).toBe(true);
    expect(isWriteAction('some.brand_new_action')).toBe(true);
    expect(isWriteAction('audit.entity_trail_read')).toBe(false);
    expect(isWriteAction('trust.risk_profile_read')).toBe(false);
    expect(isWriteAction('schemes.registry_exported')).toBe(false);
    expect(isWriteAction('')).toBe(false);
  });
  it('MONEY MUTATIONS matches the namespaces money actually moves in', () => {
    expect(isMoneyAction('billing.adjustment_applied')).toBe(true);
    expect(isMoneyAction('ledger.correction_posted')).toBe(true);
    expect(isMoneyAction('wallet.account_frozen')).toBe(true);
    expect(isMoneyAction('dpdp.dsr_completed')).toBe(false);
    expect([...MONEY_ACTION_PREFIXES]).toContain('ledger.');
  });
  it('the MONEY view is money AND write — an export of money data is not a money mutation', () => {
    expect(matchesView('billing.report_exported', 'money')).toBe(false);
    expect(matchesView('billing.adjustment_applied', 'money')).toBe(true);
    expect(matchesView('billing.report_exported', 'writes')).toBe(false);
    expect(matchesView('dpdp.dsr_completed', 'all')).toBe(true);
  });
});

describe('ADMIN-5e · the date window is enforced, not suggested', () => {
  const NOW = new Date('2026-08-07T10:00:00.000Z');
  it('defaults to TODAY rather than to everything', () => {
    // Defaulting the other way turns a console query into a full scan of every partition ever created, on the table
    // that grows fastest and is never deleted from.
    const w = checkWindow(null, null, NOW);
    expect(w.ok && w.from.toISOString()).toBe('2026-08-07T00:00:00.000Z');
  });
  it('REFUSES a window wider than the live limit and says how wide', () => {
    expect(MAX_LIVE_WINDOW_DAYS).toBe(90);
    const w = checkWindow(new Date('2026-01-01T00:00:00.000Z'), NOW, NOW);
    expect(w.ok).toBe(false);
    expect(!w.ok && w.reason === 'too_wide' && w.days).toBeGreaterThan(90);
  });
  it('accepts exactly the limit', () => {
    expect(checkWindow(new Date(NOW.getTime() - 90 * 86_400_000), NOW, NOW).ok).toBe(true);
    expect(checkWindow(new Date(NOW.getTime() - 91 * 86_400_000), NOW, NOW).ok).toBe(false);
  });
  it('REFUSES an inverted or unparseable range', () => {
    expect(checkWindow(NOW, new Date('2026-01-01T00:00:00.000Z'), NOW)).toEqual({ ok: false, reason: 'inverted' });
    expect(checkWindow(new Date('nope'), NOW, NOW)).toEqual({ ok: false, reason: 'inverted' });
  });
});

describe('ADMIN-5e · the retention claim is half true and says which half', () => {
  it('IMMUTABLE is claimed and is a database fact; SEVEN YEARS is not enforced', () => {
    // W039 prints "7-year immutable retention". UPDATE and DELETE are revoked, so immutable holds. Nothing enforces
    // the seven years, and the retention worker's only verb is deletion — which must never run on this table.
    expect(RETENTION_CLAIM.immutable).toBe(true);
    expect(RETENTION_CLAIM.yearsEnforced).toBe(false);
    expect(RETENTION_CLAIM.immutableBasis).toContain('revoked');
    expect(RETENTION_CLAIM.yearsBasis).toContain('deletion only');
  });
});
