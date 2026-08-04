// apps/admin-api/src/modules/ai-models-ops/__tests__/ai-models-ops.spec.ts · unit tests (pure/mocked).
// Covers: the model lifecycle state machine; self-contained admin-JWT verification (alg/iss/aud/exp/signature);
// owner-role permission resolution; the FIDO2 + step-up guards; and the registry/threshold services proving
// every write audits in-tx + the state machine is enforced.
import { createHmac } from 'node:crypto';
import { AiModel } from '../domain/ai-model.entity';
import { IllegalModelTransitionError } from '../domain/ai-model.state';
import { InvalidAiModelError } from '../domain/ai-models.errors';
import { ModelRegistryService } from '../services/model-registry.service';
import { ThresholdTuningService } from '../services/threshold-tuning.service';
import { AdminConfig } from '../../../core/config/admin-config';
import { verifyAdminToken, AdminTokenError } from '../../../core/auth/admin-jwt.strategy';
import { resolveOwnerPermissions, hasOwnerPermission } from '../../../core/rbac/owner-roles';
import { HardwareKeyGuard } from '../../../core/auth/hardware-key.guard';
import { StepUpReauthGuard } from '../../../core/auth/step-up-reauth.guard';

// ---------- domain: lifecycle state machine ----------
describe('AiModel domain', () => {
  it('register validates code/version/threshold + defaults to shadow', () => {
    const m = AiModel.register({ id: 'm1', code: 'photo_grading', version: 'v1', provider: 'inhouse', confidenceThreshold: 0.7 });
    expect(m.status).toBe('shadow');
    expect(() => AiModel.register({ id: 'm2', code: 'BAD CODE', version: 'v1', provider: null, confidenceThreshold: null })).toThrow(InvalidAiModelError);
    expect(() => AiModel.register({ id: 'm3', code: 'ok', version: 'v1', provider: null, confidenceThreshold: 2 })).toThrow(InvalidAiModelError);
  });
  it('promote follows the ladder; illegal throws; retired terminal', () => {
    const m = AiModel.register({ id: 'm1', code: 'cc', version: 'v1', provider: null, confidenceThreshold: 0.5 });
    expect(m.promote('canary')).toEqual({ from: 'shadow', to: 'canary' });
    m.promote('production'); m.retire();
    expect(m.status).toBe('retired');
    expect(() => m.promote('production')).toThrow(IllegalModelTransitionError);
  });
  it('tuneThreshold validates [0,1] + returns old→new', () => {
    const m = AiModel.register({ id: 'm1', code: 'cc', version: 'v1', provider: null, confidenceThreshold: 0.5 });
    expect(m.tuneThreshold(0.9)).toEqual({ from: 0.5, to: 0.9 });
    expect(() => m.tuneThreshold(-0.1)).toThrow(InvalidAiModelError);
  });
});

// ---------- self-contained admin-JWT verification ----------
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
function sign(payload: Record<string, unknown>, secret: string, alg = 'HS256') {
  const h = b64({ alg, typ: 'JWT' }); const p = b64(payload);
  const s = createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}
const cfg = new AdminConfig({ NODE_ENV: 'test', ADMIN_JWT_SECRET: 's'.repeat(40), ADMIN_JWT_ISSUER: 'krishalaya-admin', ADMIN_JWT_AUDIENCE: 'krishalaya-admin-api', ADMIN_REQUIRE_HARDWARE_KEY: 'true' });
const goodClaims = (over: Record<string, unknown> = {}) => ({ sub: 'admin1', roles: ['platform_ai_ops'], amr: ['pwd', 'hwk'], auth_time: Math.floor(Date.now() / 1000), iss: 'krishalaya-admin', aud: 'krishalaya-admin-api', exp: Math.floor(Date.now() / 1000) + 600, ...over });

describe('verifyAdminToken', () => {
  it('accepts a well-formed token + surfaces claims', () => {
    const p = verifyAdminToken(sign(goodClaims(), cfg.jwt.secret), cfg);
    expect(p.userId).toBe('admin1'); expect(p.amr).toContain('hwk'); expect(p.roles).toContain('platform_ai_ops');
  });
  it('rejects bad signature, wrong alg, bad iss/aud, and expiry', () => {
    expect(() => verifyAdminToken(sign(goodClaims(), 'wrong-secret-wrong-secret-wrong!!'), cfg)).toThrow(AdminTokenError);
    expect(() => verifyAdminToken(sign(goodClaims(), cfg.jwt.secret, 'none'), cfg)).toThrow(/alg/);
    expect(() => verifyAdminToken(sign(goodClaims({ iss: 'evil' }), cfg.jwt.secret), cfg)).toThrow(/issuer/);
    expect(() => verifyAdminToken(sign(goodClaims({ aud: 'other' }), cfg.jwt.secret), cfg)).toThrow(/audience/);
    expect(() => verifyAdminToken(sign(goodClaims({ exp: Math.floor(Date.now() / 1000) - 5 }), cfg.jwt.secret), cfg)).toThrow(/expired/);
  });
});

