// apps/admin-api/src/modules/templates-ops/__tests__/admin11b-templates.spec.ts · PC-56 ADMIN-11b.
//
// The four things this plane has to get right, and every one of them was wrong before the wave:
//   1. a tenant cannot rewrite security copy (the rule was written in W101 and enforced nowhere);
//   2. a published wording never changes, and an edit does not disturb what is sending;
//   3. an edited SMS body loses the DLT registration it was approved under;
//   4. a template Meta rejected is not sendable — `is_active` was the entire test.
import {
  assessDraft, bodyTokens, canTransition, coverageGaps, isSecurityCopy, isSendable, missingRequired,
  needsProviderApproval, needsSecondPerson, refSurvivesEdit, approvalBlockedByMissingRef, severityOf,
  tenantMayOverride, unknownTokens,
} from '../domain/template-version';
import { encodingOf, exceedsSegmentBudget, renderWithSamples, segmentsFor, toDltTemplate, unitsOf } from '../domain/sms-segments';

const otp = { code: 'auth.otp', priority: 'critical', userCanOptOut: false, defaultChannels: ['sms'] };
const delivered = { code: 'order.delivered', priority: 'important', userCanOptOut: true, defaultChannels: ['sms', 'push'] };
const promo = { code: 'offer.weekly', priority: 'promotional', userCanOptOut: true, defaultChannels: ['whatsapp'] };

const vars = [
  { name: 'order_id', sourceRef: 'orders.order_no', sampleValue: 'ORD-2026-088412', isRequired: true },
  { name: 'amount', sourceRef: 'orders.total_minor', sampleValue: '12450', isRequired: false },
];

describe('ADMIN-11b · security copy is platform-controlled', () => {
  // **THE SHARPEST FINDING OF THE WAVE.** W101: "auth.otp and dispute events are opt-out-locked and tenant overrides are
  // disabled on them." `TemplateAdminService.upsert` checked that the event existed and nothing else, and `resolve()`
  // sorts `tenant_id NULLS LAST` — so a tenant row beat the platform default for every event, OTP included.
  it('refuses a tenant override on an opt-out-locked or critical event', () => {
    expect(isSecurityCopy(otp)).toBe(true);
    expect(tenantMayOverride(otp)).toBe(false);
    expect(tenantMayOverride(delivered)).toBe(true);
  });

  it('treats either test as sufficient, because they say different things', () => {
    // A user who cannot opt out is being told they will receive this whether they want it or not — the strongest claim a
    // notification makes on a person. Critical is the operational half. Either alone means the wording is not marketing.
    expect(isSecurityCopy({ priority: 'important', userCanOptOut: false })).toBe(true);
    expect(isSecurityCopy({ priority: 'critical', userCanOptOut: true })).toBe(true);
    expect(isSecurityCopy({ priority: 'important', userCanOptOut: true })).toBe(false);
  });

  it('names the refusal in the draft verdict rather than failing at the database', () => {
    const v = assessDraft(
      { eventCode: 'auth.otp', channel: 'sms', languageCode: 'gu', tenantId: 'tenant-1', subject: null,
        body: '{{otp}} is your code', providerTemplateRef: 'DLT-1' }, otp, []);
    expect(v.ok).toBe(false);
    expect(v.problems.map((p) => p.code)).toContain('security_copy_platform_only');
  });

  it('gates the second person on exactly the same test', () => {
    // Sixteenth maker-checker site, and NARROW on purpose: a checker on every copy tweak is a checker who stops reading.
    expect(needsSecondPerson(otp)).toBe(true);
    expect(needsSecondPerson(delivered)).toBe(false);
    expect(needsSecondPerson(promo)).toBe(false);
  });
});

