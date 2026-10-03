// modules/twin/services/twin.service.ts · PC-56 TENANT-12 · THE DIGITAL TWIN — THE HONEST FRAME (founder decision: NO MODEL).
//
// W420 the overview (ground truth with as-ofs; the Locked state is the flag OFF — see TwinAccessService), W421 the scenarios
// (create from a template, cited assumptions with history, archive, and the RUN — refused by the gate and recorded), W422 the
// results (pair picker; every band cell "Too few runs — no registered model"; the one measured fact, actual yield last full
// season; "Send as proposal" says "no run to cite"). Every write: keyed (Law 3), audited (actor · reason · before/after · ip) in
// the same transaction, re-judged on the locked row (the review / confirm page is not an authorisation token).
//
// THE GATE LIVES IN ONE PLACE (`run`): `gateVerdict` over the model registered in `ai_models` (none) and the runner (none) →
// the refused attempt is WRITTEN (twin_runs status refused + refusal code + input snapshot hash) and AUDITED, the transaction
// COMMITS, and only then is the 409 thrown — so "a run was asked for and none happened, and why" is itself a recorded fact.
// Nothing here can write a band: kv_app holds no UPDATE on twin_runs and 0190's CHECKs + trigger refuse a non-refused row that
// does not pin a registered model. No AI badge is ever attached to a measured fact by this service — none of its wires carries one.
import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { uuidv7 } from '../../../core/database/uuid.util';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { AppConfig } from '../../../core/config/app-config';
import { ConflictError } from '../../../shared/errors/app-error';
import { KeysetCursor, encodeKeyset } from '../../../shared/pagination/us-keyset';
import { TwinRepository, ScenarioRow, RunRow } from '../repositories/twin.repository';
import { TwinFactsReadModel } from '../read-models/twin-facts.read-model';
import {
  AssumptionInput, AssumptionValue, FeedRow, ScenarioInput, TWIN_MODEL_CODE, TWIN_REFUSED_BY_NAME, YieldFact, canonicalSnapshot, gateVerdict,
  normaliseValue, reasonRefusal, resultsCell, reviewAssumptions, reviewScenario, yieldFact,
} from '../domain/twin-rules';
import { ScenarioStatus, actsFor, assertTransition, statusAfterAssumptions } from '../domain/twin-scenario.state';
import { ScenarioNotFoundError, TwinForbiddenError, TwinRefusedError, TwinRunRefusedError } from '../domain/twin.errors';

export interface TwinActor { userId: string; permissions: ReadonlySet<string>; ip: string | null; requestId: string | null }
const has = (a: { permissions: ReadonlySet<string> }, p: string) => a.permissions.has(p) || a.permissions.has('*');
export const canView = (a: { permissions: ReadonlySet<string> }) => has(a, 'twin.view');
export const canRun = (a: { permissions: ReadonlySet<string> }) => has(a, 'twin.run');
export const canManageDevices = (a: { permissions: ReadonlySet<string> }) => has(a, 'twin.devices.manage');
const pgCode = (e: unknown) => (e as { code?: string })?.code;
/**
 * NO RUNNER EXISTS. apps/ai-services has no yield, rainfall, adoption, cost or income model, and nothing in this codebase can execute
 * a scenario. This constant is what `gateVerdict` is told; the day a runner is built it changes WITH a test of the queued path.
 */
export const RUNNER_AVAILABLE = false;

@Injectable()
export class TwinService {
  constructor(@Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork, @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
              private readonly repo: TwinRepository, private readonly facts: TwinFactsReadModel, private readonly audit: AuditWriter,
              private readonly config: AppConfig) {}

  private assertView(actor: TwinActor) { if (!canView(actor)) throw new TwinForbiddenError('twin.view'); }

  /* ------------------------------------------------------------------------------------------------------------ */
  /* W420 — THE OVERVIEW (measured facts only; each with its source and as-of)                                    */
  /* ------------------------------------------------------------------------------------------------------------ */

