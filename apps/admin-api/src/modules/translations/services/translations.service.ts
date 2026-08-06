// apps/admin-api/src/modules/translations/services/translations.service.ts · the TRANSLATIONS plane
// (PC-56 ADMIN-3b, canon W028 — closes ADMIN-3-Q1).
//
// THIS IS THE FIRST SERVICE IN THE PLATFORM THAT WRITES A TRANSLATION. `translations` has existed since migration 0001
// and nothing has ever inserted into it, so Golden Law 6 — "never hardcoded, names localize via translations" — has been
// half-wired and completely unfed. A Gujarati farmer has seen "Wheat", not "ઘઉં", for every category in the product.
//
// THE ORDER OF WORK IN THIS WAVE WAS DECIDED BY A BUG, NOT BY A SCREEN. Before writing anything, the read path had to be
// fixed: apps/api's three translation joins carried NO predicate, so (a) an unreviewed machine draft would have been
// served to farmers the instant this service inserted one — the canon's rule broken on day one by the feature meant to
// honour it — and (b) a soft-deleted translation was still served, so revoking a bad one would not have revoked it.
// `core/database/translation-visibility.ts` is that fix.
//
// TWO RULES THIS SERVICE ENFORCES THAT NOTHING ELSE CAN:
//   • LANGUAGE-SCOPED REVIEW. `translations.review` grants the ability; `translation_reviewers` decides which languages.
//     Both are required. A reviewer who cannot read Tamil cannot tell a correct Tamil translation from a fluent-sounding
//     wrong one, and fluent-sounding wrong is precisely what a machine produces.
//   • COVERAGE COUNTS ONLY WHAT A FARMER CAN SEE. A percentage that included unreviewed drafts would tell a founder the
//     platform speaks Tamil when nothing Tamil has ever reached anybody. It is the most misleading number this screen
//     could show, so the repository's coverage query filters on the servable predicate.
import { Injectable } from '@nestjs/common';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { TranslationsRepository } from '../repositories/translations.repository';
import {
  assertTranslation, assertReview, assertReviewerScope, assertReviewerGrant,
  isTranslatableEntity, fieldsFor, coverageMatrix, emptyLanguages, describeState, isServable,
  TRANSLATABLE_ENTITIES, REVIEW_DECISIONS,
} from '../domain/translation';
import {
  InvalidTranslationError, TranslationNotFoundError, AlreadyReviewedError, DuplicateTranslationError,
} from '../domain/translations.errors';
import type {
  QueryQueueDto, CreateTranslationDto, ReviewTranslationDto, RevokeTranslationDto,
  GrantReviewerDto, RevokeReviewerDto, RequestRunDto,
} from '../dto/translations.dto';

const QUEUE_LIMIT = 50;

/**
 * THERE IS NO TRANSLATION ENGINE IN THIS PLATFORM. The same honest gap as the email, voice and pager providers
 * (ADMIN-1e, ADMIN-2b, ADMIN-2d). A run is therefore RECORDED and lands `provider_pending` with the reason — never
 * `completed`, and never with a progress bar for work nothing can perform.
 */
const NO_ENGINE_DETAIL =
  'no machine-translation engine is configured in this deployment, so the run was recorded and nothing was produced';

@Injectable()
export class TranslationsService {
  constructor(
    private readonly pool: AdminPool,
    private readonly repo: TranslationsRepository,
  ) {}

  /* ------------------------------------------------------------------ reads */

  /**
   * The review queue: machine drafts nobody has judged, OLDEST FIRST.
   *
   * Each row carries the CANONICAL text it is a translation of. Without that a reviewer is judging Gujarati against
   * nothing, which is a spelling check rather than a review — and the whole point of the language scope is that this
   * person can compare the two.
   */
  async queue(actor: AdminRequestContext, q: QueryQueueDto) {
    if (q.entityType && !isTranslatableEntity(q.entityType)) {
      throw new InvalidTranslationError(`entityType must be one of ${TRANSLATABLE_ENTITIES.join('|')}`);
    }
    const limit = Math.min(Math.max(q.limit ?? QUEUE_LIMIT, 1), QUEUE_LIMIT);
    const cursor = parseCursor(q.cursor);
    const rows = await this.repo.reviewQueue({ languageCode: q.languageCode, entityType: q.entityType, cursor, limit: limit + 1 });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];

