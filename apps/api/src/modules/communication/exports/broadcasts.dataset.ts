// modules/communication/exports/broadcasts.dataset.ts · W2839 / W2840 on the tenant export plane (6e-2) — PC-56 TENANT-8e.
// Dataset `communication.broadcasts`: the cooperative's broadcast history, counts from the delivery log. Registered by
// `CommunicationModule.onModuleInit`. Gated by the read verb (`notification.manage` — the support agent keeps the read;
// tenant_admin holds it too) and by the `communication` flag (`dataset_disabled` with a receipt when off).
import { Injectable } from '@nestjs/common';
import type { DatasetProducer, ProduceContext, ProduceOutcome } from '../../../core/exports-plane/dataset.registry';
import { UiMessageRepository } from '../../../core/i18n/ui-message.repository';
import type { LangMap } from '../../../core/i18n/lang-map';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { BroadcastExportParams, BroadcastExportParamsSchema } from '../dto/create-broadcast.dto';
import { BroadcastRepository } from '../repositories/broadcast.repository';
import { countBroadcast } from '../domain/broadcast-counts';
import { BROADCAST_EXPORT_HEADER, broadcastExportNotes, broadcastExportRow } from '../domain/broadcast-export';
import { CommPermissions } from '../policies/communication.policies';

export const BROADCASTS_DATASET = 'communication.broadcasts';
export const BROADCASTS_DATASET_NAME_KEY = `exports.dataset.${BROADCASTS_DATASET}`;
const PAGE = 100;

@Injectable()
export class BroadcastsDataset implements DatasetProducer<BroadcastExportParams> {
  readonly code = BROADCASTS_DATASET;
  readonly permission: string = CommPermissions.Manage;
  readonly params = BroadcastExportParamsSchema;

  constructor(private readonly repo: BroadcastRepository, private readonly uiMessages: UiMessageRepository, private readonly flags: FlagsService) {}

  datasetName(): Promise<LangMap> { return this.uiMessages.map(BROADCASTS_DATASET_NAME_KEY); }

  async produce(ctx: ProduceContext): Promise<ProduceOutcome> {
    if (!(await this.flags.isEnabled('communication', { tenantId: ctx.tenantId }))) return { kind: 'refused', code: 'dataset_disabled', detail: 'flag communication is off for this tenant' };
    const repo = this.repo; const tenantId = ctx.tenantId;
    // Count first (a bounded read of one tenant's broadcast headers) so the notes can say "no rows" honestly.
    const first = await repo.list(tenantId, { limit: 1 });
    return {
      kind: 'file',
      file: {
        header: BROADCAST_EXPORT_HEADER,
        rows: (async function* () {
          let cursor: string | undefined;
          for (;;) {
            const page = await repo.list(tenantId, { cursor, limit: PAGE });
            const logs = await repo.logGroups(tenantId, page.filter((b) => b.status === 'sent').map((b) => b.id));
            for (const b of page) {
              const l = logs.get(b.id);
              yield broadcastExportRow(b.toJSON(), l ? countBroadcast(l.recipients, l.groups) : null);
            }
            if (page.length < PAGE) return;
            cursor = page[page.length - 1].id;
          }
        })(),
        notes: broadcastExportNotes({ rows: first.length }),
        fileSuffix: 'history',
      },
    };
  }
}