  async overview(tenantId: string, actor: TwinActor) {
    this.assertView(actor);
    const [clock, registry, parcels, soil, seasons, devices, mandi, alerts, model] = await Promise.all([
      this.repo.clockOf(tenantId), this.facts.feeds(tenantId), this.facts.parcels(tenantId), this.facts.soil(tenantId), this.facts.seasons(tenantId),
      this.facts.devices(tenantId), this.facts.mandi(tenantId), this.facts.alerts(tenantId), this.repo.servingModel(tenantId),
    ]);
    const weather = this.config.weather;
    const feedRow = (code: string, sourceTables: string[]): FeedRow => {
      switch (code) {
        case 'parcel_register': return { code, sourceTables, state: parcels.registered > 0 ? 'recorded' : 'none', asOf: parcels.asOf, detail: { registered: parcels.registered, mapped: parcels.mapped } };
        case 'soil_tests': return { code, sourceTables, state: soil.tests > 0 ? 'recorded' : 'none', asOf: soil.latestSampledOn, detail: { tests: soil.tests, parcelsTested: soil.parcelsTested } };
        case 'devices': return { code, sourceTables, state: 'not_connected', asOf: devices.asOf, detail: { soilPods: devices.soilPods, weatherMasts: devices.weatherMasts, readings: devices.withReading, ingestion: 'not_built' } };
        case 'mandi_prices': return mandi.platformRows > 0
          ? { code, sourceTables, state: 'recorded', asOf: mandi.platformAsOf, detail: { platformRows: mandi.platformRows, tenantObservations: mandi.tenantObservations, tenantAsOf: mandi.tenantAsOf } }
          : { code, sourceTables, state: 'none', asOf: null, detail: { platformRows: 0, tenantObservations: mandi.tenantObservations, tenantAsOf: mandi.tenantAsOf } };
        case 'weather_forecast': return { code, sourceTables, state: weather.enabled ? 'live' : 'none', asOf: alerts.lastIngestedAt,
          detail: { forecastLive: weather.enabled, provider: weather.enabled ? weather.kind : null, alertsRecent: alerts.recent, alertIngestion: alerts.recent > 0 ? 'recorded' : 'none' } };
        default: return { code, sourceTables, state: 'none', asOf: null, detail: {} };
      }
    };
    return {
      clock,
      parcels: { registered: parcels.registered, mapped: parcels.mapped, unmapped: Math.max(0, parcels.registered - parcels.mapped), asOf: parcels.asOf },
      soil, seasons,
      devices: { ...devices, readings: 'none' as const, ingestion: 'not_built' as const },
      mandi,
      weather: { forecast: { live: weather.enabled, provider: weather.enabled ? weather.kind : null }, alerts: { recent: alerts.recent, lastIngestedAt: alerts.lastIngestedAt, ingestion: 'none' as const } },
      herd: { linked: false as const, reason: 'no_bmc_link' as const },
      feeds: registry.map((f) => feedRow(f.code, f.sourceTables)),
      model: { code: TWIN_MODEL_CODE, registered: model !== null },
      canRun: canRun(actor), canManageDevices: canManageDevices(actor),
      refusedByName: [...TWIN_REFUSED_BY_NAME],
    };
  }

  /** The form's vocabulary: keys (unit + bounds), templates (their keys, no values), device kinds, the floor, the model state. */
  async catalogue(tenantId: string, actor: TwinActor) {
    this.assertView(actor);
    const [cat, floor, model] = await Promise.all([this.repo.catalogue(tenantId), this.repo.minGroupSize(tenantId), this.repo.servingModel(tenantId)]);
    return { ...cat, minGroupSize: floor, canRun: canRun(actor), canManageDevices: canManageDevices(actor), model: { code: TWIN_MODEL_CODE, registered: model !== null },
      bounds: { minCitation: 10, maxCitation: 500, minName: 3, maxName: 120, minReason: 3, maxReason: 300 } };
  }

  /* ------------------------------------------------------------------------------------------------------------ */
  /* W421 — THE SCENARIOS                                                                                         */
  /* ------------------------------------------------------------------------------------------------------------ */

