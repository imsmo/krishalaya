// modules/esg/exports/esg-metrics.dataset.ts · W424 "Generate report" — THE ESG FILE on the 6e-2 plane (PC-56 TENANT-9d).
// Registered by `EsgModule.onModuleInit`. A READ that happens to be long — it writes nothing — over `EsgService.compute`, the
// ONE gate the dashboard reads, so the file cannot carry a figure the page would refuse. Every receipt opens with the
// unsigned sentence (F-11) and names every metric it left out. The `esg` flag gates it as it gates the screens.
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { DatasetProducer, ProduceContext, ProduceOutcome } from '../../../core/exports-plane/dataset.registry';
import { UiMessageRepository } from '../../../core/i18n/ui-message.repository';
import type { LangMap } from '../../../core/i18n/lang-map';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { EsgRepository } from '../repositories/esg.repository';
import { EsgService } from '../services/esg.service';
import { ESG_EXPORT_HEADER, ESG_METRICS_DATASET, exportNotes, exportRows } from '../domain/esg-export';

export const EsgExportParamsSchema = z.object({ lang: z.string().regex(/^[a-z]{2,3}$/).optional() }).strict();
export type EsgExportParams = z.infer<typeof EsgExportParamsSchema>;

@Injectable()
export class EsgMetricsDataset implements DatasetProducer<EsgExportParams> {
  readonly code = ESG_METRICS_DATASET;
  readonly permission: string = 'esg.read';
  readonly params = EsgExportParamsSchema;
  constructor(private readonly esg: EsgService, private readonly repo: EsgRepository, private readonly ui: UiMessageRepository, private readonly flags: FlagsService) {}
  datasetName(): Promise<LangMap> { return this.ui.map(`exports.dataset.${this.code}`); }

  async produce(ctx: ProduceContext, p: EsgExportParams): Promise<ProduceOutcome> {
    if (!(await this.flags.isEnabled('esg', { tenantId: ctx.tenantId }).catch(() => false))) {
      return { kind: 'refused', code: 'dataset_disabled', detail: 'flag esg is off for this tenant' };
    }
    const [{ clock, entries }, published, languages] = await Promise.all([
      this.esg.compute(ctx.tenantId), this.repo.publishedDisclosures(ctx.tenantId), this.repo.activeLanguages(ctx.tenantId),
    ]);
    const asked = p.lang ?? 'en';
    const lang = languages.includes(asked) ? asked : 'en';
    const rows = exportRows(entries, published.map((d) => ({ metricCode: d.metricCode, texts: d.texts, publishedAt: d.publishedAt as string })), lang);
    return {
      kind: 'file',
      file: {
        header: ESG_EXPORT_HEADER,
        rows: (async function* () { for (const r of rows) yield r; })(),
        notes: exportNotes(entries, { zone: clock.zone, today: clock.today, lang, langFallback: lang !== asked, disclosures: published.length }),
        fileSuffix: `${lang}-${clock.today}`,
      },
    };
  }
}
