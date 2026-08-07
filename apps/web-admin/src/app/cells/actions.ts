'use server';
// apps/web-admin/src/app/cells/actions.ts · god-mode CELL-MAP mutations — the ONLY place the admin bearer writes for
// the cells path. Editing a cell/shard or moving a tenant's placement reshapes WHERE that tenant's data physically
// lives (the DPDP residency boundary), so admin-api re-authorises SERVER-SIDE (cells.ops.manage + FIDO2 hardware-key
// + step-up), enforces the node state machine + residency rules, and audits every change with the operator's
// mandatory `reason`. CRITICAL (Law 11 + §4): a shard's dsn_secret_ref is a vault secret — it is NEVER accepted from
// or echoed to the browser here; this console only ever sees `hasDsn`. No Idempotency-Key (admin-api exposes none);
// no auto-retry. 'use server' files export ONLY async functions.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../../lib/admin-auth';
import { adminPost, adminPatch, adminDelete, AdminApiError } from '../../lib/admin-client';
import {
  buildCreateCell, buildUpdateCell, buildSetStatus, buildSetDefault, buildSetResidencyLock,
  buildCreateShard, buildUpdateShard, buildPlace, buildMove, buildRemove, CellInputError, isNodeStatus, type NodeStatus,
} from '../../features/cells/cell';

function apiErrorKey(e: unknown): string {
  if (e instanceof AdminApiError) {
    if (e.status === 403) return 'elevation';
    if (e.status === 409) return 'conflict';   // code/index exists · node not accepting/empty · capacity · already placed/in-state
    if (e.status === 422) return 'invalid';     // input · illegal transition · residency violation · shard/cell mismatch
    if (e.status === 404) return 'notFound';
  }
  return 'generic';
}
/** Pure-builder validation errors carry a stable i18n field key (e.g. cells.err.code). */
function inputErrorKey(e: unknown, fallback = 'invalid'): string {
  return e instanceof CellInputError ? e.fieldKey : fallback;
}
const enc = encodeURIComponent;
const str = (fd: FormData, k: string) => String(fd.get(k) ?? '');
const opt = (fd: FormData, k: string) => (fd.has(k) ? String(fd.get(k) ?? '') : undefined);

/* ---- cells ---- */
export async function createCellAction(formData: FormData): Promise<void> {
  requireAdmin();
  let body;
  try {
    body = buildCreateCell({
      code: str(formData, 'code'), displayName: str(formData, 'displayName'), countryCode: str(formData, 'countryCode'),
      isDefault: opt(formData, 'isDefault'), residencyLocked: opt(formData, 'residencyLocked'),
      capacityTenants: str(formData, 'capacityTenants'), notes: str(formData, 'notes'), reason: str(formData, 'reason'),
    });
  } catch (e) { redirect(`/cells?error=${inputErrorKey(e)}`); }
  let id: string | undefined;
  try { id = (await adminPost<{ id: string }>('cells/cells', { body })).data?.id; }
  catch (e) { redirect(`/cells?error=${apiErrorKey(e)}`); }
  revalidatePath('/cells');
  redirect(id ? `/cells/cells/${enc(id)}?ok=created` : '/cells?ok=created');
}

export async function updateCellAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = str(formData, 'id').trim();
  if (!id) redirect('/cells');
  let body;
  try {
    body = buildUpdateCell({
      displayName: opt(formData, 'displayName'), capacityTenants: opt(formData, 'capacityTenants'),
      residencyLocked: opt(formData, 'residencyLocked'), notes: opt(formData, 'notes'), reason: str(formData, 'reason'),
    });
  } catch (e) { redirect(`/cells/cells/${enc(id)}?error=${inputErrorKey(e)}`); }
  try { await adminPatch(`cells/cells/${enc(id)}`, { body }); }
  catch (e) { redirect(`/cells/cells/${enc(id)}?error=${apiErrorKey(e)}`); }
  revalidatePath(`/cells/cells/${id}`);
  redirect(`/cells/cells/${enc(id)}?ok=updated`);
}

export async function setCellStatusAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = str(formData, 'id').trim();
  const fromRaw = str(formData, 'from').trim();
  if (!id || !isNodeStatus(fromRaw)) redirect('/cells');
  let body;
  try { body = buildSetStatus(fromRaw as NodeStatus, str(formData, 'status'), str(formData, 'reason')); }
  catch (e) { redirect(`/cells/cells/${enc(id)}?error=${inputErrorKey(e, 'illegal')}`); }
  try { await adminPost(`cells/cells/${enc(id)}/status`, { body }); }
  catch (e) { redirect(`/cells/cells/${enc(id)}?error=${apiErrorKey(e)}`); }
  revalidatePath(`/cells/cells/${id}`);
  redirect(`/cells/cells/${enc(id)}?ok=status`);
}

