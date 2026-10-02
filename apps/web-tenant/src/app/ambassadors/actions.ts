'use server';
// apps/web-tenant/src/app/ambassadors/actions.ts · the ambassador DETAIL page's one direct write: set a target.
//
// PC-56 TENANT-10a: every other write that used to live here (enrol by pasted UUID, suspend / reinstate without a reason,
// pay out with a fresh key per click, activate a referral by pasted UUID) is now its own chain with a confirm step and a
// recorded reason — /people/ambassadors/new, /people/ambassadors/[id]/edit, /people/ambassadors/[id]/act,
// /people/ambassadors/run, /people/referrals/[id]/activate. Setting a target is not money and not a lifecycle change; it
// stays a plain form, now on the detail page. 'use server' modules export ONLY async functions.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { SdkError } from '@krishalaya/sdk-js';
import { validateTarget } from '../../features/ambassadors/admin';
import { detailHref } from '../../features/ambassadors/console';

export async function setTargetAction(formData: FormData): Promise<void> {
  const ambassadorId = String(formData.get('ambassadorId') ?? '').trim();
  const back = detailHref(ambassadorId);
  await requireSession(back);
  const metric = String(formData.get('metric') ?? '').trim();
  const periodStart = String(formData.get('periodStart') ?? '').trim();
  const periodEnd = String(formData.get('periodEnd') ?? '').trim();
  const targetValue = String(formData.get('targetValue') ?? '').trim();
  const bad = validateTarget({ ambassadorId, metric, periodStart, periodEnd, targetValue });
  if (bad) redirect(`${back}?targetError=${bad}`);
  try {
    await tenantClient().ambassadors.setTarget({ ambassadorId, metric: metric as 'onboardings' | 'sales_facilitated' | 'earnings_minor' | 'visits', periodStart, periodEnd, targetValue });
  } catch (e) { redirect(`${back}?targetError=${encodeURIComponent(e instanceof SdkError ? (e.code || 'save') : 'save')}`); }
  revalidatePath(back);
  redirect(`${back}?ok=target`);
}
