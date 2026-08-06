// PC-56 ADMIN-5 · the erasure console helpers. Pure, framework-free.
// The governing rule: NEVER RENDER A REASSURING DEFAULT. An unmeasured SLA is not a met one, an empty scope is not
// "nothing will be kept", and an unevidenced erasure is not a completed one.
import {
  isRejectionGround, groundIsFixableByPrincipal, slaClass, slaKey, cleanRecordClaimable,
  scopeKey, actionClass, rowsText, hasUnrunnableActions, completeOfferable, evidenceProgressPct, evidenceClass,
  buildReject, buildRecordAction, queueTypeFilter, queueStatusFilter,
  REJECTION_GROUNDS, type ScopeResult, type CompletionCheck, type SlaState,
} from '../features/compliance/erasure';

const scope = (over: Partial<Extract<ScopeResult, { kind: 'scope' }>> = {}): ScopeResult => ({
  kind: 'scope',
  lines: [
    { dataClass: 'users', action: 'delete', legalBasis: null, keptByLaw: false, retainedMonths: 0, rows: null },
    { dataClass: 'ledger_entries', action: 'keep_forever', legalBasis: 'RBI PSS — 10 years', keptByLaw: true, retainedMonths: null, rows: null },
  ],
  keptByLawCount: 1, deletableCount: 1, unrunnable: [],
  ...over,
});

describe('ADMIN-5 console · the SLA clocks', () => {
  it('UNMEASURED is a warning — not a pass and not a failure', () => {
    // Not a pass, because "0 breaches" over an unread clock is an absent measurement wearing a clean record's clothes.
    // Not a failure, because nobody breached anything.
    expect(slaClass({ kind: 'unmeasured' })).toContain('warn');
    expect(slaClass({ kind: 'unmeasured' })).not.toContain('--ok');
    expect(slaClass({ kind: 'unmeasured' })).not.toContain('danger');
  });
  it('met is positive, breached is a failure', () => {
    expect(slaClass({ kind: 'met' })).toContain('ok');
    expect(slaClass({ kind: 'breached', hoursOver: 3 })).toContain('danger');
  });
  it('a deadline inside twelve hours is urgent', () => {
    expect(slaClass({ kind: 'due', hoursLeft: 6 })).toContain('danger');
    expect(slaClass({ kind: 'due', hoursLeft: 20 })).toContain('warn');
    expect(slaClass({ kind: 'due', hoursLeft: 48 })).toContain('ok');
  });
  it('a missing state is muted, never treated as met', () => {
    expect(slaClass(null)).toContain('muted');
    expect(slaKey(undefined)).toBe('unmeasured');
    expect(slaKey({ kind: 'met' } as SlaState)).toBe('met');
  });
  it('the CLEAN RECORD claim needs zero breaches AND zero unmeasured', () => {
    expect(cleanRecordClaimable({ breached: 0, due: 2, met: 40, unmeasured: 0 })).toBe(true);
    // The case W041 would have shown as "clean record · 0" before migration 0107: no breaches, because no clock existed.
    expect(cleanRecordClaimable({ breached: 0, due: 0, met: 0, unmeasured: 23 })).toBe(false);
    expect(cleanRecordClaimable({ breached: 1, due: 0, met: 40, unmeasured: 0 })).toBe(false);
    expect(cleanRecordClaimable(null)).toBe(false);
  });
});

