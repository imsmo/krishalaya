// modules/memberships/services/register-import.service.ts · PC-56 TENANT-SW-d · W2626–W2628 "Import register" — UNDER A CHECKER + CONSENT.
//
// The flow (every wall in 0200's triggers; the service names them):
//   upload   — `POST /governance/register/imports` (`governance.register.import`): the CSV (≤ 5,000 rows, ≤ 1 MB) + a REQUIRED consent
//              document (board resolution / attestation) this cooperative uploaded. The file is stored as media (sha256 recorded); every
//              line is judged and written with its verdict (`valid` · `error` + a code, named with its line · `skipped_duplicate` when the
//              member is already on the register); the import is `validated`.
//   propose  — the MAKER (a tenant_admin) proposes it with a reason → `proposed`.
//   confirm  — a DIFFERENT tenant_admin confirms (trigger: IMPORT_CHECKER_IS_MAKER) → `confirmed`.
//   apply    — the job `governance-register-import-apply` (kv_app UoW per tenant, registered) writes `coop_share_registers` rows with
//              source = 'import' and import_batch_id (the trigger refuses an import row whose batch is not confirmed), idempotently:
//              only `valid` lines are visited; a member already on the register, or a folio taken since validation, is skipped.
//   reject   — either administrator, with a reason, before it is confirmed.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { MediaService } from '../../../core/media/media-links.service';
import { uuidv7 } from '../../../core/database/uuid.util';
import { parseCsv } from '../../../core/bulk/csv-parser';
import { KeysetCursor, encodeKeyset } from '../../../shared/pagination/us-keyset';
import { RegisterImportRepository, ImportRow } from '../repositories/register-import.repository';
import { ALREADY_ON_REGISTER, ConsentKind, IMPORT_MAX_BYTES, IMPORT_MAX_ROWS, judgeLines, missingColumns, tally } from '../domain/register-import';
import { namedSwdGovRefusal, swdGovRefusal } from '../domain/swd-gov.errors';

export interface ImportActor { userId: string; permissions: ReadonlySet<string>; ip?: string | null }
const can = (a: ImportActor, p: string) => a.permissions.has(p) || a.permissions.has('*');
const view = (r: ImportRow) => ({ ...r, cursorTs: undefined });

