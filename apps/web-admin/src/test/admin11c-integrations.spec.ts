// apps/web-admin/src/test/admin11c-integrations.spec.ts · PC-56 ADMIN-11c console spec.
//
// Every assertion here defends a sentence the screen could not previously say:
//   • zero keys in a registry NOTHING CAN WRITE TO is not "no tenant has got round to it";
//   • one open circuit breaker out of eight pods is not "open" and is not "closed";
//   • no deliveries attempted is not a 100% success rate;
//   • our own unconfigured secret is not a provider's signature failure.
import {
  backlogClass, backlogKey, canRevoke, circuitClass, circuitKey, fallbackClass, fallbackKey, fleetKey, idleKey,
  keyStateClass, keyStateKey, metricKey, outcomeKey, payloadNoteKey, registryKey, registryNoticeKey,
  revokeWithheldKey, successClass, successKey, tenantEmptyKey, usageKey, verdictClass, verdictKey,
} from '../features/integrations/api-oversight';
import { en } from '../i18n/en';

const dict = en as unknown as Record<string, string>;

describe('ADMIN-11c · two registries, one of which no code has ever written', () => {
  it('labels each registry and warns only on the dormant one', () => {
    expect(registryKey('partner')).toBe('ap11.reg.partner');
    expect(registryKey('tenant')).toBe('ap11.reg.tenant');
    expect(registryNoticeKey('tenant')).toBe('ap11.reg.noIssuer');
    expect(registryNoticeKey('partner')).toBeNull();
  });

  // **THE SENTENCE THIS WAVE EXISTS TO BE ABLE TO SAY.** `api_keys` has existed since migration 0002; no issuance route,
  // no gateway, no last-used stamp, no tenant console screen, through twenty-one further migrations.
  it('says the tenant registry has no issuer, in those words', () => {
    expect(dict['ap11.reg.noIssuer']).toMatch(/HAS NO ISSUER/);
    expect(dict['ap11.reg.noIssuer']).toMatch(/migration 0002/);
    expect(dict['ap11.reg.noIssuer']).toMatch(/no realm has kept/);
  });

  it('uses a different empty state when nothing can create a key', () => {
    // "Keys are created by their owner" would invite exactly the wrong conclusion on the dormant registry.
    expect(tenantEmptyKey(true)).toBe('ap11.keys.emptyNoIssuer');
    expect(tenantEmptyKey(false)).toBe('ap11.keys.empty');
    expect(dict['ap11.keys.emptyNoIssuer']).toMatch(/nothing can create one/);
  });

  it('states that this plane does not issue, and why', () => {
    expect(dict['ap11.noIssuanceHere']).toMatch(/minted an identity that acts as the tenant/);
  });

  it('never renders a hash, and says that is the rule', () => {
    expect(dict['ap11.hashesOnly']).toMatch(/a hash in a screenshot/);
  });
});

describe('ADMIN-11c · key state', () => {
  it('labels all four states and treats a never-used key as a warning', () => {
    for (const s of ['active', 'revoked', 'dormant', 'never_used'] as const) expect(dict[keyStateKey(s)]).toBeTruthy();
    // An unused credential is a credential nobody would notice being stolen.
    expect(keyStateClass('never_used')).toContain('is-warn');
    expect(keyStateClass('dormant')).toContain('is-warn');
    expect(keyStateClass('active')).toContain('is-ok');
  });

  it('shows the idle days only when they matter', () => {
    expect(idleKey({ lastUsedAt: null, idleDays: null })).toBe('ap11.key.neverUsedCell');
    expect(idleKey({ lastUsedAt: '2026-08-10T00:00:00Z', idleDays: 1 })).toBe('ap11.key.idle');
    expect(idleKey({ lastUsedAt: '2026-04-04T00:00:00Z', idleDays: 129 })).toBe('ap11.key.idleLong');
    expect(dict['ap11.key.idleLong']).toMatch(/\{days\}d unused/);
  });

  // Absent, not disabled: a second revocation would overwrite the reason the first recorded, which is the only record
  // of why an integration stopped working.
  it('withholds the revoke control on an already-revoked key, with the reason shown', () => {
    expect(canRevoke({ revokedAt: null })).toBe(true);
    expect(canRevoke({ revokedAt: '2026-07-12T00:00:00Z' })).toBe(false);
    expect(revokeWithheldKey({ revokedAt: '2026-07-12T00:00:00Z', revokedReason: 'unused for 100 days' }))
      .toBe('ap11.key.revokedWithReason');
    // A row revoked before this release has no reason, and the console says which rule it predates rather than showing
    // a blank.
    expect(revokeWithheldKey({ revokedAt: '2026-07-12T00:00:00Z', revokedReason: null })).toBe('ap11.key.revokedNoReason');
    expect(dict['ap11.key.revokedNoReason']).toMatch(/predates the rule/);
    expect(revokeWithheldKey({ revokedAt: null, revokedReason: null })).toBeNull();
  });

  it('renders hourly usage as absent with its reason, never as a number', () => {
    // The counter lives in Redis inside apps/api; this realm has no client for it, and any number here would be a
    // different quantity wearing a rate limit's label.
    expect(usageKey({ hourlyUsage: null })).toBe('ap11.usage.noSource');
    expect(usageKey({ hourlyUsage: 4_980 })).toBe('ap11.usage.count');
    expect(dict['ap11.usage.noSource']).toMatch(/no client for it/);
  });

  it('demands twenty characters of reason before a revocation', () => {
    expect(dict['ap11.revokeHelp']).toMatch(/fail closed/);
    expect(dict['ap11.err.alreadyRevoked']).toMatch(/overwrite the reason/);
  });
});