describe('ADMIN-5 console · the scope panel', () => {
  it('NO POLICY is its own state, never an empty table', () => {
    expect(scopeKey({ kind: 'no_policy' })).toBe('noPolicy');
    expect(scopeKey({ kind: 'all_inactive', policyCount: 3 })).toBe('allInactive');
    expect(scopeKey(scope())).toBe('scope');
    expect(scopeKey(null)).toBe('unknown');
  });
  it('keep_forever is NOT a failure colour — the law working is not the platform refusing', () => {
    expect(actionClass('keep_forever')).toContain('muted');
    expect(actionClass('keep_forever')).not.toContain('danger');
    expect(actionClass('delete')).toContain('ok');
    expect(actionClass('archive')).toContain('warn');
  });
  it('an uncounted class reports "not counted" rather than 0', () => {
    expect(rowsText(null)).toEqual({ known: false, n: 0 });
    expect(rowsText(undefined)).toEqual({ known: false, n: 0 });
    expect(rowsText(-1)).toEqual({ known: false, n: 0 });
    // 0 IS a real answer when we counted
    expect(rowsText(0)).toEqual({ known: true, n: 0 });
    expect(rowsText(368)).toEqual({ known: true, n: 368 });
  });
  it('flags the actions the platform has no pipeline for', () => {
    expect(hasUnrunnableActions(scope())).toBe(false);
    expect(hasUnrunnableActions(scope({ unrunnable: ['anonymise'] }))).toBe(true);
    expect(hasUnrunnableActions({ kind: 'no_policy' })).toBe(false);
    expect(hasUnrunnableActions(null)).toBe(false);
  });
});

describe('ADMIN-5 console · the Complete control is ABSENT until the erasure is evidenced', () => {
  const notEvidenced: CompletionCheck = { ok: false, reason: 'missing_evidence', missing: ['users'], classesInScope: 2 };

  it('is not offered when classes are unevidenced', () => {
    // A Complete button that always 409s teaches an operator the guard is noise.
    expect(completeOfferable(notEvidenced, 'erasure')).toBe(false);
  });
  it('is not offered when there is no scope to check against', () => {
    expect(completeOfferable({ ok: false, reason: 'no_scope' }, 'erasure')).toBe(false);
  });
  it('is not offered when the check is MISSING — silence must not read as satisfied', () => {
    expect(completeOfferable(null, 'erasure')).toBe(false);
    expect(completeOfferable(undefined, 'erasure')).toBe(false);
  });
  it('IS offered once every class is evidenced', () => {
    expect(completeOfferable({ ok: true, classesEvidenced: 2 }, 'erasure')).toBe(true);
  });
  it('non-erasure requests carry no evidence requirement', () => {
    // An access or portability request is discharged by producing a bundle, not by deleting anything.
    expect(completeOfferable(null, 'access')).toBe(true);
    expect(completeOfferable(notEvidenced, 'portability')).toBe(true);
  });
  it('progress guards divide-by-zero and clamps', () => {
    expect(evidenceProgressPct(null)).toBe(0);
    expect(evidenceProgressPct({ ok: false, reason: 'no_scope' })).toBe(0);
    expect(evidenceProgressPct({ ok: false, reason: 'missing_evidence', missing: [], classesInScope: 0 })).toBe(0);
    expect(evidenceProgressPct(notEvidenced)).toBe(50);
    expect(evidenceProgressPct({ ok: true, classesEvidenced: 2 })).toBe(100);
  });
  it('blocked_by_law is NOT styled as a failure — it records something done correctly', () => {
    expect(evidenceClass('blocked_by_law')).toContain('muted');
    expect(evidenceClass('blocked_by_law')).not.toContain('danger');
    expect(evidenceClass('deleted')).toContain('ok');
    expect(evidenceClass('retracted')).toContain('danger');
    expect(evidenceClass('something_new')).toContain('muted');
  });
});