describe('ADMIN-11b · an edit never touches what is sending', () => {
  // W102's third guard rail: "Edits require re-approval of DLT ref before next send." The old upsert replaced the body
  // and KEPT the ref, so an edited body went out under a registration granted for different words — and DLT scrubbing
  // does not bounce a mismatch, it stops delivering.
  it('drops the provider ref when an SMS or WhatsApp body changes', () => {
    expect(refSurvivesEdit('sms', true)).toBe(false);
    expect(refSurvivesEdit('whatsapp', true)).toBe(false);
    // Nobody outside this platform approves push or in-app wording, so nothing is staled by an edit.
    expect(refSurvivesEdit('push', true)).toBe(true);
    expect(refSurvivesEdit('inapp', true)).toBe(true);
    expect(refSurvivesEdit('email', true)).toBe(true);
  });

  it('keeps the ref when the body did not change', () => {
    // Editing only the subject, or re-saving with the same words, is not a re-registration event. Getting this wrong in
    // the safe direction would still be wrong: it would send every no-op save back through provider approval.
    expect(refSurvivesEdit('sms', false)).toBe(true);
  });

  it('knows which channels are registered with somebody else', () => {
    expect(needsProviderApproval('sms')).toBe(true);
    expect(needsProviderApproval('whatsapp')).toBe(true);
    expect(needsProviderApproval('push')).toBe(false);
    expect(needsProviderApproval('ivr')).toBe(false);
  });

  it('refuses to approve an SMS version with no registration behind it', () => {
    // A green row that fails at the operator is worse than a blocked one: nothing on this platform would say why the
    // messages stopped.
    expect(approvalBlockedByMissingRef('sms', null)).toBe(true);
    expect(approvalBlockedByMissingRef('sms', 'DLT-1107172')).toBe(false);
    expect(approvalBlockedByMissingRef('push', null)).toBe(false);
  });
});

describe('ADMIN-11b · the lifecycle 0072 added and nobody read', () => {
  // `resolve()` sent on `is_active = true` alone. A template WhatsApp had REJECTED or PAUSED was fully sendable, which
  // is how a WABA quality rating falls and a business number gets blocked.
  it('sends only an approved version', () => {
    expect(isSendable('approved')).toBe(true);
    for (const l of ['draft', 'submitted', 'rejected', 'superseded', 'paused']) expect(isSendable(l)).toBe(false);
  });

  it('treats an unrecognised lifecycle as not sendable', () => {
    // Three waves running have made this correction: a state this code cannot describe is a state whose safety it
    // cannot assert.
    expect(isSendable('quarantined')).toBe(false);
    expect(isSendable('')).toBe(false);
  });

  it('allows only the transitions this plane performs', () => {
    expect(canTransition('draft', 'submitted')).toBe(true);
    expect(canTransition('submitted', 'approved')).toBe(true);
    expect(canTransition('rejected', 'submitted')).toBe(true);
    // An approved version is never edited back into draft — it is superseded by a newer one being approved.
    expect(canTransition('approved', 'draft')).toBe(false);
    expect(canTransition('superseded', 'approved')).toBe(false);
    expect(canTransition('approved', 'superseded')).toBe(true);
  });
});

