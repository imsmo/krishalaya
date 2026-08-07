// apps/admin-api/src/modules/compliance-ops/services/compliance-posture.service.ts · W048, the compliance overview.
//
// W048 calls itself "the page a regulator or enterprise buyer would ask to see", and that is the whole design
// constraint: every number will be read by somebody with an incentive to check it, and one overstated tile costs the
// credibility of the other five.
//
// So the rule here is stricter than elsewhere in the console. Each source is read independently and its READABILITY is
// tracked — "all quiet" is only claimable when every register was actually readable, because an empty attention list
// assembled from sources that failed to load says "nothing needs attention" when the truth is "we could not look".
import { Injectable } from '@nestjs/common';
import { ComplianceRepository } from '../repositories/compliance.repository';
import {
  CERTIFICATIONS, publicCertificationView, tile, retentionCoverage, orderAttention, allQuietClaimable,
  type AttentionItem,
} from '../domain/posture';
import { notifyClock, NOTIFY_WINDOW_HOURS } from '../domain/breach-notification';

@Injectable()
export class CompliancePostureService {
  constructor(private readonly repo: ComplianceRepository) {}

  async posture(now = new Date()) {
    const read = { dsr: false, breaches: false, retention: false, consent: false };
    const attention: AttentionItem[] = [];

    let counts: Awaited<ReturnType<ComplianceRepository['postureCounts']>> | null = null;
    try { counts = await this.repo.postureCounts(); read.dsr = true; read.breaches = true; read.consent = true; }
    catch { /* each tile below degrades to unavailable */ }

    let retention: ReturnType<typeof retentionCoverage> | null = null;
    try { retention = retentionCoverage(await this.repo.retentionPolicyShapes()); read.retention = true; }
    catch { /* unavailable */ }

    // Breach notification windows — the only clocks on this page with a statutory deadline behind them.
    try {
      for (const b of await this.repo.breachesNeedingNotification()) {
        const clock = notifyClock(b.detectedAt, null, now);
        if (clock.kind === 'breached') {
          attention.push({ id: `breach-${b.id}`, severity: 'overdue', messageKey: 'breachOverdue', params: { title: b.title, hours: String(clock.hoursOver) }, href: `/compliance/breaches/${b.id}` });
        } else if (clock.kind === 'due') {
          attention.push({ id: `breach-${b.id}`, severity: 'due_soon', messageKey: 'breachDue', params: { title: b.title, hours: String(clock.hoursLeft) }, href: `/compliance/breaches/${b.id}` });
        } else {
          // An unmeasured clock on a breach register is itself worth flagging: a breach with no detection time cannot
          // be shown to have been notified in time.
          attention.push({ id: `breach-${b.id}`, severity: 'blocking', messageKey: 'breachUnmeasured', params: { title: b.title }, href: `/compliance/breaches/${b.id}` });
        }
      }
    } catch { read.breaches = false; }

    // A MANDATORY consent purpose with no published notice blocks nothing today and should — it means people are
    // agreeing at signup to words that do not exist. W047's own launch-gate example ("ai_training notice missing in
    // ta/kn/ml — blocks Tamil Nadu launch gate") is this class of item.
    if (counts && counts.purposesWithoutNotice > 0) {
      attention.push({
        id: 'consent-notices', severity: 'blocking', messageKey: 'purposesWithoutNotice',
        params: { n: String(counts.purposesWithoutNotice) }, href: '/compliance/consent/purposes',
      });
    }
    if (retention && retention.unrunnable > 0) {
      attention.push({
        id: 'retention-pipelines', severity: 'blocking', messageKey: 'retentionUnrunnable',
        params: { n: String(retention.unrunnable), actions: retention.unrunnableActions.join(', ') }, href: '/compliance/retention',
      });
    }

    const items = orderAttention(attention);
    return {
      tiles: {
        openDsr: tile(counts?.openDsr, 'the rights-request register could not be read'),
        openBreaches: tile(counts?.openBreaches, 'the breach register could not be read'),
        containedBreaches: tile(counts?.containedBreaches, 'the breach register could not be read'),
        // NOT a "61/61 ✓" fraction. The retention worker implements `delete` only — by its own comment — so a green
        // fraction over policies the platform has no pipeline for would be the most reassuring false statement here.
        retention: retention
          ? { kind: 'coverage' as const, ...retention }
          : { kind: 'unavailable' as const, reason: 'the retention policy table could not be read' },
        mandatoryPurposes: tile(counts?.mandatoryPurposes, 'the consent registry could not be read'),
        purposesWithoutNotice: tile(counts?.purposesWithoutNotice, 'the consent registry could not be read'),
      },
      attention: items,
      allQuiet: allQuietClaimable(items, read),
      sourcesRead: read,
      notifyWindowHours: NOTIFY_WINDOW_HOURS,
      // THE SOURCE OF TRUTH for the public trust page. W048: "No certification is claimed before it is held — the
      // public trust page mirrors this list verbatim." Two hand-maintained lists drift, and the direction that matters
      // is the public one claiming something the internal one does not.
      certifications: publicCertificationView(),
      certificationCount: CERTIFICATIONS.length,
      // Said in the payload rather than left to the console: nothing here is precomputed, so a failure means no number
      // rather than a stale one. W048's error copy promises cached values; there is no cache.
      computedLive: true as const,
    };
  }
}
