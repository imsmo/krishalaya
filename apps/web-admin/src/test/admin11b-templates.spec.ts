// apps/web-admin/src/test/admin11b-templates.spec.ts · PC-56 ADMIN-11b console spec.
//
// The console's job on this plane is to keep four pairs apart, and every one of them rendered identically before the
// wave, because the schema could not express the difference:
//
//   * "active" and "would actually send" (0072's lifecycle was written by nothing and read by nothing);
//   * "the wording that is serving" and "the wording somebody is drafting" (one column, so a draft WAS the live copy);
//   * "no tenant has overridden this" and "no tenant may" (a zero beside OTP copy);
//   * "recorded by an operator" and "confirmed by a provider" (there is no provider).
import {
  approveWithheldKey, canApprove, canOverridePerTenant, channelKey, draftNoticeKey, gapTone, gapSeverityKey,
  hasUnservedDraft, lifecycleTone, lifecycleKey, overridesKey, refBlocksApproval, securityNoticeKey,
  securityOverrideClass, securityOverrideKey, segmentClass, segmentKey, sendStateTone, sendStateKey, unversionedKey,
} from '../features/templates/template';
import { en } from '../i18n/en';

const dict = en as unknown as Record<string, string>;

describe('ADMIN-11b · active and sending are different facts', () => {
  const row = (over: Record<string, unknown> = {}) =>
    ({ isActive: true, lifecycle: 'approved', sendable: true, ...over }) as
      { isActive: boolean; lifecycle: string | null; sendable: boolean };

  it('says "sending" only for an approved, active template', () => {
    expect(sendStateKey(row())).toBe('tp11.state.sending');
    expect(sendStateTone(row())).toBe('success');
  });

  // **THE STATE THE OLD SCHEMA COULD NOT SHOW.** `resolve()` sent on `is_active` alone, so a template WhatsApp had
  // rejected sat here looking live and sent anyway — which is how a business number gets blocked.
  it('draws an active row with no approved wording as DANGER, not as neutral', () => {
    const r = row({ lifecycle: 'draft', sendable: false });
    expect(sendStateKey(r)).toBe('tp11.state.activeButUnapproved');
    expect(sendStateTone(r)).toBe('danger');
    expect(dict['tp11.state.activeButUnapproved']).toBeTruthy();
  });

  it('draws a rejected template as danger and an inactive draft as ordinary', () => {
    expect(sendStateKey(row({ lifecycle: 'rejected', sendable: false }))).toBe('tp11.state.rejected');
    expect(sendStateTone(row({ lifecycle: 'rejected', sendable: false }))).toBe('danger');
    const draft = row({ isActive: false, lifecycle: 'draft', sendable: false });
    expect(sendStateKey(draft)).toBe('tp11.state.draft');
    expect(sendStateTone(draft)).not.toBe('danger');
  });

  it('treats a row with no version at all as a warning rather than as new', () => {
    // After 0122's backfill an unversioned row means a writer that predates this plane: a send whose words cannot be
    // reconstructed. Drawn as a warning so nobody reads the blank as "nothing has happened here yet".
    expect(lifecycleKey(null)).toBe('tp11.life.unversioned');
    expect(lifecycleTone(null)).toBe('warning');
    expect(dict['tp11.life.unversioned']).toBeTruthy();
  });

  it('treats an unrecognised lifecycle as neither approved nor blank', () => {
    expect(lifecycleKey('quarantined')).toBe('tp11.life.other');
    expect(lifecycleTone('quarantined')).not.toBe('success');
  });
});

describe('ADMIN-11b · an edit is visibly not live', () => {
  it('knows when a draft is waiting behind the serving version', () => {
    expect(hasUnservedDraft({ currentVersionNo: 3, servingVersionNo: 2 })).toBe(true);
    expect(hasUnservedDraft({ currentVersionNo: 2, servingVersionNo: 2 })).toBe(false);
    // Nothing serving and something authored is also an unserved draft — and a more urgent one.
    expect(hasUnservedDraft({ currentVersionNo: 1, servingVersionNo: null })).toBe(true);
    expect(hasUnservedDraft({ currentVersionNo: 0, servingVersionNo: null })).toBe(false);
  });

  // The reassurance that makes a 2 a.m. typo fix on the OTP template safe.
  it('says what is still serving while a draft waits', () => {
    expect(draftNoticeKey({ currentVersionNo: 3, servingVersionNo: 2 })).toBe('tp11.draft.serving');
    expect(dict['tp11.draft.serving']).toMatch(/Nothing a recipient receives has changed/);
    expect(dict['tp11.editIsSafe']).toMatch(/without stopping a single one-time password/);
  });

  it('distinguishes "a draft waits" from "nothing is serving"', () => {
    // The second is the dangerous one: this event has no approved wording on this channel at all.
    expect(draftNoticeKey({ currentVersionNo: 1, servingVersionNo: null })).toBe('tp11.draft.nothingServing');
    expect(dict['tp11.draft.nothingServing']).toMatch(/NOTHING is serving/);
    expect(draftNoticeKey({ currentVersionNo: 2, servingVersionNo: 2 })).toBeNull();
  });
});

