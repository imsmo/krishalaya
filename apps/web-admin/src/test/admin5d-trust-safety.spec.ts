// PC-56 ADMIN-5d · the trust & safety console helpers. Pure, framework-free.
// The governing rule for this plane: NEVER SHOW A RESTRICTION THE PLATFORM DOES NOT APPLY, and never show a number
// the platform does not actually produce. Both failure directions here are FLATTERING ones — an enforced-looking
// band, a zero where nothing is measured — which is why they are typed rather than remembered.
import {
  IDENTIFIER_TYPES, blockStateTone, attemptsText, countersignOfferable, buildAddBlock, REASON_MIN,
  approveBlockedKey, firedText, driftTone, dryRunState, buildPropose,
  RISK_BANDS, bandTone, readingTone, equationRenderable, equationText, factorNoticeKey,
  effectTone, advisoryBannerVisible, buildBandChange, blockOfferable, shareText, censusShortfall, BAND_REASON_MIN,
  tileValue, tileText, slaTone, attentionTone, allQuiet, unreadSources, sampleNote,
  type BlockRow, type ProposalView, type FactorPanel, type BandEffect, type SourcesRead, type AttentionItem,
} from '../features/trust/trust-safety';

const READ: SourcesRead = { reports: true, appeals: true, blocklist: true, risk: true };

/* ================================================================================================ */
describe('ADMIN-5d console · the blocklist', () => {
  it('an UNBOUNDED block is a failure colour — W096 prohibits indefinite blocks without review', () => {
    expect(blockStateTone('unbounded')).toBe('danger');
    // EXPIRED is muted, not a failure: it lapsed, which is the rule working.
    expect(blockStateTone('expired')).toBe('neutral');
    expect(blockStateTone('lifted')).toBe('neutral');
    expect(blockStateTone('active')).toBe('success');
    expect(blockStateTone(null)).toBe('neutral');
    expect(blockStateTone(undefined)).toBe('neutral');
  });
  it('ATTEMPTS IS A DASH, NEVER 0 — nothing on the platform reads this list', () => {
    // "0 attempts blocked" says the block is installed and nobody has tried. Nothing is checking.
    expect(attemptsText({ known: false, reason: 'x' })).toEqual({ known: false, text: '—' });
    expect(attemptsText(null)).toEqual({ known: false, text: '—' });
    // …and if an enforcer ever does count, a real 0 renders as 0.
    expect(attemptsText({ known: true, value: 0 })).toEqual({ known: true, text: '0' });
    expect(attemptsText({ known: true, value: 1204 })).toEqual({ known: true, text: '1204' });
    // A "known" value that is not a finite number must not render as a number.
    expect(attemptsText({ known: true, value: Number.NaN } as BlockRow['attempts']).known).toBe(false);
  });
  it('countersign is ABSENT to whoever added the block, and once signed', () => {
    expect(countersignOfferable('op-a', 'op-a', false)).toBe(false);
    expect(countersignOfferable('op-a', 'op-b', false)).toBe(true);
    expect(countersignOfferable('op-a', 'op-b', true)).toBe(false);
  });
  it('an UNKNOWN adder or viewer is offered it — the server refuses if wrong', () => {
    expect(countersignOfferable(null, 'op-b', false)).toBe(true);
    expect(countersignOfferable('op-a', null, false)).toBe(true);
  });
});

