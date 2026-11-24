// apps/admin-api/src/modules/operator-auth/services/operator-auth.service.ts · PC-56 ADMIN-AUTH-1 — sign-in, step-up, sign-out, keys.
//
// THE TWO FACTORS, AND WHERE EACH IS PROVEN:
//   1. the IdP (OpenID Connect): /sso/callback verifies the id_token and resolves the email's binding (CONFIG). Output: a
//      single-use, 5-minute login TICKET bound to the operator — not a session, and worth nothing on its own;
//   2. the hardware key (WebAuthn, UV required): /webauthn/login verifies an assertion against a credential THIS realm
//      holds for THAT operator, then — in one transaction — consumes the ticket, advances the signature counter, opens the
//      session row and audits. Only then is a token minted: sub = admin_user_id, roles = the binding's roles, amr
//      ['oidc','hwk'], auth_time = now, sid = the new session.
// Nothing here grants a role from a row; 0118's restrictions and suspension still subtract on every request.
import { Injectable } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { AdminConfig } from '../../../core/config/admin-config';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { OperatorRegistryRepository } from '../../../core/auth/operator-registry.repository';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { accessVerdict } from '../../../core/auth/operator-access';
import { bindingFor, emailDomain } from '../../../core/auth/operator-bindings';
import { signAdminToken } from '../../../core/auth/admin-token.signer';
import { hasOwnerPermission, OwnerPermissions } from '../../../core/rbac/owner-roles';
import { IdTokenError, pkcePair, randomToken, sha256hex, verifyIdToken, constantTimeEqual } from '../domain/oidc';
import {
  CHALLENGE_TTL_SEC, ENROLLMENT_CODE_TTL_SEC, SSO_FLOW_TTL_SEC, TICKET_TTL_SEC, canIssueCode, canonicalCode, decideEnrollment,
  formatEnrollmentCode, revokeKeyVerdict, signCountAcceptable, ticketVerdict,
} from '../domain/operator-auth.rules';
import { OperatorAuthError } from '../domain/operator-auth.errors';
import { OidcClient, OidcUnavailableError } from './oidc-client';
import {
  CeremonyError, StoredCredential, authenticationOptions, challengeOf, registrationOptions, verifyAssertion, verifyRegistration,
} from './webauthn.ceremony';
import { CredentialRow, OperatorAuthRepository } from '../repositories/operator-auth.repository';

export const AMR = ['oidc', 'hwk'];

export interface RequestMeta { ip: string | null; userAgent: string | null; requestId: string | null }
export interface MintedSession { token: string; maxAgeSec: number; expiresAt: string; sessionId: string }

const stored = (c: CredentialRow): StoredCredential => ({ credentialId: c.credentialId, publicKey: c.publicKey, signCount: c.signCount, transports: c.transports });
const keyView = (c: CredentialRow) => ({
  id: c.id, label: c.label, enrolledVia: c.enrolledVia, transports: c.transports, createdAt: c.createdAt.toISOString(),
  lastUsedAt: c.lastUsedAt?.toISOString() ?? null, revokedAt: c.revokedAt?.toISOString() ?? null, revokeReason: c.revokeReason,
});

@Injectable()
export class OperatorAuthService {
  constructor(
    private readonly config: AdminConfig,
    private readonly repo: OperatorAuthRepository,
    private readonly audit: AdminAuditWriter,
    private readonly registry: OperatorRegistryRepository,
    private readonly oidc: OidcClient,
  ) {}

  private get rp() { return this.config.webauthn; }
  private consoleUrl(path: string): string { return `${this.config.env.ADMIN_CONSOLE_URL}${path}`; }

  /** Refusal audit — standalone (no business transaction to join), best-effort, never the email in clear. */
  private refuse(action: string, reason: string, meta: RequestMeta, v: { adminUserId?: string | null; email?: string | null } = {}): void {
    void this.audit.log({
      actorUserId: v.adminUserId ?? null, action, entityType: 'platform_operator', entityId: v.adminUserId ?? null,
      newValue: { reason, ...(v.email ? { emailDomain: emailDomain(v.email), emailSha256: sha256hex(v.email) } : {}) },
      ip: meta.ip, requestId: meta.requestId,
    }).catch(() => undefined);
  }

  /* ================================================================================================================ */
  /* 1 · the IdP                                                                                                       */
  /* ================================================================================================================ */