export async function setCellDefaultAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = str(formData, 'id').trim();
  if (!id) redirect('/cells');
  const isDefault = str(formData, 'isDefault') === 'true';
  let body;
  try { body = buildSetDefault(isDefault, str(formData, 'reason')); }
  catch (e) { redirect(`/cells/cells/${enc(id)}?error=${inputErrorKey(e)}`); }
  try { await adminPost(`cells/cells/${enc(id)}/default`, { body }); }
  catch (e) { redirect(`/cells/cells/${enc(id)}?error=${apiErrorKey(e)}`); }
  revalidatePath(`/cells/cells/${id}`);
  redirect(`/cells/cells/${enc(id)}?ok=${isDefault ? 'madeDefault' : 'unset'}`);
}

export async function setResidencyLockAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = str(formData, 'id').trim();
  if (!id) redirect('/cells');
  const locked = str(formData, 'residencyLocked') === 'true';
  let body;
  try { body = buildSetResidencyLock(locked, str(formData, 'reason')); }
  catch (e) { redirect(`/cells/cells/${enc(id)}?error=${inputErrorKey(e)}`); }
  try { await adminPost(`cells/cells/${enc(id)}/residency-lock`, { body }); }
  catch (e) { redirect(`/cells/cells/${enc(id)}?error=${apiErrorKey(e)}`); }
  revalidatePath(`/cells/cells/${id}`);
  redirect(`/cells/cells/${enc(id)}?ok=${locked ? 'locked' : 'unlocked'}`);
}

/* ---- shards ---- */
export async function createShardAction(formData: FormData): Promise<void> {
  requireAdmin();
  let body;
  try {
    body = buildCreateShard({
      cellId: str(formData, 'cellId'), shardIndex: str(formData, 'shardIndex'),
      weight: str(formData, 'weight'), notes: str(formData, 'notes'), reason: str(formData, 'reason'),
    });
  } catch (e) { redirect(`/cells/shards?error=${inputErrorKey(e)}`); }
  let id: string | undefined;
  try { id = (await adminPost<{ id: string }>('cells/shards', { body })).data?.id; }
  catch (e) { redirect(`/cells/shards?error=${apiErrorKey(e)}`); }
  revalidatePath('/cells/shards');
  redirect(id ? `/cells/shards/${enc(id)}?ok=created` : '/cells/shards?ok=created');
}

export async function updateShardAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = str(formData, 'id').trim();
  if (!id) redirect('/cells/shards');
  let body;
  try { body = buildUpdateShard({ weight: opt(formData, 'weight'), notes: opt(formData, 'notes'), reason: str(formData, 'reason') }); }
  catch (e) { redirect(`/cells/shards/${enc(id)}?error=${inputErrorKey(e)}`); }
  try { await adminPatch(`cells/shards/${enc(id)}`, { body }); }
  catch (e) { redirect(`/cells/shards/${enc(id)}?error=${apiErrorKey(e)}`); }
  revalidatePath(`/cells/shards/${id}`);
  redirect(`/cells/shards/${enc(id)}?ok=updated`);
}

export async function setShardStatusAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = str(formData, 'id').trim();
  const fromRaw = str(formData, 'from').trim();
  if (!id || !isNodeStatus(fromRaw)) redirect('/cells/shards');
  let body;
  try { body = buildSetStatus(fromRaw as NodeStatus, str(formData, 'status'), str(formData, 'reason')); }
  catch (e) { redirect(`/cells/shards/${enc(id)}?error=${inputErrorKey(e, 'illegal')}`); }
  try { await adminPost(`cells/shards/${enc(id)}/status`, { body }); }
  catch (e) { redirect(`/cells/shards/${enc(id)}?error=${apiErrorKey(e)}`); }
  revalidatePath(`/cells/shards/${id}`);
  redirect(`/cells/shards/${enc(id)}?ok=status`);
}

/* ---- placements (tenant ↔ cell/shard) ---- */
export async function placeTenantAction(formData: FormData): Promise<void> {
  requireAdmin();
  let body;
  try {
    body = buildPlace({
      tenantId: str(formData, 'tenantId'), cellId: str(formData, 'cellId'), shardId: str(formData, 'shardId'),
      pinned: opt(formData, 'pinned'), reason: str(formData, 'reason'),
    });
  } catch (e) { redirect(`/cells/placements?error=${inputErrorKey(e)}`); }
  try { await adminPost('cells/placements', { body }); }
  catch (e) { redirect(`/cells/placements?error=${apiErrorKey(e)}`); }
  revalidatePath('/cells/placements');
  redirect(`/cells/placements/${enc(body.tenantId)}?ok=placed`);
}

