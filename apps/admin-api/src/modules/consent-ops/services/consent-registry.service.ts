// apps/admin-api/src/modules/consent-ops/services/consent-registry.service.ts · W046, the consent registry.
//
// THE ADMIN CONSOLE HAS NEVER SEEN THIS TABLE. `consents` has existed since 0001, is correctly append-only, and holds
// 8,42,196 events in the canon's own header — and there was no admin endpoint, no page, and no permission. This is the
// first read.
//
// Two rules it inherits from ADMIN-4b and one it adds:
//   • PII IS MASKED SERVER-SIDE (the mask moved to core/pii at this, its second consumer). The registry names a farmer
//     and what they agreed to; a screenshot of it is a list of people and their choices.
//   • WITHDRAWN IS NOT A STATE. The schema stores `granted boolean` append-only, so a withdrawal is a `granted:false`
//     event superseding a prior grant — and a `granted:false` with NO prior grant is a REFUSAL. Counting refusals as
//     withdrawals would inflate every withdrawal number with people who simply said no the first time.
//   • A CONSENT WHOSE WORDS WERE NEVER RECORDED IS FLAGGED. Before 0108 `consents.version` pointed at a mutable column,
//     so the notice text for any superseded version is gone. Rendering "v2" with no way to produce v2 would claim a
//     record of informed consent that does not exist.
import { Injectable } from '@nestjs/common';
import { ConsentOpsRepository } from '../repositories/consent-ops.repository';
import { maskApplicant } from '../../../core/pii/mask';
import { decisionKind, noticeProvenance, isConsentChannel, IVR_EVIDENCE_GAP } from '../domain/consent-notice';
import { InvalidConsentInputError } from '../domain/consent-ops.errors';

const cursorOf = (createdAt: any, id: string) => Buffer.from(`${createdAt?.toISOString?.() ?? createdAt}|${id}`).toString('base64');

@Injectable()
export class ConsentRegistryService {
  constructor(private readonly repo: ConsentOpsRepository) {}

  async list(q: { purposeCode?: string; channel?: string; withdrawnOnly?: string; cursor?: { c: string; id: string }; limit: number }) {
    // A bad channel THROWS rather than being ignored — an ignored filter shows every consent event on the platform while
    // the chip claims one channel, and somebody will read the screen and believe it.
    if (q.channel && !isConsentChannel(q.channel)) {
      throw new InvalidConsentInputError(`channel must be one of app|web|ambassador_assisted|ivr`);
    }
    const withdrawnOnly = q.withdrawnOnly === 'true';
    if (q.withdrawnOnly !== undefined && q.withdrawnOnly !== 'true' && q.withdrawnOnly !== 'false' && q.withdrawnOnly !== '') {
      throw new InvalidConsentInputError('withdrawnOnly must be true or false');
    }
    const rows = await this.repo.listConsents({ purposeCode: q.purposeCode, channel: q.channel, withdrawnOnly }, q.cursor, q.limit);

    const items = rows.map((r: any) => ({
      id: r.id,
      principal: maskApplicant({ userId: r.user_id, fullName: r.principal_name, phone: r.principal_phone }),
      purposeCode: r.purpose_code,
      version: r.version,
      granted: r.granted === true,
      // The three-way W046's own display note describes.
      decision: decisionKind(r.granted === true, r.had_prior_grant === true),
      channel: r.channel,
      // An ambassador is staff acting in role, not a data subject on this screen — the id is what an operator needs to
      // find their record, and masking it would remove the accountability the assisted channel exists to provide.
      assistedBy: r.assisted_by ?? null,
      // Can we show this person the words they agreed to?
      provenance: noticeProvenance({ version: r.version ?? null, consentPurposeVersionId: r.consent_purpose_version_id ?? null }),
      at: r.created_at,
    }));
    const last = rows[rows.length - 1] as any;
    return {
      items,
      // Said in the payload: an IVR consent's evidence is the recording and there is nowhere to store its reference.
      ivrEvidence: IVR_EVIDENCE_GAP,
      nextCursor: rows.length === q.limit && last ? cursorOf(last.created_at, last.id) : null,
    };
  }

  /** W046's tiles. The assisted share is over EVENTS, and it says so — the canon's "38% assisted" is an event share and
   *  calling it a share of people would be a different, smaller number. */
  async tiles() {
    const t = await this.repo.registryTiles();
    return {
      principals: t.principals,
      totalEvents: t.totalEvents,
      assistedEvents: t.assistedEvents,
      assistedEventPct: t.totalEvents > 0 ? Math.round((t.assistedEvents / t.totalEvents) * 1000) / 10 : null,
      basis: 'events_not_principals' as const,
    };
  }
}
