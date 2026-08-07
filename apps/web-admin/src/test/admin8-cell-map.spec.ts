// apps/web-admin/src/test/admin8-cell-map.spec.ts (PC-56 ADMIN-8)
import {
  actionClass, actionKey, approvalNoticeClass, approvalNoticeKey, countCheckClass, countCheckKey,
  defaultNotActiveClass, diffText, dsnCellKey, dsnMissingIsUrgent, entityKey, fieldIsCritical,
  headroomClass, headroomText, orderDiff, proposalClass, proposalKey, rateClass, rateText, shardTraffic,
  showApply, showMarkStale, showReject, stalenessKey, trafficClass, trafficKey, weeksToFullText, zeroWeightClass,
} from '../features/cells/map-approval';

describe('the proposal badge', () => {
  it('draws OPEN as a warning, not neutral', () => {
    // An unsigned proposal is a routing change somebody is waiting on — and one of them could be "drain the default cell",
    // which stops a country's onboarding.
    expect(proposalClass('open')).toContain('is-warn');
    expect(proposalClass('applied')).toContain('is-ok');
    expect(proposalClass('rejected')).toBe('kv-badge');
  });
  it('draws STALE as DANGER, because somebody wrote a change against a world that moved', () => {
    expect(proposalClass('stale')).toContain('is-danger');
  });
  it('keys an unrecognised status rather than showing a raw code', () => {
    expect(proposalKey('quantum')).toBe('cm.status.unknown');
  });
});

describe('the apply control — maker-checker BY ABSENCE', () => {
  it('is drawn ONLY when the state is approvable', () => {
    // A disabled Apply teaches an operator that they nearly have the right to authorise their own topology change.
    expect(showApply('approvable')).toBe(true);
    for (const k of ['needs_other_operator', 'already', 'stale']) expect(showApply(k)).toBe(false);
  });
  it('SHOWS Reject to the maker, so withdrawing your own proposal is cheap', () => {
    expect(showReject('needs_other_operator')).toBe(true);
    expect(showReject('stale')).toBe(true);
    expect(showReject('already')).toBe(false);
  });
  it('shows Mark-stale ONLY when the proposal genuinely is stale', () => {
    // It must not be a way of dismissing a proposal one disagrees with — that is Reject, which demands a reason — because
    // conflating them would let somebody bury a colleague's change without writing one.
    expect(showMarkStale('stale')).toBe(true);
    for (const k of ['approvable', 'needs_other_operator', 'already']) expect(showMarkStale(k)).toBe(false);
  });
  it('classes the notice by severity and keys every state', () => {
    expect(approvalNoticeClass('stale')).toContain('is-danger');
    expect(approvalNoticeClass('needs_other_operator')).toContain('is-warn');
    for (const k of ['approvable', 'needs_other_operator', 'already', 'stale']) {
      expect(approvalNoticeKey(k)).toBe(`cm.approval.${k}`);
    }
    expect(approvalNoticeKey('novel')).toBe('cm.approval.unknown');
  });
});

describe('stalenessKey', () => {
  it('is silent when the proposal is fresh', () => {
    expect(stalenessKey(null)).toBeNull();
    expect(stalenessKey({ stale: false })).toBeNull();
  });
  it('distinguishes a missing entity from changed fields', () => {
    // One means the cell or shard is gone; the other means somebody else changed the fields this proposal is about.
    expect(stalenessKey({ stale: true, reason: 'entity_missing' })).toBe('cm.stale.missing');
    expect(stalenessKey({ stale: true, reason: 'observed_changed' })).toBe('cm.stale.changed');
    expect(stalenessKey({ stale: true })).toBe('cm.stale.other');
  });
});

describe('the diff', () => {
  it('renders null as null rather than as an empty cell', () => {
    // On this map `null` capacity means UNCAPPED, which is the opposite of "no value" — and a blank would read as the
    // second.
    expect(diffText(null)).toBe('null');
    expect(diffText(2000)).toBe('2000');
    expect(diffText('active')).toBe('active');
  });
  it('says so when a value was not recorded', () => {
    expect(diffText(undefined)).toBe('(not recorded)');
  });
  it('leads with status and isDefault', () => {
    // A diff listing `notes` above `status` would bury the field that decides whether a region accepts tenants.
    const lines = [{ field: 'notes' }, { field: 'capacityTenants' }, { field: 'status' }, { field: 'isDefault' }];
    expect(orderDiff(lines).map((l) => l.field)).toEqual(['status', 'isDefault', 'capacityTenants', 'notes']);
  });
  it('sorts unknown fields alphabetically after the known ones', () => {
    const lines = [{ field: 'zulu' }, { field: 'alpha' }, { field: 'status' }];
    expect(orderDiff(lines).map((l) => l.field)).toEqual(['status', 'alpha', 'zulu']);
  });
  it('marks the consequential fields', () => {
    for (const f of ['status', 'isDefault', 'residencyLocked']) expect(fieldIsCritical(f)).toBe(true);
    for (const f of ['notes', 'capacityTenants', 'weight']) expect(fieldIsCritical(f)).toBe(false);
  });
});