    // the caller's OWN scopes travel with the queue, so a console can show which rows this person may actually act on
    // rather than offering a button that will 403
    const scopes = await this.repo.scopesFor(actor.userId);
    return {
      items: page.map((r) => ({ ...r, stateNote: describeState(r), reviewableByYou: scopes.includes(r.languageCode) }))
      ,
      nextCursor: rows.length > limit && last ? `${last.createdAt}|${last.id}` : null,
      yourLanguages: scopes,
      decisions: REVIEW_DECISIONS,
      scopeNote: scopes.length === 0
        ? 'You are not a reviewer for any language. Approving a translation is a claim that it says what the English says, to a farmer who cannot check — so it is scoped per language.'
        : null,
    };
  }

  /** W028's coverage matrix, with the pending drafts shown BESIDE it rather than folded into it. */
  async coverage() {
    const [keys, cells, languages, pending] = await Promise.all([
      this.repo.keyCounts(), this.repo.coverage(), this.repo.activeLanguages(), this.repo.pendingByLanguage(),
    ]);
    const codes = languages.map((l) => l.code);
    const matrix = coverageMatrix(keys, cells, codes);
    return {
      languages, matrix,
      gaps: matrix.map((row) => ({ entityType: row.entityType, empty: emptyLanguages(row) })).filter((g) => g.empty.length > 0),
      pendingByLanguage: pending,
      // the sentence that stops the two numbers being confused
      basis: 'Coverage counts ONLY translations a farmer can see — human-written, or machine-written and reviewed. Unreviewed drafts are listed separately as pending, because a percentage that counted them would claim the platform speaks a language when nothing in it has reached anybody.',
    };
  }

  async forEntity(entityType: string, entityId: string) {
    if (!isTranslatableEntity(entityType)) {
      throw new InvalidTranslationError(`entityType must be one of ${TRANSLATABLE_ENTITIES.join('|')}`);
    }
    const items = await this.repo.forEntity(entityType, entityId);
    return {
      items: items.map((r) => ({ ...r, stateNote: describeState(r), servable: isServable(r) })),
      fields: fieldsFor(entityType),
      languages: await this.repo.activeLanguages(),
    };
  }

  async reviewers() {
    const [items, languages] = await Promise.all([this.repo.listReviewers(), this.repo.activeLanguages()]);
    return {
      items, languages,
      note: 'Holding `translations.review` grants the ability to review; a language grant decides which languages. Both are required, and a revoked grant is kept — a translation approved last year was approved by somebody who held the scope then.',
    };
  }

  async runs() {
    return {
      items: await this.repo.listRuns(),
      note: NO_ENGINE_DETAIL,
    };
  }

  /* ------------------------------------------------------------------ authoring */

  /**
   * Author a HUMAN translation. Live on insert — a person who holds the language wrote it, and requiring them to then
   * approve themselves is ceremony that teaches people to click through.
   *
   * THE LANGUAGE SCOPE APPLIES TO AUTHORING TOO, and that is not obvious enough to leave unsaid: somebody who cannot read
   * Tamil should not be typing Tamil into a farmer-facing surface any more than they should be approving it. The same
   * check, for the same reason.
   */
  async create(actor: AdminRequestContext, dto: CreateTranslationDto) {
    const t = assertTranslation({
      entityType: dto.entityType, entityId: dto.entityId, field: dto.field,
      languageCode: dto.languageCode, text: dto.text, isMachine: false, source: null,
    });
    const scopes = await this.repo.scopesFor(actor.userId);
    assertReviewerScope(t.languageCode, scopes);

    return this.pool.withTx(async (client) => {
      const existed = await this.repo.exists(t.entityType, t.entityId, t.field, t.languageCode);
      const saved = await this.repo.upsert(client, { ...t, actorUserId: actor.userId, reviewedOnInsert: true });
      await this.repo.insertChange(client, {
        entityType: 'translation', entityId: saved.id,
        action: existed ? 'updated' : 'created',
        oldValue: null,
        newValue: {
          entity: `${t.entityType}:${t.entityId}`, field: t.field, language: t.languageCode,
          text: t.text, isMachine: false, live: true,
        },
        reason: dto.reason, actorUserId: actor.userId,
      });
      return { id: saved.id, live: true, replaced: existed };
    });
  }

  /**
   * Review a machine draft.
   *
   * The scope check happens against the DRAFT'S language, read inside the transaction — not against anything the caller
   * sent, because a caller could otherwise name a language they hold while reviewing a row in one they do not.
   *
   * A REJECTION SOFT-DELETES rather than marking the row rejected. The read predicate keys on `reviewed_at`, so a
   * rejected row that carried a reviewed_at would become SERVABLE — the precise opposite of the decision. The note and
   * the ledger entry survive.
   */
  async review(actor: AdminRequestContext, id: string, dto: ReviewTranslationDto) {
    const review = assertReview({ decision: dto.decision, text: dto.text, note: dto.note });

    return this.pool.withTx(async (client) => {
      const current = await this.repo.getForUpdate(client, id);
      if (!current) throw new TranslationNotFoundError(id);
      if (!current.isMachine) {
        throw new InvalidTranslationError('this translation was written by a person and is already live — there is nothing to review');
      }
      if (current.reviewedAt) throw new AlreadyReviewedError(id, current.reviewedAt);

      const scopes = await this.repo.scopesFor(actor.userId);
      assertReviewerScope(current.languageCode, scopes);

      if (review.decision === 'reject') {
        const changed = await this.repo.reject(client, { id, reviewerId: actor.userId, note: review.note as string });
        if (changed === 0) throw new AlreadyReviewedError(id, 'a moment ago');
        await this.repo.insertChange(client, {
          entityType: 'translation', entityId: id, action: 'rejected',
          oldValue: { text: current.text, source: current.source, language: current.languageCode },
          newValue: { effect: 'the draft is withdrawn; the entity falls back to its canonical name until somebody supplies a correct translation' },
          reason: review.note as string, actorUserId: actor.userId,
        });
        return { id, decision: review.decision, live: false };
      }

      const changed = await this.repo.review(client, {
        id, reviewerId: actor.userId, text: review.text, note: review.note,
      });
      if (changed === 0) throw new AlreadyReviewedError(id, 'a moment ago');
      await this.repo.insertChange(client, {
        entityType: 'translation', entityId: id, action: 'approved',
        oldValue: { text: current.text, source: current.source },
        newValue: {
          text: review.text ?? current.text,
          // recorded distinctly, because "approved" and "rewrote and approved" are different facts about the engine
          edited: review.decision === 'approve_with_edit',
          language: current.languageCode, live: true,
        },
        reason: review.note ?? `approved ${current.languageCode} translation from ${current.source ?? 'a machine'}`,
        actorUserId: actor.userId,
      });
      return { id, decision: review.decision, live: true, edited: review.decision === 'approve_with_edit' };
    });
  }

  /** Withdraw a live translation. The entity falls back to its canonical name — which is degraded and readable, rather
   *  than wrong and confident. */
  async revoke(actor: AdminRequestContext, id: string, dto: RevokeTranslationDto) {
    return this.pool.withTx(async (client) => {
      const current = await this.repo.getForUpdate(client, id);
      if (!current) throw new TranslationNotFoundError(id);
      const scopes = await this.repo.scopesFor(actor.userId);
      assertReviewerScope(current.languageCode, scopes);
      const changed = await this.repo.revoke(client, { id, actorUserId: actor.userId });
      if (changed === 0) return { id, changed: false };
      await this.repo.insertChange(client, {
        entityType: 'translation', entityId: id, action: 'deactivated',
        oldValue: { text: current.text, language: current.languageCode, isMachine: current.isMachine },
        newValue: { effect: 'withdrawn — the entity now shows its canonical name in this language' },
        reason: dto.reason, actorUserId: actor.userId,
      });
      return { id, changed: true };
    });
  }

  /* ------------------------------------------------------------------ reviewer scopes */

  async grantReviewer(actor: AdminRequestContext, dto: GrantReviewerDto) {
    const grant = assertReviewerGrant({ adminUserId: dto.adminUserId, languageCode: dto.languageCode, note: dto.note });
    const languages = await this.repo.activeLanguages();
    if (!languages.some((l) => l.code === grant.languageCode)) {
      // a grant for an inactive language would be authority over something no farmer reads
      throw new InvalidTranslationError(`${grant.languageCode} is not an active platform language`);
    }
    if (await this.repo.grantExists(grant.adminUserId, grant.languageCode)) {
      throw new DuplicateTranslationError(`that reviewer already holds ${grant.languageCode}`);
    }
    return this.pool.withTx(async (client) => {
      const created = await this.repo.grantReviewer(client, { ...grant, grantedBy: actor.userId });
      await this.repo.insertChange(client, {
        entityType: 'translation_reviewer', entityId: created.id, action: 'granted',
        oldValue: null,
        newValue: { adminUserId: grant.adminUserId, languageCode: grant.languageCode },
        reason: dto.reason, actorUserId: actor.userId,
      });
      return { id: created.id, languageCode: grant.languageCode };
    });
  }

  async revokeReviewer(actor: AdminRequestContext, id: string, dto: RevokeReviewerDto) {
    return this.pool.withTx(async (client) => {
      const changed = await this.repo.revokeReviewer(client, { id, revokedBy: actor.userId });
      if (changed === 0) throw new TranslationNotFoundError(id);
      await this.repo.insertChange(client, {
        entityType: 'translation_reviewer', entityId: id, action: 'revoked',
        oldValue: null,
        newValue: { effect: 'the reviewer can no longer approve this language; approvals they already made stand, and the grant record is kept so those approvals stay explainable' },
        reason: dto.reason, actorUserId: actor.userId,
      });
      return { id, revoked: true };
    });
  }

  /* ------------------------------------------------------------------ machine-translation runs */

  /**
   * Request a machine-translation run over the gaps.
   *
   * IT RECORDS AND DOES NOT TRANSLATE. No engine is configured, so the run lands `provider_pending` with that reason, and
   * every surface says so. The alternative — a spinner over work nothing can perform — is the failure mode ADMIN-1e
   * refused for scheduled reports and ADMIN-2b for pager steps.
   *
   * The gap count is computed BEFORE the row is written, so the record carries a real denominator: "filled 40 of 3,218"
   * only means something against the number the run started from.
   */
  async requestRun(actor: AdminRequestContext, dto: RequestRunDto) {
    const entityTypes = dto.entityTypes.map((e) => e.trim());
    const bad = entityTypes.find((e) => !isTranslatableEntity(e));
    if (bad) throw new InvalidTranslationError(`"${bad}" is not a translatable entity kind`);

    const languages = await this.repo.activeLanguages();
    const codes = languages.map((l) => l.code);
    const unknown = dto.languageCodes.find((l) => !codes.includes(l.trim().toLowerCase()));
    if (unknown) throw new InvalidTranslationError(`${unknown} is not an active platform language`);
    const languageCodes = dto.languageCodes.map((l) => l.trim().toLowerCase());

    const gapCount = await this.repo.countGaps(entityTypes, languageCodes);

    return this.pool.withTx(async (client) => {
      const created = await this.repo.insertRun(client, {
        requestedBy: actor.userId, entityTypes, languageCodes, gapCount,
        reason: dto.reason,
        // NOT 'queued': queued would imply something will pick it up
        status: 'provider_pending', detail: NO_ENGINE_DETAIL,
      });
      await this.repo.insertChange(client, {
        entityType: 'translation_run', entityId: created.id, action: 'requested',
        oldValue: null,
        newValue: { entityTypes, languageCodes, gapCount, status: 'provider_pending', detail: NO_ENGINE_DETAIL },
        reason: dto.reason, actorUserId: actor.userId,
      });
      return {
        id: created.id, gapCount, status: 'provider_pending' as const,
        // said in the response, not only on the screen: a scripted consumer must not read this as work started
        note: `Recorded. ${gapCount} gap(s) are in scope and NOTHING WAS TRANSLATED — ${NO_ENGINE_DETAIL}.`,
      };
    });
  }

  async history(id: string) {
    const t = await this.repo.getById(id);
    if (!t) throw new TranslationNotFoundError(id);
    return { translation: { ...t, stateNote: describeState(t), servable: isServable(t) }, history: await this.repo.listChanges(id) };
  }
}

/** `<iso>|<uuid>`, the cursor shape this realm uses. A malformed cursor is DROPPED — a stale link shows page one rather
 *  than an error page. */
function parseCursor(raw?: string): { at: string; id: string } | undefined {
  if (!raw) return undefined;
  const [at, id] = raw.split('|');
  if (!at || !id) return undefined;
  if (Number.isNaN(Date.parse(at))) return undefined;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  return { at, id };
}
