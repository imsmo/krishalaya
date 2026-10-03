// modules/identity/services/desk.service.ts · PC-56 TENANT-13b · W185 DESKS + the W2574–W2580 chains (F-18).
//
// Founder decision 2026-10-03: TENANT DESK BUNDLES, NO NEW GLOBAL ROLES, NO SEPARATE OWNER ROLE.
//   • GET   /desks                       the cards: members, codes, the template verdicts (every canon label mapped or refused by name),
//                                         the honest guarantees, the grantable list, pending proposals, the labour suggestion (a real
//                                         count, printed only when > 0 and no active desk carries labour.desk), the admin count.
//   • POST  /desks/preview               W2575 — the diff (permissions add / remove, members, who is re-granted) and every refusal.
//   • POST  /desks/proposals             create · edit (permissions) · disable · enable · install_templates — a PROPOSAL; never applied
//                                         by the person who made it.
//   • POST  /desks/proposals/:id/confirm a DIFFERENT active tenant_admin; 0192 `trg_dcp_moves` is the wall. The change is applied IN
//                                         THE CONFIRMING TRANSACTION (0192 `trg_desk_proposal_gate` admits the desk / permission writes
//                                         only there), and every affected member's compiled grant is invalidated after commit.
//   • POST  /desks/proposals/:id/refuse  a tenant_admin, with a reason.
//   • POST  /desks/:id/members           direct, audited (canon: "assign desks, not permission lists").
//   • POST  /desks/:id/members/:userId/remove   direct, audited, with a reason.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { RoleCacheService } from '../../../core/rbac/role-cache.service';
import { isUngrantable } from '../../../core/rbac/ungrantable';
import { decodeKeyset, encodeKeyset, UUID_RE } from '../../../shared/pagination/us-keyset';
import {
  DESK_CODE, DeskProposalKind, DeskProposalStatus, InstallItem, MAX_DESK_MEMBERS, MAX_DESK_PERMISSIONS, MEMBER_REASON_MAX, MEMBER_REASON_MIN,
  assertDeskProposalMove, codeVerdict, permissionDiff, reasonProblem, seasonWindow,
} from '../domain/desk-rules';
import { DESK_TEMPLATES, mappedCodes, templateOf } from '../domain/desk-templates';
import {
  DeskCheckerIsMakerError, DeskForbiddenError, DeskInvalidError, DeskMemberError, DeskNeedsSecondAdminError, DeskNotFoundError,
  DeskProposalExpiredError, DeskProposalLiveError, DeskProposalNotFoundError, DeskStaleError,
} from '../domain/desk.errors';
import { DeskProposalRow, DeskRepository, DeskRow } from '../repositories/desk.repository';

export interface DeskActor { userId: string; canManage: boolean }
export interface DeskProposalInput {
  kind: DeskProposalKind; deskId?: string | null; code?: string | null; name?: string | null; description?: string | null;
  templateCode?: string | null; permissions?: string[] | null; members?: { add?: string[]; remove?: string[] } | null; reason?: string | null;
}
type Refusal = { field: string | null; code: string; detail?: Record<string, unknown> };

const DESK_EVENT = 'identity.desk_changed';