  private static runWire(r: RunRow, names: Map<string, string>) {
    return { id: r.id, status: r.status, refusalCode: r.refusalCode, createdAt: r.createdAt, requestedBy: names.get(r.requestedBy) ?? null,
      // a band only ever travels from a DONE run (bandShown) — and no run is done; a refused attempt carries none of it
      modelCode: r.status === 'refused' ? null : r.modelCode, modelVersion: r.status === 'refused' ? null : r.modelVersion };
  }
  private static scenarioWire(s: ScenarioRow) {
    return { id: s.id, name: s.name, templateCode: s.templateCode, productId: s.productId, productName: s.productName, status: s.status,
      createdAt: s.createdAt, updatedAt: s.updatedAt, archivedAt: s.archivedAt, archiveReason: s.archiveReason, acts: actsFor(s.status) };
  }

  async listScenarios(tenantId: string, actor: TwinActor, q: { status?: ScenarioStatus; cursor?: KeysetCursor; limit: number }) {
    this.assertView(actor);
    const [rows, counts, model] = await Promise.all([this.repo.listScenarios(tenantId, q), this.repo.countScenarios(tenantId), this.repo.servingModel(tenantId)]);
    const runs = await this.repo.runs(tenantId, rows.map((r) => r.id));
    const names = await this.repo.shortNames(tenantId, runs.map((r) => r.requestedBy));
    const last = rows[rows.length - 1];
    return {
      items: rows.map((s) => {
        const mine = runs.filter((r) => r.scenarioId === s.id);
        return { ...TwinService.scenarioWire(s), attempts: mine.length, lastAttempt: mine[0] ? TwinService.runWire(mine[0], names) : null,
          cell: resultsCell(mine, model !== null) };
      }),
      counts, total: counts.draft + counts.ready + counts.archived,
      nextCursor: rows.length === q.limit && last ? encodeKeyset(last.createdUs, last.id) : null,
      canRun: canRun(actor), model: { code: TWIN_MODEL_CODE, registered: model !== null },
    };
  }

  async scenario(tenantId: string, actor: TwinActor, id: string) {
    this.assertView(actor);
    const s = await this.repo.getScenario(tenantId, id);
    if (!s) throw new ScenarioNotFoundError(id);
    const [assumptions, history, runs, cat, model] = await Promise.all([
      this.repo.assumptions(tenantId, id), this.repo.history(tenantId, id), this.repo.runs(tenantId, [id]), this.repo.catalogue(tenantId), this.repo.servingModel(tenantId),
    ]);
    const names = await this.repo.shortNames(tenantId, runs.map((r) => r.requestedBy));
    const templateKeys = s.templateCode ? cat.templates.find((t) => t.code === s.templateCode)?.keys ?? [] : [];
    return {
      scenario: TwinService.scenarioWire(s), templateKeys,
      assumptions: assumptions.map((a) => ({ key: a.key, value: normaliseValue(a.value) ?? a.value, unit: a.unit, citation: a.citation, asOf: a.asOf, setAt: a.setAt, setBy: a.setByName })),
      missingKeys: templateKeys.filter((k) => !assumptions.some((a) => a.key === k)),
      history: history.map((h) => ({ ...h, setBy: h.setByName })),
      attempts: runs.map((r) => TwinService.runWire(r, names)),
      cell: resultsCell(runs, model !== null),
      canRun: canRun(actor), model: { code: TWIN_MODEL_CODE, registered: model !== null },
    };
  }

  private async scenarioReview(tenantId: string, actor: TwinActor, input: ScenarioInput) {
    const cat = await this.repo.catalogue(tenantId);
    const productId = (input.productId ?? '').trim();
    const known = productId ? await this.repo.productKnown(tenantId, productId) : null;
    return reviewScenario(input, { canRun: canRun(actor), templates: cat.templates, productKnown: known });
  }
  async previewScenario(tenantId: string, actor: TwinActor, input: ScenarioInput) {
    this.assertView(actor);
    return this.scenarioReview(tenantId, actor, input);
  }
  async createScenario(tenantId: string, actor: TwinActor, key: string, input: ScenarioInput) {
    this.assertView(actor);
    return this.idem.remember(key, actor.userId, 'twin.scenario.create', async () => {
      const r = await this.scenarioReview(tenantId, actor, input);
      if (!r.ready) throw new TwinRefusedError(r.refusals);
      const id = uuidv7();
      try {
        await this.uow.run(tenantId, async (tx) => {
          await this.repo.insertScenario(tx, { id, tenantId, name: r.name, templateCode: r.templateCode, productId: r.productId, userId: actor.userId });
          await this.audit.write(tx, {
            tenantId, actorUserId: actor.userId, action: 'twin.scenario.created', entityType: 'twin_scenario', entityId: id,
            oldValue: null, newValue: { name: r.name, templateCode: r.templateCode, productId: r.productId, status: 'draft', templateKeys: r.keys }, reason: null, ip: actor.ip, requestId: actor.requestId,
          });
        }, { userId: actor.userId });
      } catch (e) { if (pgCode(e) === '23514') throw new TwinRefusedError([{ field: null, code: 'DATABASE_REFUSED' }]); throw e; }
      return { id, status: 'draft' as const, templateKeys: r.keys };
    });
  }

