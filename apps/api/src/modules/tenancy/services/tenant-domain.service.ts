// modules/tenancy/services/tenant-domain.service.ts · PC-56 TENANT-13d · W192 DOMAINS (F-6, F-7, F-12, F-16, F-20, F-25).
//
// Founder decision 2026-10-03: DOMAIN BY PLAN; CNAME + TXT PROOF; PLATFORM EDGE; HOST ROUTING; ACME LATER.
//
//   • GET  /tenants/me/domains                tenant.settings (F-12). Every live domain: Type · TLS (+ the honest note) · Primary · Status ·
//                                              the token, the exact two records, last check, the error in words; the plan fact (custom_domain,
//                                              read for real); the platform edge / included suffix; the waiting proposals; µs keyset (F-20).
//   • POST /tenants/me/domains/preview        W2592's review: plan first, then normalisation, the reserved rule (the database's ONE function),
//                                              "already claimed and verified", and the exact CNAME + TXT records. Writes nothing.
//   • POST /tenants/me/domains                W2591 → W2593: add a CLAIM (Idempotency-Key, reason audited). A pending claim by another
//                                              tenant does not block — the first VERIFIED wins. Unproven after 7 days it is released.
//   • POST /tenants/me/domains/:id/recheck    re-check now, once a minute (DNS through the pinned resolvers).
//   • POST /tenants/me/domains/proposals      make primary (verified only) / remove (a primary needs a named, verified successor) — a
//                                              PROPOSAL; a second administrator confirms and the change happens in that transaction.
//   • POST …/proposals/:id/confirm | refuse   W2595–W2597.
//   • the verifier                            (jobs/domain-verification.job.ts, every 5 minutes) — `verifyOne` below.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { decodeKeyset, encodeKeyset, UUID_RE } from '../../../shared/pagination/us-keyset';
import {
  DOMAIN_REASON_MAX, DOMAIN_REASON_MIN, RECHECK_MIN_INTERVAL_MS, TLS_NOT_BUILT_NOTE, VERIFY_INTERVAL_MS, WILDCARD_NOT_READY_NOTE, dnsRecords,
  judgeDns, newVerificationToken, normaliseHost,
} from '../domain/domain-rules';
import { assertClaimMove, assertDomainProposalMove } from '../domain/brand-domain.state';
import {
  DomainCheckerIsMakerError, DomainPlanRequiredError, DomainProposalNotFoundError, DomainRecheckTooSoonError, DomainRefusedError,
  SettingNeedsSecondAdminError, TenantDomainNotFoundError, TenantForbiddenError,
} from '../domain/tenancy.errors';
import { DomainProposalRow, DomainRow, TenantDomainRepository } from '../repositories/tenant-domain.repository';
import { TenantBrandingRepository } from '../repositories/tenant-branding.repository';
import { SettingGovernanceRepository } from '../repositories/setting-governance.repository';
import { ACME_PORT, AcmePort, DOMAIN_DNS, DomainDnsPort } from '../infra/domain-dns.port';
import { TenancyEventType } from '../domain/tenancy.events';
import { TenantActor } from '../policies/tenancy.policies';

export const DOMAIN_VERIFIED_EVENT = 'tenancy.tenant_domain_verified';
export const DOMAIN_RELEASED_EVENT = 'tenancy.tenant_domain_released';

function reasonProblem(raw: string | null | undefined, min = DOMAIN_REASON_MIN): string | null {
  const s = (raw ?? '').trim();
  if (!s) return 'required';
  if (s.length < min) return 'too_short';
  if (s.length > DOMAIN_REASON_MAX) return 'too_long';
  return null;
}