describe('ADMIN-11c · a circuit breaker is per-process and the console says so', () => {
  it('labels every state and calls silence "nothing reported"', () => {
    for (const s of ['closed', 'open', 'half_open'] as const) expect(dict[circuitKey(s)]).toBeTruthy();
    expect(circuitKey('unknown')).toBe('ap11.circ.unknown');
    expect(circuitKey('tripped')).toBe('ap11.circ.unknown');
    expect(circuitClass('open')).toContain('is-danger');
    expect(circuitClass('half_open')).toContain('is-warn');
    expect(circuitClass('closed')).toContain('is-ok');
    // Silence is not health — the sixth time this programme has had to make that explicit.
    expect(circuitClass('unknown')).toContain('is-warn');
  });

  it('counts the instances rather than inventing one platform answer', () => {
    expect(fleetKey({ instancesOpen: 0, instancesReporting: 0 })).toBe('ap11.circ.noReports');
    expect(fleetKey({ instancesOpen: 0, instancesReporting: 8 })).toBe('ap11.circ.allClosed');
    expect(fleetKey({ instancesOpen: 3, instancesReporting: 8 })).toBe('ap11.circ.someOpen');
    expect(fleetKey({ instancesOpen: 8, instancesReporting: 8 })).toBe('ap11.circ.allOpen');
    expect(dict['ap11.circ.someOpen']).toMatch(/fraction of traffic is failing fast/);
    expect(dict['ap11.circ.perInstance']).toMatch(/PER-PROCESS/);
    expect(dict['ap11.circ.noReports']).toMatch(/opposite conclusions/);
  });

  // A blank Fallback column means two opposite things: forbidden because money, or simply undefended.
  it('separates a forbidden fallback from a missing one', () => {
    expect(fallbackKey({ fallbackStrategy: null, isMoney: true, fallbackActive: false })).toBe('ap11.fb.forbidden');
    expect(fallbackKey({ fallbackStrategy: null, isMoney: false, fallbackActive: false })).toBe('ap11.fb.none');
    expect(fallbackKey({ fallbackStrategy: 'voice-OTP', isMoney: false, fallbackActive: false })).toBe('ap11.fb.declared');
    expect(fallbackKey({ fallbackStrategy: 'voice-OTP', isMoney: false, fallbackActive: true })).toBe('ap11.fb.active');
    expect(dict['ap11.fb.forbidden']).toMatch(/failed debit must fail/);
    // An undefended dependency is a warning; a money call with no fallback is correct and is not.
    expect(fallbackClass({ fallbackStrategy: null, isMoney: false, fallbackActive: false })).toContain('is-warn');
    expect(fallbackClass({ fallbackStrategy: null, isMoney: true, fallbackActive: false })).not.toContain('is-warn');
    expect(fallbackClass({ fallbackStrategy: 'voice-OTP', isMoney: false, fallbackActive: true })).toContain('is-warn');
  });

  it('renders p95 and error rate as absent, with the reason on the page', () => {
    expect(metricKey(null)).toBe('ap11.latency.noSource');
    expect(metricKey(412)).toBe('ap11.latency.value');
    expect(dict['ap11.ph.noMetrics']).toMatch(/is not an error rate/);
    expect(dict['ap11.ph.noProbe']).toMatch(/nothing probes any provider/i);
  });
});