describe('the change log', () => {
  it('draws a MOVE as consequential — a tenant\'s live data relocating between stacks', () => {
    expect(actionClass('moved')).toContain('is-warn');
    expect(actionClass('status_changed')).toContain('is-info');
    expect(actionClass('placed')).toBe('kv-badge');
  });
  it('keys every action and entity, with a fallback', () => {
    for (const a of ['created', 'updated', 'status_changed', 'placed', 'moved', 'removed']) {
      expect(actionKey(a)).toBe(`cm.action.${a}`);
    }
    expect(actionKey('teleported')).toBe('cm.action.other');
    expect(entityKey('cell')).toBe('cm.entity.cell');
    expect(entityKey('quantum')).toBe('cm.entity.other');
  });
});

describe('headroom', () => {
  it('escalates past the plan trigger and again near full', () => {
    expect(headroomClass({ known: true, percent: 5, placed: 95, capacity: 100 }, 70)).toContain('is-danger');
    expect(headroomClass({ known: true, percent: 25, placed: 75, capacity: 100 }, 70)).toContain('is-warn');
    expect(headroomClass({ known: true, percent: 60, placed: 40, capacity: 100 }, 70)).toContain('is-ok');
  });
  it('does NOT draw UNCAPPED as plenty', () => {
    // An uncapped cell has no headroom to report and no guard protecting it, which is a different condition from a roomy
    // one — green would say the opposite of what it means.
    expect(headroomClass({ known: false, reason: 'uncapped' }, 70)).toBe('kv-badge');
    expect(headroomText({ known: false, reason: 'uncapped' }))
      .toEqual({ text: '—', unknownKey: 'cm.headroom.uncapped' });
  });
  it('renders a known percentage', () => {
    expect(headroomText({ known: true, percent: 40, placed: 600, capacity: 1000 }))
      .toEqual({ text: '40%', unknownKey: null });
  });
});

describe('the growth rate', () => {
  it('signs a positive rate and never fakes one', () => {
    expect(rateText({ known: true, perWeek: 38, windowWeeks: 8, sample: 300 }))
      .toEqual({ text: '+38/week', unknownKey: null });
    // "Nobody joined" and "we have no history" are the same number and different findings.
    expect(rateText({ known: false, reason: 'no_history' }))
      .toEqual({ text: '—', unknownKey: 'cm.rate.noHistory' });
  });
  it('renders a KNOWN zero as a NUMBER rather than as unknown', () => {
    // The substance of this assertion is the absence of a dash: a cell that genuinely gained nobody this window must not
    // render like a cell with no history. The sign is cosmetic and deliberately absent at zero — "0/week" sits correctly
    // in a column of "+38/week" and "-5/week", and "+0/week" is odd typography for a value with no direction. I asserted
    // the sign first, which was a statement about punctuation dressed as a statement about meaning.
    expect(rateText({ known: true, perWeek: 0, windowWeeks: 8, sample: 12 }).text).toBe('0/week');
    expect(rateText({ known: true, perWeek: 0, windowWeeks: 8, sample: 12 }).unknownKey).toBeNull();
  });
  it('draws a SHRINKING cell as a note rather than as good news', () => {
    // Tenants leaving is a churn signal, and a capacity screen that painted it green would be the wrong screen to learn it
    // from.
    expect(rateClass({ known: true, perWeek: -5, windowWeeks: 8, sample: 40 })).toContain('is-warn');
    expect(rateClass({ known: true, perWeek: 5, windowWeeks: 8, sample: 40 })).toBe('kv-badge');
  });
});