/** 0194's trigger refusals by name. Anything else re-thrown. */
function mapDomainDbError(e: unknown, proposalId: string): never {
  const err = e as { message?: string; code?: string; constraint?: string };
  const msg = String(err?.message ?? '');
  const token = /\[([A-Z_]+)\]/.exec(msg)?.[1];
  if (token === 'DOMAIN_CHECKER_IS_MAKER') throw new DomainCheckerIsMakerError(proposalId);
  if (token === 'DOMAIN_CHECKER_NOT_ADMIN' || token === 'DOMAIN_PROPOSER_NOT_ADMIN') throw new TenantForbiddenError('Only an active tenant administrator may propose, confirm or refuse a domain change');
  if (token === 'DOMAIN_RESERVED') throw new DomainRefusedError('DOMAIN_RESERVED', 'This domain is reserved by the platform', { problem: /\(([^)]+)\)/.exec(msg)?.[1] ?? 'reserved' });
  if (token && token.startsWith('DOMAIN_')) {
    const words = msg.replace(/^.*?\] /, '').replace(/ — PC-56.*$/, '');
    throw new DomainRefusedError(token, words, { proposalId: proposalId || undefined }, 409);
  }
  if (err?.code === '23505' && String(err?.constraint ?? '') === 'uq_tdp_live') throw new DomainRefusedError('DOMAIN_PROPOSAL_LIVE', 'A change to this domain is already waiting for a second administrator', {}, 409);
  if (err?.code === '23505' && String(err?.constraint ?? '') === 'uq_td_tenant_domain') throw new DomainRefusedError('DOMAIN_ALREADY_YOURS', 'You have already added this domain', {}, 409);
  if (err?.code === '23505' && String(err?.constraint ?? '') === 'uq_td_verified_domain') throw new DomainRefusedError('DOMAIN_CLAIMED_ELSEWHERE', 'Another organisation proved this domain first', {}, 409);
  throw e;
}

