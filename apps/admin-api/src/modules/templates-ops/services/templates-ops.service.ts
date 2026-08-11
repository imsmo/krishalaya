// apps/admin-api/src/modules/templates-ops/services/templates-ops.service.ts · W101/W102 (PC-56 ADMIN-11b).
//
// Every write: one ACID transaction, the audit row inside it (Law 4), a reason of real length, and — on security copy —
// a second administrator (sixteenth site).
//
// **THE ORDER OF OPERATIONS IS THE FEATURE.** Author → (submit) → approve → promote. The promotion is the only step that
// changes what a recipient receives, and it is the only step that moves `serving_version_id`. Everything before it is
// reversible and invisible to a farmer, which is precisely why an edit can be made at 2 a.m. without stopping OTPs.
import { Injectable } from '@nestjs/common';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { assertSecondPerson } from '../../../core/approval/two-person-rule';
import { TemplatesRepository } from '../repositories/templates.repository';
import {
  assessDraft, canTransition, coverageGaps, isSecurityCopy, needsSecondPerson, refSurvivesEdit,
  approvalBlockedByMissingRef, severityOf, samplesOf, isSendable, needsProviderApproval,
} from '../domain/template-version';
import { segmentsFor, renderWithSamples, toDltTemplate } from '../domain/sms-segments';
import {
  EventNotFoundError, LifecycleTransitionError, ProviderRefRequiredError, SecurityCopyPlatformOnlyError,
  TemplateCheckerRequiredError, TemplateDraftRefusedError, TemplateNotFoundError, DuplicateSenderIdError,
} from '../domain/templates-ops.errors';

/** Owner of the provider submission call this wave does not make. Named here so the console can print it beside the
 *  word "submitted" rather than implying a Meta round trip happened. */
export const PROVIDER_SUBMISSION_OWNER = 'ADMIN-11b-Q1';
export const SENDER_VERIFICATION_OWNER = 'ADMIN-11b-Q2';

@Injectable()
export class TemplatesOpsService {
  constructor(
    private readonly pool: AdminPool,
    private readonly repo: TemplatesRepository,
    private readonly audit: AdminAuditWriter,
  ) {}

  async list(q: { channel?: string; languageCode?: string; eventCode?: string; platformOnly?: boolean; cursor?: string; limit: number }) {
    const [rows, census] = await Promise.all([this.repo.list(q), this.repo.census()]);
    return {
      data: rows.map((r) => ({
        ...r,
        // **WHETHER THE PLATFORM WOULD ACTUALLY SEND THIS.** `is_active` was the entire test before this wave, which is
        // how a template Meta rejected stayed sendable — 0072 added the lifecycle and no code read it.
        sendable: r.isActive && r.lifecycle !== null && isSendable(r.lifecycle),
        securityCopy: isSecurityCopy({ priority: r.priority, userCanOptOut: r.userCanOptOut }),
        providerRefRequired: needsProviderApproval(r.channel),
      })),
      meta: {
        ...census,
        nextCursor: rows.length === q.limit && rows.length > 0
          ? `${rows[rows.length - 1].eventCode}|${rows[rows.length - 1].channel}|${rows[rows.length - 1].languageCode}`
          : null,
        providerSubmissionOwner: PROVIDER_SUBMISSION_OWNER,
      },
    };
  }

  /** W101's gaps view. Computed on read: a stored coverage count is wrong the moment somebody authors a template. */
  async coverage(q: { limit: number }) {
    const inputs = await this.repo.coverageInputs();
    const gaps = coverageGaps(inputs);
    return {
      data: gaps.slice(0, q.limit).map((g) => ({ ...g, severity: severityOf(g.priority) })),
      meta: {
        total: gaps.length,
        critical: gaps.filter((g) => severityOf(g.priority) === 'critical').length,
        liveLanguages: inputs.liveLanguages,
        // The gaps view is a count of DEFAULT channels without a template, not of every possible combination — the
        // cross-product is a five-figure number that can never reach zero and would make the tile meaningless.
        basis: 'notification_events.default_channels × live languages, platform defaults only',
      },
    };
  }

