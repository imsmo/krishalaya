// modules/identity/exports/dpdp-person.producer.ts · PC-56 STORE-4a · B2 (founder D2) — "Download my data", compiled AUTOMATICALLY on the export
// plane with its audit receipt (sha256, row count, generated-at, requester, a 15-minute link, every fetch logged — the plane's, unchanged).
//
// Dataset `identity.dpdp_person` — a PERSONAL dataset (`personal: true`, the plane's one change: the job, receipt, link and download are
// readable by the REQUESTER only, with no tenant permission and no `tenant_exports` flag — DPDP is a statutory right). Registered by
// `IdentityModule.onModuleInit`; enqueued ONLY by `PrivacyService.requestExport` (the plane refuses it on the generic enqueue route).
//
// WHAT THE FILE IS: ONE CSV (a DELTA — the canon implies "everything" as one download) with a `section` column — profile · address (retired
// copies INCLUDED) · order (as buyer, header rows, the ORGANISATION by name) · message (the person's own) · consent · notification (no payload)
// · data_request — ACROSS every organisation the person used. The rows come from migration 0214's SECURITY DEFINER `kv_person_export_rows`
// (never kv_app under one tenant: RLS would show one organisation only), read inside a unit of work whose `app.user_id` IS the requester (the
// function refuses any other id). Phones and emails are MASKED in SQL. Each section is capped (`DPDP_SECTION_CAP`) and a capped section is said
// in the receipt's notes. `details` is the record's fields as JSON (machine-readable — portability).
//
// IT IS A READ: nothing is written. The params are `{ userId }` canonical and MUST be the requester's own id (the producer refuses any other →
// the job fails `producer_failed`, never a file about somebody else).
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { DatasetProducer, ProduceContext, ProduceOutcome } from '../../../core/exports-plane/dataset.registry';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { UiMessageRepository } from '../../../core/i18n/ui-message.repository';
import type { LangMap } from '../../../core/i18n/lang-map';

export const DPDP_PERSON_DATASET = 'identity.dpdp_person';
export const DPDP_PERSON_DATASET_NAME_KEY = `exports.dataset.${DPDP_PERSON_DATASET}`;
/** Rows per section. A person with more than this in one section gets the newest N and the receipt says which section was capped. */
export const DPDP_SECTION_CAP = 10_000;
/** The sections, in the order the file lists them. */
export const DPDP_SECTIONS = ['profile', 'address', 'order', 'message', 'consent', 'notification', 'data_request'] as const;
export type DpdpSection = (typeof DPDP_SECTIONS)[number];
export const DPDP_HEADER = ['section', 'organisation', 'record_id', 'recorded_at', 'details'] as const;
/** A permission nobody is granted: a personal job is read by its requester (the plane's `personal` rule), never through a tenant verb. */
export const DPDP_SELF_PERMISSION = 'identity.dpdp_self';

export const DpdpPersonParamsSchema = z.object({ userId: z.string().uuid() }).strict();
export type DpdpPersonParams = z.infer<typeof DpdpPersonParamsSchema>;

export interface PersonExportRow { section: string; organisation: string | null; record_id: string; recorded_at: Date | string | null; details: unknown }

/** PURE: order the rows by section (the file's order), cap each section, and say which were capped. Unit-tested. */
export function arrangeSections(rows: readonly PersonExportRow[], cap: number = DPDP_SECTION_CAP): { rows: PersonExportRow[]; capped: DpdpSection[]; counts: Record<DpdpSection, number> } {
  const by = new Map<string, PersonExportRow[]>();
  for (const r of rows) { const list = by.get(r.section) ?? []; list.push(r); by.set(r.section, list); }
  const out: PersonExportRow[] = []; const capped: DpdpSection[] = [];
  const counts = Object.fromEntries(DPDP_SECTIONS.map((s) => [s, 0])) as Record<DpdpSection, number>;
  for (const s of DPDP_SECTIONS) {
    const list = by.get(s) ?? [];
    if (list.length > cap) capped.push(s);
    const kept = list.slice(0, cap);
    counts[s] = kept.length;
    out.push(...kept);
  }
  return { rows: out, capped, counts };
}

/** PURE: one CSV row (the plane's sink neutralises formula cells and quotes). */
export function personExportCsvRow(r: PersonExportRow): string[] {
  const at = r.recorded_at instanceof Date ? r.recorded_at.toISOString() : (r.recorded_at ? new Date(r.recorded_at).toISOString() : '');
  return [r.section, r.organisation ?? '', r.record_id, at, JSON.stringify(r.details ?? {})];
}

/** What the receipt ADMITS (the plane prints notes on the receipt). */
export function personExportNotes(counts: Record<DpdpSection, number>, capped: readonly DpdpSection[], cap: number = DPDP_SECTION_CAP): string[] {
  const notes = [
    `one file; the section column says what each row is: ${DPDP_SECTIONS.map((s) => `${s} ${counts[s]}`).join(', ')}`,
    'across every organisation you used; an order or a message names the organisation, never a person',
    'phone numbers and emails are masked; addresses include retired copies (retiredAt); orders are header rows; notifications carry no text',
    'not in this file: payments, the wallet ledger (your statement), invoices (kept by law), KYC documents',
  ];
  if (capped.length) notes.push(`capped at the newest ${cap} rows: ${capped.join(', ')}`);
  return notes;
}

@Injectable()
export class DpdpPersonDataset implements DatasetProducer<DpdpPersonParams> {
  readonly code = DPDP_PERSON_DATASET;
  readonly permission = DPDP_SELF_PERMISSION;
  readonly personal = true;
  readonly params = DpdpPersonParamsSchema;

  constructor(@Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork, private readonly uiMessages: UiMessageRepository) {}

  datasetName(): Promise<LangMap> { return this.uiMessages.map(DPDP_PERSON_DATASET_NAME_KEY); }

  async produce(ctx: ProduceContext, params: DpdpPersonParams): Promise<ProduceOutcome> {
    // a file about the REQUESTER only — any other id fails the job (producer_failed), never a file about somebody else
    if (params.userId !== ctx.requestedBy) throw new Error('identity.dpdp_person: a personal export is compiled for its requester only');
    const read = await this.uow.run(ctx.tenantId, (tx) => tx.query<PersonExportRow>(
      `SELECT section, organisation, record_id, recorded_at, details FROM kv_person_export_rows($1, $2)`, [params.userId, DPDP_SECTION_CAP + 1]),
    { userId: params.userId });
    const { rows, capped, counts } = arrangeSections(read.rows);
    return {
      kind: 'file',
      file: {
        header: DPDP_HEADER,
        rows: (async function* () { for (const r of rows) yield personExportCsvRow(r); })(),
        notes: personExportNotes(counts, capped),
        fileSuffix: 'my-data',
      },
    };
  }
}
