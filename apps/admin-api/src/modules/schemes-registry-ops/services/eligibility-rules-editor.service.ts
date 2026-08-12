// apps/admin-api/src/modules/schemes-registry-ops/services/eligibility-rules-editor.service.ts
//
// BEHAVIOUR CHANGE, DELIBERATE, AND THE REASON IS IN 0105's HEADER. This service used to lock the live `schemes` row,
// bump `schemes.version` and OVERWRITE `eligibility_rules` / `benefit_summary` / the doc + region lists / the fee in
// place, recording the before-and-after in `scheme_registry_changes`. That made the version counter a label on a row
// whose previous contents no longer existed anywhere apps/api could read — so an application stamped
// `scheme_version = 6` referenced rules nothing could retrieve, and the submit path charged whatever the fee had
// since become.
//
// It is now a thin delegate onto the maker-checker version plane: a rules edit OPENS OR UPDATES A DRAFT, and nothing
// a farmer can see changes until a DIFFERENT operator publishes it (W069's locked state: "schemes.write + checker;
// benefit/eligibility changes always create a new version").
//
// THE ROUTE IS KEPT rather than removed. `POST schemes/:id/rules` is what the console already calls and what any
// operator runbook already names; repointing it is the change, and a 404 on a familiar path would just look like an
// outage. What it RETURNS is now a draft, and the response says so — `status: 'draft'` and `publishedNothing: true`
// exist so a caller written against the old behaviour cannot mistake a queued draft for a live rule change.
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { SchemeVersionService } from './scheme-version.service';
import { SchemesRegistryRepository } from '../repositories/schemes-registry.repository';
import { assertEligibilityRules, expansionOnly, EligibilityRuleError, type CohortDiff } from '../domain/eligibility-fields';
import { UpdateSchemeRulesDto } from '../dto/schemes-registry.dto';

/** 422 with the validator's own sentence — the suggestion IS the error message (W071's canon state). */
function refuse(e: EligibilityRuleError): never {
  throw new HttpException({ code: e.code, message: e.message }, HttpStatus.UNPROCESSABLE_ENTITY);
}

@Injectable()
export class EligibilityRulesEditorService {
  constructor(private readonly versions: SchemeVersionService, private readonly repo: SchemesRegistryRepository) {}

  async updateRules(actor: AdminRequestContext, id: string, dto: UpdateSchemeRulesDto) {
    // ADMIN-SWEEP-c2: validate BEFORE the draft opens — "Nothing saved. Fix and re-test" (W071). A draft holding a
    // field the evaluator ignores would carry a rule that silently does nothing into the maker-checker pipeline.
    if (dto.eligibilityRules !== undefined) {
      try { assertEligibilityRules(dto.eligibilityRules); } catch (e) {
        if (e instanceof EligibilityRuleError) refuse(e);
        throw e;
      }
    }
    const saved = await this.versions.saveDraft(actor, id, {
      benefitSummary: dto.benefitSummary, eligibilityRules: dto.eligibilityRules,
      requiredDocTypeIds: dto.requiredDocTypeIds, applicableRegionIds: dto.applicableRegionIds,
      processingFeeMinor: dto.processingFeeMinor,
    }, dto.reason);
    return {
      ...saved,
      status: 'draft' as const,
      // Blunt on purpose. The old response was the updated live scheme; anything that reads this and carries on as
      // though the rules changed is now told, in the payload, that they did not.
      publishedNothing: true,
    };
  }

  /**
   * The cohort DRY RUN (W071): validate the candidate rules, then count who qualifies over the LIVE population and
   * diff against the published version's rules. READ-ONLY by construction — it writes nothing, saves nothing, and
   * says so in the payload; the whole point of a dry run is that running it twice changes nothing either time.
   * The verdict the canon banners is `expansionOnly`: only a diff with ZERO losers may skip the re-notification
   * wave, and the count of losers is reported, never rounded away.
   */
  async dryRun(id: string, rules: unknown): Promise<CohortDiff & { expansionOnly: boolean; savedNothing: true }> {
    let validated: Record<string, unknown>;
    try { validated = assertEligibilityRules(rules); } catch (e) {
      if (e instanceof EligibilityRuleError) refuse(e);
      throw e;
    }
    const published = await this.repo.publishedRules(id);
    const diff = await this.repo.cohortDiff(validated, published);
    return { ...diff, expansionOnly: expansionOnly(diff), savedNothing: true };
  }
}