@Injectable()
export class DeskService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    private readonly audit: AuditWriter,
    private readonly repo: DeskRepository,
    private readonly roleCache: RoleCacheService,
  ) {}

  private assertManager(a: DeskActor) { if (!a.canManage) throw new DeskForbiddenError(); }

  /* ================================================================================================================== */
  /* W185 — the board                                                                                                   */
  /* ================================================================================================================== */
  async board(tenantId: string, actor: DeskActor, now = new Date()) {
    this.assertManager(actor);
    const [desks, perms, members, universe, live, admins, templateRows, people] = await Promise.all([
      this.repo.desks(tenantId), this.repo.livePermissions(tenantId), this.repo.liveMembers(tenantId), this.repo.permissionUniverse(tenantId),
      this.repo.listProposals(tenantId, { status: 'proposed', limit: 100 }), this.repo.adminIds(tenantId), this.repo.templateCodes(tenantId),
      this.repo.people(tenantId),
    ]);
    const installed = new Set(desks.map((d) => d.templateCode).filter(Boolean) as string[]);
    const labourDeskActive = desks.some((d) => d.status === 'active' && (perms.get(d.id) ?? []).includes('labour.desk'));
    const win = seasonWindow(now);
    const labourBookings = labourDeskActive ? 0 : await this.repo.adminLabourBookings(tenantId, win.from, win.to);
    const grantable = [...universe.admin].filter((c) => codeVerdict(c, universe.admin, universe.known) === 'grantable').sort();
    return {
      desks: desks.map((d) => ({
        ...d, permissions: perms.get(d.id) ?? [],
        members: members.filter((m) => m.deskId === d.id).map(({ deskId, ...m }) => m),
        pendingProposal: live.find((p) => p.deskId === d.id) ? this.proposalView(live.find((p) => p.deskId === d.id)!, actor.userId) : null,
      })),
      templates: DESK_TEMPLATES.map((t) => ({
        code: t.code, installed: installed.has(t.code), inLookup: templateRows.some((r) => r.code === t.code),
        labels: t.labels.map((l) => l.verdict.kind === 'mapped'
          ? { label: l.label, kind: 'mapped' as const, code: l.verdict.code, grant: codeVerdict(l.verdict.code, universe.admin, universe.known), noteKey: l.verdict.noteKey ?? null }
          : { label: l.label, kind: 'refused' as const, reasonKey: l.verdict.reasonKey, ridesOn: l.verdict.ridesOn ?? null }),
        guarantees: t.guarantees,
        installs: mappedCodes(t).filter((c) => codeVerdict(c, universe.admin, universe.known) === 'grantable'),
      })),
      grantable,
      pending: live.map((p) => this.proposalView(p, actor.userId)),
      suggestion: labourBookings > 0 ? { template: 'labour', season: win.season, adminBookings: labourBookings, from: win.from.toISOString(), to: win.to.toISOString() } : null,
      admins: { count: admins.length, youAreAdmin: admins.includes(actor.userId) },
      // who a desk member may be chosen from (active role holders; the API judges again)
      people,
    };
  }

  private proposalView(p: DeskProposalRow, me: string) {
    const { cursorTs, ...rest } = p;
    return { ...rest, youProposed: p.proposedBy === me, canConfirm: p.status === 'proposed' && p.proposedBy !== me, canRefuse: p.status === 'proposed' };
  }

  async proposals(tenantId: string, actor: DeskActor, q: { status?: DeskProposalStatus; cursor?: string; limit: number }) {
    this.assertManager(actor);
    const rows = await this.repo.listProposals(tenantId, { status: q.status, cursor: decodeKeyset(q.cursor, UUID_RE), limit: q.limit });
    const last = rows[rows.length - 1];
    return { items: rows.map((p) => this.proposalView(p, actor.userId)), nextCursor: rows.length === q.limit && last ? encodeKeyset(last.cursorTs, last.id) : null };
  }
  async proposal(tenantId: string, actor: DeskActor, id: string) {
    this.assertManager(actor);
    if (!UUID_RE.test(id)) throw new DeskProposalNotFoundError(id);
    const p = await this.repo.proposal(tenantId, id);
    if (!p) throw new DeskProposalNotFoundError(id);
    const admins = await this.repo.adminIds(tenantId);
    let desk: DeskRow | null = null;
    if (p.deskId) desk = (await this.repo.desks(tenantId)).find((d) => d.id === p.deskId) ?? null;
    return { ...this.proposalView(p, actor.userId), desk, admins: admins.length };
  }

  /* ================================================================================================================== */
  /* W2575 — the review: the diff and every refusal (also the proposal's own validation)                                */
  /* ================================================================================================================== */
  async preview(tenantId: string, actor: DeskActor, input: DeskProposalInput) {
    this.assertManager(actor);
    return this.uow.run(tenantId, (tx) => this.review(tx, tenantId, actor, input), { userId: actor.userId });
  }

  private async review(tx: TxContext, tenantId: string, actor: DeskActor, input: DeskProposalInput) {
    const refusals: Refusal[] = [];
    const universe = await this.repo.permissionUniverse(tenantId, tx);
    const admins = await this.repo.adminIds(tenantId, tx);
    if (admins.length < 2) refusals.push({ field: null, code: 'NEEDS_SECOND_ADMIN', detail: { admins: admins.length } });
    const rp = reasonProblem(input.reason);
    if (rp) refusals.push({ field: 'reason', code: 'DESK_REASON_INVALID', detail: { problem: rp } });
    const codesProblems = (codes: string[]) => {
      if (codes.length > MAX_DESK_PERMISSIONS) refusals.push({ field: 'permissions', code: 'DESK_TOO_MANY_CODES', detail: { max: MAX_DESK_PERMISSIONS } });
      for (const c of codes) {
        const v = codeVerdict(c, universe.admin, universe.known);
        if (v !== 'grantable') refusals.push({ field: 'permissions', code: v === 'ungrantable' ? 'DESK_CODE_UNGRANTABLE' : v === 'not_held' ? 'DESK_CODE_NOT_HELD' : 'DESK_CODE_UNKNOWN', detail: { code: c } });
      }
    };
    const memberProblems = async (ids: string[]) => {
      if (ids.length > MAX_DESK_MEMBERS) refusals.push({ field: 'members', code: 'DESK_TOO_MANY_MEMBERS', detail: { max: MAX_DESK_MEMBERS } });
      const bad = ids.filter((u) => !UUID_RE.test(u));
      for (const u of bad) refusals.push({ field: 'members', code: 'DESK_MEMBER_NOT_IN_TENANT', detail: { userId: u } });
      const ok = await this.repo.activeInTenantTx(tx, tenantId, ids.filter((u) => UUID_RE.test(u)));
      for (const u of ids.filter((x) => UUID_RE.test(x) && !ok.includes(x))) refusals.push({ field: 'members', code: 'DESK_MEMBER_NOT_IN_TENANT', detail: { userId: u } });
    };
    const uniq = (xs: string[] | null | undefined) => [...new Set((xs ?? []).map((x) => String(x).trim()).filter(Boolean))];

    let desk: DeskRow | null = null; let before: string[] = []; let after: string[] = [];
    let membersAdd: string[] = []; let membersRemove: string[] = []; let install: InstallItem[] = []; let reGranted = 0;
    const kind = input.kind;
    if (kind === 'create') {
      const code = String(input.code ?? '').trim();
      const name = String(input.name ?? '').trim();
      if (!DESK_CODE.test(code)) refusals.push({ field: 'code', code: 'DESK_CODE_INVALID' });
      else if (await this.repo.deskByCodeTx(tx, tenantId, code)) refusals.push({ field: 'code', code: 'DESK_CODE_TAKEN', detail: { code } });
      else if (await this.repo.liveCreateForCodeTx(tx, tenantId, code)) refusals.push({ field: 'code', code: 'DESK_PROPOSAL_LIVE', detail: { code } });
      if (name.length < 2 || name.length > 80) refusals.push({ field: 'name', code: 'DESK_NAME_INVALID' });
      if ((input.description ?? '').length > 300) refusals.push({ field: 'description', code: 'DESK_DESCRIPTION_TOO_LONG' });
      if (input.templateCode && !templateOf(input.templateCode)) refusals.push({ field: 'templateCode', code: 'DESK_TEMPLATE_UNKNOWN' });
      after = uniq(input.permissions).sort();
      if (after.length === 0) refusals.push({ field: 'permissions', code: 'DESK_NO_CODES' });
      codesProblems(after);
      membersAdd = uniq(input.members?.add);
      await memberProblems(membersAdd);
      reGranted = membersAdd.length;
    } else if (kind === 'install_templates') {
      const existing = new Set((await this.repo.desks(tenantId, tx)).map((d) => d.code));
      for (const t of DESK_TEMPLATES) {
        if (existing.has(t.code) || (await this.repo.liveCreateForCodeTx(tx, tenantId, t.code))) continue;
        const codes = mappedCodes(t).filter((c) => codeVerdict(c, universe.admin, universe.known) === 'grantable');
        if (codes.length) install.push({ code: t.code, name: t.code, templateCode: t.code, permissions: codes });
      }
      if (install.length === 0) refusals.push({ field: null, code: 'DESK_TEMPLATES_INSTALLED' });
    } else {
      const id = String(input.deskId ?? '');
      if (!UUID_RE.test(id)) throw new DeskNotFoundError(id);
      desk = await this.repo.deskForUpdate(tx, tenantId, id);
      if (!desk) throw new DeskNotFoundError(id);
      const live = await this.repo.liveProposalForDeskTx(tx, tenantId, id);
      if (live) refusals.push({ field: null, code: 'DESK_PROPOSAL_LIVE', detail: { proposalId: live } });
      before = ((await this.repo.livePermissions(tenantId, tx)).get(id) ?? []).sort();
      const current = (await this.repo.liveMembers(tenantId, tx)).filter((m) => m.deskId === id).map((m) => m.userId);
      if (kind === 'edit') {
        after = uniq(input.permissions).sort();
        if (after.length === 0) refusals.push({ field: 'permissions', code: 'DESK_NO_CODES' });
        // only codes being ADDED are judged — a code already on the desk that became ungrantable is removed by this very edit
        codesProblems(after.filter((c) => !before.includes(c)));
        membersAdd = uniq(input.members?.add).filter((u) => !current.includes(u));
        membersRemove = uniq(input.members?.remove).filter((u) => current.includes(u));
        await memberProblems(membersAdd);
        const d = permissionDiff(before, after);
        if (d.add.length === 0 && d.remove.length === 0 && membersAdd.length === 0 && membersRemove.length === 0) refusals.push({ field: 'permissions', code: 'DESK_UNCHANGED' });
        reGranted = new Set([...current, ...membersAdd]).size;
      } else if (kind === 'disable') {
        if (desk.status !== 'active') refusals.push({ field: null, code: 'DESK_ALREADY_DISABLED' });
        after = before; reGranted = current.length;
      } else {
        if (desk.status !== 'disabled') refusals.push({ field: null, code: 'DESK_ALREADY_ACTIVE' });
        after = before; reGranted = current.length;
      }
    }
    const pd = permissionDiff(before, after);
    const diff = kind === 'install_templates'
      ? { desks: install, add: [], remove: [], members: { add: [], remove: [] } }
      : kind === 'create'
        ? { code: String(input.code ?? '').trim(), name: String(input.name ?? '').trim(), description: (input.description ?? '').trim() || null,
            templateCode: input.templateCode ?? null, add: pd.add, remove: [], members: { add: membersAdd, remove: [] } }
        : kind === 'edit'
          ? { add: pd.add, remove: pd.remove, members: { add: membersAdd, remove: membersRemove } }
          : { add: [], remove: [], members: { add: [], remove: [] }, status: kind === 'disable' ? 'disabled' : 'active' };
    return {
      kind, desk, before, after, diff, reGranted, admins: admins.length,
      confirmer: { rule: 'a_different_tenant_admin', admins: admins.length },
      ready: refusals.length === 0, refusals,
    };
  }

  /* ================================================================================================================== */
  /* propose · confirm · refuse                                                                                         */
  /* ================================================================================================================== */
  async propose(tenantId: string, actor: DeskActor, idemKey: string, input: DeskProposalInput, ip: string | null) {
    this.assertManager(actor);
    return this.idem.remember(idemKey, actor.userId, 'identity.desk_propose', () =>
      this.uow.run(tenantId, async (tx) => {
        const r = await this.review(tx, tenantId, actor, input);
        const need2 = r.refusals.find((x) => x.code === 'NEEDS_SECOND_ADMIN');
        if (need2) throw new DeskNeedsSecondAdminError(r.admins);
        const live = r.refusals.find((x) => x.code === 'DESK_PROPOSAL_LIVE' && x.field === null);
        if (live) throw new DeskProposalLiveError(String(live.detail?.proposalId ?? ''));
        if (!r.ready) throw new DeskInvalidError(r.refusals);
        const reason = String(input.reason).trim();
        const id = await this.repo.insertProposalTx(tx, { tenantId, kind: input.kind, deskId: r.desk?.id ?? null, diff: r.diff, reason, proposedBy: actor.userId });
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'desk.change_proposed', entityType: 'desk_change_proposal', entityId: id,
          oldValue: r.desk ? { desk: r.desk.code, status: r.desk.status, permissions: r.before } : null,
          newValue: { kind: input.kind, diff: r.diff, reGranted: r.reGranted, status: 'proposed' }, reason, ip });
        const row = await this.repo.proposalForUpdate(tx, tenantId, id);
        return this.proposalView(row!, actor.userId);
      }, { userId: actor.userId }));
  }

  async confirm(tenantId: string, actor: DeskActor, idemKey: string, id: string, ip: string | null) {
    this.assertManager(actor);
    if (!UUID_RE.test(id)) throw new DeskProposalNotFoundError(id);
    let affected: string[] = [];
    const out = await this.idem.remember(idemKey, actor.userId, 'identity.desk_confirm', () =>
      this.uow.run(tenantId, async (tx) => {
        const p = await this.repo.proposalForUpdate(tx, tenantId, id);
        if (!p) throw new DeskProposalNotFoundError(id);
        assertDeskProposalMove(p.status, 'confirmed');
        if (new Date(p.expiresAt).getTime() <= Date.now()) throw new DeskProposalExpiredError(id);
        // maker ≠ checker: 0192 trg_dcp_moves is the wall; no TypeScript copy (its removal must turn a test red).
        try { await this.repo.confirmTx(tx, tenantId, id, actor.userId); }
        catch (e) {
          const m = String((e as Error)?.message ?? '');
          if (m.includes('[DESK_CHECKER_IS_MAKER]')) throw new DeskCheckerIsMakerError(id);
          if (m.includes('[DESK_CHECKER_NOT_ADMIN]')) throw new DeskForbiddenError();
          throw e;
        }
        await this.repo.citeProposalTx(tx, id);
        affected = await this.apply(tx, tenantId, p, actor.userId);
        await this.repo.citeProposalTx(tx, null);
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'desk.change_confirmed', entityType: 'desk_change_proposal', entityId: id,
          oldValue: { status: 'proposed', proposedBy: p.proposedBy, kind: p.kind },
          newValue: { status: 'confirmed', confirmedBy: actor.userId, kind: p.kind, diff: p.diff, reGranted: affected.length }, reason: p.reason, ip });
        await this.outbox.write(tx, { tenantId, aggregateType: 'desk_change_proposal', aggregateId: id, eventType: DESK_EVENT, payload: { v: 1, tenantId, proposalId: id, kind: p.kind } });
        const row = await this.repo.proposalForUpdate(tx, tenantId, id);
        return { ...this.proposalView(row!, actor.userId), reGranted: affected.length };
      }, { userId: actor.userId }));
    // the compiled grant of everyone the change touched is recomputed on their next request
    for (const u of affected) await this.roleCache.invalidate(u, tenantId);
    return out;
  }

  /** Apply a confirmed proposal inside its confirming transaction. Re-validates against NOW (the desk may have moved). */
  private async apply(tx: TxContext, tenantId: string, p: DeskProposalRow, checker: string): Promise<string[]> {
    const universe = await this.repo.permissionUniverse(tenantId, tx);
    const assertGrantable = (codes: string[]) => {
      for (const c of codes) if (codeVerdict(c, universe.admin, universe.known) !== 'grantable') throw new DeskStaleError(`${c} can no longer sit on a desk`);
    };
    const d = p.diff ?? {};
    if (p.kind === 'create') {
      if (await this.repo.deskByCodeTx(tx, tenantId, d.code)) throw new DeskStaleError(`a desk named ${d.code} now exists`);
      assertGrantable(d.add ?? []);
      const members: string[] = d.members?.add ?? [];
      const ok = await this.repo.activeInTenantTx(tx, tenantId, members);
      const deskId = await this.repo.insertDeskTx(tx, { tenantId, code: d.code, name: d.name, description: d.description ?? null, templateCode: d.templateCode ?? null, createdBy: p.proposedBy, confirmedBy: checker, proposalId: p.id });
      await this.repo.addPermissionsTx(tx, tenantId, deskId, d.add ?? [], p.id);
      for (const u of members.filter((m) => ok.includes(m))) await this.repo.addMemberTx(tx, tenantId, deskId, u, p.proposedBy);
      await this.audit.write(tx, { tenantId, actorUserId: checker, action: 'desk.created', entityType: 'desk', entityId: deskId, oldValue: null,
        newValue: { code: d.code, name: d.name, permissions: d.add ?? [], members: members.filter((m) => ok.includes(m)), proposedBy: p.proposedBy, confirmedBy: checker }, reason: p.reason });
      return members.filter((m) => ok.includes(m));
    }
    if (p.kind === 'install_templates') {
      const created: string[] = [];
      for (const item of (d.desks ?? []) as InstallItem[]) {
        if (await this.repo.deskByCodeTx(tx, tenantId, item.code)) continue;   // installed since: skip, never duplicate
        const codes = item.permissions.filter((c) => codeVerdict(c, universe.admin, universe.known) === 'grantable');
        if (codes.length === 0) continue;
        const deskId = await this.repo.insertDeskTx(tx, { tenantId, code: item.code, name: item.name, description: null, templateCode: item.templateCode, createdBy: p.proposedBy, confirmedBy: checker, proposalId: p.id });
        await this.repo.addPermissionsTx(tx, tenantId, deskId, codes, p.id);
        await this.audit.write(tx, { tenantId, actorUserId: checker, action: 'desk.created', entityType: 'desk', entityId: deskId, oldValue: null,
          newValue: { code: item.code, templateCode: item.templateCode, permissions: codes, proposedBy: p.proposedBy, confirmedBy: checker }, reason: p.reason });
        created.push(item.code);
      }
      if (created.length === 0) throw new DeskStaleError('every template is already installed');
      return [];
    }
    const desk = p.deskId ? await this.repo.deskForUpdate(tx, tenantId, p.deskId) : null;
    if (!desk) throw new DeskNotFoundError(p.deskId ?? '');
    const current = (await this.repo.liveMembers(tenantId, tx)).filter((m) => m.deskId === desk.id).map((m) => m.userId);
    const before = ((await this.repo.livePermissions(tenantId, tx)).get(desk.id) ?? []).sort();
    if (p.kind === 'edit') {
      const add: string[] = (d.add ?? []).filter((c: string) => !before.includes(c));
      const remove: string[] = (d.remove ?? []).filter((c: string) => before.includes(c));
      assertGrantable(add);
      await this.repo.addPermissionsTx(tx, tenantId, desk.id, add, p.id);
      await this.repo.removePermissionsTx(tx, tenantId, desk.id, remove, p.id);
      const madd: string[] = d.members?.add ?? []; const mrem: string[] = d.members?.remove ?? [];
      const ok = await this.repo.activeInTenantTx(tx, tenantId, madd);
      for (const u of madd.filter((m) => ok.includes(m))) await this.repo.addMemberTx(tx, tenantId, desk.id, u, p.proposedBy);
      for (const u of mrem) await this.repo.removeMemberTx(tx, tenantId, desk.id, u, checker, 'removed by a confirmed desk change');
      const after = [...before.filter((c) => !remove.includes(c)), ...add].sort();
      await this.audit.write(tx, { tenantId, actorUserId: checker, action: 'desk.permissions_changed', entityType: 'desk', entityId: desk.id,
        oldValue: { permissions: before, members: current }, newValue: { permissions: after, add, remove, members: { add: madd, remove: mrem }, proposedBy: p.proposedBy, confirmedBy: checker }, reason: p.reason });
      return [...new Set([...current, ...madd, ...mrem])];
    }
    const to = p.kind === 'disable' ? 'disabled' : 'active';
    if ((to === 'disabled' && desk.status !== 'active') || (to === 'active' && desk.status !== 'disabled')) throw new DeskStaleError(`the desk is already ${desk.status}`);
    await this.repo.setDeskStatusTx(tx, tenantId, desk.id, to, p.id);
    await this.audit.write(tx, { tenantId, actorUserId: checker, action: to === 'disabled' ? 'desk.disabled' : 'desk.enabled', entityType: 'desk', entityId: desk.id,
      oldValue: { status: desk.status }, newValue: { status: to, proposedBy: p.proposedBy, confirmedBy: checker, members: current.length }, reason: p.reason });
    return current;
  }

  async refuse(tenantId: string, actor: DeskActor, idemKey: string, id: string, reason: string, ip: string | null) {
    this.assertManager(actor);
    if (!UUID_RE.test(id)) throw new DeskProposalNotFoundError(id);
    const rp = reasonProblem(reason);
    if (rp) throw new DeskInvalidError([{ field: 'reason', code: 'DESK_REASON_INVALID', detail: { problem: rp } }]);
    return this.idem.remember(idemKey, actor.userId, 'identity.desk_refuse', () =>
      this.uow.run(tenantId, async (tx) => {
        const p = await this.repo.proposalForUpdate(tx, tenantId, id);
        if (!p) throw new DeskProposalNotFoundError(id);
        assertDeskProposalMove(p.status, 'refused');
        try { await this.repo.refuseTx(tx, tenantId, id, actor.userId, reason.trim()); }
        catch (e) { if (String((e as Error)?.message ?? '').includes('[DESK_CHECKER_NOT_ADMIN]')) throw new DeskForbiddenError(); throw e; }
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'desk.change_refused', entityType: 'desk_change_proposal', entityId: id,
          oldValue: { status: 'proposed', proposedBy: p.proposedBy, kind: p.kind, diff: p.diff },
          newValue: { status: 'refused', refusedBy: actor.userId, withdrawn: p.proposedBy === actor.userId }, reason: reason.trim(), ip });
        const row = await this.repo.proposalForUpdate(tx, tenantId, id);
        return this.proposalView(row!, actor.userId);
      }, { userId: actor.userId }));
  }

  /** The job: a desk proposal nobody confirmed in 7 days expires. */
  async expireDue(tenantId: string, id: string): Promise<boolean> {
    return this.uow.run(tenantId, async (tx) => {
      const ok = await this.repo.expireTx(tx, tenantId, id);
      if (ok) await this.audit.write(tx, { tenantId, actorUserId: null, action: 'desk.change_expired', entityType: 'desk_change_proposal', entityId: id,
        oldValue: { status: 'proposed' }, newValue: { status: 'expired' }, reason: 'unconfirmed after 7 days' });
      return ok;
    }, { userId: undefined });
  }

  /* ================================================================================================================== */
  /* members — direct, audited                                                                                          */
  /* ================================================================================================================== */
  async addMember(tenantId: string, actor: DeskActor, idemKey: string, deskId: string, userId: string, reason: string | null, ip: string | null) {
    this.assertManager(actor);
    if (!UUID_RE.test(deskId)) throw new DeskNotFoundError(deskId);
    if (!UUID_RE.test(userId)) throw new DeskMemberError('DESK_MEMBER_NOT_IN_TENANT', 'A desk member must hold an active role in this organisation');
    const out = await this.idem.remember(idemKey, actor.userId, 'identity.desk_member_add', () =>
      this.uow.run(tenantId, async (tx) => {
        const desk = await this.repo.deskForUpdate(tx, tenantId, deskId);
        if (!desk) throw new DeskNotFoundError(deskId);
        if (desk.status !== 'active') throw new DeskMemberError('DESK_DISABLED', 'This desk is disabled — enable it (with a second administrator) before adding people');
        const ok = await this.repo.activeInTenantTx(tx, tenantId, [userId]);
        if (!ok.length) throw new DeskMemberError('DESK_MEMBER_NOT_IN_TENANT', 'A desk member must hold an active role in this organisation');
        if (!(await this.repo.addMemberTx(tx, tenantId, deskId, userId, actor.userId))) throw new DeskMemberError('DESK_MEMBER_ALREADY', 'This person already sits at this desk');
        const perms = (await this.repo.livePermissions(tenantId, tx)).get(deskId) ?? [];
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'desk.member_added', entityType: 'desk', entityId: deskId,
          oldValue: { member: null }, newValue: { member: userId, desk: desk.code, grants: perms }, reason: reason?.trim() || null, ip });
        return { deskId, userId, grants: perms };
      }, { userId: actor.userId }));
    await this.roleCache.invalidate(userId, tenantId);
    return out;
  }

  async removeMember(tenantId: string, actor: DeskActor, idemKey: string, deskId: string, userId: string, reason: string, ip: string | null) {
    this.assertManager(actor);
    if (!UUID_RE.test(deskId)) throw new DeskNotFoundError(deskId);
    const rp = reasonProblem(reason, MEMBER_REASON_MIN, MEMBER_REASON_MAX);
    if (rp) throw new DeskMemberError('DESK_MEMBER_REASON', `reason is ${rp} (3–300 characters)`);
    const out = await this.idem.remember(idemKey, actor.userId, 'identity.desk_member_remove', () =>
      this.uow.run(tenantId, async (tx) => {
        const desk = await this.repo.deskForUpdate(tx, tenantId, deskId);
        if (!desk) throw new DeskNotFoundError(deskId);
        if (!(await this.repo.removeMemberTx(tx, tenantId, deskId, userId, actor.userId, reason.trim()))) throw new DeskMemberError('DESK_MEMBER_NOT_ON_DESK', 'This person does not sit at this desk');
        const perms = (await this.repo.livePermissions(tenantId, tx)).get(deskId) ?? [];
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'desk.member_removed', entityType: 'desk', entityId: deskId,
          oldValue: { member: userId, desk: desk.code, grants: perms }, newValue: { member: null }, reason: reason.trim(), ip });
        return { deskId, userId };
      }, { userId: actor.userId }));
    await this.roleCache.invalidate(userId, tenantId);
    return out;
  }
}

/** Exported for the parity test: the desk path refuses exactly what the override path refuses. */
export const deskRefusesCode = (code: string) => isUngrantable(code);
