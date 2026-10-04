// modules/memberships/exports/agm-pack.dataset.ts · PC-56 TENANT-SW-d · W2473 / W2474 — the AGM pack's DATASET on the 6e-2 export plane.
//
// Queued in the transaction that issues the pack (AgmPackService.renderOne → ExportPlaneService.enqueueInTx), so the issued row carries
// its export job id. The file is the pack's own section rows, read back — never re-computed: section, item, status, the figure line,
// the method in English AND in the pack's second language (hi / gu, from ui_messages `agm.method.<item>` — the half the WinAnsi PDF
// writer cannot draw), and the refusal code. A refused row has an EMPTY figure cell (0200's CHECK: a refusal carries no figure).
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { DatasetProducer, ProduceContext, ProduceOutcome } from '../../../core/exports-plane/dataset.registry';
import { UiMessageRepository } from '../../../core/i18n/ui-message.repository';
import type { LangMap } from '../../../core/i18n/lang-map';
import { AgmPackRepository } from '../repositories/agm-pack.repository';
import { figureLine, SectionRow } from '../domain/agm-pack';

export const AGM_PACK_DATASET_CODE = 'governance.agm_pack';
export const AgmPackDatasetParams = z.object({ packId: z.string().uuid() }).strict();
export type AgmPackDatasetParams = z.infer<typeof AgmPackDatasetParams>;
export const AGM_DATASET_HEADER = ['document_id', 'fiscal_year', 'section', 'item', 'status', 'figure', 'method_en', 'second_language', 'method_second_language', 'refusal_code'] as const;

@Injectable()
export class AgmPackDataset implements DatasetProducer<AgmPackDatasetParams> {
  readonly code = AGM_PACK_DATASET_CODE;
  readonly permission: string = 'governance.agm.issue';
  readonly params = AgmPackDatasetParams;
  constructor(private readonly repo: AgmPackRepository, private readonly ui: UiMessageRepository) {}

  datasetName(): Promise<LangMap> { return this.ui.map(`exports.dataset.${AGM_PACK_DATASET_CODE}`); }

  async produce(ctx: ProduceContext, params: AgmPackDatasetParams): Promise<ProduceOutcome> {
    const pack = await this.repo.get(ctx.tenantId, params.packId);
    if (!pack || (pack.status !== 'issued' && pack.status !== 'issuing')) return { kind: 'refused', code: 'dataset_disabled', detail: 'the pack is not issued' };
    const sections = await this.repo.sections(ctx.tenantId, pack.id);
    const words = await this.ui.mapsUnder('agm.method.');
    const lang = pack.secondLanguage;
    const rows = sections.map((s) => {
      const m = words.get(`agm.method.${s.item}`);
      return [pack.documentId ?? '', pack.fiscalYearLabel, s.section, s.item, s.status, s.status === 'included' ? figureLine(s as SectionRow) : '', s.method, lang, m?.[lang] ?? '', s.refusalCode ?? ''];
    });
    return {
      kind: 'file',
      file: {
        header: AGM_DATASET_HEADER,
        rows: (async function* () { for (const r of rows) yield r; })(),
        notes: [
          'Every row is a section of the issued AGM pack, read back from the pack — nothing is recomputed for the file.',
          'A refused row (surplus, operating costs, the notice period, …) has no figure: there is no method that meets a recorded fact.',
          `method_second_language is the platform's ${lang === 'gu' ? 'Gujarati' : 'Hindi'} wording of each method (the PDF writer cannot draw that script).`,
        ],
        fileSuffix: (pack.documentId ?? pack.id).toLowerCase(),
      },
    };
  }
}
