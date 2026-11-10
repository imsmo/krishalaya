'use server';
// apps/web-tenant/src/app/team/actions.ts · tenant staff/roster mutations. The only place the authed tenantClient()
// writes for the team path. Two Server Actions, each re-authorised SERVER-SIDE (identity.approve / identity.report
// within the caller's own tenant — NOT god-mode, Law 11):
//   - approveAssignmentAction: approve a pending role assignment (e.g. a farmer joining the tenant).
//   - addUserAction: admin-add a member who can't self-register (users.create, Idempotency-Key, Law 3).
// 'use server' modules export ONLY async functions — validation lives in features/team/form.ts.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { buildAddUser } from '../../features/team/form';
import { SdkError } from '@krishalaya/sdk-js';
import { GOV_ROLE_REFUSAL } from '../../features/swc/console';

export async function approveAssignmentAction(formData: FormData): Promise<void> {
  await requireSession('/team');
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/team');
  try { await tenantClient().rbac.approveAssignment(id); }
  // PC-56 HOTFIX-15: the frozen gov_officer is refused by name (its own sentence, ×3), never as a generic 'illegal'.
  catch (e) { redirect(`/team?error=${e instanceof SdkError && e.code === GOV_ROLE_REFUSAL ? GOV_ROLE_REFUSAL : e instanceof SdkError && e.status === 409 ? 'illegal' : 'approve'}`); }
  revalidatePath('/team');
  redirect('/team?ok=approved');
}

export async function addUserAction(formData: FormData): Promise<void> {
  await requireSession('/team');
  const built = buildAddUser({
    phone: String(formData.get('phone') ?? ''),
    fullName: String(formData.get('fullName') ?? ''),
    languageCode: String(formData.get('languageCode') ?? ''),
    countryCode: String(formData.get('countryCode') ?? ''),
  });
  if (!built.ok) redirect(`/team?error=${built.error}`);
  try { await tenantClient().users.create(built.value, randomUUID()); }
  catch (e) { redirect(`/team?error=${encodeURIComponent(e instanceof SdkError ? (e.code || 'add') : 'add')}`); }
  revalidatePath('/team');
  redirect('/team?ok=added');
}
