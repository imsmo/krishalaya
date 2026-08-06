// apps/admin-api/src/modules/schemes-registry-ops/services/scheme-version.service.ts · the maker-checker version
// plane over `scheme_versions` (0105).
//
// THE SHAPE, AND WHY IT IS A THREE-STEP AND NOT A TWO-STEP.
//   draft   (maker)    a full rule set, freely editable, invisible to farmers — nothing has changed for anybody
//   publish (checker)  a DIFFERENT operator makes it the live rules, and the live `schemes` row is reprojected
//   discard (anyone)   the draft goes away and its version NUMBER stays burned
// The alternative — edit the live row and record it afterwards — is what this module did before, and it is the shape
// that made `scheme_applications.scheme_version` a number pointing at nothing. See 0105's header.
//
// ONE ACID TX PER WRITE, AUDIT ROW INSIDE IT (Law 4). Every method below opens exactly one `pool.withTx`, and the
// `scheme_registry_changes` row and the `audit_log` row are written on the SAME client as the mutation: a rule change
// that committed without its audit entry would be an unattributable change to what a farmer is entitled to.
import { Injectable } from '@nestjs/common';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { SchemesRegistryRepository } from '../repositories/schemes-registry.repository';
import {
  SchemeNotFoundError, VersionNotFoundError, DraftAlreadyOpenError, NoPublishedVersionError,
} from '../domain/schemes-registry.errors';
import {
  VersionRow, VersionRules, RulesPatch, applyRulesPatch, assertRulesChanged, assertChangeReason, assertCheckerNote,
  assertPublishable, assertDiscardable, versionCoverage, versionDiff, isSignedVersion,
} from '../domain/scheme-version';

/** The version row as the console sees it. `publishedBy` is deliberately NOT exposed as a name here — this realm
 *  returns ids and the console renders them; what IS exposed is `isSigned`, so a backfilled row can never be drawn
 *  with a signature line. */
function toJson(v: VersionRow, applicationCount: number | null) {
  return {
    id: v.id, schemeId: v.schemeId, version: v.version, status: v.status,
    benefitSummary: v.benefitSummary, eligibilityRules: v.eligibilityRules,
    requiredDocTypeIds: v.requiredDocTypeIds, applicationWindow: v.applicationWindow,
    applicableRegionIds: v.applicableRegionIds, processingFeeMinor: v.processingFeeMinor,
    changeReason: v.changeReason, draftedBy: v.draftedBy, draftedAt: v.draftedAt,
    publishedBy: v.publishedBy, publishedAt: v.publishedAt, checkerNote: v.checkerNote,
    isBackfilled: v.isBackfilled, isSigned: isSignedVersion(v),
    // NULL when we did not ask, 0 when we asked and the answer is none. A console that cannot tell those apart
    // renders "0 applications filed" over a number it never fetched.
    applicationCount,
  };
}

const rulesOf = (v: VersionRow): VersionRules => ({
  benefitSummary: v.benefitSummary, eligibilityRules: v.eligibilityRules, requiredDocTypeIds: v.requiredDocTypeIds,
  applicationWindow: v.applicationWindow, applicableRegionIds: v.applicableRegionIds, processingFeeMinor: v.processingFeeMinor,
});

@Injectable()
export class SchemeVersionService {
  constructor(private readonly pool: AdminPool, private readonly audit: AdminAuditWriter, private readonly repo: SchemesRegistryRepository) {}

  /** The version history for one scheme, plus what it cannot tell you.
   *
   *  `coverage.unrecordedBelow` is the honest note W070 needs. A scheme at v6 whose earliest recorded version is v6
   *  changed five times before 0105 and those rule sets are gone. "No earlier versions" would be a false statement
   *  about a scheme that has been rewritten five times.
   */
  async listVersions(schemeId: string, limit: number) {
    const scheme = await this.repo.getScheme(schemeId);
    if (!scheme) throw new SchemeNotFoundError(schemeId);
    const rows = await this.repo.listVersions(schemeId, limit);
    const counts = await this.repo.applicationCountsByVersion(rows.map((r) => r.id));
    return {
      items: rows.map((r) => toJson(r, counts.get(r.id) ?? 0)),
      coverage: versionCoverage(rows),
      // The live row's version, so the console can say out loud when the projection and the published version
      // disagree — which should be impossible and is therefore worth being able to see.
      liveVersion: scheme.version,
    };
  }