describe('ADMIN-5d console · the Add-block form', () => {
  const good = {
    identifierType: 'ip_range', identifier: '103.24.0.0/29',
    reason: 'credential-stuffing source', auditNote: 'confirmed from cluster RSK-CL-0630-02',
    expiresAt: '2026-09-01T00:00',
  };
  it('accepts a proper entry', () => { expect(buildAddBlock(good).ok).toBe(true); });
  it('REFUSES an already-hashed identifier BEFORE the required-field checks', () => {
    // Pasting a displayed identifier back in produces a block that matches nothing and can never be spotted. The
    // ordering is exercised with a required field ALSO wrong, so it is genuinely the first check that fires.
    const r = buildAddBlock({ ...good, identifier: 'a'.repeat(64), reason: '' });
    expect(!r.ok && r.error).toBe('looksHashed');
    // Case and whitespace must not defeat it.
    expect(buildAddBlock({ ...good, identifier: `  ${'A'.repeat(64)}  ` }).ok).toBe(false);
  });
  it('REFUSES a block with neither an expiry nor a review date', () => {
    const r = buildAddBlock({ ...good, expiresAt: '', reviewAt: '' });
    expect(!r.ok && r.error).toBe('expiry');
    expect(buildAddBlock({ ...good, expiresAt: '', reviewAt: '2026-09-01T00:00' }).ok).toBe(true);
  });
  it('REFUSES a thin reason or audit note', () => {
    expect(REASON_MIN).toBe(12);
    const r = buildAddBlock({ ...good, reason: 'fraud' });
    expect(!r.ok && r.error).toBe('reason');
    const r2 = buildAddBlock({ ...good, auditNote: 'ok' });
    expect(!r2.ok && r2.error).toBe('auditNote');
  });
  it('refuses an unknown type and an empty identifier', () => {
    expect(buildAddBlock({ ...good, identifierType: 'email' }).ok).toBe(false);
    expect(buildAddBlock({ ...good, identifierType: '' }).ok).toBe(false);
    const r = buildAddBlock({ ...good, identifier: '   ' });
    expect(!r.ok && r.error).toBe('identifier');
  });
  it('omits blank optional fields rather than sending empty strings', () => {
    const r = buildAddBlock({ ...good, originRef: '', reviewAt: '' });
    expect(r.ok && 'originRef' in r.value).toBe(false);
    expect(r.ok && 'reviewAt' in r.value).toBe(false);
    expect(r.ok && 'expiresAt' in r.value).toBe(true);
  });
  it('offers exactly the three types', () => {
    expect([...IDENTIFIER_TYPES]).toEqual(['device', 'ip_range', 'phone_hash']);
  });
});

/* ================================================================================================ */
describe('ADMIN-5d console · the Approve control is ABSENT until the dry run stands up', () => {
  const p = (over: Partial<ProposalView> = {}): ProposalView => ({
    weight: -15, proposedBy: 'op-a', proposedAt: '2026-08-07T08:00:00.000Z',
    checkedBy: null, checkedAt: null,
    dryRun: { at: '2026-08-07T08:00:00.000Z', bandDrops: 312, newRestricted: 41, population: 78204, fresh: true },
    approvalState: { ok: true, from: -12, to: -15 }, approveOfferable: true, ...over,
  });
  it('names NO DRY RUN distinctly — the next move is to run one', () => {
    expect(approveBlockedKey(p({ approvalState: { ok: false, reason: 'no_dry_run' } }), 'op-b')).toBe('noDryRun');
  });
  it('names a STALE dry run distinctly — the next move is to re-run it', () => {
    expect(approveBlockedKey(p({ approvalState: { ok: false, reason: 'stale_dry_run', ageHours: 90 } }), 'op-b')).toBe('staleDryRun');
  });
  it('names YOUR OWN proposal distinctly — the next move is a colleague', () => {
    // Four different states, four different next moves. One generic "cannot approve" sends all four to the wrong place.
    expect(approveBlockedKey(p(), 'op-a')).toBe('yourOwn');
    expect(approveBlockedKey(p(), 'op-b')).toBeNull();
  });
  it('names no-proposal and already-checked', () => {
    expect(approveBlockedKey(null, 'op-b')).toBe('noProposal');
    expect(approveBlockedKey(undefined, 'op-b')).toBe('noProposal');
    expect(approveBlockedKey(p({ approvalState: { ok: false, reason: 'no_proposal' } }), 'op-b')).toBe('noProposal');
    expect(approveBlockedKey(p({ approvalState: { ok: false, reason: 'already_checked' } }), 'op-b')).toBe('alreadyChecked');
  });
  it('an UNKNOWN viewer on an approvable proposal is offered it', () => {
    expect(approveBlockedKey(p(), null)).toBeNull();
    expect(approveBlockedKey(p({ proposedBy: null }), 'op-a')).toBeNull();
  });
  it('the dry-run panel reports absent / stale / fresh', () => {
    expect(dryRunState(null)).toBe('absent');
    expect(dryRunState({ at: '', bandDrops: 1, newRestricted: 1, population: 1, fresh: true })).toBe('absent');
    // Figures with no band-drop count are not figures.
    expect(dryRunState({ at: 'x', bandDrops: null, newRestricted: 1, population: 1, fresh: true })).toBe('absent');
    expect(dryRunState({ at: 'x', bandDrops: Number.NaN, newRestricted: 1, population: 1, fresh: true })).toBe('absent');
    expect(dryRunState({ at: 'x', bandDrops: 3, newRestricted: 1, population: 9, fresh: false })).toBe('stale');
    expect(dryRunState({ at: 'x', bandDrops: 3, newRestricted: 1, population: 9, fresh: true })).toBe('fresh');
  });
  it('a weight the code does not use is a FAILURE colour, not a note', () => {
    // The table is being read as policy and it is not policy.
    expect(driftTone('weight_mismatch')).toBe('danger');
    expect(driftTone('no_producer')).toBe('warning');
    expect(driftTone('unconfigured')).toBe('neutral');
  });
  it('the FIRED count is a dash when unreadable, never 0', () => {
    // For three of the five seeded rules 0 is the TRUE answer — which is exactly why an unreadable count must not
    // look like one, or the screen cannot tell the reader which rules are dead.
    expect(firedText(null)).toEqual({ known: false, text: '—' });
    expect(firedText(Number.NaN)).toEqual({ known: false, text: '—' });
    expect(firedText(0)).toEqual({ known: true, text: '0' });
    expect(firedText(211)).toEqual({ known: true, text: '211' });
  });
});