export async function moveTenantAction(formData: FormData): Promise<void> {
  requireAdmin();
  const tenantId = str(formData, 'tenantId').trim();
  if (!tenantId) redirect('/cells/placements');
  let body;
  try { body = buildMove({ cellId: str(formData, 'cellId'), shardId: str(formData, 'shardId'), pinned: opt(formData, 'pinned'), reason: str(formData, 'reason') }); }
  catch (e) { redirect(`/cells/placements/${enc(tenantId)}?error=${inputErrorKey(e)}`); }
  try { await adminPost(`cells/placements/${enc(tenantId)}/move`, { body }); }
  catch (e) { redirect(`/cells/placements/${enc(tenantId)}?error=${apiErrorKey(e)}`); }
  revalidatePath(`/cells/placements/${tenantId}`);
  redirect(`/cells/placements/${enc(tenantId)}?ok=moved`);
}

export async function removePlacementAction(formData: FormData): Promise<void> {
  requireAdmin();
  const tenantId = str(formData, 'tenantId').trim();
  if (!tenantId) redirect('/cells/placements');
  let body;
  try { body = buildRemove(str(formData, 'reason')); }
  catch (e) { redirect(`/cells/placements/${enc(tenantId)}?error=${inputErrorKey(e)}`); }
  try { await adminDelete(`cells/placements/${enc(tenantId)}`, { body }); }
  catch (e) { redirect(`/cells/placements/${enc(tenantId)}?error=${apiErrorKey(e)}`); }
  revalidatePath('/cells/placements');
  redirect('/cells/placements?ok=removed');
}

/* ------------------------------------------------------------------------------------------------ */
/* PC-56 ADMIN-8 · the TWELFTH maker-checker site                                                    */
/* ------------------------------------------------------------------------------------------------ */
//
// These are the writes the canon names a checker on five times and that had none. Each is re-authorised SERVER-SIDE:
// `cells.manage` to propose, the NEW `cells.approve` to apply or reject, plus a FIDO2 hardware key and step-up freshness
// on both — because this map decides which physical stack and which COUNTRY a tenant's data lives in.
//
// NO `observed` FIELD IS SENT. The maker's observed state is read server-side from the row, because it is what the
// staleness check compares against — and a client that could supply it could supply a snapshot matching whatever it wanted
// applied, which defeats the point of storing one. Applying sends no body at all.

/** Propose a cell change (the maker half). */
export async function proposeCellChangeAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = String(formData.get('id') ?? '').trim();
  const action = String(formData.get('action') ?? '').trim();
  const reason = String(formData.get('reason') ?? '');
  if (!id) redirect('/cells');
  if (action !== 'status_changed' && action !== 'updated') redirect(`/cells/cells/${encodeURIComponent(id)}?error=invalid`);
  // Checked here so the operator sees a field error rather than a 422, and again by Zod, and again by 0116's CHECK.
  if (reason.trim().length < 20) redirect(`/cells/cells/${encodeURIComponent(id)}?error=reason`);

  const body: Record<string, unknown> = { action, reason: reason.trim() };
  if (action === 'status_changed') {
    const status = String(formData.get('status') ?? '').trim();
    if (!status) redirect(`/cells/cells/${encodeURIComponent(id)}?error=invalid`);
    body.status = status;
  } else {
    const cap = String(formData.get('capacityTenants') ?? '').trim();
    // An EMPTY capacity field means "leave it alone"; the literal string "null" means UNCAPPED. Those are different
    // intentions and the form has to be able to express both, or raising a cap and removing one become the same gesture.
    if (cap === 'null') body.capacityTenants = null;
    else if (cap !== '') {
      const n = Number(cap);
      if (!Number.isInteger(n) || n < 0) redirect(`/cells/cells/${encodeURIComponent(id)}?error=capacity`);
      body.capacityTenants = n;
    }
    const isDefault = String(formData.get('isDefault') ?? '').trim();
    if (isDefault === 'true' || isDefault === 'false') body.isDefault = isDefault === 'true';
    const lock = String(formData.get('residencyLocked') ?? '').trim();
    if (lock === 'true' || lock === 'false') body.residencyLocked = lock === 'true';
  }
  let proposalId: string | undefined;
  try {
    const res = await adminPost<{ id: string }>(`cells/cells/${encodeURIComponent(id)}/proposals`, { body });
    proposalId = res.data?.id;
  } catch (e) {
    redirect(`/cells/cells/${encodeURIComponent(id)}?error=${apiErrorKey(e)}`);
  }
  revalidatePath(`/cells/cells/${id}`);
  revalidatePath('/cells/changes');
  if (proposalId) redirect(`/cells/proposals/${encodeURIComponent(proposalId)}?ok=proposed`);
  redirect('/cells/changes?ok=proposed');
}