  /** New authorization request. Returns the IdP URL and the browser-binding value (set as an httpOnly cookie). */
  async startSso(meta: RequestMeta): Promise<{ redirectUrl: string; binding: string }> {
    const state = randomToken(32); const nonce = randomToken(32); const binding = randomToken(32);
    const pkce = pkcePair();
    await this.repo.createFlow({ stateSha256: sha256hex(state), bindingSha256: sha256hex(binding), nonce, codeVerifier: pkce.verifier, ip: meta.ip, ttlSec: SSO_FLOW_TTL_SEC });
    const redirectUrl = await this.oidc.authorizationUrl({ state, nonce, codeChallenge: pkce.challenge });
    return { redirectUrl, binding };
  }

  /** The IdP's redirect. ALWAYS answers with a redirect to the console: /login/key?ticket=… or /login?error=signin. */
  async handleCallback(q: { code?: string; state?: string; error?: string }, bindingCookie: string | null, meta: RequestMeta): Promise<string> {
    const fail = (reason: string, v: { adminUserId?: string | null; email?: string | null } = {}) => {
      this.refuse('admin.auth.sso_refused', reason, meta, v);
      return this.consoleUrl('/login?error=signin');
    };
    if (q.error) return fail(`idp_error:${String(q.error).slice(0, 60)}`);
    if (!q.code || !q.state || q.code.length > 2048 || q.state.length > 128) return fail('missing_code_or_state');

    const flow = await this.repo.consumeFlow(sha256hex(q.state));
    if (!flow) return fail('unknown_or_used_state');
    if (!bindingCookie || !constantTimeEqual(sha256hex(bindingCookie), flow.bindingSha256)) return fail('browser_binding_mismatch');

    let identity;
    try {
      const idToken = await this.oidc.exchangeCode(q.code, flow.codeVerifier);
      const o = this.config.oidc;
      identity = await verifyIdToken(idToken, { issuer: o.issuer, clientId: o.clientId, nonce: flow.nonce, allowedDomains: o.allowedDomains }, this.oidc);
    } catch (e) {
      if (e instanceof IdTokenError) return fail(`id_token:${e.reason}`);
      if (e instanceof OidcUnavailableError) return fail(`idp_unavailable:${e.reason}`);
      return fail('callback_error');
    }

    const binding = bindingFor(this.config.env.ADMIN_OPERATOR_BINDINGS, identity.email);
    if (!binding) return fail('no_binding', { email: identity.email });

    const ticket = randomToken(32);
    const outcome = await this.repo.db.withTx(async (c) => {
      const { identity: row, created } = await this.repo.upsertIdentity(c, { issuer: identity.issuer, subject: identity.subject, email: identity.email });
      const refusal = await this.operatorRefusal(row.adminUserId);
      if (refusal) return { refused: refusal, adminUserId: row.adminUserId };
      await this.repo.createTicket(c, { ticketSha256: sha256hex(ticket), adminUserId: row.adminUserId, email: identity.email, ip: meta.ip, ttlSec: TICKET_TTL_SEC });
      await this.audit.write(c, {
        actorUserId: row.adminUserId, action: 'admin.auth.sso_verified', entityType: 'platform_operator', entityId: row.adminUserId,
        newValue: { identityCreated: created, emailDomain: emailDomain(identity.email), hd: identity.hd, roles: binding.roles },
        ip: meta.ip, requestId: meta.requestId,
      });
      return { refused: null, adminUserId: row.adminUserId };
    });
    if (outcome.refused) return fail(outcome.refused, { adminUserId: outcome.adminUserId, email: identity.email });
    return this.consoleUrl(`/login/key?ticket=${encodeURIComponent(ticket)}`);
  }

  /** 0118's access decision at the door: a suspended operator (or one past the dormancy line) is refused at sign-in, not
   *  only on their first request after it. Returns a refusal code or null. */
  private async operatorRefusal(adminUserId: string): Promise<string | null> {
    const op = await this.registry.getOperator(adminUserId);
    if (!op) return null;
    const { policy } = await this.registry.accessPolicy();
    const v = accessVerdict(op, null, policy, new Date());
    if (v.allow) return null;
    if (v.autoSuspend) await this.registry.autoSuspendDormant(adminUserId, policy.suspendAfterDays).catch(() => undefined);
    return `operator_${v.reason}`;
  }

  /* ================================================================================================================ */
  /* 2 · the key                                                                                                       */
  /* ================================================================================================================ */