describe('ADMIN-11b · the variable a typo makes invisible', () => {
  it('finds every distinct token once, in order', () => {
    expect(bodyTokens('{{order_id}} — {{amount}} — {{order_id}}')).toEqual(['order_id', 'amount']);
    expect(bodyTokens('no variables here')).toEqual([]);
    expect(bodyTokens('{{ spaced }}')).toEqual(['spaced']);
  });

  it('refuses an undeclared variable, because at send time it renders as nothing', () => {
    // `render()` turns an undeclared token into '' — right at send time, and it means an author who types `order_no`
    // for `order_id` ships an SMS with a silent hole in it, to a farmer, in a language they may not read.
    expect(unknownTokens('Order {{order_no}} delivered', vars)).toEqual(['order_no']);
    expect(unknownTokens('Order {{order_id}} delivered', vars)).toEqual([]);
  });

  it('refuses NOTHING when the event declares no variables, and says so', () => {
    // **UNKNOWN IS NOT ZERO**, for the sixth time in two waves. With an empty catalogue a typo cannot be told from a
    // variable nobody has documented, and refusing every token would make the plane unusable for 200-odd events.
    expect(unknownTokens('Order {{whatever}}', [])).toEqual([]);
    const v = assessDraft(
      { eventCode: 'offer.weekly', channel: 'whatsapp', languageCode: 'en', tenantId: null, subject: null,
        body: 'Hello {{name}}', providerTemplateRef: 'WA-1' }, promo, []);
    expect(v.ok).toBe(true);
    expect(v.warnings.map((w) => w.code)).toContain('variables_not_declared');
  });

  it('refuses a body that omits a required variable', () => {
    expect(missingRequired('Your order was delivered', vars)).toEqual(['order_id']);
    expect(missingRequired('Order {{order_id}} delivered', vars)).toEqual([]);
  });

  it('lists what IS declared in the refusal, so the author can act on it', () => {
    const v = assessDraft(
      { eventCode: 'order.delivered', channel: 'push', languageCode: 'en', tenantId: null, subject: null,
        body: 'Order {{order_no}} delivered', providerTemplateRef: null }, delivered, vars);
    const problem = v.problems.find((p) => p.code === 'unknown_variables');
    expect(problem?.detail).toContain('order_no');
    expect(problem?.detail).toContain('order_id');
  });
});

describe('ADMIN-11b · segments, because a wording change is a pricing change', () => {
  it('detects the encoding a body forces', () => {
    expect(encodingOf('Your order has been delivered.')).toBe('gsm7');
    // One Gujarati character converts the WHOLE message to UCS-2 — there is no partial GSM-7.
    expect(encodingOf('તમારો ઓર્ડર')).toBe('ucs2');
    // A single curly quote does it too, which is how an English template silently triples in cost.
    expect(encodingOf('Your order’s ready')).toBe('ucs2');
  });

  it('charges two septets for the seven escaped GSM-7 characters', () => {
    expect(unitsOf('{}', 'gsm7')).toBe(4);
    expect(unitsOf('abc', 'gsm7')).toBe(3);
    // **AND MY FIRST EXPECTATION HERE WAS WRONG, WHICH IS WORTH LEAVING IN.** I asserted that 80 braces was two
    // segments; 80 braces is exactly 160 septets, which is exactly one full segment. The property that matters is the
    // one below: 81 braces costs a second segment while 81 ordinary characters does not, so a template can double in
    // price on an edit that adds one character and shortens nothing a reader would notice.
    expect(segmentsFor('{'.repeat(80)).segments).toBe(1);
    expect(segmentsFor('{'.repeat(81)).segments).toBe(2);
    expect(segmentsFor('a'.repeat(81)).segments).toBe(1);
  });

  it('counts an astral character as two UCS-2 units, because that is how it is billed', () => {
    expect(unitsOf('😀', 'ucs2')).toBe(2);
  });

  it('uses 160/153 for GSM-7 and 70/67 for UCS-2', () => {
    expect(segmentsFor('a'.repeat(160)).segments).toBe(1);
    expect(segmentsFor('a'.repeat(161)).segments).toBe(2);
    expect(segmentsFor('a'.repeat(306)).segments).toBe(2);   // 2 × 153
    expect(segmentsFor('a'.repeat(307)).segments).toBe(3);
    expect(segmentsFor('ક'.repeat(70)).segments).toBe(1);
    expect(segmentsFor('ક'.repeat(71)).segments).toBe(2);
    expect(segmentsFor('ક'.repeat(134)).segments).toBe(2);   // 2 × 67
    expect(segmentsFor('ક'.repeat(135)).segments).toBe(3);
  });

  it('reports an empty body as zero segments, not one', () => {
    // A billable segment for a template with no words would hide the defect behind a plausible number.
    expect(segmentsFor('').segments).toBe(0);
  });

  it('counts the RENDERED length, not the template length', () => {
    // `{{order_id}}` is 12 characters and ORD-2026-088412 is 15. Counting the template under-reports every time, always
    // in the direction that hides a cost.
    const rendered = renderWithSamples('Order {{order_id}}', { order_id: 'ORD-2026-088412' });
    expect(rendered).toBe('Order ORD-2026-088412');
    expect(segmentsFor(rendered).characters).toBeGreaterThan(segmentsFor('Order {{order_id}}').characters);
  });

  it('applies the ≤2 budget to ordinary events and exempts critical ones', () => {
    expect(exceedsSegmentBudget(3, 'important')).toBe(true);
    expect(exceedsSegmentBudget(2, 'important')).toBe(false);
    // An OTP truncated to save a fraction of a rupee is a message that failed at the only job it had.
    expect(exceedsSegmentBudget(4, 'critical')).toBe(false);
  });

  it('refuses an over-budget SMS draft with the cost in the message', () => {
    const long = 'ક'.repeat(200);
    const v = assessDraft(
      { eventCode: 'order.delivered', channel: 'sms', languageCode: 'gu', tenantId: null, subject: null,
        body: long, providerTemplateRef: 'DLT-1' }, delivered, []);
    expect(v.ok).toBe(false);
    const p = v.problems.find((x) => x.code === 'segment_budget');
    expect(p?.detail).toContain('67 chars per segment');
  });

  it('does not count segments for a non-SMS channel', () => {
    const v = assessDraft(
      { eventCode: 'order.delivered', channel: 'push', languageCode: 'gu', tenantId: null, subject: null,
        body: 'ક'.repeat(400), providerTemplateRef: null }, delivered, []);
    expect(v.segments).toBeNull();
    expect(v.ok).toBe(true);
  });

  it('maps our placeholders to DLT syntax', () => {
    // `{{var}}` registered as-is fails DLT content scrubbing, which does not bounce — it stops delivering.
    expect(toDltTemplate('Order {{order_id}} — {{amount}}')).toBe('Order {#var#} — {#var#}');
  });
});