  private async assumptionReview(tenantId: string, actor: TwinActor, s: ScenarioRow, input: AssumptionInput[], tx?: Parameters<TwinRepository['assumptions']>[2]) {
    const [cat, current, clock] = await Promise.all([this.repo.catalogue(tenantId), this.repo.assumptions(tenantId, s.id, tx), this.repo.clockOf(tenantId)]);
    const templateKeys = s.templateCode ? cat.templates.find((t) => t.code === s.templateCode)?.keys ?? [] : null;
    const cur = new Map<string, AssumptionValue>(current.map((a) => [a.key, { key: a.key, value: a.value, unit: a.unit, citation: a.citation, asOf: a.asOf }]));
    const review = reviewAssumptions(input, { canRun: canRun(actor), archived: s.status === 'archived', keys: cat.keys, templateKeys, today: clock.today, current: cur });
    return { review, templateKeys };
  }
  /** W2801 — the review the API computes (read-only): every refusal against its field, before / after per key. */
  async previewAssumptions(tenantId: string, actor: TwinActor, id: string, input: AssumptionInput[]) {
    this.assertView(actor);
    const s = await this.repo.getScenario(tenantId, id);
    if (!s) throw new ScenarioNotFoundError(id);
    const { review, templateKeys } = await this.assumptionReview(tenantId, actor, s, input);
    return { ...review, statusAfter: review.ready ? statusAfterAssumptions(s.status, templateKeys, review.setKeys) : s.status };
  }
  /** W2802 — save (keyed; re-judged on the locked scenario; every change lands in twin_assumption_history by trigger). */
  async saveAssumptions(tenantId: string, actor: TwinActor, id: string, key: string, input: AssumptionInput[]) {
    this.assertView(actor);
    return this.idem.remember(key, actor.userId, 'twin.assumptions.save', async () => {
      try {
        return await this.uow.run(tenantId, async (tx) => {
          const s = await this.repo.getScenario(tenantId, id, tx, true);
          if (!s) throw new ScenarioNotFoundError(id);
          const { review, templateKeys } = await this.assumptionReview(tenantId, actor, s, input, tx);
          if (!review.ready) throw new TwinRefusedError(review.refusals);
          for (const d of review.diff) {
            await this.repo.upsertAssumption(tx, { tenantId, scenarioId: id, key: d.key, value: d.after.value, unit: d.after.unit, citation: d.after.citation, asOf: d.after.asOf, userId: actor.userId });
          }
          const to = statusAfterAssumptions(s.status, templateKeys, review.setKeys);
          if (to !== s.status) { assertTransition(s.status, to); await this.repo.setStatus(tx, tenantId, id, to, actor.userId); }
          await this.audit.write(tx, {
            tenantId, actorUserId: actor.userId, action: 'twin.assumptions.saved', entityType: 'twin_scenario', entityId: id,
            oldValue: { status: s.status, assumptions: review.diff.map((d) => d.before) },
            newValue: { status: to, assumptions: review.diff.map((d) => d.after) }, reason: null, ip: actor.ip, requestId: actor.requestId,
          });
          return { id, status: to, changed: review.diff.length };
        }, { userId: actor.userId });
      } catch (e) { if (pgCode(e) === '23514') throw new TwinRefusedError([{ field: null, code: 'DATABASE_REFUSED' }]); throw e; }
    });
  }