  private async liveTicket(ticket: string, meta: RequestMeta) {
    const t = await this.repo.getTicket(sha256hex(ticket));
    const v = ticketVerdict(t, new Date());
    if (!v.ok || !t) { this.refuse('admin.auth.ticket_refused', v.ok ? 'unknown' : v.reason, meta, { adminUserId: t?.adminUserId }); throw new OperatorAuthError('AUTH_TICKET_INVALID'); }
    const refusal = await this.operatorRefusal(t.adminUserId);
    if (refusal) { this.refuse('admin.auth.ticket_refused', refusal, meta, { adminUserId: t.adminUserId }); throw new OperatorAuthError('AUTH_REFUSED'); }
    return t;
  }

  private async newChallenge(challenge: string, adminUserId: string, purpose: 'login' | 'enroll' | 'step_up' | 'add_key'): Promise<void> {
    await this.repo.createChallenge({ challenge, challengeSha256: sha256hex(challenge), adminUserId, purpose, ttlSec: CHALLENGE_TTL_SEC });
  }

  private async spendChallenge(response: unknown, adminUserId: string, purpose: 'login' | 'enroll' | 'step_up' | 'add_key'): Promise<string | null> {
    const ch = challengeOf(response as { response?: { clientDataJSON?: unknown } });
    if (!ch) return null;
    return this.repo.consumeChallenge(sha256hex(ch), adminUserId, purpose);
  }

  /** What the key screen should do for this ticket: assert with an existing key, or enroll a first one. */
  async keyOptions(ticket: string, meta: RequestMeta): Promise<{ mode: 'authenticate' | 'enroll'; options: unknown }> {
    const t = await this.liveTicket(ticket, meta);
    const creds = await this.repo.activeCredentialsOf(t.adminUserId);
    if (creds.length > 0) {
      const options = await authenticationOptions(this.rp, creds.map(stored));
      await this.newChallenge(options.challenge, t.adminUserId, 'login');
      return { mode: 'authenticate', options };
    }
    const options = await registrationOptions(this.rp, { adminUserId: t.adminUserId, email: t.email }, []);
    await this.newChallenge(options.challenge, t.adminUserId, 'enroll');
    return { mode: 'enroll', options };
  }

  /** First key for an operator who has none — gated by a single-use enrollment code (or the founder's bootstrap code). */
  async enroll(dto: { ticket: string; code: string; label: string; response: unknown }, meta: RequestMeta): Promise<{ enrolled: true; keyId: string }> {
    const ticketSha = sha256hex(dto.ticket);
    const t = await this.liveTicket(dto.ticket, meta);
    const failKey = async (reason: string): Promise<never> => {
      await this.repo.recordTicketFailure(ticketSha).catch(() => undefined);
      this.refuse('admin.auth.enroll_refused', reason, meta, { adminUserId: t.adminUserId });
      throw new OperatorAuthError('AUTH_KEY_REJECTED', reason);
    };
    if ((await this.repo.activeCredentialsOf(t.adminUserId)).length > 0) {
      // An operator WITH a key adds another only from inside a session, after a fresh assertion (POST /v1/auth/keys).
      this.refuse('admin.auth.enroll_refused', 'operator_already_has_a_key', meta, { adminUserId: t.adminUserId });
      throw new OperatorAuthError('AUTH_REFUSED');
    }
    const challenge = await this.spendChallenge(dto.response, t.adminUserId, 'enroll');
    if (!challenge) return failKey('challenge_unknown_or_used');
    let reg;
    try { reg = await verifyRegistration(this.rp, dto.response as RegistrationResponseJSON, challenge); }
    catch (e) { return failKey(e instanceof CeremonyError ? e.reason : 'registration_error'); }

    const codeSha256 = sha256hex(canonicalCode(dto.code));
    const result = await this.repo.db.withTx(async (c) => {
      await this.repo.lockEnrollment(c);
      const decision = decideEnrollment({
        codeSha256, operatorEmail: t.email,
        activeCredentialsPlatformWide: await this.repo.countActiveCredentialsPlatformWide(c),
        bootstrapSha256: this.config.env.ADMIN_BOOTSTRAP_ENROLLMENT_CODE_SHA256,
        bootstrapAlreadyUsed: this.config.env.ADMIN_BOOTSTRAP_ENROLLMENT_CODE_SHA256 ? await this.repo.bootstrapUsed(c, this.config.env.ADMIN_BOOTSTRAP_ENROLLMENT_CODE_SHA256) : false,
        codeRow: await this.repo.codeBySha(c, codeSha256),
        now: new Date(),
      });
      if (!decision.ok) return { refused: decision.reason } as const;
      const keyId = await this.repo.insertCredential(c, {
        adminUserId: t.adminUserId, credentialId: reg.credentialId, publicKey: reg.publicKey, signCount: reg.signCount,
        transports: reg.transports, aaguid: reg.aaguid, label: dto.label,
        enrolledVia: decision.via, enrollmentCodeId: decision.via === 'enrollment_code' ? decision.codeId : null,
      });
      if (decision.via === 'bootstrap') {
        await this.repo.recordBootstrap(c, { codeSha256, adminUserId: t.adminUserId, credentialRowId: keyId });
      } else if (!(await this.repo.consumeCode(c, decision.codeId, t.adminUserId))) {
        throw new OperatorAuthError('AUTH_ENROLLMENT_REFUSED', 'code_consumed_concurrently');
      }
      await this.audit.write(c, {
        actorUserId: t.adminUserId, action: 'admin.auth.key_enrolled', entityType: 'platform_operator_credential', entityId: keyId,
        newValue: { via: decision.via, enrollmentCodeId: decision.via === 'enrollment_code' ? decision.codeId : null, label: dto.label, transports: reg.transports, aaguid: reg.aaguid },
        ip: meta.ip, requestId: meta.requestId,
      });
      return { refused: null, keyId } as const;
    }).catch((e) => {
      // A unique-violation on credential_id: this physical credential is already registered (to anybody).
      if ((e as { code?: string }).code === '23505') return { refused: 'credential_already_registered' } as const;
      throw e;
    });
    if (result.refused) {
      await this.repo.recordTicketFailure(ticketSha).catch(() => undefined);
      this.refuse('admin.auth.enroll_refused', result.refused, meta, { adminUserId: t.adminUserId });
      throw new OperatorAuthError('AUTH_ENROLLMENT_REFUSED', result.refused);
    }
    return { enrolled: true, keyId: result.keyId };
  }

