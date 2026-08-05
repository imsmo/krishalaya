// apps/mobile/src/features/delivery-partner/delivery.api.ts · data layer for the rider vertical (PC-50 W10-5).
// box=mine — ONLY the caller's assigned shipments (server-scoped by riderUserId). Milestones are plain
// transitions the server re-validates against the state machine AND the assigned rider. Delivery is the
// money-adjacent step (it can settle COD/complete the order) → OTP 4–8 digits + optional POD photo via the
// shared media pipeline, Idempotency-Keyed (Law 3). Reads degrade-never-die.
import type { Shipment, RiderPayoutStatement } from '@krishalaya/sdk-js';
import { apiClient } from '../../core/api/client';
import { newId } from '../../core/util/ids';
import { uploadPickedImage, type PickedImage } from '../../core/media';

export async function myTasks(): Promise<Shipment[]> {
  try { return (await apiClient().shipments.list({ box: 'mine', limit: 100 })).items; } catch { return []; }
}
export async function getTask(id: string): Promise<Shipment | null> {
  try { return await apiClient().shipments.get(id); } catch { return null; }
}
export function markPickedUp(id: string): Promise<Shipment> { return apiClient().shipments.markPickedUp(id); }
export function markInTransit(id: string): Promise<Shipment> { return apiClient().shipments.markInTransit(id); }
export function markAtHub(id: string): Promise<Shipment> { return apiClient().shipments.markAtHub(id); }
export function markOutForDelivery(id: string): Promise<Shipment> { return apiClient().shipments.markOutForDelivery(id); }
export function failTask(id: string, reason: string): Promise<Shipment> { return apiClient().shipments.fail(id, reason); }
export function deliverTask(id: string, otp: string, podMediaId?: string): Promise<Shipment> {
  return apiClient().shipments.deliver(id, podMediaId ? { otp, podMediaId } : { otp }, newId());
}
/** POD photo → shared pipeline (EXIF-drop/downscale → presign → PUT → confirm) → mediaId (or null if queued/offline). */
export async function uploadPod(picked: PickedImage): Promise<string | null> {
  try { return (await uploadPickedImage(picked)).mediaId; } catch { return null; }
}
export function pingLocation(id: string, lat: number, lng: number): Promise<{ ok: boolean }> {
  return apiClient().shipments.postLocation(id, { lat, lng });
}

/** PC-55 A7: my OWN payout statement (this month by default). Ledgered arithmetic — settlement.paid is
 *  always false until the operator's payouts actually run; the screen shows that verbatim, never a promise. */
export async function myPayoutStatement(): Promise<RiderPayoutStatement | null> {
  try { return await apiClient().shipments.myRiderPayoutStatement(); } catch { return null; }
}