/** Propose a shard change. W031: "Weight/status changes need `cells.write` + checker; they shift the placement hash." */
export async function proposeShardChangeAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = String(formData.get('id') ?? '').trim();
  const action = String(formData.get('action') ?? '').trim();
  const reason = String(formData.get('reason') ?? '');
  if (!id) redirect('/cells/shards');
  if (action !== 'status_changed' && action !== 'updated') redirect(`/cells/shards/${encodeURIComponent(id)}?error=invalid`);
  if (reason.trim().length < 20) redirect(`/cells/shards/${encodeURIComponent(id)}?error=reason`);

  const body: Record<string, unknown> = { action, reason: reason.trim() };
  if (action === 'status_changed') {
    const status = String(formData.get('status') ?? '').trim();
    if (!status) redirect(`/cells/shards/${encodeURIComponent(id)}?error=invalid`);
    body.status = status;
  } else {
    const w = String(formData.get('weight') ?? '').trim();
    const n = Number(w);
    // 0 IS THE INTERESTING VALUE and must be accepted: W031's "weight 0 = drain (no new placements)", which nothing
    // enforced until 0116. A falsy check here would have made the drain gesture unreachable through the very form that
    // exists to perform it.
    if (w === '' || !Number.isInteger(n) || n < 0) redirect(`/cells/shards/${encodeURIComponent(id)}?error=weight`);
    body.weight = n;
  }
  let proposalId: string | undefined;
  try {
    const res = await adminPost<{ id: string }>(`cells/shards/${encodeURIComponent(id)}/proposals`, { body });
    proposalId = res.data?.id;
  } catch (e) {
    redirect(`/cells/shards/${encodeURIComponent(id)}?error=${apiErrorKey(e)}`);
  }
  revalidatePath(`/cells/shards/${id}`);
  revalidatePath('/cells/changes');
  if (proposalId) redirect(`/cells/proposals/${encodeURIComponent(proposalId)}?ok=proposed`);
  redirect('/cells/changes?ok=proposed');
}

/** Apply an approved change — the checker half, on `cells.approve`. NO BODY. */
export async function applyProposalAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/cells/changes');
  try {
    await adminPost(`cells/proposals/${encodeURIComponent(id)}/apply`, { body: {} });
  } catch (e) {
    redirect(`/cells/proposals/${encodeURIComponent(id)}?error=${apiErrorKey(e)}`);
  }
  revalidatePath(`/cells/proposals/${id}`);
  revalidatePath('/cells');
  revalidatePath('/cells/changes');
  revalidatePath('/cells/capacity');
  redirect(`/cells/proposals/${encodeURIComponent(id)}?ok=applied`);
}

export async function rejectProposalAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = String(formData.get('id') ?? '').trim();
  const note = String(formData.get('note') ?? '');
  if (!id) redirect('/cells/changes');
  if (note.trim().length < 20) redirect(`/cells/proposals/${encodeURIComponent(id)}?error=note`);
  try {
    await adminPost(`cells/proposals/${encodeURIComponent(id)}/reject`, { body: { note: note.trim() } });
  } catch (e) {
    redirect(`/cells/proposals/${encodeURIComponent(id)}?error=${apiErrorKey(e)}`);
  }
  revalidatePath(`/cells/proposals/${id}`);
  redirect(`/cells/proposals/${encodeURIComponent(id)}?ok=rejected`);
}

/** Mark a proposal stale. The server refuses unless it genuinely IS stale, so this cannot be used to bury a colleague's
 *  change — that would be Reject, which demands a reason. */
export async function staleProposalAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/cells/changes');
  try {
    await adminPost(`cells/proposals/${encodeURIComponent(id)}/stale`, { body: {} });
  } catch (e) {
    redirect(`/cells/proposals/${encodeURIComponent(id)}?error=${apiErrorKey(e)}`);
  }
  revalidatePath(`/cells/proposals/${id}`);
  redirect(`/cells/proposals/${encodeURIComponent(id)}?ok=stale`);
}

/** Reconcile the denormalised placement counts against `tenant_placements`. The capacity guard reads the denormalised
 *  number and nothing has ever compared it with the truth — ADMIN-6's cached-balance finding, one table over. */
export async function runCountCheckAction(): Promise<void> {
  requireAdmin();
  try {
    await adminPost('cells/capacity/count-check', { body: {} });
  } catch (e) {
    redirect(`/cells/capacity?error=${apiErrorKey(e)}`);
  }
  revalidatePath('/cells/capacity');
  // `?ok=counted` deliberately does NOT say "no drift". The verdict is whatever the comparison found, and a success banner
  // implying a clean result would be the console asserting an outcome it did not compute.
  redirect('/cells/capacity?ok=counted');
}
