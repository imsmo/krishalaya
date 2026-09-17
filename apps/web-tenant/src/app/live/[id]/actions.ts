'use server';
// apps/web-tenant/src/app/live/[id]/actions.ts · a member registers for a class · PC-56 TENANT-7c. Idempotent twice over:
// by (class, member) in the table and by a fresh key per click. Refusals (`CLASS_FULL`, `CLASS_NOT_OPEN`) land back on the
// class page as a code the page prints.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { SdkError } from '@krishalaya/sdk-js';
import { liveClassHref, liveHref } from '../../../features/live/classes';

export async function registerAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect(liveHref());
  await requireSession(liveClassHref(id));
  try { await tenantClient().liveClasses.register(id, randomUUID()); }
  catch (e) {
    const code = e instanceof SdkError ? ((e.details as { refusals?: string[] } | undefined)?.refusals?.[0] ?? e.code ?? 'register') : 'register';
    redirect(`${liveClassHref(id)}?error=${encodeURIComponent(code)}`);
  }
  revalidatePath(liveClassHref(id)); revalidatePath(liveHref());
  redirect(`${liveClassHref(id)}?registered=1`);
}