// ---------- owner RBAC ----------
describe('owner roles', () => {
  it('resolves least-privilege perms; super_admin = god; unknown role = nothing', () => {
    expect(hasOwnerPermission(resolveOwnerPermissions(['platform_ai_ops']), 'ai.model.manage')).toBe(true);
    expect(hasOwnerPermission(resolveOwnerPermissions(['platform_ai_auditor']), 'ai.model.manage')).toBe(false);
    expect(hasOwnerPermission(resolveOwnerPermissions(['platform_ai_auditor']), 'ai.model.read')).toBe(true);
    expect(hasOwnerPermission(resolveOwnerPermissions(['super_admin']), 'anything.at.all')).toBe(true);
    expect(hasOwnerPermission(resolveOwnerPermissions(['some_tenant_role']), 'ai.model.manage')).toBe(false);
  });
});

// ---------- elevation guards ----------
const ctxWith = (admin: any) => ({ switchToHttp: () => ({ getRequest: () => ({ admin }) }) } as any);
describe('elevation guards', () => {
  it('hardware-key guard requires amr=hwk when enforced', () => {
    const g = new HardwareKeyGuard(cfg);
    expect(g.canActivate(ctxWith({ amr: ['pwd', 'hwk'] }))).toBe(true);
    expect(() => g.canActivate(ctxWith({ amr: ['pwd'] }))).toThrow(/hardware-key/);
  });
  it('step-up guard requires a recent auth_time', () => {
    const g = new StepUpReauthGuard(cfg);
    expect(g.canActivate(ctxWith({ authTimeSec: Math.floor(Date.now() / 1000) }))).toBe(true);
    expect(() => g.canActivate(ctxWith({ authTimeSec: Math.floor(Date.now() / 1000) - 99999 }))).toThrow(/step-up/);
  });
});

// ---------- services: tx + in-tx audit + state machine ----------
const actor = { userId: 'admin1', roles: ['platform_ai_ops'], amr: ['hwk'], authTimeSec: 0, sessionId: '', permissions: new Set(['ai.model.manage']), ip: '10.0.0.1', requestId: 'req1' } as any;
function fakes(model?: AiModel) {
  const client = { query: jest.fn() };
  const pool = { withTx: jest.fn(async (fn: any) => fn(client)) };
  const audit = { write: jest.fn(), log: jest.fn() };
  const repo = { insert: jest.fn(), getForUpdate: jest.fn(async () => model ?? null), updateStatus: jest.fn(), updateThreshold: jest.fn(), getById: jest.fn(async () => model ?? null), list: jest.fn(), recentInferenceStats: jest.fn() };
  return { pool, audit, repo, client };
}

describe('ModelRegistryService', () => {
  it('register inserts + writes an in-tx audit row', async () => {
    const f = fakes();
    const svc = new ModelRegistryService(f.pool as any, f.audit as any, f.repo as any);
    const out: any = await svc.register(actor, { code: 'fraud_score', version: 'v1', provider: 'inhouse', confidenceThreshold: 0.8 } as any);
    expect(out.code).toBe('fraud_score');
    expect(f.repo.insert).toHaveBeenCalledTimes(1);
    expect(f.audit.write).toHaveBeenCalledTimes(1);
    expect(f.audit.write.mock.calls[0][1].action).toBe('ai.model.registered');
  });
  it('promote enforces the state machine + audits old→new', async () => {
    const model = AiModel.register({ id: 'm1', code: 'cc', version: 'v1', provider: null, confidenceThreshold: 0.5 });
    const f = fakes(model);
    const svc = new ModelRegistryService(f.pool as any, f.audit as any, f.repo as any);
    await svc.promote(actor, 'm1', { to: 'canary', reason: 'good shadow metrics' } as any);
    expect(f.repo.updateStatus).toHaveBeenCalledWith(f.client, 'm1', 'canary', 'admin1');
    expect(f.audit.write.mock.calls[0][1]).toMatchObject({ action: 'ai.model.promoted', oldValue: { status: 'shadow' }, newValue: { status: 'canary' } });
  });
  it('illegal promotion throws (and never updates)', async () => {
    const model = AiModel.rehydrate({ id: 'm1', code: 'cc', version: 'v1', provider: null, status: 'retired', confidenceThreshold: null, fairnessAudit: null });
    const f = fakes(model);
    const svc = new ModelRegistryService(f.pool as any, f.audit as any, f.repo as any);
    await expect(svc.promote(actor, 'm1', { to: 'production', reason: 'x' } as any)).rejects.toThrow(IllegalModelTransitionError);
    expect(f.repo.updateStatus).not.toHaveBeenCalled();
  });
});

describe('ThresholdTuningService', () => {
  it('tunes + audits old→new threshold', async () => {
    const model = AiModel.register({ id: 'm1', code: 'cc', version: 'v1', provider: null, confidenceThreshold: 0.5 });
    const f = fakes(model);
    const svc = new ThresholdTuningService(f.pool as any, f.audit as any, f.repo as any);
    await svc.tune(actor, 'm1', { confidenceThreshold: 0.9, reason: 'too many escalations' } as any);
    expect(f.repo.updateThreshold).toHaveBeenCalledWith(f.client, 'm1', 0.9, 'admin1');
    expect(f.audit.write.mock.calls[0][1]).toMatchObject({ action: 'ai.model.threshold_tuned', oldValue: { confidenceThreshold: 0.5 }, newValue: { confidenceThreshold: 0.9 } });
  });
});