describe('ADMIN-11b · security copy', () => {
  it('shows a lock rather than a zero in the overrides column', () => {
    // "0 tenants override this" invites the reader to think none has bothered yet. On auth.otp the answer is never.
    expect(overridesKey({ securityCopy: true, overrideCount: 0 })).toBe('tp11.over.locked');
    expect(overridesKey({ securityCopy: false, overrideCount: 0 })).toBe('tp11.over.none');
    expect(overridesKey({ securityCopy: false, overrideCount: 14 })).toBe('tp11.over.count');
    expect(dict['tp11.over.locked']).toMatch(/never overridable/);
  });

  it('withholds the tenant-override control entirely and explains why', () => {
    expect(canOverridePerTenant({ securityCopy: true })).toBe(false);
    expect(canOverridePerTenant({ securityCopy: false })).toBe(true);
    expect(securityNoticeKey({ securityCopy: true })).toBe('tp11.security.locked');
    expect(securityNoticeKey({ securityCopy: false })).toBeNull();
    // The notice records that the rule existed on this screen and was enforced by nothing.
    expect(dict['tp11.security.locked']).toMatch(/enforced by nothing/);
    expect(dict['tp11.security.locked']).toMatch(/any tenant could rewrite/);
  });

  // **THE AUDIT QUERY FROM 0122, PRINTED WHETHER IT IS ZERO OR NOT.** A panel that appears only when something is wrong
  // is a panel nobody trusts when it is absent.
  it('prints the security-override census in both directions', () => {
    expect(securityOverrideKey(0)).toBe('tp11.census.noSecurityOverrides');
    expect(securityOverrideKey(3)).toBe('tp11.census.securityOverrides');
    expect(securityOverrideClass(0)).not.toContain('is-danger');
    expect(securityOverrideClass(1)).toContain('is-danger');
    expect(dict['tp11.census.noSecurityOverrides']).toMatch(/whether it is zero or not/);
    expect(dict['tp11.census.securityOverrides']).toMatch(/\{n\}/);
  });

  it('says what an unversioned count means rather than showing a bare number', () => {
    expect(unversionedKey(0)).toBe('tp11.census.allVersioned');
    expect(unversionedKey(7)).toBe('tp11.census.unversioned');
    expect(dict['tp11.census.unversioned']).toMatch(/cannot be reconstructed/);
  });
});

describe('ADMIN-11b · the approve control is absent, not disabled', () => {
  const v = (over: Record<string, unknown> = {}) =>
    ({ lifecycle: 'submitted', needsSecondPerson: true, authoredByAdminId: 'admin-a', ...over }) as
      { lifecycle: string; needsSecondPerson: boolean; authoredByAdminId: string | null };

  it('withholds approval from the author of security copy', () => {
    expect(canApprove(v(), 'admin-a')).toBe(false);
    expect(canApprove(v(), 'admin-b')).toBe(true);
    expect(approveWithheldKey(v(), 'admin-a')).toBe('tp11.approve.ownWork');
    expect(dict['tp11.approve.ownWork']).toMatch(/TWO ADMINISTRATORS/);
  });

  it('lets one person approve ordinary copy, deliberately', () => {
    // A checker on every wording change is a checker who stops reading, and a rubber-stamped approval is worse than
    // none: it produces a record that looks like evidence.
    expect(canApprove(v({ needsSecondPerson: false }), 'admin-a')).toBe(true);
  });

  it('refuses to approve a security-copy version with no recorded author', () => {
    // Unknown is not "somebody else". With no author there is nothing to check the approver against.
    expect(canApprove(v({ authoredByAdminId: null }), 'admin-b')).toBe(false);
    expect(approveWithheldKey(v({ authoredByAdminId: null }), 'admin-b')).toBe('tp11.approve.noAuthor');
  });

  it('offers approval only from a state that can transition to it', () => {
    expect(canApprove(v({ lifecycle: 'approved' }), 'admin-b')).toBe(false);
    expect(approveWithheldKey(v({ lifecycle: 'approved' }), 'admin-b')).toBe('tp11.approve.alreadyApproved');
    expect(canApprove(v({ lifecycle: 'superseded' }), 'admin-b')).toBe(false);
    expect(approveWithheldKey(v({ lifecycle: 'superseded' }), 'admin-b')).toBe('tp11.approve.superseded');
    expect(approveWithheldKey(v({ lifecycle: 'rejected' }), 'admin-b')).toBe('tp11.approve.rejected');
  });

  it('blocks approval of an SMS or WhatsApp version with no registration, before the button is pressed', () => {
    expect(refBlocksApproval('sms', null)).toBe(true);
    expect(refBlocksApproval('whatsapp', null)).toBe(true);
    expect(refBlocksApproval('sms', 'DLT-1107172')).toBe(false);
    expect(refBlocksApproval('push', null)).toBe(false);
    expect(dict['tp11.approve.needsRef']).toMatch(/silently stops delivering/);
  });
});

