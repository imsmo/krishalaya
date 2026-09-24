// modules/education/exports/instructor-earnings.dataset.ts · W418's export on the tenant export plane (PC-56 TENANT-7d-money),
// `dairy.insights` (6e-2) as the model. Registered by `EducationModule.onModuleInit`; owns nothing — the rows are the
// SAME statement the page pages through (`InstructorEarningsService.statement`, exhausted page by page), projected by the
// pure `earningsExportRow`. The requester is the INSTRUCTOR: the file is their own lifetime statement and nobody else's
// (the service refuses a member with no row). The screen's flag gates the file (`dataset_disabled` with a receipt).
import { Injectable } from '@nestjs/common';
import type { DatasetProducer, ProduceContext, ProduceOutcome } from '../../../core/exports-plane/dataset.registry';
import { UiMessageRepository } from '../../../core/i18n/ui-message.repository';
import type { LangMap } from '../../../core/i18n/lang-map';
import { EarningsExportParamsSchema, EarningsExportParams } from '../dto/instructor-earnings.dto';
import { EARNINGS_EXPORT_HEADER, earningsExportNotes, earningsExportRow } from '../domain/instructor-earnings-export';
import { InstructorEarningsService, MAX_STATEMENT_PAGE, StatementLine } from '../services/instructor-earnings.service';
import { EducationPermissions } from '../policies/education.policies';
import { EarningsDisabledError } from '../domain/education.errors';

export const INSTRUCTOR_EARNINGS_DATASET = 'education.instructor_earnings';
export const INSTRUCTOR_EARNINGS_DATASET_NAME_KEY = `exports.dataset.${INSTRUCTOR_EARNINGS_DATASET}`;

@Injectable()
export class InstructorEarningsDataset implements DatasetProducer<EarningsExportParams> {
  readonly code = INSTRUCTOR_EARNINGS_DATASET;
  /** W418 is the instructor's own page (course.author); its file is gated on the same verb. */
  readonly permission: string = EducationPermissions.Author;
  readonly params = EarningsExportParamsSchema;

  constructor(private readonly earnings: InstructorEarningsService, private readonly uiMessages: UiMessageRepository) {}

  datasetName(): Promise<LangMap> { return this.uiMessages.map(INSTRUCTOR_EARNINGS_DATASET_NAME_KEY); }

  async produce(ctx: ProduceContext): Promise<ProduceOutcome> {
    const actor = { userId: ctx.requestedBy, canAuthor: true, canPublish: false, isAdmin: false, canHost: false, canModerate: false, canFinance: false };
    let view;
    try { view = await this.earnings.view(ctx.tenantId, actor, null); }
    catch (e) {
      if (e instanceof EarningsDisabledError) return { kind: 'refused', code: 'dataset_disabled', detail: `flag ${e.details?.flag} is off for this tenant` };
      throw e;
    }
    const heldLines = view.tiles.reduce((n, t) => n + t.lifetime.heldLines, 0);
    const notes = earningsExportNotes({ timezone: view.timezone, currencies: view.tiles.map((t) => t.currencyCode), heldLines });
    const svc = this.earnings; const tenantId = ctx.tenantId;
    return {
      kind: 'file',
      file: {
        header: EARNINGS_EXPORT_HEADER,
        rows: (async function* () {
          let cursor: { c: string; id: string } | undefined;
          for (;;) {
            const page = await svc.statement(tenantId, actor, { cursor, limit: MAX_STATEMENT_PAGE });
            for (const l of page.items as StatementLine[]) yield earningsExportRow(l);
            if (!page.nextCursor) return;
            const [c, id] = Buffer.from(page.nextCursor, 'base64').toString().split('|');
            cursor = { c, id };
          }
        })(),
        notes,
        fileSuffix: 'lifetime',
      },
    };
  }

}