  /* ------------------------------------------------------------------------------------------------------------ */
  /* THE ACTS (W2804–W2806): run (THE GATE) · archive                                                             */
  /* ------------------------------------------------------------------------------------------------------------ */

  /** W2804 — the verdict at confirm (read-only). For "run" it states, before anything is pressed, that the gate refuses it. */
  async previewAct(tenantId: string, actor: TwinActor, id: string, act: 'run' | 'archive', reason?: string) {
    this.assertView(actor);
    const s = await this.repo.getScenario(tenantId, id);
    if (!s) throw new ScenarioNotFoundError(id);
    const refusals: string[] = [];
    if (!canRun(actor)) refusals.push('NO_PERMISSION');
    if (s.status === 'archived') refusals.push('SCENARIO_ARCHIVED');
    if (act === 'archive') { const rr = reasonRefusal(reason); if (rr) refusals.push(rr); }
    const assumptions = await this.repo.assumptions(tenantId, id);
    if (act === 'run') {
      const verdict = gateVerdict(await this.repo.servingModel(tenantId), RUNNER_AVAILABLE);
      return { scenario: TwinService.scenarioWire(s), act, assumptions: assumptions.length,
        // the run can be ASKED for (and is recorded) when nothing else refuses; the gate's answer is stated here in advance
        allowed: refusals.length === 0, refusals, gate: { code: verdict.allowed ? null : verdict.code, modelCode: TWIN_MODEL_CODE, willBeRefused: !verdict.allowed } };
    }
    return { scenario: TwinService.scenarioWire(s), act, assumptions: assumptions.length, allowed: refusals.length === 0, refusals, gate: null };
  }

  /**
   * W2805 / W2806 — THE RUN. Permission-gated (`twin.run`), keyed, audited. The gate's verdict is RECORDED (twin_runs, status
   * refused, the input snapshot hash of what was asked) in a committed transaction, and then the 409 is thrown naming the gate.
   * A replay with the same key returns the same recorded refusal (one row — idempotency service + UNIQUE (tenant, user, key)).
   */
  async run(tenantId: string, actor: TwinActor, id: string, key: string): Promise<never> {
    this.assertView(actor);
    if (!canRun(actor)) throw new TwinRefusedError([{ field: null, code: 'NO_PERMISSION' }]);
    const outcome = await this.idem.remember(key, actor.userId, 'twin.scenario.run', () => this.uow.run(tenantId, async (tx) => {
      const prior = await this.repo.runByKey(tx, tenantId, actor.userId, key);
      if (prior) return { runId: prior.id, code: (prior.refusalCode ?? 'TWIN_NO_MODEL_REGISTERED') as 'TWIN_NO_MODEL_REGISTERED' | 'TWIN_NO_RUNNER' };
      const s = await this.repo.getScenario(tenantId, id, tx, true);
      if (!s) throw new ScenarioNotFoundError(id);
      if (s.status === 'archived') throw new TwinRefusedError([{ field: null, code: 'SCENARIO_ARCHIVED' }]);
      const assumptions = await this.repo.assumptions(tenantId, id, tx);
      const snapshot = assumptions.map((a) => ({ key: a.key, value: a.value, unit: a.unit, citation: a.citation, asOf: a.asOf }));
      const canonical = canonicalSnapshot(snapshot);
      const hash = createHash('sha256').update(canonical).digest('hex');
      const model = await this.repo.servingModel(tenantId, tx);
      const verdict = gateVerdict(model, RUNNER_AVAILABLE);
      // With RUNNER_AVAILABLE false the verdict never allows; were it ever to, the queued path does not exist yet and the attempt is
      // refused by the runner's own name rather than silently accepted.
      const code = verdict.allowed ? 'TWIN_NO_RUNNER' : verdict.code;
      const runId = uuidv7();
      await this.repo.insertRefusedRun(tx, { id: runId, tenantId, scenarioId: id, hash, snapshot: JSON.parse(canonical), userId: actor.userId, code, key,
        modelCode: verdict.model?.code ?? null, modelVersion: verdict.model?.version ?? null, modelId: verdict.model?.id ?? null });
      await this.audit.write(tx, {
        tenantId, actorUserId: actor.userId, action: 'twin.run.refused', entityType: 'twin_run', entityId: runId,
        oldValue: { scenarioId: id, scenarioStatus: s.status },
        newValue: { status: 'refused', refusalCode: code, modelCode: TWIN_MODEL_CODE, modelRegistered: model !== null, inputSnapshotHash: hash, assumptions: snapshot.length },
        reason: code, ip: actor.ip, requestId: actor.requestId,
      });
      return { runId, code };
    }, { userId: actor.userId }));
    throw new TwinRunRefusedError(outcome.code, outcome.runId, id);
  }