  /** One version, with its diff against the version below it — the W2254 review step reads this. */
  async getVersion(versionId: string) {
    const row = await this.repo.getVersion(versionId);
    if (!row) throw new VersionNotFoundError(versionId);
    const all = await this.repo.listVersions(row.schemeId, 200);
    const below = all.filter((v) => v.version < row.version).sort((a, b) => b.version - a.version)[0] ?? null;
    const counts = await this.repo.applicationCountsByVersion([row.id]);
    return {
      ...toJson(row, counts.get(row.id) ?? 0),
      comparedWith: below ? below.version : null,
      diff: versionDiff(below ? rulesOf(below) : null, rulesOf(row)),
    };
  }

  /** MAKER. Opens a draft if none is open, otherwise edits the open one.
   *
   *  One route for both because the alternative is asking the console to know which it is before it asks, and the
   *  answer can change between the page render and the submit. The response says which happened.
   */
  async saveDraft(actor: AdminRequestContext, schemeId: string, patch: RulesPatch, rawReason: unknown) {
    const reason = assertChangeReason(rawReason);
    return this.pool.withTx(async (client) => {
      const scheme = await this.repo.getSchemeForUpdate(client, schemeId);
      if (!scheme) throw new SchemeNotFoundError(schemeId);

      const existing = await this.repo.getDraftForUpdate(client, schemeId);
      const published = await this.repo.getPublishedForUpdate(client, schemeId);

      if (existing) {
        // Edit in place. The base is the DRAFT's own rules, not the published ones — otherwise a second edit would
        // silently revert the first, which is the sort of data loss nobody reports because it looks like a mistake
        // they made themselves.
        const next = applyRulesPatch(rulesOf(existing), patch);
        assertRulesChanged(published ? rulesOf(published) : rulesOf(existing), next);
        await this.repo.updateDraft(client, existing.id, next, reason, actor.userId);
        await this.repo.insertChange(client, { entityType: 'scheme_version', entityId: existing.id, action: 'draft_updated', oldValue: rulesOf(existing), newValue: next, reason, actorUserId: actor.userId });
        await this.audit.write(client, { actorUserId: actor.userId, actorRole: actor.roles[0] ?? null, action: 'schemes.version.draft_updated', entityType: 'scheme_version', entityId: existing.id, oldValue: rulesOf(existing), newValue: next, reason, ip: actor.ip, requestId: actor.requestId || null });
        return { versionId: existing.id, version: existing.version, opened: false, diff: versionDiff(published ? rulesOf(published) : null, next) };
      }

      if (!published) throw new NoPublishedVersionError(schemeId);
      const next = applyRulesPatch(rulesOf(published), patch);
      assertRulesChanged(rulesOf(published), next);
      // maxVersionEverUsed, NOT published.version + 1: a discarded v7 burned the number, and two rule sets sharing
      // a version number would make every application stamped with it ambiguous for good.
      const version = (await this.repo.maxVersionEverUsed(client, schemeId)) + 1;
      const { id } = await this.repo.insertVersion(client, { schemeId, version, rules: next, changeReason: reason, draftedBy: actor.userId });
      await this.repo.insertChange(client, { entityType: 'scheme_version', entityId: id, action: 'draft_opened', oldValue: rulesOf(published), newValue: next, reason, actorUserId: actor.userId });
      await this.audit.write(client, { actorUserId: actor.userId, actorRole: actor.roles[0] ?? null, action: 'schemes.version.draft_opened', entityType: 'scheme_version', entityId: id, oldValue: rulesOf(published), newValue: next, reason, ip: actor.ip, requestId: actor.requestId || null });
      return { versionId: id, version, opened: true, diff: versionDiff(rulesOf(published), next) };
    });
  }

