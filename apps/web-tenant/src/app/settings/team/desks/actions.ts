'use server';
// apps/web-tenant/src/app/settings/team/desks/actions.ts · the writes of W185 and its chains — PC-56 TENANT-13b.
//   • proposeDeskAction   — the form chain's Submit (W2575 → W2576 / W2577): create / edit a desk = a PROPOSAL; and the mutate chain's
//                            Proceed for install templates / disable / enable (W2578 → W2579 / W2580). Never applied by its maker.
//   • deskProposalAction   — confirm (a DIFFERENT tenant_admin — the database refuses the proposer) or refuse with a reason.
//   • addMemberAction / removeMemberAction — direct, audited (canon: "assign desks, not permission lists"); removal needs a reason.
// 'use server' modules export ONLY async functions.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import type { DeskProposalKind } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import {
  DESKS_HREF, DESK_ACT_HREF, NEW_DESK_HREF, deskProposalHref, failureCodesFrom, isActKind, isDeskCode, isIdemKey, isUuid, parseIdList, parsePermList,
} from '../../../../features/desks/desks';

const codesOf = (e: unknown) => { const err = e instanceof SdkError ? e : null; return err ? failureCodesFrom(err.code, err.status, err.details) : ['unknown']; };
const qs = (o: Record<string, string>) => new URLSearchParams(o).toString();

export async function proposeDeskAction(formData: FormData): Promise<void> {
  await requireSession(DESKS_HREF);
  const kindRaw = String(formData.get('kind') ?? '');
  const kind: DeskProposalKind = kindRaw === 'edit' || kindRaw === 'create' || isActKind(kindRaw) ? (kindRaw as DeskProposalKind) : 'create';
  const deskId = String(formData.get('deskId') ?? '');
  const code = String(formData.get('code') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim().slice(0, 120);
  const description = String(formData.get('description') ?? '').trim().slice(0, 400);
  const permissions = parsePermList(String(formData.get('permissions') ?? ''));
  const members = parseIdList(String(formData.get('members') ?? ''));
  const removeMembers = parseIdList(String(formData.get('removeMembers') ?? ''));
  const reason = String(formData.get('reason') ?? '').trim().slice(0, 500);
  const idem = String(formData.get('idempotencyKey') ?? '');
  const isForm = kind === 'create' || kind === 'edit';
  const base = isForm ? NEW_DESK_HREF : DESK_ACT_HREF;
  const back: Record<string, string> = isForm
    ? { ...(isUuid(deskId) ? { deskId } : {}), ...(isDeskCode(code) ? { code } : {}), ...(name ? { name } : {}), ...(description ? { description } : {}),
        ...(permissions.length ? { permissions: permissions.join(',') } : {}), ...(members.length ? { members: members.join(',') } : {}), ...(reason ? { reason } : {}) }
    : { kind, ...(isUuid(deskId) ? { deskId } : {}), ...(reason ? { reason } : {}) };
  let failed: string[] | null = null; let id = '';
  try {
    const r = await tenantClient().desks.propose({
      kind, deskId: isUuid(deskId) ? deskId : null, code: code || null, name: name || null, description: description || null,
      permissions: isForm ? permissions : null, members: isForm ? { add: members, remove: removeMembers } : null, reason,
    }, isIdemKey(idem) ? idem : randomUUID());
    id = r.id;
  } catch (e) { failed = codesOf(e); }
  revalidatePath(DESKS_HREF);
  if (failed) redirect(`${base}?${qs({ ...back, step: 'failure', error: failed.join(',') })}`);
  redirect(`${base}?${qs({ ...(isForm ? {} : { kind }), step: 'success', proposal: id })}`);
}

export async function deskProposalAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const act = String(formData.get('act') ?? '') === 'refuse' ? 'refuse' : 'confirm';
  await requireSession(DESKS_HREF);
  if (!isUuid(id)) redirect(DESKS_HREF);
  const idem = String(formData.get('idempotencyKey') ?? '');
  const reason = String(formData.get('reason') ?? '').trim().slice(0, 500);
  let failed: string[] | null = null;
  try {
    if (act === 'confirm') await tenantClient().desks.confirm(id, isIdemKey(idem) ? idem : randomUUID());
    else await tenantClient().desks.refuse(id, reason, isIdemKey(idem) ? idem : randomUUID());
  } catch (e) { failed = codesOf(e); }
  revalidatePath(DESKS_HREF);
  if (failed) redirect(`${deskProposalHref(id, act, 'failure')}&error=${encodeURIComponent(failed.join(','))}`);
  redirect(deskProposalHref(id, act, 'success'));
}

export async function addMemberAction(formData: FormData): Promise<void> {
  await requireSession(DESKS_HREF);
  const deskId = String(formData.get('deskId') ?? ''); const userId = String(formData.get('userId') ?? '');
  const reason = String(formData.get('reason') ?? '').trim().slice(0, 400);
  if (!isUuid(deskId) || !isUuid(userId)) redirect(`${DESKS_HREF}?memberError=DESK_MEMBER_NOT_IN_TENANT`);
  let failed: string[] | null = null;
  try { await tenantClient().desks.addMember(deskId, userId, reason || null, randomUUID()); } catch (e) { failed = codesOf(e); }
  revalidatePath(DESKS_HREF);
  if (failed) redirect(`${DESKS_HREF}?${qs({ memberError: failed.join(','), desk: deskId })}`);
  redirect(`${DESKS_HREF}?${qs({ memberOk: 'added', desk: deskId })}`);
}

export async function removeMemberAction(formData: FormData): Promise<void> {
  await requireSession(DESKS_HREF);
  const deskId = String(formData.get('deskId') ?? ''); const userId = String(formData.get('userId') ?? '');
  const reason = String(formData.get('reason') ?? '').trim().slice(0, 400);
  if (!isUuid(deskId) || !isUuid(userId)) redirect(DESKS_HREF);
  let failed: string[] | null = null;
  try { await tenantClient().desks.removeMember(deskId, userId, reason, randomUUID()); } catch (e) { failed = codesOf(e); }
  revalidatePath(DESKS_HREF);
  if (failed) redirect(`${DESKS_HREF}?${qs({ memberError: failed.join(','), desk: deskId })}`);
  redirect(`${DESKS_HREF}?${qs({ memberOk: 'removed', desk: deskId })}`);
}