describe('ADMIN-11b · coverage is what W101 counts', () => {
  const events = [delivered, otp];

  it('counts a DEFAULT channel with no platform template, not every combination', () => {
    // The full cross-product of 214 events × 6 channels × every language is a five-figure number that can never reach
    // zero, which would make the tile meaningless.
    const gaps = coverageGaps({ events, liveLanguages: ['en', 'gu'], present: new Set(['order.delivered|sms|en']) });
    expect(gaps).toHaveLength(5);   // delivered: sms/gu, push/en, push/gu · otp: sms/en, sms/gu
    expect(gaps.some((g) => g.channel === 'inapp')).toBe(false);
  });

  it('is empty when every default channel is covered in every live language', () => {
    const present = new Set([
      'order.delivered|sms|en', 'order.delivered|sms|gu', 'order.delivered|push|en', 'order.delivered|push|gu',
      'auth.otp|sms|en', 'auth.otp|sms|gu',
    ]);
    expect(coverageGaps({ events, liveLanguages: ['en', 'gu'], present })).toEqual([]);
  });

  it('counts against LIVE languages only', () => {
    // A gap in a language nobody has launched is not a gap, and counting it puts a number on the dashboard that can
    // never reach zero.
    const gaps = coverageGaps({ events, liveLanguages: ['en'], present: new Set(['order.delivered|sms|en', 'order.delivered|push|en', 'auth.otp|sms|en']) });
    expect(gaps).toEqual([]);
  });

  it('ranks a gap on critical copy above a marketing one', () => {
    // The EN/HI fallback covers a missing Gujarati marketing body acceptably; an OTP falling back to a language the
    // recipient cannot read is a login they cannot complete.
    expect(severityOf('critical')).toBe('critical');
    expect(severityOf('important')).toBe('important');
    expect(severityOf('promotional')).toBe('ordinary');
    expect(severityOf('informational')).toBe('ordinary');
  });
});