describe('ADMIN-11b · the cost an author must see before saving', () => {
  const seg = (segments: number, encoding = 'gsm7') =>
    ({ encoding, units: 10, segments, perSegment: encoding === 'gsm7' ? 153 : 67, characters: 84 });

  it('names the encoding, because it is what changes the price', () => {
    expect(segmentKey(seg(1, 'ucs2'))).toBe('tp11.seg.ucs2');
    expect(segmentKey(seg(1))).toBe('tp11.seg.gsm7');
    expect(segmentKey(seg(0))).toBe('tp11.seg.empty');
    expect(segmentKey(null)).toBeNull();
    expect(dict['tp11.seg.ucs2']).toMatch(/billed on every send of this event, for ever/);
  });

  it('warns at two segments and refuses the reader’s indifference at three', () => {
    expect(segmentClass(seg(1), 'important')).not.toContain('is-warn');
    expect(segmentClass(seg(2), 'important')).toContain('is-warn');
    expect(segmentClass(seg(3), 'important')).toContain('is-danger');
  });

  it('does not scold a critical template for its length', () => {
    // An OTP truncated to save a fraction of a rupee is a message that failed at the only job it had.
    expect(segmentClass(seg(4), 'critical')).not.toContain('is-danger');
  });
});

describe('ADMIN-11b · coverage and the sender registry', () => {
  it('ranks a gap on critical copy loudest', () => {
    expect(gapSeverityKey('critical')).toBe('tp11.gap.critical');
    expect(gapTone('critical')).toBe('danger');
    expect(gapTone('important')).toBe('warning');
    expect(gapTone('ordinary')).not.toBe('warning');
    expect(gapSeverityKey('nonsense')).toBe('tp11.gap.ordinary');
  });

  it('separates "no gaps" from "nothing is being checked"', () => {
    expect(dict['tp11.gaps.noneBody']).toMatch(/not .nothing is being checked/);
    expect(dict['tp11.gaps.basis']).toMatch(/Never stored/);
  });

  // **NO PROVIDER IS WIRED**, so a status here is an operator's assertion. A console that let a reader believe otherwise
  // would be the status-recording-an-act-nobody-performs shape in the wave that names it.
  it('says on the page that nothing is provider-verified', () => {
    expect(dict['tp11.senders.unverified']).toMatch(/AN OPERATOR.S ASSERTION/);
    expect(dict['tp11.senders.notVerified']).toMatch(/not confirmed by any provider/);
    expect(dict['tp11.submissionNote']).toMatch(/out of band/);
  });

  it('says a sender registration is per-country', () => {
    // DLT is Indian; a registry without a country is a table that cannot cross a border.
    expect(dict['tp11.senders.countryHelp']).toMatch(/per-country/);
  });
});

describe('ADMIN-11b · the guard rails, in the words an operator reads', () => {
  it('states which rails were true and which were true of nothing', () => {
    expect(dict['tp11.rail.unique']).toMatch(/True since migration 0012/);
    expect(dict['tp11.rail.fallback']).toMatch(/never to silence/);
    expect(dict['tp11.rail.reapproval']).toMatch(/Before this release the edit kept the registration/);
  });

  it('labels every channel and does not silently drop an unknown one', () => {
    for (const c of ['push', 'sms', 'whatsapp', 'email', 'inapp', 'ivr']) expect(dict[channelKey(c)]).toBeTruthy();
    expect(channelKey('telepathy')).toBe('tp11.ch.other');
    expect(dict['tp11.ch.other']).toBeTruthy();
  });

  it('says an undeclared variable set is unknown rather than empty', () => {
    expect(dict['tp11.vars.undeclared']).toMatch(/UNKNOWN, not none/);
  });

  it('says the preview never uses a live row', () => {
    expect(dict['tp11.previewNote']).toMatch(/never with a live row/);
    expect(dict['tp11.previewNote']).toMatch(/working one-time code/);
  });
});
