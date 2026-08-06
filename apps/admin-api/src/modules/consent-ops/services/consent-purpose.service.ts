// apps/admin-api/src/modules/consent-ops/services/consent-purpose.service.ts · W047, the purpose registry and its
// version ladder.
//
// W047 draws the ladder in four steps: draft the notice in twelve languages → DPO + checker approve → publish vN+1 →
// re-consent prompts roll out. Three of those four are built here. THE FOURTH IS NOT AND THE SCREEN SAYS SO: nothing
// compares a person's held version against the current one at the point of use, so no re-consent prompt has ever rolled
// out. What this service CAN do is size the job — how many principals hold a superseded version — which is the number
// somebody needs before they build the prompt.
//
// One ACID tx per write, audit row in the same tx (Law 4). Publishing reprojects `consent_purposes.current_version`
// (Law 5) — that column was the ONLY record of the version before 0108 and it was mutable, which is exactly how the
// words of every superseded version were lost.
import { Injectable } from '@nestjs/common';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { ConsentOpsRepository } from '../repositories/consent-ops.repository';
import {
  ConsentPurposeNotFoundError, ConsentVersionNotFoundError, ConsentVersionNotDraftError, InvalidConsentInputError,
} from '../domain/consent-ops.errors';
import {
  nextVersionLabel, assertNoticeText, assertToggleLabel, assertNoticeIsNotTheLabel, noticeCoverage,
  assertPublishable, assertNoOpenDraft, reConsentBacklog, IVR_EVIDENCE_GAP,
} from '../domain/consent-notice';

@Injectable()
export class ConsentPurposeService {
  constructor(private readonly pool: AdminPool, private readonly audit: AdminAuditWriter, private readonly repo: ConsentOpsRepository) {}

  /** W047's table. Coverage is against the ACTIVE languages, and a purpose whose published version has no notice at all
   *  is reported as such rather than as 0/N — every backfilled purpose is in that state, because the platform had no
   *  column to store a notice in before 0108. */
  async listPurposes() {
    const [rows, languages] = await Promise.all([this.repo.listPurposes(), this.repo.activeLanguages()]);
    return {
      languages,
      items: rows.map((r: any) => ({
        code: r.code,
        defaultName: r.default_name,
        isMandatory: r.is_mandatory === true,
        currentVersion: r.current_version,
        versionId: r.version_id ?? null,
        versionStatus: r.version_status ?? null,
        // TRUE for every purpose this platform has today. The words its existing consents were given against were never
        // recorded anywhere, and that is the fact the screen has to lead with.
        noticeNeverRecorded: (r.notice_count ?? 0) === 0,
        noticeCount: r.notice_count ?? 0,
        languageTotal: languages.length,
        isBackfilled: r.is_backfilled === true,
        draftVersionId: r.draft_id ?? null,
        draftVersion: r.draft_version ?? null,
        // Opt-in over LATEST decisions per person. NULL when nobody has decided — 0% would say everybody declined.
        optInPct: (r.decided_principals ?? 0) > 0 ? Math.round(((r.granted_principals ?? 0) / r.decided_principals) * 1000) / 10 : null,
        grantedPrincipals: r.granted_principals ?? 0,
        decidedPrincipals: r.decided_principals ?? 0,
      })),
    };
  }

  /** One purpose: its version history with the notices, coverage per version, and the re-consent backlog. */
  async getPurpose(code: string) {
    const purpose = await this.repo.getPurpose(code);
    if (!purpose) throw new ConsentPurposeNotFoundError(code);
    const [versions, languages, reRows] = await Promise.all([
      this.repo.listVersions(code), this.repo.activeLanguages(), this.repo.reConsentRows(code),
    ]);
    return {
      ...purpose,
      languages,
      versions: versions.map((v) => ({
        ...v,
        coverage: noticeCoverage(v.notices, languages),
        // A backfilled version is `published` and nobody signed it; the console must not draw a signature line.
        isSigned: !v.isBackfilled && v.publishedBy !== null,
      })),
      reConsent: reConsentBacklog(reRows),
      // Named in the payload: the ladder's fourth rung does not exist.
      reConsentPrompt: { available: false as const, reason: 'nothing_compares_held_version_to_current_at_point_of_use' as const },
      ivrEvidence: IVR_EVIDENCE_GAP,
    };
  }