describe('ADMIN-11c · outbound delivery', () => {
  it('refuses to read an empty window as a perfect one', () => {
    expect(successKey(null)).toBe('ap11.deliv.noTraffic');
    expect(successClass(null)).toContain('is-warn');
    expect(dict['ap11.deliv.noTraffic']).toMatch(/not a success rate of 100%/);
    expect(successKey(9_680)).toBe('ap11.deliv.ok');
    expect(successKey(8_500)).toBe('ap11.deliv.poor');
    expect(successClass(8_500)).toContain('is-danger');
  });

  // A pending retry is the system working. A delivery past eight attempts is an event the tenant will never receive.
  it('treats an exhausted delivery as the number that matters', () => {
    expect(backlogKey({ pendingRetry: 0, exhausted24h: 0 })).toBe('ap11.deliv.clear');
    expect(backlogKey({ pendingRetry: 142, exhausted24h: 0 })).toBe('ap11.deliv.backlog');
    expect(backlogKey({ pendingRetry: 142, exhausted24h: 3 })).toBe('ap11.deliv.exhausted');
    expect(backlogClass({ pendingRetry: 0, exhausted24h: 1 })).toContain('is-danger');
    expect(dict['ap11.deliv.exhausted']).toMatch(/never reach the tenant/);
    expect(dict['ap11.deliv.backlog']).toMatch(/the system working/);
  });
});

describe('ADMIN-11c · inbound receipts, which had no source at all', () => {
  it('names five failure reasons a boolean collapses into one', () => {
    expect(verdictKey({ signatureOk: true, signatureReason: 'ok' })).toBe('ap11.sig.ok');
    for (const r of ['absent', 'mismatch', 'secret_unconfigured', 'unsupported_provider', 'unparseable']) {
      expect(verdictKey({ signatureOk: false, signatureReason: r })).toBe(`ap11.sig.${r}`);
      expect(dict[`ap11.sig.${r}`]).toBeTruthy();
    }
    expect(verdictKey({ signatureOk: false, signatureReason: 'weird' })).toBe('ap11.sig.failedUnknown');
  });

  // **OUR OWN MISSING SECRET IS NOT A PROVIDER'S SIGNATURE FAILURE.** Counted as one, it sends an operator to rotate
  // somebody else's credential over an environment variable on our side.
  it('says whose fault an unconfigured secret is', () => {
    expect(dict['ap11.sig.secret_unconfigured']).toMatch(/OUR secret/);
  });

  it('treats an unsettled receipt as a finding, not a pass', () => {
    expect(verdictKey({ signatureOk: null, signatureReason: null })).toBe('ap11.sig.undecided');
    expect(verdictClass({ signatureOk: null })).toContain('is-warn');
    expect(verdictClass({ signatureOk: true })).toContain('is-ok');
    expect(verdictClass({ signatureOk: false })).toContain('is-danger');
  });

  it('calls a refused callback ignored rather than failed', () => {
    // The platform declined; it did not try and fail. One is a defence working, the other is an incident.
    expect(outcomeKey('ignored')).toBe('ap11.out.ignored');
    expect(dict['ap11.out.ignored']).toMatch(/declined/);
    expect(outcomeKey('failed')).toBe('ap11.out.failed');
    expect(outcomeKey('nonsense')).toBe('ap11.out.other');
  });

  it('admits when a stored payload is partial', () => {
    expect(payloadNoteKey({ truncated: true })).toBe('ap11.payload.truncated');
    expect(payloadNoteKey({ truncated: false })).toBeNull();
  });

  it('does not let an empty log read as a clean one', () => {
    expect(dict['ap11.inbound.beganWithRelease']).toMatch(/began with this release/);
    expect(dict['ap11.inbound.beganWithRelease']).toMatch(/discarded the bytes/);
    expect(dict['ap11.inbound.emptyBody']).toMatch(/Do not read this as/);
  });

  it('says the payload archive holds PII and how long it lives', () => {
    expect(dict['ap11.inbound.piiNote']).toMatch(/PII/);
    expect(dict['ap11.inbound.piiNote']).toMatch(/90 days/);
    expect(dict['ap11.inbound.piiNote']).toMatch(/ADMIN-11c-Q3/);
  });
});