describe('ADMIN-11b · the whole verdict', () => {
  it('accepts a valid platform draft and reports its cost and its checker', () => {
    const v = assessDraft(
      { eventCode: 'order.delivered', channel: 'sms', languageCode: 'en', tenantId: null, subject: null,
        body: 'Order {{order_id}} delivered. Total {{amount}}.', providerTemplateRef: 'DLT-1107172' }, delivered, vars);
    expect(v.ok).toBe(true);
    expect(v.problems).toEqual([]);
    expect(v.segments?.segments).toBe(1);
    expect(v.renderedPreview).toContain('ORD-2026-088412');
    expect(v.needsSecondPerson).toBe(false);
  });

  it('collects every problem at once rather than one at a time', () => {
    // W2282/W2291: "every invalid field is listed with its reason". One problem per attempt turns that into a guessing
    // game in a language the author may not read.
    const v = assessDraft(
      { eventCode: 'auth.otp', channel: 'sms', languageCode: 'gu', tenantId: 'tenant-1', subject: null,
        body: '{{code}} ' + 'ક'.repeat(200), providerTemplateRef: null },
      { ...otp, priority: 'important', userCanOptOut: false },
      [{ name: 'otp', sourceRef: 'generated', sampleValue: '482913', isRequired: true }]);
    const codes = v.problems.map((p) => p.code);
    expect(codes).toContain('security_copy_platform_only');
    expect(codes).toContain('unknown_variables');
    expect(codes).toContain('missing_required_variables');
    expect(codes).toContain('segment_budget');
    expect(codes.length).toBeGreaterThanOrEqual(4);
  });

  it('refuses an empty body', () => {
    const v = assessDraft(
      { eventCode: 'order.delivered', channel: 'push', languageCode: 'en', tenantId: null, subject: 'hi', body: '   ',
        providerTemplateRef: null }, delivered, []);
    expect(v.problems.map((p) => p.code)).toContain('body_empty');
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* THE SERVICE LAYER, TESTED ALONE                                                                   */
/* ------------------------------------------------------------------------------------------------ */
// **A MUTATION SURVIVED AND THIS BLOCK IS WHY IT EXISTS.** Deleting the explicit security-copy refusal from
// `authorVersion` broke NOTHING: `assessDraft` refuses the same draft, so the request was still rejected — as a 422
// "draft refused" instead of a 403 "platform-controlled". Which means the guard the plane's security rests on was
// invisible to the suite, and the console's error mapping (which reads the 403 to say "this wording is not yours to
// change" rather than "fix the highlighted fields") rested on a line no test held down.
//
// Third wave running that this shape has appeared: a rule enforced in two places, verified only through one of them.
import { TemplatesOpsService } from '../services/templates-ops.service';
import { SecurityCopyPlatformOnlyError, TemplateDraftRefusedError } from '../domain/templates-ops.errors';

function service(event: Record<string, unknown>) {
  const withTx = jest.fn(async (fn: (c: unknown) => Promise<unknown>) => fn({ query: jest.fn() }));
  const repo = {
    eventWithVariables: jest.fn().mockResolvedValue(event),
    byKey: jest.fn().mockResolvedValue(null),
    createTemplateShell: jest.fn().mockResolvedValue('tpl-1'),
    nextVersionNo: jest.fn().mockResolvedValue(1),
    insertVersion: jest.fn().mockResolvedValue('ver-1'),
  };
  const audit = { write: jest.fn().mockResolvedValue(undefined) };
  const svc = new TemplatesOpsService({ withTx } as never, repo as never, audit as never);
  return { svc, repo, withTx, audit };
}

const actor = { userId: 'admin-a', roles: ['platform_templates_ops'], ip: '10.0.0.1', requestId: 'r1' } as never;
const draft = {
  eventCode: 'auth.otp', channel: 'sms', languageCode: 'gu', tenantId: 'tenant-1',
  body: '{{otp}} is your code', reason: 'Tenant asked for its own OTP wording in Gujarati.',
};

describe('ADMIN-11b · the service refuses a tenant override on security copy ITSELF', () => {
  const otpEvent = {
    code: 'auth.otp', priority: 'critical', userCanOptOut: false, defaultChannels: ['sms'],
    variables: [{ name: 'otp', sourceRef: 'generated', sampleValue: '482913', isRequired: true }],
  };

  it('throws the 403 that names the rule, not the 422 that says "fix your fields"', async () => {
    const { svc } = service(otpEvent);
    // The distinction is the whole point: 403 tells an operator the wording is not theirs to change; 422 tells them to
    // correct a field, which is advice they cannot act on.
    await expect(svc.authorVersion(actor, draft)).rejects.toBeInstanceOf(SecurityCopyPlatformOnlyError);
    await expect(svc.authorVersion(actor, draft)).rejects.not.toBeInstanceOf(TemplateDraftRefusedError);
  });

  it('refuses BEFORE it opens a transaction', async () => {
    // A refusal that reached the transaction would create the template shell and then abort — and on a retry loop that
    // is a row appearing and disappearing for an act that is never allowed.
    const { svc, withTx, repo } = service(otpEvent);
    await expect(svc.authorVersion(actor, draft)).rejects.toBeInstanceOf(SecurityCopyPlatformOnlyError);
    expect(withTx).not.toHaveBeenCalled();
    expect(repo.createTemplateShell).not.toHaveBeenCalled();
    expect(repo.insertVersion).not.toHaveBeenCalled();
  });

  it('still writes a PLATFORM version of the same security-copy wording', async () => {
    // The rule is about tenant ownership, not about OTP copy being unchangeable: the platform must be able to fix its
    // own one-time-password wording, with a second administrator on the approval.
    const { svc, repo } = service(otpEvent);
    const out = await svc.authorVersion(actor, { ...draft, tenantId: null, providerTemplateRef: 'DLT-1107169' });
    expect(repo.insertVersion).toHaveBeenCalledTimes(1);
    expect(repo.insertVersion.mock.calls[0][1]).toMatchObject({ needsSecondPerson: true, tenantId: null });
    expect(out.needsSecondPerson).toBe(true);
    // A NEW version is never born approved, even for an operator who could approve it in the next breath.
    expect(out.lifecycle).toBe('draft');
  });

  it('lets a tenant author ordinary copy, and records that no checker is needed', async () => {
    const { svc, repo } = service({
      code: 'order.delivered', priority: 'important', userCanOptOut: true, defaultChannels: ['sms'], variables: [],
    });
    const out = await svc.authorVersion(actor, {
      eventCode: 'order.delivered', channel: 'push', languageCode: 'gu', tenantId: 'tenant-1',
      body: 'Your order arrived', reason: 'Tenant wants its own delivery wording in Gujarati.',
    });
    expect(repo.insertVersion).toHaveBeenCalledTimes(1);
    expect(out.needsSecondPerson).toBe(false);
  });

  it('drops the provider ref on an SMS body change and says so in the response', async () => {
    // W102's third guard rail, at the layer that performs it: the console needs to TELL the author, not discover it
    // later when the approval is refused for a missing registration.
    const { svc, repo } = service({
      code: 'order.delivered', priority: 'important', userCanOptOut: true, defaultChannels: ['sms'], variables: [],
    });
    repo.byKey.mockResolvedValue({
      id: 'tpl-1', body: 'the old wording', providerTemplateRef: 'DLT-OLD', channel: 'sms',
    });
    const out = await svc.authorVersion(actor, {
      eventCode: 'order.delivered', channel: 'sms', languageCode: 'en', tenantId: null,
      body: 'a different wording entirely', reason: 'Legal asked for the refund window to be named.',
    });
    expect(out.providerRefStaled).toBe(true);
    expect(repo.insertVersion.mock.calls[0][1]).toMatchObject({ providerTemplateRef: null });
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* THE SQL, ASSERTED — a second survivor, and a different lesson                                     */
/* ------------------------------------------------------------------------------------------------ */
// **THE SECOND MUTATION THAT SURVIVED WAS A ONE-WORD CHANGE IN A SQL LITERAL**: `'draft'` → `'approved'` in the version
// INSERT. Every domain test still passed, the service still returned `lifecycle: 'draft'` (it returns the constant, not
// the row), and a version would have been born APPROVED — bypassing the sixteenth maker-checker site entirely, in the
// one place on this plane where a second person is the whole control.
//
// The lesson generalises past this file: a rule expressed in SQL is invisible to a domain suite. So the literals that
// carry a RULE — the starting lifecycle, the digest, the supersede-then-promote pair — are asserted against the
// statement text, the same way apps/api's tenant-isolation spec asserts that a query binds `tenant_id`.
import { TemplatesRepository } from '../repositories/templates.repository';

function captured() {
  const calls: { sql: string; params: unknown[] }[] = [];
  const client = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return { rows: [{ id: 'ver-1', n: 1 }] };
    }),
  };
  const repo = new TemplatesRepository({ query: client.query } as never);
  return { repo, client, calls };
}

describe('ADMIN-11b · the rules carried in SQL literals', () => {
  it('starts every version at draft, never at approved', async () => {
    const { repo, client, calls } = captured();
    await repo.insertVersion(client as never, {
      templateId: 't1', tenantId: null, eventCode: 'auth.otp', channel: 'sms', languageCode: 'en',
      versionNo: 2, subject: null, body: '{{otp}} is your code', providerTemplateRef: 'DLT-1',
      needsSecondPerson: true, authoredByAdminId: 'admin-a', reason: 'a reason of sufficient length here',
    });
    const insert = calls.find((c) => /INSERT INTO notification_template_versions/.test(c.sql));
    expect(insert).toBeDefined();
    // A version born approved would bypass the second person entirely — the whole control on security copy.
    expect(insert!.sql).toMatch(/'draft'/);
    expect(insert!.sql).not.toMatch(/'approved'/);
    // The digest is computed BY THE DATABASE over the same bind as the body, so it cannot disagree with the words.
    expect(insert!.sql).toMatch(/encode\(digest\(\$8,'sha256'\),'hex'\)/);
  });

  it('supersedes the old approved version in the same call set that promotes the new one', async () => {
    // Two approved versions and no way to tell which is live is worse than either alone.
    const { repo, client, calls } = captured();
    await repo.promoteToServing(client as never, 't1', 'ver-2');
    const [supersede, promote] = calls;
    expect(supersede.sql).toMatch(/SET lifecycle = 'superseded'/);
    expect(supersede.sql).toMatch(/lifecycle = 'approved' AND id <> \$2/);
    expect(promote.sql).toMatch(/SET serving_version_id = \$2, is_active = true/);
  });

  it('creates a template shell that cannot send: inactive, version zero', async () => {
    // 0012 defaults `is_active` to TRUE. Inheriting that default is how an unapproved body would start sending the
    // moment its row appeared.
    const { repo, client, calls } = captured();
    await repo.createTemplateShell(client as never, {
      eventCode: 'order.delivered', channel: 'sms', languageCode: 'gu', tenantId: null, adminId: 'admin-a',
    });
    expect(calls[0].sql).toMatch(/VALUES \(\$1,\$2,\$3,\$4,NULL,'',NULL,false,0,\$5\)/);
  });

  it('runs 0122’s audit query as part of the census, joined to the catalogue', async () => {
    const { repo, calls } = captured();
    await repo.census();
    const sql = calls[0].sql;
    // **A SECURITY-OVERRIDE COUNT DERIVED FROM `notification_templates` ALONE WOULD ALWAYS READ ZERO**, because the
    // table does not know which events are opt-out-locked. The join to the catalogue IS the figure.
    expect(sql).toMatch(/JOIN notification_events e ON e\.code = t\.event_code/);
    expect(sql).toMatch(/e\.user_can_opt_out = false OR e\.priority = 'critical'/);
    expect(sql).toMatch(/t\.tenant_id IS NOT NULL/);
    // The pending-registration figure is counted from the SERVING version, because the registration belongs to the
    // words rather than to the row.
    expect(sql).toMatch(/COALESCE\(v\.provider_template_ref, t\.provider_template_ref\) IS NULL/);
    expect(sql).toMatch(/t\.channel IN \('sms','whatsapp'\)/);
  });
});
