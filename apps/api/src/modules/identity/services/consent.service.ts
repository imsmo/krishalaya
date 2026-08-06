// modules/identity/services/consent.service.ts · DPDP consent capture (append-only).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { Consent } from '../domain/consent.entity';
import { ConsentRepository } from '../repositories/consent.repository';
import { GrantConsentDto } from '../dto/grant-consent.dto';

@Injectable()
export class ConsentService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    private readonly repo: ConsentRepository,
  ) {}
  async grant(tenantId: string, userId: string, dto: GrantConsentDto) {
    let version = 'v1';
    await this.uow.run(tenantId, async (tx) => {
      // ADMIN-5b: resolved INSIDE the transaction, on the primary. The previous code read it from the replica BEFORE
      // opening the tx, so a version published in between (or simply not yet replicated) stamped the consent with a
      // version the person never saw. See ConsentRepository.currentPublishedVersion for why both halves mattered.
      const current = await this.repo.currentPublishedVersion(tx, dto.purposeCode);
      // No published version means the purpose has no notice anybody could have read. The label falls back to 'v1' as
      // before so an existing caller is not broken, but the POINTER stays null — which is what makes the record honestly
      // say "the words this person agreed to were never recorded" instead of implying they were.
      version = current?.version ?? 'v1';
      const c = Consent.record({ id: uuidv7(), userId, purposeCode: dto.purposeCode, version, granted: dto.granted, channel: dto.channel, assistedBy: dto.assistedBy ?? null, consentPurposeVersionId: current?.id ?? null });
      await this.repo.record(tx, c);
      await this.outbox.write(tx, { tenantId, aggregateType: 'user', aggregateId: userId, eventType: 'identity.consent_changed', payload: { v: 1, userId, purposeCode: dto.purposeCode, granted: dto.granted, version } });
    }, { userId });
    return { ok: true, version };
  }
  list(tenantId: string, userId: string) { return this.repo.latestByUser(tenantId, userId); }

  /** Is the user's LATEST decision for `purposeCode` a grant? Optionally require it was assisted by a specific
   *  user (on-behalf consent: the farmer granted it with this ambassador as assistedBy). DPDP authority check. */
  async isGranted(tenantId: string, userId: string, purposeCode: string, assistedBy?: string): Promise<boolean> {
    const latest = await this.repo.latestForPurpose(tenantId, userId, purposeCode);
    if (!latest || !latest.granted) return false;
    if (assistedBy && latest.assistedBy !== assistedBy) return false;
    return true;
  }
}
