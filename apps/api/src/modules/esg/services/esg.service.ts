// modules/esg/services/esg.service.ts · PC-56 TENANT-9d · ESG: the dashboard (W423), the method pages (the canon's dangling
// anchors, made real), the report checklist + the unsigned export (W424), and the cooperative's disclosures (W2598–W2604).
//
// THE GATE LIVES IN ONE PLACE (`compute`). For every row of 0183's registry: a fact is READ only behind a published method
// whose text the platform can cite; the verdict and the printable fact come from the pure `verdictOf` / `printable`; the
// wire never carries a fact the gate did not pass. The dashboard, the method page, the report checklist and the export file
// all read `compute` — none of them can widen it.
//
// THE DISCLOSURE IS WORDS. Reviewed by the API (metric exists; every language active; length; no markup; NO NUMBER in any
// script), keyed by the review / confirm page's Idempotency-Key (Law 3), written with an audit row in the same transaction,
// re-judged on the locked row; 0183's guard and CHECK are the wall under it (23514 → DATABASE_REFUSED).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { uuidv7 } from '../../../core/database/uuid.util';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { UiMessageRepository } from '../../../core/i18n/ui-message.repository';
import type { LangMap } from '../../../core/i18n/lang-map';
import { ExportPlaneService } from '../../../core/exports-plane/export-plane.service';
import { ConflictError } from '../../../shared/errors/app-error';
import { Disclosure, EsgClock, EsgRepository } from '../repositories/esg.repository';
import { EsgFactsReadModel } from '../read-models/esg-facts.read-model';
import {
  ESG_REFUSED_BY_NAME, Fact, MAX_NOTE, MAX_TEXT, MIN_NOTE, MIN_TEXT, MethodRow, Verdict, VERDICTS, DisclosureInput,
  buildDisclosureReview, disclosureActVerdict, freshnessOf, isFactKind, printable, verdictOf, windowEnding,
} from '../domain/esg-rules';
import { DisclosureAct, actsFor } from '../domain/esg-disclosure.state';
import { ESG_METRICS_DATASET, ESG_UNSIGNED_NOTE, EsgEntry } from '../domain/esg-export';
import { DisclosureNotFoundError, EsgRefusedError, MetricNotFoundError } from '../domain/esg.errors';

export interface EsgActor { userId: string; permissions: ReadonlySet<string>; ip: string | null; requestId: string | null }
const has = (a: { permissions: ReadonlySet<string> }, p: string) => a.permissions.has(p) || a.permissions.has('*');
export const canDisclose = (a: { permissions: ReadonlySet<string> }) => has(a, 'esg.disclose');

const pgCode = (e: unknown) => (e as { code?: string })?.code;
/** The adulteration method's window when its row declares none (0183 declares 30). */
const DEFAULT_WINDOW_DAYS = 30;
/** W424's own refusals, in its order (a subset of ESG_REFUSED_BY_NAME). */
export const REPORT_REFUSED_BY_NAME = ['audience', 'platformSignature', 'docIdQr', 'watermark', 'byteIdentical', 'pdf', 'retry'] as const;

export interface EsgRowWire {
  metricCode: string; pillar: string; sortOrder: number; name: LangMap; verdict: Verdict;
  method: { status: string; ref: string | null; version: number | null; publishedAt: string | null; text: LangMap | null;
    sourceTables: string[]; freshnessRule: string; staleAfterDays: number | null; windowDays: number | null };
  fact: Fact | null; freshness: EsgEntry['freshness']; needs: LangMap | null;
}

@Injectable()
export class EsgService {
  constructor(@Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork, @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
              private readonly repo: EsgRepository, private readonly facts: EsgFactsReadModel, private readonly audit: AuditWriter,
              private readonly ui: UiMessageRepository, private readonly exportsPlane: ExportPlaneService) {}

  /* ------------------------------------------------------------------------------------------------------------ */
  /* THE GATE                                                                                                     */
  /* ------------------------------------------------------------------------------------------------------------ */

  private async readFact(tenantId: string, m: MethodRow, clock: EsgClock): Promise<Fact | null> {
    switch (m.factKind) {
      case 'omov': return this.facts.omov(tenantId, clock.zone);
      case 'adulteration': {
        const days = m.windowDays ?? DEFAULT_WINDOW_DAYS;
        return this.facts.adulteration(tenantId, clock.zone, { ...windowEnding(clock.today, days), days });
      }
      case 'audit_trail': return this.facts.auditTrail(tenantId, clock.zone);
      default: return null;
    }
  }