describe('ADMIN-5 console · rejection grounds', () => {
  it('accepts only the three lawful grounds', () => {
    for (const g of REJECTION_GROUNDS) expect(isRejectionGround(g)).toBe(true);
    expect(isRejectionGround('too_expensive')).toBe(false);
    expect(isRejectionGround(null)).toBe(false);
  });
  it('labels whether the farmer can fix it themselves', () => {
    expect(groundIsFixableByPrincipal('identity_unverified')).toBe(true);
    expect(groundIsFixableByPrincipal('legal_hold')).toBe(false);
  });
  it('checks the GROUND before the explanation — asserted with BOTH fields wrong', () => {
    // A rejection with a good explanation and no lawful ground is unlawful; one with a ground and a thin explanation is
    // merely unhelpful. Reporting the resolution first would hide the one that matters.
    //
    // AND THE ORDERING CAN ONLY BE TESTED WITH BOTH FIELDS INVALID. My first version passed a VALID resolution, so a
    // mutant that checked the resolution first returned 'ground' anyway and survived — the identical weakness ADMIN-3c
    // found in its source-checked-first test. Standing lesson: to assert "X is checked before Y", break X AND Y.
    const bothWrong = buildReject({ ground: 'too_expensive', resolution: 'x' });
    expect(!bothWrong.ok && bothWrong.error).toBe('ground');
    const blankBoth = buildReject({ ground: '', resolution: '' });
    expect(!blankBoth.ok && blankBoth.error).toBe('ground');
    // and a good explanation still cannot rescue an unlawful ground
    const r = buildReject({ ground: '', resolution: 'a perfectly detailed explanation of our reasoning' });
    expect(!r.ok && r.error).toBe('ground');
  });
  it('still requires an explanation', () => {
    const r = buildReject({ ground: 'legal_hold', resolution: 'x' });
    expect(!r.ok && r.error).toBe('resolution');
  });
  it('builds a valid rejection', () => {
    const r = buildReject({ ground: 'identity_unverified', resolution: 'OTP re-auth failed three times' });
    expect(r.ok && r.value).toEqual({ action: 'reject', resolution: 'OTP re-auth failed three times', rejectionGround: 'identity_unverified' });
  });
});

describe('ADMIN-5 console · recording an erasure action', () => {
  it('refuses a DELETED against a class the law requires us to keep', () => {
    // The single most consequential mistake available on this screen, and it gets its own error key so the operator is
    // told which rule they hit rather than "invalid".
    const r = buildRecordAction({ dataClass: 'ledger_entries', action: 'deleted', rowsAffected: '1204' }, scope());
    expect(!r.ok && r.error).toBe('lawMismatch');
  });
  it('refuses BLOCKED_BY_LAW against a class no law protects', () => {
    const r = buildRecordAction({ dataClass: 'users', action: 'blocked_by_law' }, scope());
    expect(!r.ok && r.error).toBe('lawMismatch');
  });
  it('accepts the lawful pairing in both directions', () => {
    expect(buildRecordAction({ dataClass: 'users', action: 'deleted', rowsAffected: '14' }, scope()).ok).toBe(true);
    expect(buildRecordAction({ dataClass: 'ledger_entries', action: 'blocked_by_law' }, scope()).ok).toBe(true);
  });
  it('leaves the law check to the server when no scope is available', () => {
    // A Server Action does not hold the page's scope; passing null must not invent a verdict.
    expect(buildRecordAction({ dataClass: 'ledger_entries', action: 'deleted' }, null).ok).toBe(true);
  });
  it('a BLANK count is zero, and zero is legitimate', () => {
    // A class the farmer had no rows in was still CHECKED — the difference between "nothing there" and "never looked".
    const r = buildRecordAction({ dataClass: 'users', action: 'deleted', rowsAffected: '' }, scope());
    expect(r.ok && r.value.rowsAffected).toBe(0);
  });
  it('refuses a non-numeric count and a bad class name', () => {
    expect(buildRecordAction({ dataClass: 'users', action: 'deleted', rowsAffected: 'all' }, scope()).ok).toBe(false);
    expect(buildRecordAction({ dataClass: 'Users', action: 'deleted' }, scope()).ok).toBe(false);
    expect(buildRecordAction({ dataClass: 'u', action: 'deleted' }, scope()).ok).toBe(false);
  });
  it('refuses an unrecognised action', () => {
    expect(buildRecordAction({ dataClass: 'users', action: 'shredded' }, scope()).ok).toBe(false);
  });
});

describe('ADMIN-5 console · queue filters drop unknown values', () => {
  it('an unrecognised type or status is dropped, not passed through', () => {
    // A silently ignored filter shows a DPO every rights request on the platform while the chip claims one type.
    expect(queueTypeFilter('erasure')).toBe('erasure');
    expect(queueTypeFilter('deletion')).toBeUndefined();
    expect(queueTypeFilter(null)).toBeUndefined();
    expect(queueStatusFilter('in_progress')).toBe('in_progress');
    expect(queueStatusFilter('closed')).toBeUndefined();
  });
});