  async archive(tenantId: string, actor: TwinActor, id: string, key: string, reason: string) {
    this.assertView(actor);
    return this.idem.remember(key, actor.userId, 'twin.scenario.archive', () => this.uow.run(tenantId, async (tx) => {
      const refusals: Array<{ field: string | null; code: string }> = [];
      if (!canRun(actor)) refusals.push({ field: null, code: 'NO_PERMISSION' });
      const rr = reasonRefusal(reason); if (rr) refusals.push({ field: 'reason', code: rr });
      const s = await this.repo.getScenario(tenantId, id, tx, true);
      if (!s) throw new ScenarioNotFoundError(id);
      if (s.status === 'archived') refusals.push({ field: null, code: 'SCENARIO_ARCHIVED' });
      if (refusals.length) throw new TwinRefusedError(refusals);
      assertTransition(s.status, 'archived');
      await this.repo.archive(tx, tenantId, id, actor.userId, reason.trim());
      const after = await this.repo.getScenario(tenantId, id, tx);
      if (!after || after.status !== 'archived') throw new ConflictError('the scenario moved while you were confirming — reload it');
      await this.audit.write(tx, {
        tenantId, actorUserId: actor.userId, action: 'twin.scenario.archived', entityType: 'twin_scenario', entityId: id,
        oldValue: { status: s.status }, newValue: { status: 'archived' }, reason: reason.trim(), ip: actor.ip, requestId: actor.requestId,
      });
      return { id, status: 'archived' as const };
    }, { userId: actor.userId }));
  }

  /* ------------------------------------------------------------------------------------------------------------ */
  /* W422 — THE RESULTS                                                                                           */
  /* ------------------------------------------------------------------------------------------------------------ */

  async results(tenantId: string, actor: TwinActor, a: string, b?: string) {
    this.assertView(actor);
    const ids = Array.from(new Set([a, b].filter((x): x is string => !!x)));
    const scenarios = (await Promise.all(ids.map((id) => this.repo.getScenario(tenantId, id))));
    ids.forEach((id, i) => { if (!scenarios[i]) throw new ScenarioNotFoundError(id); });
    const [runs, model, floor, edges] = await Promise.all([this.repo.runs(tenantId, ids), this.repo.servingModel(tenantId), this.repo.minGroupSize(tenantId), this.facts.conversions(tenantId)]);
    const facts = new Map<string, YieldFact>();
    for (const s of scenarios as ScenarioRow[]) {
      if (s.productId && !facts.has(s.productId)) facts.set(s.productId, yieldFact(await this.facts.harvests(tenantId, s.productId), edges, floor));
    }
    const clock = await this.repo.clockOf(tenantId);
    const pair = (scenarios as ScenarioRow[]).map((s) => {
      const mine = runs.filter((r) => r.scenarioId === s.id);
      const cell = resultsCell(mine, model !== null);
      return { scenario: TwinService.scenarioWire(s), attempts: mine.length, cells: { yield: cell, income: cell },
        fact: s.productId ? facts.get(s.productId)! : { state: 'no_crop' as const } };
    });
    const citable = pair.find((p) => p.cells.yield.state === 'band');
    return {
      clock, pair, minGroupSize: floor, model: { code: TWIN_MODEL_CODE, registered: model !== null },
      proposal: citable ? { available: true as const, runId: (citable.cells.yield as { runId: string }).runId } : { available: false as const, reason: 'no_run_to_cite' as const },
      refusedByName: ['model', 'districtDrill'] as const,
    };
  }
}
