// modules/dairy/exports/dairy-insights.dataset.ts · the FIRST dataset on the tenant export plane (PC-56 TENANT-6e-2):
// W172's insights, as W2553/W2554's file.
//
// It owns nothing of its own. The rows come from `DairyInsightsReadModel.view` — the SAME read the page renders, same
// window parameter, same refusals — projected by the pure `insightsExportRows`. Registered into `DATASET_REGISTRY` by
// `DairyModule.onModuleInit`, the way the module already registers its cadence jobs.
//
// THE SCREEN'S FLAG GATES THE FILE. 6e-1 reads `dairy_insights` in the read model; a `not_enabled` view here becomes a
// job that FAILS with `dataset_disabled` and a receipt that says so, because producing a file for a screen a tenant
// cannot see would be a way round the flag. `unavailable` (no currency scale) fails with `money_shape_missing` — every
// money cell in this file needs the scale, and a guessed one is wrong by a factor of a hundred for the yen.
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { DatasetProducer, ProduceContext, ProduceOutcome } from '../../../core/exports-plane/dataset.registry';
import { UiMessageRepository } from '../../../core/i18n/ui-message.repository';
import type { LangMap } from '../../../core/i18n/lang-map';
import { DairyInsightsReadModel } from '../read-models/dairy-insights.read-model';
import { DEFAULT_INSIGHT_WINDOW, INSIGHT_WINDOWS, POURER_LOOKBACK_DAYS, InsightWindow } from '../domain/dairy-insights';
import { INSIGHTS_EXPORT_HEADER, insightsExportRows } from '../domain/dairy-insights-export';
import { DairyPermissions } from '../policies/dairy.policies';

export const DAIRY_INSIGHTS_DATASET = 'dairy.insights';
export const DAIRY_INSIGHTS_DATASET_NAME_KEY = `exports.dataset.${DAIRY_INSIGHTS_DATASET}`;

/** The SAME closed set the page accepts (6e-1's DTO), so an export cannot ask for a window the partition pruning cannot serve. */
export const DairyInsightsExportParamsSchema = z.object({
  window: z.coerce.number().int()
    .refine((n): n is InsightWindow => (INSIGHT_WINDOWS as readonly number[]).includes(n), { message: `window must be one of ${INSIGHT_WINDOWS.join(', ')}` })
    .default(DEFAULT_INSIGHT_WINDOW),
}).strict();
export type DairyInsightsExportParams = z.infer<typeof DairyInsightsExportParamsSchema>;

@Injectable()
export class DairyInsightsDataset implements DatasetProducer<DairyInsightsExportParams> {
  readonly code = DAIRY_INSIGHTS_DATASET;
  /** W172 is gated on `dairy.manage` (6e-1); its file is gated on the same verb. */
  readonly permission: string = DairyPermissions.Manage;
  readonly params = DairyInsightsExportParamsSchema;

  constructor(private readonly insights: DairyInsightsReadModel, private readonly uiMessages: UiMessageRepository) {}

  datasetName(): Promise<LangMap> { return this.uiMessages.map(DAIRY_INSIGHTS_DATASET_NAME_KEY); }

  async produce(ctx: ProduceContext, params: DairyInsightsExportParams): Promise<ProduceOutcome> {
    // The drill-down verb is a PAGE decision (may this person open one member's file); the export carries no member
    // rows at all, so it is false here and nothing in the file depends on it.
    const view = await this.insights.view(ctx.tenantId, { userId: ctx.requestedBy, canDrillDown: false }, { window: params.window, today: ctx.today });
    if (view.kind === 'not_enabled') return { kind: 'refused', code: 'dataset_disabled', detail: `flag ${view.flag} is off for this tenant` };
    if (view.kind === 'unavailable') return { kind: 'refused', code: 'money_shape_missing', detail: `missing: ${view.missing.join(', ')}` };
    const file = insightsExportRows(view, { lookbackDaysNote: `${POURER_LOOKBACK_DAYS} days` });
    return {
      kind: 'file',
      file: {
        header: INSIGHTS_EXPORT_HEADER,
        rows: (async function* () { for (const r of file.rows) yield r; })(),
        notes: file.notes,
        fileSuffix: file.fileSuffix,
      },
    };
  }
}