describe('weeks to full', () => {
  it('shows the projection when there is one', () => {
    expect(weeksToFullText({ known: true, weeks: 21 })).toEqual({ text: '21', unknownKey: null });
  });
  it('NEVER puts a number on "never"', () => {
    // A large figure meaning never invites somebody to plan against it.
    expect(weeksToFullText({ known: false, reason: 'not_filling' }))
      .toEqual({ text: '—', unknownKey: 'cm.full.notFilling' });
  });
  it('keys each unknown reason separately', () => {
    expect(weeksToFullText({ known: false, reason: 'uncapped' }).unknownKey).toBe('cm.full.uncapped');
    expect(weeksToFullText({ known: false, reason: 'already_full' }).unknownKey).toBe('cm.full.already');
    expect(weeksToFullText({ known: false, reason: 'no_rate' }).unknownKey).toBe('cm.full.noRate');
    expect(weeksToFullText({ known: false, reason: 'novel' }).unknownKey).toBe('cm.full.noRate');
  });
  it('shows 0 for an already-full cell rather than a dash', () => {
    // Zero weeks is the true answer here, and a dash would read as "we cannot say" about a cell that is demonstrably full.
    expect(weeksToFullText({ known: false, reason: 'already_full' }).text).toBe('0');
  });
});

describe('the count-check claim', () => {
  it('draws NEVER CHECKED as a warning — the state of every node today', () => {
    // The ADMIN-6 rule: an unverified figure says so rather than implying verification.
    expect(countCheckClass(null)).toContain('is-warn');
    expect(countCheckKey(null)).toBe('cm.count.never');
  });
  it('escalates a drift on a CAPPED node to danger', () => {
    expect(countCheckClass({ kind: 'over', at: 'x', urgent: true })).toContain('is-danger');
    expect(countCheckClass({ kind: 'over', at: 'x', urgent: false })).toContain('is-warn');
    expect(countCheckClass({ kind: 'match', at: 'x', urgent: false })).toContain('is-ok');
  });
  it('keys OVER and UNDER separately, because they cost different things', () => {
    expect(countCheckKey({ kind: 'over', at: 'x', urgent: true })).toBe('cm.count.over');
    expect(countCheckKey({ kind: 'under', at: 'x', urgent: true })).toBe('cm.count.under');
  });
});

describe('the two findings', () => {
  it('draws a non-active default cell as an incident', () => {
    expect(defaultNotActiveClass(1)).toContain('is-danger');
    expect(defaultNotActiveClass(0)).toBe('kv-note');
  });
  it('draws a zero-weight active shard as a warning', () => {
    expect(zeroWeightClass(3)).toContain('is-warn');
    expect(zeroWeightClass(0)).toBe('kv-note');
  });
});

describe('the DSN cell', () => {
  it('renders the BOOLEAN, never a reference', () => {
    // W031: "Raw DSNs never appear here … even platform owners see only the reference." The server emits `hasDsn` only, and
    // this renders that — keeping the rule where a reviewer will look for it.
    expect(dsnCellKey(true)).toBe('cm.dsn.sealed');
    expect(dsnCellKey(false)).toBe('cm.dsn.absent');
  });
  it('flags an active shard with no connection reference', () => {
    // It cannot serve traffic, which is a misconfiguration rather than a display detail.
    expect(dsnMissingIsUrgent(false, 'active')).toBe(true);
    expect(dsnMissingIsUrgent(false, 'retired')).toBe(false);
    expect(dsnMissingIsUrgent(true, 'active')).toBe(false);
  });
});

describe('shardTraffic', () => {
  it('separates draining-by-weight from draining-by-status', () => {
    // The two can disagree, and the disagreement is the interesting case: somebody took the shard out of rotation without
    // committing to the lifecycle change.
    expect(shardTraffic('active', 0)).toBe('draining_by_weight');
    expect(shardTraffic('draining', 100)).toBe('draining_by_status');
    expect(shardTraffic('active', 100)).toBe('accepting');
  });
  it('names readonly and retired as their own states', () => {
    expect(shardTraffic('readonly', 100)).toBe('frozen');
    expect(shardTraffic('retired', 0)).toBe('retired');
  });
  it('reports an unreadable weight as UNKNOWN rather than as draining', () => {
    // NaN loses every comparison, so a bare `weight > 0` would land on draining by luck rather than by design — the
    // equivalence ADMIN-5f caught itself relying on.
    expect(shardTraffic('active', NaN)).toBe('unknown');
    expect(shardTraffic('nonsense', 100)).toBe('unknown');
  });
  it('draws UNKNOWN as danger on a routing table', () => {
    // A shard whose traffic state cannot be read is a shard nobody can say is safe to place onto.
    expect(trafficClass('unknown')).toContain('is-danger');
    expect(trafficClass('accepting')).toContain('is-ok');
    expect(trafficClass('draining_by_weight')).toContain('is-warn');
    expect(trafficKey('draining_by_weight')).toBe('cm.traffic.draining_by_weight');
  });
});
