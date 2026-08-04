'use server';
// apps/web-tenant/src/app/team/roles/actions.ts · staff-permissions matrix mutations (assign / revoke role,
// set a per-assignment permission override). The only place the authed tenantClient() writes the RBAC matrix.
// Every write is re-authorised SERVER-SIDE within the caller's own tenant (identity.approve — NOT god-mode, Law 11)
// and the API re-enforces the no-escalation rules: platform/owner roles are never assignable here, and a staff
// override can never hand out `*`/money/god permissions nor exceed what the granter holds. The client guards in
// features/team/permissions.ts are a first gate only; a server 403 is surfaced as `escalation`.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { buildAssign, buildOverride } from '../../../features/team/permissions';
import { SdkError } from '@krishalaya/sdk-js';

const PATH = '/team/roles';
function fail(error: string): never { redirect(`${PATH}?error=${encodeURIComponent(error)}`); }
function ok(k: string): never { revalidatePath(PATH); redirect(`${PATH}?ok=${k}`); }
function code(e: unknown, fallback: string): string {
  if (e instanceof SdkError) return e.status === 403 ? 'escalation' : (e.code || fallback);
  return fallback;
}

export async function assignRoleAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  // The assignable set is re-derived server-side; here we only block obvious escalation client-side by
  // requiring the submitted role to be one the API marked tenant-assignable (passed as a hidden field list).
  const assignable = new Set(String(formData.get('assignable') ?? '').split(',').map((s) => s.trim()).filter(Boolean));
  const built = buildAssign({ userId: formData.get('userId'), roleCode: formData.get('roleCode') }, assignable);
  if (!built.ok) fail(`assign.${built.error}`);
  try { await tenantClient().rbac.assign(built.value, randomUUID()); }
  catch (e) { fail(code(e, 'assign.save')); }
  ok('assigned');
}

export async function revokeRoleAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const id = String(formData.get('id') ?? '').trim();
  if (!id) fail('assign.save');
  try { await tenantClient().rbac.revoke(id); }
  catch (e) { fail(code(e, 'assign.save')); }
  ok('revoked');
}

export async function setOverrideAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const built = buildOverride({
    userTenantRoleId: formData.get('userTenantRoleId'),
    permissionCode: formData.get('permissionCode'),
    isGranted: formData.get('isGranted'),
  });
  if (!built.ok) fail(`override.${built.error}`);
  try { await tenantClient().rbac.setOverride(built.value); }
  catch (e) { fail(code(e, 'override.save')); }
  ok('override');
}