describe('ADMIN-5d console · the proposal form carries its dry run', () => {
  const good = { currentWeight: -12, proposedWeight: '-15', changeReason: 'dispute quality review', bandDrops: '312', newRestricted: '41', population: '78204', computedAt: '2026-08-07T08:00' };
  it('accepts a proper proposal', () => { expect(buildPropose(good).ok).toBe(true); });
  it('REFUSES a proposal with no dry run — it cannot exist without one', () => {
    expect(buildPropose({ ...good, bandDrops: '' }).ok).toBe(false);
    expect(buildPropose({ ...good, computedAt: '' }).ok).toBe(false);
    const r = buildPropose({ ...good, population: '' });
    expect(!r.ok && r.error).toBe('dryRun');
  });
  it('REFUSES dry-run arithmetic that cannot be true', () => {
    // Figures that look checked while being broken are worse than figures that are visibly absent.
    const r = buildPropose({ ...good, bandDrops: '99999999', population: '100' });
    expect(!r.ok && r.error).toBe('dryRunArithmetic');
    expect(buildPropose({ ...good, newRestricted: '999', population: '100' }).ok).toBe(false);
    expect(buildPropose({ ...good, population: '0' }).ok).toBe(false);
  });
  it('refuses a no-op, a non-numeric weight and a thin reason', () => {
    const r = buildPropose({ ...good, proposedWeight: '-12' });
    expect(!r.ok && r.error).toBe('sameWeight');
    expect(buildPropose({ ...good, proposedWeight: 'lots' }).ok).toBe(false);
    expect(buildPropose({ ...good, proposedWeight: '-15.5' }).ok).toBe(false);
    expect(buildPropose({ ...good, proposedWeight: '' }).ok).toBe(false);
    const r2 = buildPropose({ ...good, changeReason: 'because' });
    expect(!r2.ok && r2.error).toBe('reason');
  });
  it('a POSITIVE weight is accepted — clean_history_bonus is +8', () => {
    expect(buildPropose({ ...good, proposedWeight: '10' }).ok).toBe(true);
  });
});

/* ================================================================================================ */
describe('ADMIN-5d console · the score equation is rendered ONLY when it closes', () => {
  const closed: FactorPanel = { kind: 'closed', base: 78, score: 44, factors: [{ event: 'same_ip_bidding', weight: -30 }, { event: 'dispute_lost', weight: -12 }, { event: 'clean_history_bonus', weight: 8 }] };
  it('renders a closing equation in W094 shape', () => {
    expect(equationRenderable(closed)).toBe(true);
    expect(equationText(closed)).toBe('78 − 30 − 12 + 8 = 44');
    expect(factorNoticeKey(closed)).toBeNull();
  });
  it('REFUSES to render one that does not close, and says so as a FAILURE', () => {
    // An equation with a wrong answer under a caption promising every point is traceable is worse than none — and the
    // total on the right is the number that decides what happens to the person.
    const bad: FactorPanel = { kind: 'does_not_close', base: 78, score: 44, sum: 66, factors: [{ event: 'dispute_lost', weight: -12 }] };
    expect(equationRenderable(bad)).toBe(false);
    expect(equationText(bad)).toBeNull();
    expect(factorNoticeKey(bad)).toBe('doesNotClose');
  });
  it('an unavailable or missing panel renders nothing and is not an error', () => {
    expect(equationRenderable({ kind: 'unavailable', reason: 'x' })).toBe(false);
    expect(equationRenderable(null)).toBe(false);
    expect(equationRenderable(undefined)).toBe(false);
    expect(factorNoticeKey({ kind: 'unavailable', reason: 'x' })).toBe('unavailable');
    expect(factorNoticeKey(null)).toBe('unavailable');
  });
  it('an equation with no factors is still the base', () => {
    expect(equationText({ kind: 'closed', base: 70, score: 70, factors: [] })).toBe('70 = 70');
  });
});