  /** Every row of the registry with its verdict, its printable fact (or none) and its words. The ONE gate. */
  async compute(tenantId: string): Promise<{ clock: EsgClock; entries: Array<EsgEntry & { needs: LangMap | null }> }> {
    const [methods, clock, words] = await Promise.all([this.repo.methods(tenantId), this.repo.clockOf(tenantId), this.ui.mapsUnder('esg.')]);
    const entries: Array<EsgEntry & { needs: LangMap | null }> = [];
    for (const m of methods) {
      const methodText = m.methodStatus === 'published' ? (words.get(`esg.method.${m.metricCode}.text`) ?? null) : null;
      const cited = methodText !== null;
      // A fact is READ only behind a published, citable method whose kind the API has a reader for.
      const raw = m.methodStatus === 'published' && cited && isFactKind(m.factKind) ? await this.readFact(tenantId, m, clock) : null;
      const verdict = verdictOf(m, raw, cited);
      entries.push({
        method: m, verdict, fact: printable(m, raw, cited), freshness: freshnessOf(m, raw, clock, cited),
        name: words.get(`esg.metric.${m.metricCode}.name`) ?? { en: m.metricCode },
        methodText: cited ? methodText : null,
        needs: verdict === 'no_method' || verdict === 'no_programme' ? (words.get(`esg.metric.${m.metricCode}.needs`) ?? null) : null,
      });
    }
    return { clock, entries };
  }

  private wire(e: EsgEntry & { needs: LangMap | null }): EsgRowWire {
    const m = e.method;
    return {
      metricCode: m.metricCode, pillar: m.pillar, sortOrder: m.sortOrder, name: e.name, verdict: e.verdict,
      method: { status: m.methodStatus, ref: m.methodRef, version: m.methodVersion, publishedAt: m.publishedAt, text: e.methodText,
        sourceTables: m.sourceTables, freshnessRule: m.freshnessRule, staleAfterDays: m.staleAfterDays, windowDays: m.windowDays },
      fact: e.fact, freshness: e.freshness, needs: e.needs,
    };
  }

  private static disclosureWire(d: Disclosure) {
    return { id: d.id, metricCode: d.metricCode, status: d.status, texts: d.texts, createdAt: d.createdAt, updatedAt: d.updatedAt,
      publishedAt: d.publishedAt, withdrawnAt: d.withdrawnAt, withdrawReason: d.withdrawReason, acts: actsFor(d.status) };
  }

  /** W423 — the dashboard. A cooperative's published disclosure sits beside its metric; a discloser also sees its drafts. */
  async dashboard(tenantId: string, actor: EsgActor) {
    const [{ clock, entries }, live] = await Promise.all([this.compute(tenantId), this.repo.liveDisclosures(tenantId)]);
    const disclose = canDisclose(actor);
    const counts = Object.fromEntries(VERDICTS.map((v) => [v, entries.filter((e) => e.verdict === v).length])) as Record<Verdict, number>;
    return {
      clock, canDisclose: disclose, counts,
      rows: entries.map((e) => ({
        ...this.wire(e),
        disclosure: (() => { const p = live.find((d) => d.metricCode === e.method.metricCode && d.status === 'published'); return p ? EsgService.disclosureWire(p) : null; })(),
        drafts: disclose ? live.filter((d) => d.metricCode === e.method.metricCode && d.status === 'draft').map(EsgService.disclosureWire) : [],
      })),
      refusedByName: [...ESG_REFUSED_BY_NAME],
    };
  }

  /** A method page — W423's `#method-…` / `#source-…` anchors had no targets in the canon; here each metric has a page. */
  async method(tenantId: string, code: string) {
    const { clock, entries } = await this.compute(tenantId);
    const e = entries.find((x) => x.method.metricCode === code);
    if (!e) throw new MetricNotFoundError(code);
    return { clock, row: this.wire(e) };
  }