  /** The hardware-key assertion that turns a ticket into a session. */
  async login(dto: { ticket: string; response: unknown }, meta: RequestMeta): Promise<MintedSession> {
    const ticketSha = sha256hex(dto.ticket);
    const t = await this.liveTicket(dto.ticket, meta);
    const failKey = async (reason: string): Promise<never> => {
      await this.repo.recordTicketFailure(ticketSha).catch(() => undefined);
      this.refuse('admin.auth.login_refused', reason, meta, { adminUserId: t.adminUserId });
      throw new OperatorAuthError('AUTH_KEY_REJECTED', reason);
    };
    const binding = bindingFor(this.config.env.ADMIN_OPERATOR_BINDINGS, t.email);
    if (!binding) { this.refuse('admin.auth.login_refused', 'no_binding', meta, { adminUserId: t.adminUserId }); throw new OperatorAuthError('AUTH_REFUSED'); }

    const { cred, newSignCount } = await this.assert(dto.response, t.adminUserId, 'login').catch((e: Error) => failKey(e.message));

    const sessionId = randomUUID();
    const nowSec = Math.floor(Date.now() / 1000);
    const expSec = nowSec + this.config.env.ADMIN_SESSION_TTL_SEC;
    const refused = await this.repo.db.withTx(async (c) => {
      if (!(await this.repo.consumeTicket(c, ticketSha, sessionId))) return 'ticket_consumed_concurrently';
      if (!(await this.repo.advanceSignCount(c, cred.id, newSignCount))) return 'sign_count_regression';
      await this.repo.markLogin(c, t.adminUserId);
      await this.repo.openSession(c, {
        sessionId, adminUserId: t.adminUserId, ip: meta.ip, userAgent: meta.userAgent, roles: binding.roles, amr: AMR,
        authTime: new Date(nowSec * 1000), expiresAt: new Date(expSec * 1000),
      });
      await this.audit.write(c, {
        actorUserId: t.adminUserId, actorRole: binding.roles[0] ?? null, action: 'admin.auth.login', entityType: 'platform_operator', entityId: t.adminUserId,
        newValue: { sessionId, keyId: cred.id, roles: binding.roles, amr: AMR, expiresAt: new Date(expSec * 1000).toISOString() },
        ip: meta.ip, requestId: meta.requestId,
      });
      return null;
    });
    if (refused === 'ticket_consumed_concurrently') { this.refuse('admin.auth.login_refused', refused, meta, { adminUserId: t.adminUserId }); throw new OperatorAuthError('AUTH_TICKET_INVALID'); }
    if (refused) return failKey(refused);
    const token = signAdminToken({ sub: t.adminUserId, roles: binding.roles, amr: AMR, authTimeSec: nowSec, sid: sessionId, expSec }, this.config, nowSec);
    return { token, maxAgeSec: expSec - nowSec, expiresAt: new Date(expSec * 1000).toISOString(), sessionId };
  }