  async get(id: string) {
    const t = await this.repo.byId(id);
    if (!t) throw new TemplateNotFoundError(id);
    const [versions, event] = await Promise.all([this.repo.versions(id), this.repo.eventWithVariables(t.eventCode)]);
    const declared = event?.variables ?? [];
    const rendered = renderWithSamples(t.body, samplesOf(declared));
    const overrides = t.tenantId === null
      ? await this.repo.list({ eventCode: t.eventCode, channel: t.channel, languageCode: t.languageCode, limit: 50 })
      : [];
    return {
      ...t,
      securityCopy: isSecurityCopy({ priority: t.priority, userCanOptOut: t.userCanOptOut }),
      needsSecondPerson: needsSecondPerson({ priority: t.priority, userCanOptOut: t.userCanOptOut }),
      sendable: t.isActive && t.lifecycle !== null && isSendable(t.lifecycle),
      providerRefRequired: needsProviderApproval(t.channel),
      variables: declared,
      // **A PREVIEW RENDERED FROM DECLARED SAMPLES, NEVER FROM A PRODUCTION ROW.** Previewing an OTP template against a
      // real user would put a farmer's live one-time code on a god-mode console screen.
      preview: rendered,
      segments: t.channel === 'sms' ? segmentsFor(rendered) : null,
      dltTemplate: t.channel === 'sms' ? toDltTemplate(t.body) : null,
      versions,
      // Tenant rows for the same event×channel×language: the only place on the platform where a divergence from the
      // platform's own wording is visible.
      overrides: overrides.filter((o) => o.tenantId !== null)
        .map((o) => ({ id: o.id, tenantId: o.tenantId, tenantName: o.tenantName, isActive: o.isActive, lifecycle: o.lifecycle })),
      providerSubmissionOwner: PROVIDER_SUBMISSION_OWNER,
    };
  }