  /** W424 — the greenwash guard over EVERY metric: what the file will carry, what it leaves out and why. */
  async report(tenantId: string, actor: EsgActor) {
    const [{ clock, entries }, published, languages] = await Promise.all([this.compute(tenantId), this.repo.publishedDisclosures(tenantId), this.repo.activeLanguages(tenantId)]);
    const checklist = entries.map((e) => ({ metricCode: e.method.metricCode, pillar: e.method.pillar, name: e.name, verdict: e.verdict,
      included: e.verdict === 'published_with_fact', methodRef: e.method.methodRef, methodVersion: e.method.methodVersion }));
    return {
      clock, checklist, included: checklist.filter((c) => c.included).length, excluded: checklist.filter((c) => !c.included).length,
      disclosures: published.length, canGenerate: canDisclose(actor), languages, dataset: ESG_METRICS_DATASET,
      unsignedNote: ESG_UNSIGNED_NOTE, refusedByName: [...REPORT_REFUSED_BY_NAME],
    };
  }

  /** W424 "Generate report" — the unsigned file on the 6e-2 plane. Generating words for outside audiences is `esg.disclose`. */
  async enqueueReport(tenantId: string, actor: EsgActor, key: string, params: { lang?: string }, ip: string | null) {
    if (!canDisclose(actor)) throw new EsgRefusedError([{ field: null, code: 'NO_PERMISSION' }]);
    return this.exportsPlane.enqueue(tenantId, { userId: actor.userId, permissions: actor.permissions }, key,
      { datasetCode: ESG_METRICS_DATASET, params: params.lang ? { lang: params.lang } : {} }, ip);
  }

  /* ------------------------------------------------------------------------------------------------------------ */
  /* THE DISCLOSURE (W2598–W2601)                                                                                 */
  /* ------------------------------------------------------------------------------------------------------------ */

  async disclosureCatalogue(tenantId: string, actor: EsgActor) {
    const [methods, words, languages, reasons] = await Promise.all([this.repo.methods(tenantId), this.ui.mapsUnder('esg.metric.'), this.repo.activeLanguages(tenantId), this.repo.withdrawReasons(tenantId)]);
    return {
      metrics: methods.map((m) => ({ code: m.metricCode, pillar: m.pillar, name: words.get(`esg.metric.${m.metricCode}.name`) ?? { en: m.metricCode }, methodStatus: m.methodStatus })),
      languages, withdrawReasons: reasons, bounds: { minText: MIN_TEXT, maxText: MAX_TEXT, minNote: MIN_NOTE, maxNote: MAX_NOTE }, canDisclose: canDisclose(actor),
    };
  }

  private async review(tenantId: string, actor: EsgActor, input: DisclosureInput, current: Disclosure | null) {
    const [methods, languages] = await Promise.all([this.repo.methods(tenantId), this.repo.activeLanguages(tenantId)]);
    return buildDisclosureReview(input, {
      canDisclose: canDisclose(actor), metricCodes: methods.map((m) => m.metricCode), languages,
      current: current ? { status: current.status, metricCode: current.metricCode, texts: current.texts } : null,
    });
  }

  /** W2599 — the review the API computes (read-only). `id` = an edit of that draft. */
  async previewDisclosure(tenantId: string, actor: EsgActor, input: DisclosureInput, id?: string) {
    const current = id ? await this.repo.get(tenantId, id) : null;
    if (id && !current) throw new DisclosureNotFoundError(id);
    return this.review(tenantId, actor, input, current);
  }

  /** W2600 — create (keyed). */
  async createDisclosure(tenantId: string, actor: EsgActor, key: string, input: DisclosureInput) {
    return this.idem.remember(key, actor.userId, 'esg.disclosure.create', async () => {
      const r = await this.review(tenantId, actor, input, null);
      if (!r.ready || !r.metricCode) throw new EsgRefusedError(r.refusals);
      const id = uuidv7();
      try {
        await this.uow.run(tenantId, async (tx) => {
          await this.repo.insert(tx, { id, tenantId, metricCode: r.metricCode as string, texts: r.texts, userId: actor.userId });
          await this.audit.write(tx, {
            tenantId, actorUserId: actor.userId, action: 'esg.disclosure.created', entityType: 'esg_disclosure', entityId: id,
            oldValue: null, newValue: { status: 'draft', metricCode: r.metricCode, texts: r.texts }, reason: null, ip: actor.ip, requestId: actor.requestId,
          });
        }, { userId: actor.userId });
      } catch (e) {
        if (pgCode(e) === '23514') throw new EsgRefusedError([{ field: null, code: 'DATABASE_REFUSED' }]);
        throw e;
      }
      return { id, status: 'draft' as const };
    });
  }