describe('ADMIN-5d console · band effects never look enforced', () => {
  it('an unenforced effect is muted', () => {
    expect(effectTone({ key: 'payoutDelay48h', enforced: false, enforcedBy: null })).toBe('neutral');
    expect(effectTone({ key: 'walletStillWithdrawable', enforced: true, enforcedBy: 'x' })).toBe('success');
    expect(effectTone(null)).toBe('neutral');
    expect(effectTone(undefined)).toBe('neutral');
  });
  it('the ADVISORY BANNER shows whenever no real restriction is enforced', () => {
    const unenforced: BandEffect[] = [{ key: 'payoutDelay48h', enforced: false, enforcedBy: null }, { key: 'bidCap', enforced: false, enforcedBy: null }];
    expect(advisoryBannerVisible(unenforced)).toBe(true);
    // The wallet promise is TRUE and must not suppress the banner — it is a reassurance, not a restriction.
    expect(advisoryBannerVisible([...unenforced, { key: 'walletStillWithdrawable', enforced: true, enforcedBy: 'x' }])).toBe(true);
    // …and the banner disappears by itself the day a real restriction ships, so nobody has to remember to remove it.
    expect(advisoryBannerVisible([{ key: 'payoutDelay48h', enforced: true, enforcedBy: 'payout hold' }])).toBe(false);
    // An empty or missing list must not read as "everything is enforced".
    expect(advisoryBannerVisible([])).toBe(true);
    expect(advisoryBannerVisible(null)).toBe(true);
  });
});

describe('ADMIN-5d console · bands and readings', () => {
  it('restricted and blocked are failure colours — for what they do to the person', () => {
    expect(bandTone('blocked')).toBe('danger');
    expect(bandTone('restricted')).toBe('danger');
    expect(bandTone('caution')).toBe('warning');
    expect(bandTone('trusted')).toBe('success');
    expect(bandTone('gold')).toBe('neutral');
    expect(bandTone(null)).toBe('neutral');
  });
  it('an INCONSISTENT row is a failure and LADDER DRIFT is a warning', () => {
    // Inconsistent means somebody's access is governed by a value nothing computed.
    expect(readingTone({ kind: 'inconsistent', band: 'blocked', expected: 'trusted', score: 85 })).toBe('danger');
    expect(readingTone({ kind: 'ladder_drift', band: 'standard', canon: 'trusted', score: 75 })).toBe('warning');
    expect(readingTone({ kind: 'unknown', reason: 'x' })).toBe('neutral');
    expect(readingTone({ kind: 'agreed', band: 'trusted', score: 85 })).toBe('success');
    expect(readingTone(null)).toBe('neutral');
  });
  it('a share with no denominator is a DASH, never 0%', () => {
    expect(shareText(null)).toEqual({ known: false, text: '—' });
    expect(shareText({ pct: Number.NaN, of: 'active' })).toEqual({ known: false, text: '—' });
    expect(shareText({ pct: 0, of: 'active' })).toEqual({ known: true, text: '0%' });
    expect(shareText({ pct: 72, of: 'active' })).toEqual({ known: true, text: '72%' });
  });
  it('the census must add up, and a shortfall is reported', () => {
    expect(censusShortfall({ trusted: 3, standard: 0, caution: 0, restricted: 0, blocked: 0, unrecognised: 1, total: 4 })).toBe(0);
    expect(censusShortfall({ trusted: 3, standard: 0, caution: 0, restricted: 0, blocked: 0, unrecognised: 0, total: 9 })).toBe(6);
    expect(censusShortfall(null)).toBe(0);
    expect(censusShortfall({ total: Number.NaN } as unknown as Record<string, number>)).toBe(0);
  });
  it('offers exactly the five bands', () => {
    expect([...RISK_BANDS]).toEqual(['trusted', 'standard', 'caution', 'restricted', 'blocked']);
  });
});