  /**
   * Author a new version. Creates the template row on first use.
   *
   * **AN EDIT NEVER TOUCHES WHAT IS SENDING.** The new version lands at `draft` beside the approved one; the serving
   * pointer moves only in `approve`. That is what makes W102's third guard rail — "edits require re-approval of DLT ref
   * before next send" — true without a window in which the platform sends nothing.
   */
  async authorVersion(actor: AdminRequestContext, dto: {
    eventCode: string; channel: string; languageCode: string; tenantId?: string | null;
    subject?: string | null; body: string; providerTemplateRef?: string | null; reason: string;
  }) {
    const event = await this.repo.eventWithVariables(dto.eventCode);
    if (!event) throw new EventNotFoundError(dto.eventCode);
    const tenantId = dto.tenantId ?? null;

    // **THE RULE W101 STATES AND NOTHING ENFORCED.** Refused HERE and by a trigger in 0122 — two layers, each tested
    // alone, because defence in depth that is only ever tested through the outer layer is one layer with a story.
    if (tenantId !== null && isSecurityCopy(event)) throw new SecurityCopyPlatformOnlyError(dto.eventCode);

    const verdict = assessDraft(
      { eventCode: dto.eventCode, channel: dto.channel, languageCode: dto.languageCode, tenantId,
        subject: dto.subject ?? null, body: dto.body, providerTemplateRef: dto.providerTemplateRef ?? null },
      event, event.variables);
    if (!verdict.ok) throw new TemplateDraftRefusedError(verdict.problems);

    return this.pool.withTx(async (c) => {
      let template = await this.repo.byKey(dto.eventCode, dto.channel, dto.languageCode, tenantId);
      let templateId: string;
      if (template) {
        templateId = template.id;
      } else {
        templateId = await this.repo.createTemplateShell(c, {
          eventCode: dto.eventCode, channel: dto.channel, languageCode: dto.languageCode,
          tenantId, adminId: actor.userId,
        });
        template = null;
      }
      const versionNo = await this.repo.nextVersionNo(c, templateId);

      // **THE PROVIDER REF DOES NOT SURVIVE A BODY CHANGE ON SMS OR WHATSAPP.** Carrying it forward is the convenient
      // shortcut and it is the defect: DLT scrubbing rejects a mismatch by silently not delivering.
      const bodyChanged = template !== null && template.body !== dto.body;
      const ref = refSurvivesEdit(dto.channel, bodyChanged)
        ? dto.providerTemplateRef ?? template?.providerTemplateRef ?? null
        : dto.providerTemplateRef ?? null;

      const versionId = await this.repo.insertVersion(c, {
        templateId, tenantId, eventCode: dto.eventCode, channel: dto.channel, languageCode: dto.languageCode,
        versionNo, subject: dto.subject ?? null, body: dto.body, providerTemplateRef: ref,
        needsSecondPerson: needsSecondPerson(event), authoredByAdminId: actor.userId, reason: dto.reason,
      });
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'templates.version_authored', entityType: 'notification_template', entityId: templateId,
        oldValue: template ? { body: template.body, providerTemplateRef: template.providerTemplateRef } : null,
        newValue: { versionNo, body: dto.body, providerTemplateRef: ref, refStaled: bodyChanged && !refSurvivesEdit(dto.channel, true) },
        reason: dto.reason, ip: actor.ip, requestId: actor.requestId || null,
      });
      return {
        templateId, versionId, versionNo, lifecycle: 'draft',
        // The two facts an author needs before this page reloads: does somebody else have to approve it, and did the
        // edit just invalidate the registration this channel needs.
        needsSecondPerson: needsSecondPerson(event),
        providerRefStaled: bodyChanged && !refSurvivesEdit(dto.channel, true),
        segments: verdict.segments, warnings: verdict.warnings, preview: verdict.renderedPreview,
      };
    });
  }

  /** Send for out-of-band provider review. **NOTHING IS SUBMITTED ANYWHERE BY THIS CALL** — there is no Meta client and
   *  no DLT portal client in this repository, so the state means "a human has taken this to the provider". Named, so the
   *  console can say it in those words rather than implying a round trip. */
  async submit(actor: AdminRequestContext, versionId: string, dto: { reason: string }) {
    return this.transition(actor, versionId, 'submitted', dto.reason, {});
  }

  /**
   * Approve a version and promote it to serving.
   *
   * **SIXTEENTH MAKER-CHECKER SITE, AND IT IS NARROW ON PURPOSE.** Security copy — anything a user cannot opt out of, or
   * anything critical — takes a second administrator. Ordinary marketing wording takes one, because a checker on every
   * copy tweak is a checker who stops reading, and a rubber-stamped approval is worse than none: it produces a record
   * that looks like evidence and is not.
   */
  async approve(actor: AdminRequestContext, versionId: string, dto: { reason: string; authoredByAdminId?: string }) {
    return this.pool.withTx(async (c) => {
      const v = await this.repo.versionById(c, versionId);
      if (!v) throw new TemplateNotFoundError(versionId);
      if (!canTransition(v.lifecycle, 'approved')) throw new LifecycleTransitionError(v.lifecycle, 'approved');
      const t = await this.repo.byId(v.templateId);
      if (!t) throw new TemplateNotFoundError(v.templateId);

      // A green row that fails at the operator is worse than a blocked one: the failure is invisible until deliveries
      // stop arriving, and nothing on this platform would say why.
      if (approvalBlockedByMissingRef(t.channel, v.providerTemplateRef)) throw new ProviderRefRequiredError(t.channel);

      if (v.needsSecondPerson) {
        const author = v.authoredByAdminId ?? dto.authoredByAdminId ?? null;
        if (!author) {
          throw new TemplateCheckerRequiredError(
            `${t.eventCode} is security copy: approving its wording takes two administrators, and this version records no author to check against.`);
        }
        assertSecondPerson(`template ${t.eventCode}/${t.channel}/${t.languageCode}`, author, actor.userId,
          `${t.eventCode} is opt-out-locked or critical: the operator who wrote the wording cannot approve it.`);
      }

      await this.repo.setLifecycle(c, versionId, 'approved', { approverAdminId: actor.userId });
      // **THE ONLY STEP THAT CHANGES WHAT A RECIPIENT RECEIVES.** Supersedes the version it replaces in the same tx, so
      // there is never a moment with two approved versions and no way to tell which one is live.
      await this.repo.promoteToServing(c, v.templateId, versionId);

      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'templates.version_approved', entityType: 'notification_template', entityId: v.templateId,
        oldValue: { servingVersionNo: t.servingVersionNo, body: t.body },
        newValue: { servingVersionNo: v.versionNo, body: v.body, bodySha256: v.bodySha256, secondPerson: v.needsSecondPerson },
        reason: dto.reason, ip: actor.ip, requestId: actor.requestId || null,
      });
      return { templateId: v.templateId, versionId, versionNo: v.versionNo, serving: true };
    });
  }

  async reject(actor: AdminRequestContext, versionId: string, dto: { reason: string }) {
    return this.transition(actor, versionId, 'rejected', dto.reason, { rejectionReason: dto.reason });
  }

  private async transition(
    actor: AdminRequestContext, versionId: string, to: 'submitted' | 'rejected', reason: string,
    extra: { rejectionReason?: string },
  ) {
    return this.pool.withTx(async (c) => {
      const v = await this.repo.versionById(c, versionId);
      if (!v) throw new TemplateNotFoundError(versionId);
      if (!canTransition(v.lifecycle, to)) throw new LifecycleTransitionError(v.lifecycle, to);
      await this.repo.setLifecycle(c, versionId, to, extra);
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: `templates.version_${to}`, entityType: 'notification_template', entityId: v.templateId,
        oldValue: { lifecycle: v.lifecycle }, newValue: { lifecycle: to, versionNo: v.versionNo },
        reason, ip: actor.ip, requestId: actor.requestId || null,
      });
      return {
        templateId: v.templateId, versionId, lifecycle: to,
        // Said on the response, not only in the console: this state is a human's out-of-band act, not a provider call.
        providerSubmissionOwner: to === 'submitted' ? PROVIDER_SUBMISSION_OWNER : undefined,
      };
    });
  }

  /* ---------------------------------------------------------------------------------------------- */
  /* THE SENDER REGISTRY                                                                             */
  /* ---------------------------------------------------------------------------------------------- */

  async listSenders() {
    const rows = await this.repo.listSenders();
    return {
      data: rows.map((r) => ({
        ...r,
        // **'recorded' MEANS AN OPERATOR TYPED IT IN.** No provider verifies this today, and a console that let a reader
        // believe otherwise would be the status-recording-an-act-nobody-performs shape in the wave that names it.
        providerVerified: r.verifiedByProviderAt !== null,
      })),
      meta: { verificationOwner: SENDER_VERIFICATION_OWNER, total: rows.length },
    };
  }

  async registerSender(actor: AdminRequestContext, dto: {
    channel: string; sender: string; entityId?: string | null; countryCode: string; provider?: string | null;
    note?: string | null; reason: string;
  }) {
    const existing = (await this.repo.listSenders()).find(
      (s) => s.channel === dto.channel && s.sender === dto.sender && s.countryCode === dto.countryCode.toUpperCase());
    if (existing) throw new DuplicateSenderIdError(dto.sender, dto.channel, dto.countryCode);
    return this.pool.withTx(async (c) => {
      const id = await this.repo.insertSender(c, {
        channel: dto.channel, sender: dto.sender, entityId: dto.entityId ?? null,
        countryCode: dto.countryCode, provider: dto.provider ?? null, note: dto.note ?? null, adminId: actor.userId,
      });
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'templates.sender_registered', entityType: 'messaging_sender_id', entityId: id,
        newValue: { channel: dto.channel, sender: dto.sender, countryCode: dto.countryCode.toUpperCase(), status: 'recorded' },
        reason: dto.reason, ip: actor.ip, requestId: actor.requestId || null,
      });
      return { id, status: 'recorded', verificationOwner: SENDER_VERIFICATION_OWNER };
    });
  }
}