  /** Edit a draft's words (keyed) — re-judged on the locked row. */
  async updateDisclosure(tenantId: string, actor: EsgActor, id: string, key: string, input: DisclosureInput) {
    return this.idem.remember(key, actor.userId, 'esg.disclosure.edit', async () => {
      try {
        return await this.uow.run(tenantId, async (tx) => {
          const cur = await this.repo.get(tenantId, id, tx);
          if (!cur) throw new DisclosureNotFoundError(id);
          const r = await this.review(tenantId, actor, input, cur);
          if (!r.ready) throw new EsgRefusedError(r.refusals);
          const after = await this.repo.updateDraft(tx, tenantId, id, r.texts, actor.userId);
          if (!after) throw new ConflictError('the disclosure moved while you were reviewing — reload it');
          await this.audit.write(tx, {
            tenantId, actorUserId: actor.userId, action: 'esg.disclosure.edited', entityType: 'esg_disclosure', entityId: id,
            oldValue: { texts: cur.texts }, newValue: { texts: after.texts }, reason: null, ip: actor.ip, requestId: actor.requestId,
          });
          return { id, status: after.status };
        }, { userId: actor.userId });
      } catch (e) {
        if (pgCode(e) === '23514') throw new EsgRefusedError([{ field: null, code: 'DATABASE_REFUSED' }]);
        throw e;
      }
    });
  }

  async disclosure(tenantId: string, id: string) {
    const d = await this.repo.get(tenantId, id);
    if (!d) throw new DisclosureNotFoundError(id);
    return EsgService.disclosureWire(d);
  }

  /* ------------------------------------------------------------------------------------------------------------ */
  /* THE ACTS (W2602–W2604): publish · withdraw                                                                   */
  /* ------------------------------------------------------------------------------------------------------------ */

  async previewAct(tenantId: string, actor: EsgActor, id: string, act: DisclosureAct, input: { reasonCode?: string; note?: string }) {
    const d = await this.repo.get(tenantId, id);
    if (!d) throw new DisclosureNotFoundError(id);
    const [other, reasons] = await Promise.all([this.repo.otherPublished(tenantId, d.metricCode, d.id), this.repo.withdrawReasons(tenantId)]);
    const v = disclosureActVerdict(act, d, { canDisclose: canDisclose(actor), otherPublished: other, reasons }, input);
    return { disclosure: EsgService.disclosureWire(d), allowed: v.allowed, refusals: v.refusals, to: v.to, reasons };
  }

  async act(tenantId: string, actor: EsgActor, id: string, act: DisclosureAct, input: { reasonCode?: string; note?: string }, key: string) {
    return this.idem.remember(key, actor.userId, `esg.disclosure.${act}`, async () => {
      try {
        return await this.uow.run(tenantId, async (tx) => {
          const d = await this.repo.get(tenantId, id, tx);
          if (!d) throw new DisclosureNotFoundError(id);
          const [other, reasons] = await Promise.all([this.repo.otherPublished(tenantId, d.metricCode, d.id, tx), this.repo.withdrawReasons(tenantId)]);
          const v = disclosureActVerdict(act, d, { canDisclose: canDisclose(actor), otherPublished: other, reasons }, input);
          if (!v.allowed) throw new EsgRefusedError(v.refusals.map((code) => ({ field: null, code })));
          const note = (input.note ?? '').trim();
          const after = act === 'publish'
            ? await this.repo.publish(tx, tenantId, id, actor.userId)
            : await this.repo.withdraw(tx, tenantId, id, actor.userId, (input.reasonCode ?? '').trim());
          if (!after) throw new ConflictError('the disclosure moved while you were confirming — reload it');
          await this.audit.write(tx, {
            tenantId, actorUserId: actor.userId, action: act === 'publish' ? 'esg.disclosure.published' : 'esg.disclosure.withdrawn',
            entityType: 'esg_disclosure', entityId: id,
            oldValue: { status: d.status }, newValue: { status: after.status, metricCode: d.metricCode, ...(act === 'withdraw' ? { withdrawReason: after.withdrawReason } : {}) },
            reason: note, ip: actor.ip, requestId: actor.requestId,
          });
          return { id, status: after.status };
        }, { userId: actor.userId });
      } catch (e) {
        if (pgCode(e) === '23505') throw new EsgRefusedError([{ field: null, code: 'ANOTHER_PUBLISHED' }]);
        if (pgCode(e) === '23514') throw new EsgRefusedError([{ field: null, code: 'DATABASE_REFUSED' }]);
        throw e;
      }
    });
  }
}