  /** MAKER — open a draft of the next version. */
  async openDraft(actor: AdminRequestContext, code: string, dto: { changeReason: string; isMandatory?: boolean }) {
    return this.pool.withTx(async (client) => {
      const purpose = await this.repo.getPurpose(code);
      if (!purpose) throw new ConsentPurposeNotFoundError(code);
      const existing = await this.repo.versionsFor(client, code);
      assertNoOpenDraft(code, existing);

      // From the maximum label EVER used, including discarded drafts — see nextVersionLabel.
      const labels = await this.repo.versionLabelsEverUsed(client, code);
      const version = nextVersionLabel(labels);
      const isMandatory = dto.isMandatory ?? purpose.isMandatory;
      const { id } = await this.repo.insertVersion(client, { purposeCode: code, version, isMandatory, changeReason: dto.changeReason, draftedBy: actor.userId });

      await this.audit.write(client, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'dpdp.consent_version_drafted', entityType: 'consent_purpose_version', entityId: id,
        newValue: { purposeCode: code, version, isMandatory }, reason: dto.changeReason,
        ip: actor.ip, requestId: actor.requestId || null,
      });
      return { versionId: id, purposeCode: code, version, isMandatory, publishedNothing: true as const };
    });
  }

  /** Write one language's notice onto a DRAFT. One language per call: twelve languages is twelve deliberate acts, and a
   *  bulk endpoint is how eleven of them end up machine-translated in one gesture. */
  async saveNotice(actor: AdminRequestContext, versionId: string, dto: { languageCode: string; noticeText: string; toggleLabel: string }) {
    return this.pool.withTx(async (client) => {
      const v = await this.repo.getVersionForUpdate(client, versionId);
      if (!v) throw new ConsentVersionNotFoundError(versionId);
      if (v.status !== 'draft') throw new ConsentVersionNotDraftError(versionId, v.status);

      const languages = await this.repo.activeLanguages();
      if (!languages.includes(dto.languageCode)) {
        throw new InvalidConsentInputError(`${dto.languageCode} is not an active platform language`);
      }
      const toggleLabel = assertToggleLabel(dto.toggleLabel, dto.languageCode);
      const noticeText = assertNoticeText(dto.noticeText, dto.languageCode);
      // The cheapest way to satisfy a length floor is to paste the label and pad it. Refused.
      assertNoticeIsNotTheLabel(noticeText, toggleLabel, dto.languageCode);

      await this.repo.upsertNotice(client, { versionId, languageCode: dto.languageCode, noticeText, toggleLabel, actorUserId: actor.userId });
      await this.audit.write(client, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'dpdp.consent_notice_saved', entityType: 'consent_purpose_version', entityId: versionId,
        // The NOTICE TEXT ITSELF is not in the audit row. It is in the notice table, which is the record of it; copying
        // a multi-paragraph legal text into every audit entry would bloat the ledger and duplicate the source of truth.
        newValue: { purposeCode: v.purposeCode, version: v.version, languageCode: dto.languageCode, chars: noticeText.length },
        reason: `notice authored in ${dto.languageCode}`, ip: actor.ip, requestId: actor.requestId || null,
      });
      const notices = await this.repo.noticesFor(client, versionId);
      return { versionId, languageCode: dto.languageCode, coverage: noticeCoverage(notices, languages) };
    });
  }

  async deleteNotice(actor: AdminRequestContext, versionId: string, languageCode: string) {
    return this.pool.withTx(async (client) => {
      const v = await this.repo.getVersionForUpdate(client, versionId);
      if (!v) throw new ConsentVersionNotFoundError(versionId);
      if (v.status !== 'draft') throw new ConsentVersionNotDraftError(versionId, v.status);
      const removed = await this.repo.deleteNotice(client, versionId, languageCode);
      if (removed === 0) throw new InvalidConsentInputError(`no ${languageCode} notice on this draft to remove`);
      await this.audit.write(client, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'dpdp.consent_notice_removed', entityType: 'consent_purpose_version', entityId: versionId,
        oldValue: { languageCode }, reason: `notice removed for ${languageCode}`, ip: actor.ip, requestId: actor.requestId || null,
      });
      return { versionId, languageCode, removed: true as const };
    });
  }

  /** CHECKER — publish. A DIFFERENT operator from the drafter (the shared two-person rule), every active language for a
   *  MANDATORY purpose, and the live purpose row is reprojected in the same transaction. */
  async publish(actor: AdminRequestContext, versionId: string, checkerNote: string | null) {
    return this.pool.withTx(async (client) => {
      const v = await this.repo.getVersionForUpdate(client, versionId);
      if (!v) throw new ConsentVersionNotFoundError(versionId);

      const [notices, languages] = await Promise.all([this.repo.noticesFor(client, versionId), this.repo.activeLanguages()]);
      // Throws SecondPersonRequiredError / NoticeLanguageMissingError / ConsentVersionNotDraftError.
      const coverage = assertPublishable(
        { id: v.id, status: v.status, isMandatory: v.isMandatory, draftedBy: v.draftedBy, purposeCode: v.purposeCode, version: v.version },
        notices, languages, actor.userId,
      );

      const previous = await this.repo.getPublishedForUpdate(client, v.purposeCode);
      if (previous) await this.repo.supersedeVersion(client, previous.id, actor.userId);
      await this.repo.publishVersion(client, versionId, actor.userId, checkerNote);
      await this.repo.projectCurrentVersion(client, v.purposeCode, v.version, v.isMandatory, actor.userId);

      await this.audit.write(client, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'dpdp.consent_version_published', entityType: 'consent_purpose_version', entityId: versionId,
        oldValue: previous ? { version: previous.version } : null,
        newValue: {
          purposeCode: v.purposeCode, version: v.version, isMandatory: v.isMandatory,
          languages: coverage.covered, missingLanguages: coverage.missing, checkerNote,
        },
        reason: v.changeReason, ip: actor.ip, requestId: actor.requestId || null,
      });
      return {
        versionId, purposeCode: v.purposeCode, version: v.version,
        supersededVersion: previous?.version ?? null, coverage,
        // Every person holding the previous version now holds a superseded one and nothing will prompt them.
        reConsentPromptAvailable: false as const,
      };
    });
  }

  async discardDraft(actor: AdminRequestContext, versionId: string, reason: string) {
    return this.pool.withTx(async (client) => {
      const v = await this.repo.getVersionForUpdate(client, versionId);
      if (!v) throw new ConsentVersionNotFoundError(versionId);
      if (v.status !== 'draft') throw new ConsentVersionNotDraftError(versionId, v.status);
      await this.repo.discardDraft(client, versionId, actor.userId);
      await this.audit.write(client, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'dpdp.consent_version_discarded', entityType: 'consent_purpose_version', entityId: versionId,
        oldValue: { purposeCode: v.purposeCode, version: v.version }, reason,
        ip: actor.ip, requestId: actor.requestId || null,
      });
      // The label stays burned — see nextVersionLabel.
      return { versionId, version: v.version, discarded: true as const };
    });
  }
}