  /** Verify an assertion for one operator and purpose. Throws Error(reason) — callers map it to their own refusal. */
  private async assert(response: unknown, adminUserId: string, purpose: 'login' | 'step_up'): Promise<{ cred: CredentialRow; newSignCount: number }> {
    const challenge = await this.spendChallenge(response, adminUserId, purpose);
    if (!challenge) throw new Error('challenge_unknown_or_used');
    const id = (response as { id?: unknown })?.id;
    const cred = (await this.repo.activeCredentialsOf(adminUserId)).find((c) => c.credentialId === id);
    if (!cred) throw new Error('credential_not_registered_to_operator');
    let out;
    try { out = await verifyAssertion(this.rp, response as AuthenticationResponseJSON, challenge, stored(cred)); }
    catch (e) { throw new Error(e instanceof CeremonyError ? e.reason : 'assertion_error'); }
    if (!signCountAcceptable(cred.signCount, out.newSignCount)) throw new Error('sign_count_regression');
    return { cred, newSignCount: out.newSignCount };
  }

  /* ================================================================================================================ */
  /* 3 · inside a session: step-up, sign-out, keys, enrollment codes                                                   */
  /* ================================================================================================================ */

  private async identityOf(admin: AdminRequestContext) {
    const id = await this.repo.getIdentity(admin.userId);
    if (!id) throw new OperatorAuthError('AUTH_REFUSED', 'no_identity_for_session');   // e.g. the dev-login sentinel
    return id;
  }

  async stepUpOptions(admin: AdminRequestContext): Promise<{ options: unknown }> {
    const creds = await this.repo.activeCredentialsOf(admin.userId);
    if (creds.length === 0) throw new OperatorAuthError('AUTH_REFUSED', 'no_active_key');
    const options = await authenticationOptions(this.rp, creds.map(stored));
    await this.newChallenge(options.challenge, admin.userId, 'step_up');
    return { options };
  }

  /** A fresh assertion → the same session (sid, exp) with a new auth_time. Roles are re-read from the CURRENT binding, so a
   *  removed binding stops a step-up as well as a login. */
  async stepUp(admin: AdminRequestContext, response: unknown, route: string): Promise<MintedSession> {
    const meta: RequestMeta = { ip: admin.ip, userAgent: null, requestId: admin.requestId || null };
    const identity = await this.identityOf(admin);
    const binding = bindingFor(this.config.env.ADMIN_OPERATOR_BINDINGS, identity.email);
    const record = (outcome: 'verified' | 'refused', detail: string | null) => void this.registry.recordStepUp({
      adminUserId: admin.userId, sessionId: admin.sessionId || null, gate: 'step_up', actionRoute: route, outcome, detail, ip: admin.ip, userAgent: null,
    }).catch(() => undefined);
    if (!binding || !admin.sessionId) { record('refused', 'no binding or no session id'); throw new OperatorAuthError('AUTH_REFUSED'); }
    let a;
    try { a = await this.assert(response, admin.userId, 'step_up'); }
    catch (e) { record('refused', `key not accepted (${(e as Error).message})`.slice(0, 300)); this.refuse('admin.auth.step_up_refused', (e as Error).message, meta, { adminUserId: admin.userId }); throw new OperatorAuthError('AUTH_KEY_REJECTED'); }
    const nowSec = Math.floor(Date.now() / 1000);
    const ok = await this.repo.db.withTx(async (c) => {
      if (!(await this.repo.advanceSignCount(c, a.cred.id, a.newSignCount))) return false;
      if (!(await this.repo.stepUpSession(c, { sessionId: admin.sessionId, adminUserId: admin.userId, authTime: new Date(nowSec * 1000) }))) return false;
      await this.audit.write(c, {
        actorUserId: admin.userId, actorRole: binding.roles[0] ?? null, action: 'admin.auth.step_up', entityType: 'platform_operator', entityId: admin.userId,
        newValue: { sessionId: admin.sessionId, keyId: a.cred.id }, ip: admin.ip, requestId: admin.requestId || null,
      });
      return true;
    });
    if (!ok) { record('refused', 'counter regression or session no longer live'); throw new OperatorAuthError('AUTH_KEY_REJECTED'); }
    record('verified', null);
    const token = signAdminToken({ sub: admin.userId, roles: binding.roles, amr: AMR, authTimeSec: nowSec, sid: admin.sessionId, expSec: admin.expSec }, this.config, nowSec);
    return { token, maxAgeSec: Math.max(0, admin.expSec - nowSec), expiresAt: new Date(admin.expSec * 1000).toISOString(), sessionId: admin.sessionId };
  }