@Injectable()
export class RegisterImportService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    private readonly audit: AuditWriter,
    private readonly repo: RegisterImportRepository,
    private readonly media: MediaService,
  ) {}

  private assert(a: ImportActor) { if (!can(a, 'governance.register.import')) throw swdGovRefusal('IMPORT_RESTRICTED'); }

  async upload(tenantId: string, actor: ImportActor, key: string, input: { csv: string; consentMediaId: string; consentKind: ConsentKind }) {
    this.assert(actor);
    const bytes = Buffer.byteLength(input.csv ?? '', 'utf8');
    if (bytes > IMPORT_MAX_BYTES) throw swdGovRefusal('IMPORT_FILE_TOO_LARGE');
    let parsed: { header: string[]; records: string[][] };
    try { parsed = parseCsv(input.csv ?? '', { maxRows: IMPORT_MAX_ROWS, maxFields: 20, maxCellLen: 200 }); }
    catch (e) { throw swdGovRefusal(/exceeds \d+ data rows/.test(String((e as Error).message)) ? 'IMPORT_FILE_TOO_LARGE' : 'IMPORT_FILE_UNREADABLE'); }
    if (missingColumns(parsed.header).length) throw swdGovRefusal('IMPORT_COLUMNS_MISSING', { missing: missingColumns(parsed.header) });
    const records = parsed.records.filter((r) => !(r.length === 1 && r[0].trim() === ''));
    if (!records.length) throw swdGovRefusal('IMPORT_FILE_EMPTY');
    if (!(await this.repo.mediaOfTenant(tenantId, input.consentMediaId))) throw swdGovRefusal('IMPORT_CONSENT_REQUIRED');
    const shape = await this.repo.countryShape(tenantId);
    if (!shape) throw swdGovRefusal('IMPORT_FILE_UNREADABLE', { reason: 'country phone prefix or currency scale not recorded' });

    return this.idem.remember(key, actor.userId, 'governance.register.import_upload', async () => {
      // the file itself is kept as the uploaded evidence (scan pending — never served back by this flow)
      const file = await this.media.putReceivedFile(tenantId, actor.userId, Buffer.from(input.csv, 'utf8'), 'text/csv');
      try {
        return await this.uow.run(tenantId, async (tx) => {
          const id = uuidv7();
          await this.repo.insertImportTx(tx, { id, tenantId, uploadedBy: actor.userId, fileMediaId: file.id, fileSha256: file.sha256, consentMediaId: input.consentMediaId, consentKind: input.consentKind });
          const judged = judgeLines(parsed.header, records, shape);
          const members = await this.repo.membersByPhone(tx, tenantId, [...new Set(judged.filter((l) => l.phoneE164).map((l) => l.phoneE164!))]);
          const reg = await this.repo.registerState(tx, tenantId);
          const lines = judged.map((l) => {
            const member = l.phoneE164 ? members.get(l.phoneE164) ?? null : null;
            let status: 'valid' | 'error' | 'skipped_duplicate' = 'valid'; let code: string | null = l.error;
            if (!code && !member) code = 'MEMBER_NOT_FOUND';
            if (!code && member && reg.members.has(member)) { status = 'skipped_duplicate'; code = ALREADY_ON_REGISTER; }
            else if (!code && l.folio && reg.folios.has(l.folio) && reg.folios.get(l.folio) !== member) code = 'FOLIO_TAKEN';
            if (code && status !== 'skipped_duplicate') status = 'error';
            return { lineNo: l.lineNo, phoneMasked: l.phoneMasked, folio: l.folio, shares: l.shares, paidUpMinor: l.paidUpMinor, memberUserId: member,
              status, errorCode: code,
              raw: { phoneMasked: l.phoneMasked, folio: l.folio ?? '', shares: l.shares === null ? '' : String(l.shares), paidUp: l.paidUpMinor ?? '' } };
          });
          // within-file duplicates on the MEMBER (two phones of one person cannot happen — a phone is one user — but one person twice can)
          const seen = new Set<string>();
          for (const l of lines) { if (l.status !== 'valid' || !l.memberUserId) continue; if (seen.has(l.memberUserId)) { l.status = 'error'; l.errorCode = 'DUPLICATE_IN_FILE'; } seen.add(l.memberUserId); }
          await this.repo.insertLinesTx(tx, tenantId, id, lines);
          const t = tally(lines.map((l) => l.status));
          await this.repo.moveTx(tx, tenantId, id, ['staged'], { status: 'validated', row_count: t.rowCount, valid_count: t.validCount, error_count: t.errorCount, duplicate_count: t.duplicateCount });
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'governance.register.import_uploaded', entityType: 'share_register_import', entityId: id,
            newValue: { rows: t.rowCount, valid: t.validCount, errors: t.errorCount, duplicates: t.duplicateCount, fileSha256: file.sha256, consentKind: input.consentKind }, ip: actor.ip ?? null });
          return view((await this.repo.get(tenantId, id, tx))!);
        }, { userId: actor.userId });
      } catch (e) { throw namedSwdGovRefusal(e); }
    });
  }

  private async move(tenantId: string, actor: ImportActor, id: string, from: string[], set: Record<string, unknown>, action: string, reason: string | null) {
    try {
      return await this.uow.run(tenantId, async (tx) => {
        const row = await this.repo.get(tenantId, id, tx, true);
        if (!row) throw swdGovRefusal('IMPORT_NOT_FOUND');
        if (!from.includes(row.status)) throw swdGovRefusal('IMPORT_BAD_MOVE', { status: row.status });
        if (!(await this.repo.moveTx(tx, tenantId, id, from, set))) throw swdGovRefusal('IMPORT_BAD_MOVE');
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action, entityType: 'share_register_import', entityId: id, oldValue: { status: row.status }, newValue: { status: set.status }, reason, ip: actor.ip ?? null });
        return view((await this.repo.get(tenantId, id, tx))!);
      }, { userId: actor.userId });
    } catch (e) { throw namedSwdGovRefusal(e); }
  }

  /** W2626 "Import register — propose": the maker, with a reason. Refused up front when nobody else could ever confirm it. */
  async propose(tenantId: string, actor: ImportActor, id: string, key: string, reason: string) {
    this.assert(actor);
    const why = (reason ?? '').trim();
    if (why.length < 10 || why.length > 500) throw swdGovRefusal('REASON_REQUIRED');
    if ((await this.repo.activeAdmins(tenantId)) < 2) throw swdGovRefusal('NEEDS_SECOND_ADMIN');
    return this.idem.remember(key, actor.userId, 'governance.register.import_propose', () =>
      this.move(tenantId, actor, id, ['validated'], { status: 'proposed', proposed_by: actor.userId, proposed_at: new Date().toISOString(), propose_reason: why }, 'governance.register.import_proposed', why));
  }
  /** W2627: the checker confirms (≠ the proposer — the trigger). The apply job writes the register. */
  async confirm(tenantId: string, actor: ImportActor, id: string, key: string) {
    this.assert(actor);
    return this.idem.remember(key, actor.userId, 'governance.register.import_confirm', () =>
      this.move(tenantId, actor, id, ['proposed'], { status: 'confirmed', confirmed_by: actor.userId, confirmed_at: new Date().toISOString() }, 'governance.register.import_confirmed', null));
  }
  async reject(tenantId: string, actor: ImportActor, id: string, reason: string) {
    this.assert(actor);
    const why = (reason ?? '').trim();
    if (why.length < 10 || why.length > 500) throw swdGovRefusal('REASON_REQUIRED');
    return this.move(tenantId, actor, id, ['validated', 'proposed'], { status: 'rejected', rejected_by: actor.userId, rejected_at: new Date().toISOString(), reject_reason: why }, 'governance.register.import_rejected', why);
  }

  /** The APPLY (the job calls this per tenant): every confirmed import, one transaction each. Idempotent. */
  async applyConfirmed(tenantId: string): Promise<{ applied: number; rows: number; skipped: number }> {
    const ids = await this.repo.confirmedImports(tenantId);
    let applied = 0, rows = 0, skipped = 0;
    for (const id of ids) {
      const out = await this.uow.run(tenantId, async (tx) => {
        const imp = await this.repo.get(tenantId, id, tx, true);
        if (!imp || imp.status !== 'confirmed') return null;
        const r = await this.repo.applyLinesTx(tx, tenantId, id, imp.batchId, imp.confirmedBy);
        await this.repo.moveTx(tx, tenantId, id, ['confirmed'], { status: 'applied', applied_at: new Date().toISOString(), applied_count: r.applied, skipped_count: r.skipped + imp.duplicateCount });
        await this.audit.write(tx, { tenantId, actorUserId: imp.confirmedBy, action: 'governance.register.import_applied', entityType: 'share_register_import', entityId: id,
          newValue: { batchId: imp.batchId, applied: r.applied, skipped: r.skipped }, reason: imp.proposeReason });
        return r;
      }, { userId: 'system' });
      if (out) { applied++; rows += out.applied; skipped += out.skipped; }
    }
    return { applied, rows, skipped };
  }

  async get(tenantId: string, actor: ImportActor, id: string) {
    this.assert(actor);
    const r = await this.repo.get(tenantId, id);
    if (!r) throw swdGovRefusal('IMPORT_NOT_FOUND');
    return view(r);
  }
  async list(tenantId: string, actor: ImportActor, after?: KeysetCursor, limit = 20) {
    this.assert(actor);
    const rows = await this.repo.page(tenantId, limit + 1, after);
    const page = rows.slice(0, limit); const last = page[page.length - 1];
    return { items: page.map(view), nextCursor: rows.length > limit && last ? encodeKeyset(last.cursorTs, last.id) : null };
  }
  /** The preview: every line with its verdict, keyset on the file's own line number. */
  async lines(tenantId: string, actor: ImportActor, id: string, afterLine = 0, limit = 100, status?: string) {
    this.assert(actor);
    const r = await this.repo.get(tenantId, id);
    if (!r) throw swdGovRefusal('IMPORT_NOT_FOUND');
    const rows = await this.repo.lines(tenantId, id, limit + 1, afterLine, status);
    const page = rows.slice(0, limit);
    // the paid-up amounts' currency is the cooperative's country currency (data) — the console never assumes one
    const shape = await this.repo.countryShape(tenantId);
    return { items: page, nextAfterLine: rows.length > limit ? page[page.length - 1].lineNo : null, currency: shape?.currency ?? null };
  }
}
