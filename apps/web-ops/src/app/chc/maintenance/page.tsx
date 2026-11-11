// apps/web-ops/src/app/chc/maintenance/page.tsx · PC-56 OPS-4b · W408 (canon `chc/maintenance`) — UPKEEP: A READ of the maintenance entries of the
// machines the signed-in person listed and the server's two alerts for them, and ONE REAL act, "Record a maintenance entry" (never "Log
// completion"). Reads, all EXISTING: `GET /v1/equipment/assets?box=mine`, the equipment categories, `GET …/maintenance/alerts` (the caller's own
// machines since the 4b first commit) and `GET …/:id/maintenance-logs` for each of the first 20 machines (the owner only). One write, through the
// server action. The chains are query states, checked FIRST: `?act=` is W3304–W3306 (a re-read — PARITY-DECOR) and reads nothing; `?form=failure|
// success` (W3303 / W3302) read nothing but this browser's kept answer; `?form=review|error` (W3301 / W3300) read the machines they are for.
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { randomUUID } from 'node:crypto';
import { SdkError, type CategoryNode, type EquipmentAsset } from '@krishalaya/sdk-js';
import { requireSession } from '../../../lib/session';
import { opsClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { machineText } from '../../../components/ops4/ChcViews';
import { Ops4Chain } from '../../../components/ops4/Ops4Chain';
import { MaintFailureNote, MaintForm, MaintFormError, MaintRecorded, MaintReview, MaintenanceView } from '../../../components/ops4/UpkeepViews';
import { chain4State } from '../../../features/ops4/refusals';
import { DASH_LIMIT, asMaintenance, chcState, type MaintenanceEntry } from '../../../features/ops4/chc';
import { ENTRY_COOKIE, MAINT, MAINT_MACHINES, asAlerts, checkDraft, decodeRecorded, draftInput, parseFailure, parseFieldError } from '../../../features/ops4/upkeep';
import { recordMaintenanceAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('ops4.upkeep.title'), robots: { index: false, follow: false } }; }
type SP = Record<string, string | string[] | undefined>;

export default async function ChcMaintenancePage({ searchParams }: { searchParams?: SP }) {
  await requireSession(MAINT);
  const t = getTranslator(); const lang = getLang();
  const act = chain4State('chc_act', searchParams);
  if (act) return <Ops4Chain t={t} chain="chc_act" state={act} page={MAINT} />;
  const form = chain4State('chc_form', searchParams);
  if (form === 'failure') return <Ops4Chain t={t} chain="chc_form" state="failure" page={MAINT}><MaintFailureNote t={t} reason={parseFailure(searchParams?.reason)} /></Ops4Chain>;
  if (form === 'success') {
    const entry = decodeRecorded(cookies().get(ENTRY_COOKIE)?.value);
    return <Ops4Chain t={t} chain="chc_form" state="success" page={MAINT}><MaintRecorded t={t} lang={lang} entry={entry} machine={null} /></Ops4Chain>;
  }

  const c = opsClient();
  let status: 'ok' | number | 'failed' = 'ok'; let machines: EquipmentAsset[] = []; let machinesMore = false;
  try { const m = await c.equipment.assets({ box: 'mine', limit: DASH_LIMIT }); machines = m.items; machinesMore = !!m.nextCursor; }
  catch (e) { status = e instanceof SdkError ? e.status : 'failed'; }
  let categories: CategoryNode[] = [];
  if (status === 'ok') { try { categories = await c.lookups.categories({ rootCode: 'equipment' }); } catch { categories = []; } }

  if (form === 'review' || form === 'error') {
    if (status !== 'ok') return <MaintenanceView t={t} lang={lang} state={chcState(status)} machines={[]} machinesMore={false} categories={[]} entries={{}} alerts={[]} />;
    const draft = draftInput(searchParams);
    const checked = checkDraft(draft, machines.map((m) => m.id));
    if (form === 'error' || !checked.body) {
      const error = form === 'error' ? parseFieldError(searchParams?.reason) : (checked.error ?? 'api');
      return (
        <Ops4Chain t={t} chain="chc_form" state="error" page={MAINT}>
          <MaintFormError t={t} error={error} />
          <MaintForm t={t} machines={machines} categories={categories} values={draft} lang={lang} />
        </Ops4Chain>
      );
    }
    const machine = machineText(t, machines.find((m) => m.id === checked.body?.assetId) ?? null, categories, lang);
    return (
      <Ops4Chain t={t} chain="chc_form" state="review" page={MAINT}>
        <MaintReview t={t} lang={lang} machine={machine} body={checked.body} idemKey={randomUUID()} action={recordMaintenanceAction} draft={draft} />
      </Ops4Chain>
    );
  }

  let alerts: ReturnType<typeof asAlerts> | null = [];
  const entries: Record<string, MaintenanceEntry[] | null> = {};
  if (status === 'ok') {
    try { alerts = asAlerts(await c.equipment.maintenanceAlerts()); } catch { alerts = null; }
    const shown = machines.slice(0, MAINT_MACHINES);
    const read = await Promise.all(shown.map((m) => c.equipment.maintenanceLogs(m.id).then(asMaintenance).catch(() => null)));
    shown.forEach((m, i) => { entries[m.id] = read[i]; });
  }
  return <MaintenanceView t={t} lang={lang} state={chcState(status)} machines={machines} machinesMore={machinesMore} categories={categories} entries={entries} alerts={alerts} />;
}