  /** Sign-out revokes the session row, so a copied bearer dies with the cookie (AdminAuthGuard refuses a revoked sid). */
  async signOut(admin: AdminRequestContext): Promise<{ signedOut: true }> {
    if (!admin.sessionId) return { signedOut: true };
    await this.repo.db.withTx(async (c) => {
      await this.repo.revokeOwnSession(c, { sessionId: admin.sessionId, adminUserId: admin.userId });
      await this.audit.write(c, {
        actorUserId: admin.userId, action: 'admin.auth.signed_out', entityType: 'platform_operator', entityId: admin.userId,
        newValue: { sessionId: admin.sessionId }, ip: admin.ip, requestId: admin.requestId || null,
      });
    });
    return { signedOut: true };
  }

  async myKeys(admin: AdminRequestContext) { return (await this.repo.credentialsOf(admin.userId)).map(keyView); }
  async operatorKeys(adminUserId: string) {
    const identity = await this.repo.getIdentity(adminUserId);
    return { email: identity?.email ?? null, keys: (await this.repo.credentialsOf(adminUserId)).map(keyView) };
  }

  /** A second (third…) key from inside a session. The route demands a hardware-key session and a fresh step-up, so the
   *  existing key is the authority — a stolen IdP account alone cannot reach this. */
  async addKeyOptions(admin: AdminRequestContext): Promise<{ options: unknown }> {
    const identity = await this.identityOf(admin);
    const creds = await this.repo.activeCredentialsOf(admin.userId);
    if (creds.length === 0) throw new OperatorAuthError('AUTH_REFUSED', 'no_active_key');
    const options = await registrationOptions(this.rp, { adminUserId: admin.userId, email: identity.email }, creds.map(stored));
    await this.newChallenge(options.challenge, admin.userId, 'add_key');
    return { options };
  }

  async addKey(admin: AdminRequestContext, dto: { label: string; response: unknown }): Promise<{ keyId: string }> {
    const meta: RequestMeta = { ip: admin.ip, userAgent: null, requestId: admin.requestId || null };
    const challenge = await this.spendChallenge(dto.response, admin.userId, 'add_key');
    if (!challenge) { this.refuse('admin.auth.key_add_refused', 'challenge_unknown_or_used', meta, { adminUserId: admin.userId }); throw new OperatorAuthError('AUTH_KEY_REJECTED'); }
    let reg;
    try { reg = await verifyRegistration(this.rp, dto.response as RegistrationResponseJSON, challenge); }
    catch (e) { this.refuse('admin.auth.key_add_refused', e instanceof CeremonyError ? e.reason : 'registration_error', meta, { adminUserId: admin.userId }); throw new OperatorAuthError('AUTH_KEY_REJECTED'); }
    const keyId = await this.repo.db.withTx(async (c) => {
      const id = await this.repo.insertCredential(c, {
        adminUserId: admin.userId, credentialId: reg.credentialId, publicKey: reg.publicKey, signCount: reg.signCount,
        transports: reg.transports, aaguid: reg.aaguid, label: dto.label, enrolledVia: 'self_with_key', enrollmentCodeId: null,
      });
      await this.audit.write(c, {
        actorUserId: admin.userId, action: 'admin.auth.key_added', entityType: 'platform_operator_credential', entityId: id,
        newValue: { label: dto.label, transports: reg.transports, aaguid: reg.aaguid }, ip: admin.ip, requestId: admin.requestId || null,
      });
      return id;
    }).catch((e) => {
      if ((e as { code?: string }).code === '23505') throw new OperatorAuthError('AUTH_KEY_REJECTED', 'credential_already_registered');
      throw e;
    });
    return { keyId };
  }