@Injectable()
export class TenantDomainService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly repo: TenantDomainRepository,
    private readonly brand: TenantBrandingRepository,
    private readonly gov: SettingGovernanceRepository,
    @Inject(DOMAIN_DNS) private readonly dns: DomainDnsPort,
    @Inject(ACME_PORT) private readonly acme: AcmePort,
  ) {}

  private assertManager(a: TenantActor) { if (!a.canManage) throw new TenantForbiddenError(); }

  /* ================================================================================================================== */
  /* READS                                                                                                              */
  /* ================================================================================================================== */

  private view(d: DomainRow, edge: string) {
    const recheckIn = d.lastManualCheckAt ? Math.max(0, RECHECK_MIN_INTERVAL_MS - (Date.now() - Date.parse(d.lastManualCheckAt))) : 0;
    return {
      id: d.id, domain: d.domain, kind: d.kind, isPrimary: d.isPrimary,
      tls: { status: d.tlsStatus, note: d.tlsNote },
      verification: {
        status: d.verificationStatus, verifiedAt: d.verifiedAt, lastCheckedAt: d.lastCheckedAt, error: d.checkError,
        expiresAt: d.kind === 'custom' && d.verificationStatus !== 'verified' ? d.expiresAt : null,
        token: d.kind === 'custom' ? d.verificationToken : null,
        records: d.kind === 'custom' ? dnsRecords(d.domain, edge, d.verificationToken) : [],
        checksEvery: '5 minutes', recheckAvailableInMs: recheckIn,
      },
      createdAt: d.createdAt,
    };
  }
  private proposalView(p: DomainProposalRow, me: string) {
    return {
      id: p.id, kind: p.kind, domainId: p.domainId, domain: p.domain, successorDomainId: p.successorDomainId, successorDomain: p.successorDomain,
      reason: p.reason, status: p.status, proposedBy: p.proposedBy, proposedByName: p.proposedByName, proposedAt: p.proposedAt, expiresAt: p.expiresAt,
      confirmedBy: p.confirmedBy, confirmedByName: p.confirmedByName, confirmedAt: p.confirmedAt, refusedBy: p.refusedBy, refusedAt: p.refusedAt,
      refuseReason: p.refuseReason, expiredAt: p.expiredAt, youProposed: p.proposedBy === me,
      canConfirm: p.status === 'proposed' && p.proposedBy !== me, canRefuse: p.status === 'proposed',
    };
  }

  async list(tenantId: string, actor: TenantActor, q: { cursor?: string; limit: number }) {
    this.assertManager(actor);
    const [rows, counts, platform, plan, plansWith, live, admins] = await Promise.all([
      this.repo.list(tenantId, decodeKeyset(q.cursor, UUID_RE), q.limit), this.repo.counts(tenantId), this.repo.platform(tenantId),
      this.brand.planFeature(tenantId, 'custom_domain'), this.brand.plansWith(tenantId, 'custom_domain'), this.repo.liveProposals(tenantId),
      this.gov.adminIds(tenantId),
    ]);
    const last = rows[rows.length - 1];
    // the included row first (the canon draws it first), then the custom claims newest first
    const items = rows.map((d) => this.view(d, platform.edge)).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'included' ? -1 : 1));
    return {
      items, nextCursor: rows.length === q.limit && last ? encodeKeyset(last.cursorTs, last.id) : null, counts,
      plan: { customDomain: plan.enabled, planCode: plan.planCode, plansWith },
      platform: { edgeHostname: platform.edge, includedSuffix: platform.suffix, wildcardTlsReady: platform.wildcardReady },
      tls: { customIssuance: 'not_built' as const, note: TLS_NOT_BUILT_NOTE },
      steps: [
        { n: 1, code: 'add_records', built: true },
        { n: 2, code: 'verify_then_tls', built: 'verify_only' as const, note: TLS_NOT_BUILT_NOTE },
        { n: 3, code: 'subdomain_301', built: 'when_primary_tls_issued' as const },
      ],
      proposals: live.map((p) => this.proposalView(p, actor.userId)),
      admins: { count: admins.length, youAreAdmin: admins.includes(actor.userId) },
    };
  }

  async proposal(tenantId: string, actor: TenantActor, id: string) {
    this.assertManager(actor);
    if (!UUID_RE.test(id)) throw new DomainProposalNotFoundError(id);
    const p = await this.repo.proposal(tenantId, id);
    if (!p) throw new DomainProposalNotFoundError(id);
    const admins = await this.gov.adminIds(tenantId);
    return { ...this.proposalView(p, actor.userId), admins: admins.length };
  }
  async proposals(tenantId: string, actor: TenantActor, q: { cursor?: string; limit: number }) {
    this.assertManager(actor);
    const rows = await this.repo.listProposals(tenantId, decodeKeyset(q.cursor, UUID_RE), q.limit);
    const last = rows[rows.length - 1];
    return { items: rows.map((p) => this.proposalView(p, actor.userId)), nextCursor: rows.length === q.limit && last ? encodeKeyset(last.cursorTs, last.id) : null };
  }

  /* ================================================================================================================== */
  /* ADD A CLAIM (W2591–W2594) — plan first, reserved, claimed elsewhere, the exact records                               */
  /* ================================================================================================================== */

  async previewAdd(tenantId: string, actor: TenantActor, input: { domain?: unknown; reason?: string | null }) {
    this.assertManager(actor);
    const refusals: Array<{ field: string | null; code: string; detail?: Record<string, unknown> }> = [];
    const plan = await this.brand.planFeature(tenantId, 'custom_domain');
    if (!plan.enabled) refusals.push({ field: null, code: 'PLAN_FEATURE_REQUIRED', detail: { feature: 'custom_domain', planCode: plan.planCode, plansWith: await this.brand.plansWith(tenantId, 'custom_domain') } });
    const domain = normaliseHost(input.domain);
    const platform = await this.repo.platform(tenantId);
    if (!domain) refusals.push({ field: 'domain', code: 'DOMAIN_INVALID' });
    else {
      const reserved = await this.repo.reservedProblem(tenantId, domain);
      if (reserved) refusals.push({ field: 'domain', code: 'DOMAIN_RESERVED', detail: { problem: reserved } });
      else if (await this.repo.byName(tenantId, domain)) refusals.push({ field: 'domain', code: 'DOMAIN_ALREADY_YOURS' });
      else if (await this.repo.verifiedElsewhere(tenantId, domain)) refusals.push({ field: 'domain', code: 'DOMAIN_CLAIMED_ELSEWHERE' });
    }
    const rp = reasonProblem(input.reason, 5);
    if (rp) refusals.push({ field: 'reason', code: 'DOMAIN_REASON_INVALID', detail: { problem: rp, min: 5 } });
    return {
      domain, ready: refusals.length === 0, refusals,
      records: domain ? dnsRecords(domain, platform.edge, 'TOKEN_ISSUED_ON_ADD') : [],
      edgeHostname: platform.edge, claimWindowDays: 7, checksEvery: '5 minutes', tls: { note: TLS_NOT_BUILT_NOTE },
    };
  }

  async add(tenantId: string, actor: TenantActor, idemKey: string, input: { domain: string; reason?: string | null }, ip: string | null) {
    this.assertManager(actor);
    return this.idem.remember(idemKey, actor.userId, 'tenancy.domain_add', () =>
      timed(this.metrics, 'tenancy.domain_add', { tenant: tenantId }, async () => {
        // PLAN FIRST (F-7d; Rule Zero — the custom domain is one of the two plan-gated acts)
        const plan = await this.brand.planFeature(tenantId, 'custom_domain');
        if (!plan.enabled) throw new DomainPlanRequiredError(plan.planCode);
        const domain = normaliseHost(input.domain);
        if (!domain) throw new DomainRefusedError('DOMAIN_INVALID', 'That is not a hostname this platform can route (e.g. mandi.anandfpo.in)', { field: 'domain' });
        const rp = reasonProblem(input.reason, 5);
        if (rp) throw new DomainRefusedError('DOMAIN_REASON_INVALID', 'Say why this domain is being added (5–500 characters)', { field: 'reason', problem: rp });
        return this.uow.run(tenantId, async (tx) => {
          const reserved = await this.repo.reservedProblem(tenantId, domain, tx);
          if (reserved) throw new DomainRefusedError('DOMAIN_RESERVED', 'This domain is reserved by the platform', { field: 'domain', problem: reserved });
          if (await this.repo.verifiedElsewhere(tenantId, domain, tx)) throw new DomainRefusedError('DOMAIN_CLAIMED_ELSEWHERE', 'Another organisation has already proved this domain', { field: 'domain' }, 409);
          const token = newVerificationToken();
          let id: string;
          try { id = await this.repo.insertClaimTx(tx, tenantId, domain, token, actor.userId); } catch (e) { mapDomainDbError(e, ''); }
          const row = (await this.repo.get(tenantId, id!, tx))!;
          const platform = await this.repo.platform(tenantId, tx);
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'tenancy.tenant_domain_added', entityType: 'tenant_domain', entityId: id!,
            oldValue: null, newValue: { domain, kind: 'custom', verification: 'pending', expiresAt: row.expiresAt, records: dnsRecords(domain, platform.edge, token) }, reason: input.reason!.trim(), ip });
          await this.outbox.write(tx, { tenantId, aggregateType: 'tenant_domain', aggregateId: id!, eventType: TenancyEventType.TenantDomainAdded, payload: { v: 1, tenantId, domainId: id!, domain } });
          return { ...this.view(row, platform.edge), audit: { entityType: 'tenant_domain', entityId: id!, action: 'tenancy.tenant_domain_added' } };
        }, { userId: actor.userId });
      }));
  }

  /* ================================================================================================================== */
  /* VERIFY — the job and "re-check now"                                                                                */
  /* ================================================================================================================== */

  async recheck(tenantId: string, actor: TenantActor, id: string, ip: string | null) {
    this.assertManager(actor);
    if (!UUID_RE.test(id)) throw new TenantDomainNotFoundError(id);
    const d = await this.uow.run(tenantId, async (tx) => {
      const row = await this.repo.get(tenantId, id, tx, true);
      if (!row) throw new TenantDomainNotFoundError(id);
      if (row.kind !== 'custom' || row.verificationStatus === 'verified') throw new DomainRefusedError('DOMAIN_NOTHING_TO_CHECK', 'This domain is already verified', {}, 409);
      if (row.lastManualCheckAt) {
        const wait = RECHECK_MIN_INTERVAL_MS - (Date.now() - Date.parse(row.lastManualCheckAt));
        if (wait > 0) throw new DomainRecheckTooSoonError(Math.ceil(wait / 1000));
      }
      await this.repo.markManualCheckTx(tx, tenantId, id);
      await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'tenancy.tenant_domain_recheck', entityType: 'tenant_domain', entityId: id,
        oldValue: { verification: row.verificationStatus, lastCheckedAt: row.lastCheckedAt }, newValue: { requested: true }, ip });
      return row;
    }, { userId: actor.userId });
    const outcome = await this.verifyOne(tenantId, d.id);
    const platform = await this.repo.platform(tenantId);
    const after = await this.repo.get(tenantId, id);
    return { outcome, domain: after ? this.view(after, platform.edge) : null };
  }

  /**
   * ONE check of one claim: past its window → expired and released; otherwise DNS through the pinned resolvers → verified only on CNAME →
   * edge AND TXT = token; else failed with the reason in words. Re-locks and re-reads the row, so the job and "re-check now" never act
   * twice. Never a fake verified (0194 admits `verified` only from this act).
   */
  async verifyOne(tenantId: string, id: string): Promise<'verified' | 'failed' | 'expired' | 'skipped'> {
    const platform = await this.repo.platform(tenantId);
    const before = await this.repo.get(tenantId, id);
    if (!before || before.kind !== 'custom' || (before.verificationStatus !== 'pending' && before.verificationStatus !== 'failed')) return 'skipped';
    const expired = before.expiresAt !== null && Date.parse(before.expiresAt) <= Date.now();
    const seen = expired ? null : await this.dns.observe(before.domain, platform.resolvers);
    return this.uow.run(tenantId, async (tx) => {
      const d = await this.repo.get(tenantId, id, tx, true);
      if (!d || d.kind !== 'custom' || (d.verificationStatus !== 'pending' && d.verificationStatus !== 'failed')) return 'skipped' as const;
      if (expired) {
        assertClaimMove(d.verificationStatus, 'expired');
        const ok = await this.repo.releaseExpiredTx(tx, tenantId, id);
        if (!ok) return 'skipped' as const;
        await this.audit.write(tx, { tenantId, actorUserId: null, action: 'tenancy.tenant_domain_released', entityType: 'tenant_domain', entityId: id,
          oldValue: { domain: d.domain, verification: d.verificationStatus, lastError: d.checkError }, newValue: { verification: 'expired', released: true }, reason: 'not proven within 7 days' });
        await this.outbox.write(tx, { tenantId, aggregateType: 'tenant_domain', aggregateId: id, eventType: DOMAIN_RELEASED_EVENT, payload: { v: 1, tenantId, domainId: id, domain: d.domain } });
        return 'expired' as const;
      }
      let outcome = judgeDns(d.domain, platform.edge, d.verificationToken ?? '', seen!);
      if (outcome.verified && await this.repo.verifiedElsewhere(tenantId, d.domain, tx)) {
        outcome = { verified: false, error: 'another organisation proved this domain first — this claim will be released when its 7-day window ends' };
      }
      if (outcome.verified) {
        assertClaimMove(d.verificationStatus, 'verified');
        // TLS: the AcmePort is the seam; the only implementation says issuance is not built — tls_status stays pending, in words
        const tls = await this.acme.requestCertificate(d.domain);
        try { await this.repo.markVerifiedTx(tx, tenantId, id, tls.issued ? '' : tls.note); } catch (e) { mapDomainDbError(e, ''); }
        await this.audit.write(tx, { tenantId, actorUserId: null, action: 'tenancy.tenant_domain_verified', entityType: 'tenant_domain', entityId: id,
          oldValue: { verification: d.verificationStatus, lastError: d.checkError }, newValue: { verification: 'verified', cname: platform.edge, txt: 'token matched', tls: 'pending', tlsNote: tls.issued ? null : tls.note } });
        await this.outbox.write(tx, { tenantId, aggregateType: 'tenant_domain', aggregateId: id, eventType: DOMAIN_VERIFIED_EVENT, payload: { v: 1, tenantId, domainId: id, domain: d.domain } });
        this.metrics.inc('tenancy_domain_verified_total', {});
        return 'verified' as const;
      }
      assertClaimMove(d.verificationStatus, 'failed');
      await this.repo.markFailedTx(tx, tenantId, id, outcome.error);
      if (d.checkError !== outcome.error) {
        await this.audit.write(tx, { tenantId, actorUserId: null, action: 'tenancy.tenant_domain_check_failed', entityType: 'tenant_domain', entityId: id,
          oldValue: { verification: d.verificationStatus, lastError: d.checkError }, newValue: { verification: 'failed', error: outcome.error } });
      }
      return 'failed' as const;
    }, { userId: undefined });
  }

  /** The job's per-tenant pass: due claims (every 5 min, and any past its window) + the included row's TLS follows the wildcard cert. */
  async sweepTenant(tenantId: string, limit = 20): Promise<{ verified: number; failed: number; expired: number; tlsSynced: number }> {
    const [due, platform] = await this.uow.run(tenantId, async (tx) => [
      await this.repo.dueClaimsTx(tx, tenantId, VERIFY_INTERVAL_MS - 10_000, limit), await this.repo.platform(tenantId, tx),
    ] as const, { userId: undefined });
    let verified = 0, failed = 0, expired = 0;
    for (const d of due) {
      const r = await this.verifyOne(tenantId, d.id);
      if (r === 'verified') verified++; else if (r === 'failed') failed++; else if (r === 'expired') expired++;
    }
    const tlsSynced = await this.uow.run(tenantId, (tx) => this.repo.syncIncludedTlsTx(tx, tenantId, platform.wildcardReady, WILDCARD_NOT_READY_NOTE), { userId: undefined });
    return { verified, failed, expired, tlsSynced };
  }

  /* ================================================================================================================== */
  /* MAKE PRIMARY / REMOVE — proposals, a second administrator (W2595–W2597)                                             */
  /* ================================================================================================================== */

  async propose(tenantId: string, actor: TenantActor, idemKey: string, input: { kind: 'make_primary' | 'remove'; domainId: string; successorDomainId?: string | null; reason?: string | null }, ip: string | null) {
    this.assertManager(actor);
    if (!UUID_RE.test(input.domainId)) throw new TenantDomainNotFoundError(input.domainId);
    const rp = reasonProblem(input.reason);
    if (rp) throw new DomainRefusedError('DOMAIN_REASON_INVALID', `A reason of ${DOMAIN_REASON_MIN}–${DOMAIN_REASON_MAX} characters is required`, { field: 'reason', problem: rp, min: DOMAIN_REASON_MIN });
    return this.idem.remember(idemKey, actor.userId, 'tenancy.domain_propose', () =>
      this.uow.run(tenantId, async (tx) => {
        const d = await this.repo.get(tenantId, input.domainId, tx, true);
        if (!d) throw new TenantDomainNotFoundError(input.domainId);
        const admins = await this.gov.adminIds(tenantId, tx);
        if (admins.length < 2) throw new SettingNeedsSecondAdminError(admins.length);
        // the state rules (verified only; successor for a primary; the included row is permanent) are the trigger's — named on the way out
        let id: string;
        try {
          id = await this.repo.insertProposalTx(tx, { tenantId, kind: input.kind, domainId: d.id, domain: d.domain,
            successorDomainId: input.kind === 'remove' && input.successorDomainId ? input.successorDomainId : null, reason: input.reason!.trim(), proposedBy: actor.userId });
        } catch (e) { mapDomainDbError(e, ''); }
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: `tenancy.tenant_domain_${input.kind}_proposed`, entityType: 'tenant_domain_proposal', entityId: id!,
          oldValue: { domain: d.domain, isPrimary: d.isPrimary, verification: d.verificationStatus }, newValue: { kind: input.kind, successorDomainId: input.successorDomainId ?? null }, reason: input.reason!.trim(), ip });
        return this.proposalView((await this.repo.proposal(tenantId, id!, tx))!, actor.userId);
      }, { userId: actor.userId }));
  }

  /** A SECOND administrator confirms — and this transaction applies it. No TypeScript maker ≠ checker check: the trigger is the wall. */
  async confirm(tenantId: string, actor: TenantActor, idemKey: string, id: string, ip: string | null) {
    this.assertManager(actor);
    if (!UUID_RE.test(id)) throw new DomainProposalNotFoundError(id);
    return this.idem.remember(idemKey, actor.userId, 'tenancy.domain_confirm', () =>
      this.uow.run(tenantId, async (tx) => {
        const p0 = await this.repo.proposal(tenantId, id, tx, true);
        if (!p0) throw new DomainProposalNotFoundError(id);
        if (p0.status !== 'proposed') throw new DomainRefusedError('DOMAIN_PROPOSAL_CLOSED', `This proposal is already ${p0.status}`, { proposalId: id, status: p0.status }, 409);
        assertDomainProposalMove(p0.status, 'confirmed');
        try { await this.repo.confirmTx(tx, tenantId, id, actor.userId); } catch (e) { mapDomainDbError(e, id); }
        const p = (await this.repo.proposal(tenantId, id, tx))!;
        await this.repo.citeProposalTx(tx, id);
        let previousPrimary: string | null = null;
        try {
          if (p.kind === 'make_primary') {
            previousPrimary = await this.repo.demotePrimaryTx(tx, tenantId);
            await this.repo.promoteTx(tx, tenantId, p.domainId, actor.userId);
          } else {
            const d = (await this.repo.get(tenantId, p.domainId, tx, true))!;
            previousPrimary = d.isPrimary ? d.domain : null;
            await this.repo.softRemoveTx(tx, tenantId, p.domainId, actor.userId, p.reason);
            if (p.successorDomainId) await this.repo.promoteTx(tx, tenantId, p.successorDomainId, actor.userId);
          }
        } catch (e) { mapDomainDbError(e, id); }
        const action = p.kind === 'make_primary' ? 'tenancy.tenant_domain_primary_changed' : 'tenancy.tenant_domain_removed';
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action, entityType: 'tenant_domain', entityId: p.domainId,
          oldValue: { domain: p.domain, primary: previousPrimary }, newValue: { kind: p.kind, proposalId: id, proposedBy: p.proposedBy, confirmedBy: actor.userId,
            primary: p.kind === 'make_primary' ? p.domain : (p.successorDomain ?? previousPrimary), removed: p.kind === 'remove' ? p.domain : null }, reason: p.reason, ip });
        await this.outbox.write(tx, { tenantId, aggregateType: 'tenant_domain', aggregateId: p.domainId,
          eventType: p.kind === 'make_primary' ? TenancyEventType.TenantDomainPrimaryChanged : TenancyEventType.TenantDomainRemoved,
          payload: { v: 1, tenantId, domainId: p.domainId, proposalId: id } });
        return { id, kind: p.kind, domain: p.domain, successorDomain: p.successorDomain, status: 'confirmed' as const, audit: { entityType: 'tenant_domain', entityId: p.domainId, action } };
      }, { userId: actor.userId }));
  }

  async refuse(tenantId: string, actor: TenantActor, idemKey: string, id: string, reason: string, ip: string | null) {
    this.assertManager(actor);
    if (!UUID_RE.test(id)) throw new DomainProposalNotFoundError(id);
    const rp = reasonProblem(reason, 5);
    if (rp) throw new DomainRefusedError('DOMAIN_REASON_INVALID', 'A refusal needs a reason', { field: 'reason', problem: rp, min: 5 });
    return this.idem.remember(idemKey, actor.userId, 'tenancy.domain_refuse', () =>
      this.uow.run(tenantId, async (tx) => {
        const p = await this.repo.proposal(tenantId, id, tx, true);
        if (!p) throw new DomainProposalNotFoundError(id);
        if (p.status !== 'proposed') throw new DomainRefusedError('DOMAIN_PROPOSAL_CLOSED', `This proposal is already ${p.status}`, { proposalId: id }, 409);
        assertDomainProposalMove(p.status, 'refused');
        try { await this.repo.refuseTx(tx, tenantId, id, actor.userId, reason.trim()); } catch (e) { mapDomainDbError(e, id); }
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'tenancy.tenant_domain_proposal_refused', entityType: 'tenant_domain_proposal', entityId: id,
          oldValue: { status: 'proposed', kind: p.kind, domain: p.domain }, newValue: { status: 'refused' }, reason: reason.trim(), ip });
        return { id, status: 'refused' as const };
      }, { userId: actor.userId }));
  }

  async expireProposal(tenantId: string, id: string): Promise<boolean> {
    return this.uow.run(tenantId, async (tx: TxContext) => {
      const p = await this.repo.proposal(tenantId, id, tx, true);
      if (!p || p.status !== 'proposed') return false;
      const ok = await this.repo.expireProposalTx(tx, tenantId, id);
      if (ok) await this.audit.write(tx, { tenantId, actorUserId: null, action: 'tenancy.tenant_domain_proposal_expired', entityType: 'tenant_domain_proposal', entityId: id,
        oldValue: { status: 'proposed', kind: p.kind, domain: p.domain }, newValue: { status: 'expired' }, reason: 'unconfirmed after 7 days' });
      return ok;
    }, { userId: undefined });
  }
}