  /** CHECKER. Publishes the open draft and reprojects the live scheme row.
   *
   *  Everything happens in one transaction: the draft becomes published, the previous published version becomes
   *  superseded, and `schemes` is reprojected. A partial commit here would leave the live row and the version ledger
   *  disagreeing about what the current rules are — and the live row is what apps/api serves to farmers.
   */
  async publish(actor: AdminRequestContext, schemeId: string, versionId: string, rawNote: unknown) {
    const checkerNote = assertCheckerNote(rawNote);
    return this.pool.withTx(async (client) => {
      const scheme = await this.repo.getSchemeForUpdate(client, schemeId);
      if (!scheme) throw new SchemeNotFoundError(schemeId);
      const draft = await this.repo.getVersionForUpdate(client, versionId);
      if (!draft || draft.schemeId !== schemeId) throw new VersionNotFoundError(versionId);

      assertPublishable(draft, actor.userId);           // 409s: not a draft, or drafted by this same operator

      const previous = await this.repo.getPublishedForUpdate(client, schemeId);
      if (previous) await this.repo.supersedeVersion(client, previous.id, actor.userId);
      await this.repo.publishVersion(client, draft.id, actor.userId, checkerNote);
      await this.repo.projectVersionOntoScheme(client, schemeId, draft.version, rulesOf(draft), actor.userId);

      const reason = draft.changeReason;               // the MAKER's reason is what this change is for
      const oldValue = previous ? { version: previous.version, ...rulesOf(previous) } : null;
      const newValue = { version: draft.version, ...rulesOf(draft), checkerNote };
      await this.repo.insertChange(client, { entityType: 'scheme_version', entityId: draft.id, action: 'published', oldValue, newValue, reason, actorUserId: actor.userId });
      await this.repo.insertChange(client, { entityType: 'scheme', entityId: schemeId, action: 'versioned', oldValue: { version: previous?.version ?? null }, newValue: { version: draft.version, versionId: draft.id }, reason, actorUserId: actor.userId });
      await this.audit.write(client, { actorUserId: actor.userId, actorRole: actor.roles[0] ?? null, action: 'schemes.version.published', entityType: 'scheme_version', entityId: draft.id, oldValue, newValue, reason, ip: actor.ip, requestId: actor.requestId || null });
      return { versionId: draft.id, version: draft.version, supersededVersion: previous?.version ?? null };
    });
  }

  /** Discard an open draft. NOT checker-gated: the maker is the person most likely to realise the draft was wrong,
   *  and nothing a farmer can see has changed. Soft-deleted, so the audit trail and the burned number both survive. */
  async discardDraft(actor: AdminRequestContext, schemeId: string, versionId: string, rawReason: unknown) {
    const reason = assertChangeReason(rawReason);
    return this.pool.withTx(async (client) => {
      const draft = await this.repo.getVersionForUpdate(client, versionId);
      if (!draft || draft.schemeId !== schemeId) throw new VersionNotFoundError(versionId);
      assertDiscardable(draft);
      await this.repo.discardDraft(client, draft.id, actor.userId);
      await this.repo.insertChange(client, { entityType: 'scheme_version', entityId: draft.id, action: 'draft_discarded', oldValue: rulesOf(draft), newValue: null, reason, actorUserId: actor.userId });
      await this.audit.write(client, { actorUserId: actor.userId, actorRole: actor.roles[0] ?? null, action: 'schemes.version.draft_discarded', entityType: 'scheme_version', entityId: draft.id, oldValue: rulesOf(draft), newValue: null, reason, ip: actor.ip, requestId: actor.requestId || null });
      return { versionId: draft.id, version: draft.version, discarded: true };
    });
  }

  /** Guards against the one thing this design can get wrong: a draft already open when somebody tries to open
   *  another. Called by the controller's create path so the 409 can name the open draft. */
  async assertNoOpenDraft(schemeId: string): Promise<void> {
    const rows = await this.repo.listVersions(schemeId, 200);
    const draft = rows.find((r) => r.status === 'draft');
    if (draft) throw new DraftAlreadyOpenError(schemeId, draft.id, draft.version);
  }
}