  async revokeKey(admin: AdminRequestContext, keyId: string, reason: string): Promise<{ revoked: true }> {
    const refused = await this.repo.db.withTx(async (c) => {
      const key = await this.repo.getCredentialForUpdate(c, keyId);
      const own = key ? (await this.repo.activeCredentialsOf(key.adminUserId, c)).length : 0;
      const v = revokeKeyVerdict({
        key, actorId: admin.userId, actorHasStaffManage: hasOwnerPermission(admin.permissions, OwnerPermissions.StaffManage), ownActiveKeys: own,
      });
      if (!v.ok) return v.reason;
      await this.repo.revokeCredential(c, { id: keyId, byAdminId: admin.userId, reason });
      await this.audit.write(c, {
        actorUserId: admin.userId, action: 'admin.auth.key_revoked', entityType: 'platform_operator_credential', entityId: keyId,
        oldValue: { adminUserId: key!.adminUserId, label: key!.label }, newValue: { self: key!.adminUserId === admin.userId, remainingActiveKeys: own - 1 },
        reason, ip: admin.ip, requestId: admin.requestId || null,
      });
      return null;
    });
    if (refused) throw new OperatorAuthError('AUTH_KEY_REVOKE_REFUSED', refused, refused === 'last_own_key'
      ? 'this is your only active key; add another key before revoking it'
      : refused === 'needs_staff_manage' ? 'revoking another operator\'s key needs staff.manage' : undefined);
    return { revoked: true };
  }

  /** Issue a one-time enrollment code for a NAMED email (never one's own). The code is returned ONCE and stored hashed. */
  async issueCode(admin: AdminRequestContext, dto: { email: string; reason: string }): Promise<{ id: string; email: string; code: string; expiresAt: string }> {
    const issuer = await this.identityOf(admin);
    const target = dto.email.toLowerCase();
    const v = canIssueCode(issuer.email, target, bindingFor(this.config.env.ADMIN_OPERATOR_BINDINGS, target) !== null);
    if (!v.ok) {
      throw new OperatorAuthError('AUTH_CODE_ISSUE_REFUSED', v.reason, v.reason === 'self'
        ? 'you cannot issue an enrollment code for yourself; to add a key to your own account use "Add a key"'
        : 'that email has no operator binding (ADMIN_OPERATOR_BINDINGS); add the binding first, then issue the code');
    }
    const code = formatEnrollmentCode(randomBytes(20));
    const out = await this.repo.db.withTx(async (c) => {
      const row = await this.repo.insertCode(c, {
        codeSha256: sha256hex(canonicalCode(code)), email: target, issuedByAdminId: admin.userId, issuedByEmail: issuer.email,
        reason: dto.reason, ttlSec: ENROLLMENT_CODE_TTL_SEC,
      });
      await this.audit.write(c, {
        actorUserId: admin.userId, action: 'admin.auth.enrollment_code_issued', entityType: 'platform_operator_enrollment_code', entityId: row.id,
        newValue: { forEmailDomain: emailDomain(target), forEmailSha256: sha256hex(target), expiresAt: row.expiresAt.toISOString() },
        reason: dto.reason, ip: admin.ip, requestId: admin.requestId || null,
      });
      return row;
    });
    return { id: out.id, email: target, code, expiresAt: out.expiresAt.toISOString() };
  }

  async listCodes() {
    return (await this.repo.listCodes()).map((r) => ({
      id: r.id, email: r.email, issuedByAdminId: r.issuedByAdminId, reason: r.reason, issuedAt: r.issuedAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(), consumedAt: r.consumedAt?.toISOString() ?? null, revokedAt: r.revokedAt?.toISOString() ?? null,
    }));
  }

  async revokeCode(admin: AdminRequestContext, id: string): Promise<{ revoked: true }> {
    const ok = await this.repo.db.withTx(async (c) => {
      if (!(await this.repo.revokeCode(c, id, admin.userId))) return false;
      await this.audit.write(c, {
        actorUserId: admin.userId, action: 'admin.auth.enrollment_code_revoked', entityType: 'platform_operator_enrollment_code', entityId: id,
        ip: admin.ip, requestId: admin.requestId || null,
      });
      return true;
    });
    if (!ok) throw new OperatorAuthError('AUTH_CODE_ISSUE_REFUSED', 'code_not_open', 'that code is already used, revoked or unknown');
    return { revoked: true };
  }
}