describe('ADMIN-5d console · the band-change form', () => {
  const good = { band: 'restricted', reason: 'confirmed same-IP bidding ring across two live auctions', currentBand: 'caution' };
  it('accepts a proper change', () => { expect(buildBandChange(good).ok).toBe(true); });
  it('refuses an unknown band, a no-op, and a thin reason', () => {
    expect(buildBandChange({ ...good, band: 'gold' }).ok).toBe(false);
    const r = buildBandChange({ ...good, band: 'caution' });
    expect(!r.ok && r.error).toBe('sameBand');
    expect(BAND_REASON_MIN).toBe(20);
    const r2 = buildBandChange({ ...good, reason: 'fraud ring' });
    expect(!r2.ok && r2.error).toBe('reason');
  });
  it('with no current band recorded, any band is a change', () => {
    expect(buildBandChange({ ...good, currentBand: null }).ok).toBe(true);
  });
  it('blocking is offered only to a second operator', () => {
    expect(blockOfferable('op-a', 'op-a')).toBe(false);
    expect(blockOfferable('op-a', 'op-b')).toBe(true);
    expect(blockOfferable(null, 'op-a')).toBe(true);
    expect(blockOfferable('op-a', null)).toBe(true);
  });
});

/* ================================================================================================ */
describe('ADMIN-5d console · the overview tiles', () => {
  it('a tile with no value is UNKNOWN, never 0', () => {
    expect(tileValue({ kind: 'unavailable', reason: 'x' })).toEqual({ known: false, value: 0 });
    expect(tileValue(null)).toEqual({ known: false, value: 0 });
    expect(tileValue({ kind: 'value', value: 0 })).toEqual({ known: true, value: 0 });
  });
  it('a NON-FINITE tile value is unknown — the guard, not just the null path', () => {
    expect(tileValue({ kind: 'value', value: Number.NaN })).toEqual({ known: false, value: 0 });
    expect(tileValue({ kind: 'value', value: Number.POSITIVE_INFINITY }).known).toBe(false);
  });
  it('renders units, and a dash when unknown', () => {
    expect(tileText({ kind: 'value', value: 18, unit: 'pct' })).toBe('18%');
    expect(tileText({ kind: 'value', value: 1.9, unit: 'hours' })).toBe('1.9h');
    expect(tileText({ kind: 'value', value: 86, unit: 'count' })).toBe('86');
    expect(tileText({ kind: 'unavailable', reason: 'x' })).toBe('—');
  });
  it('UNMEASURED SLA is a warning, not a pass', () => {
    expect(slaTone({ kind: 'unmeasured' })).toBe('warning');
    expect(slaTone({ kind: 'unmeasured' })).not.toBe('success');
    expect(slaTone({ kind: 'breached', overHours: 1 })).toBe('danger');
    expect(slaTone({ kind: 'due_soon', ageHours: 3.5 })).toBe('warning');
    expect(slaTone({ kind: 'ok', ageHours: 1 })).toBe('success');
    expect(slaTone(null)).toBe('neutral');
    expect(slaTone(null)).not.toBe('success');
  });
  it('overdue and blocking are failures; due-soon is a warning', () => {
    expect(attentionTone('overdue')).toBe('danger');
    expect(attentionTone('blocking')).toBe('danger');
    expect(attentionTone('due_soon')).toBe('warning');
    expect(attentionTone('info')).toBe('neutral');
  });
  it('ALL QUIET needs an empty list AND every register read', () => {
    const item: AttentionItem = { id: 'x', severity: 'info', messageKey: 'y' };
    expect(allQuiet([], READ)).toBe(true);
    expect(allQuiet([], { ...READ, blocklist: false })).toBe(false);
    expect(allQuiet([item], READ)).toBe(false);
    expect(allQuiet(null, READ)).toBe(false);
    expect(allQuiet([], null)).toBe(false);
  });
  it('names the registers that could not be read', () => {
    expect(unreadSources({ ...READ, reports: false, risk: false })).toEqual(['reports', 'risk']);
    expect(unreadSources(READ)).toEqual([]);
    expect(unreadSources(null)).toEqual(['reports', 'appeals', 'blocklist', 'risk']);
  });
  it('a LOW-SAMPLE percentage carries its denominator', () => {
    // "18% overturn rate" from two appeals outlives its caveat once somebody puts it in a board pack.
    expect(sampleNote(true, 3)).toBe('n=3');
    expect(sampleNote(true, null)).toBe('n=?');
    expect(sampleNote(false, 300)).toBeNull();
    expect(sampleNote(null, 3)).toBeNull();
  });
});
