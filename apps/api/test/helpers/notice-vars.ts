import { UiMessageRepository } from '../../src/core/i18n/ui-message.repository';
import { LookupsService } from '../../src/modules/lookups/lookups.service';
import { MccCentreRepository } from '../../src/modules/dairy/repositories/mcc-centre.repository';
import { InMemoryCacheService } from '../../src/core/cache/cache.service.in-memory';
import { PromMetrics } from '../../src/core/observability/metrics.prom';
import { DairyNoticeVarsService } from '../../src/modules/dairy/services/dairy-notice-vars.service';
// test/helpers/notice-vars.ts · PC-56 TENANT-6d-7 · one fake for THE WORDS, so a spec that is about something else
// does not have to know how a notice is worded — and so the specs that ARE about it (tenant6d7-*) use the real
// service against real seeded rows instead of this.
//
// The values here are DELIBERATELY REALISTIC (a formatted amount, a digits-only date, a three-language map) rather
// than `{}`: a fake that returns nothing would let the defect this wave closed reappear in every unrelated suite
// without one of them noticing.
export function fakeNoticeVars() {
  const shift = { en: 'evening', hi: 'shaam', gu: 'સાંજ' };
  return {
    qualityOpened: async () => ({ mcc: 'Vanthali', shift }),
    qualityDecided: async () => ({ outcome: { en: 'cleared', hi: 'theek paya gaya', gu: 'પાસ થયું' } }),
    billPreviewed: async () => ({
      period: '01/07–15/07', litres: '204.526', net: 'INR 8,412.00', deductions: 'INR 0.00', window_ends: '16/07 09:00',
    }),
    billDisputeResolved: async () => ({
      period: '01/07–15/07', outcome: { en: 'your objection was accepted', gu: 'તમારો વાંધો સ્વીકાર્યો' }, note: 'n',
    }),
    billConsent: async () => ({
      period: '01/07–15/07', gross: 'INR 9,414.00', deductions: 'INR 2,400.00', threshold_pct: '25',
      lines: { en: 'feed credit INR 500.00, loan INR 1,900.00' },
    }),
    deductionInstruction: async () => ({ what: { en: 'feed credit' }, how_much: { en: 'INR 200.00' } }),
    labels: async () => ({
      shift: { morning: { en: 'morning' }, evening: shift },
      qualityOutcome: { cleared: { en: 'cleared' }, rejected: { en: 'not accepted' } },
      disputeOutcome: { upheld: { en: 'your objection was accepted' }, rejected: { en: 'your objection was not accepted' } },
    }),
  } as never;
}

/**
 * THE REAL SERVICE, for LIVE suites. A fake in an integration test proves the fake works: this wave's own live suite
 * found `{{lines}}` reading *"feed credit INR 500.00"* against a bill whose only line was INR 3,000 — the fake's copy,
 * asserted against a real database. Every dairy live suite builds the real collaborator instead.
 */
export function realNoticeVars(replica: unknown) {
  return new DairyNoticeVarsService(
    new UiMessageRepository(replica as never),
    new LookupsService(replica as never, new InMemoryCacheService(), new PromMetrics()),
    new MccCentreRepository(replica as never),
  );
}
