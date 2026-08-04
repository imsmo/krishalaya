// apps/mobile/src/core/media/uploader.ts · the upload orchestrator: process → hash → presign → PUT(progress,
// retry) → confirm. OFFLINE-FIRST: on a network/timeout failure the op is enqueued durably and replayed later
// with the SAME idempotency keys, so a reconnect can never create a duplicate asset (Law 3). The raw bytes go
// straight to S3 (ticket.uploadUrl) via expo-file-system — never proxied through the API or logged.
import * as FileSystem from 'expo-file-system';
import { SdkError } from '@krishalaya/sdk-js';
import type { MediaKind } from '@krishalaya/sdk-js';
import { apiClient } from '../api/client';
import type { QueuedOp, ReplayResult } from '../api/offline-queue';
import { registerOpHandler, enqueueOp } from '../offline/sync-queue';
import { newId } from '../util/ids';
import { processImage } from './process';
import { hashFile } from './hash';
import type { PickedImage, ProcessedImage, ProgressFn, UploadOutcome } from './types';

export const MEDIA_UPLOAD_OP = 'media.upload';

interface MediaOpPayload {
  localUri: string; kind: MediaKind; mimeType: string; bytes: number; sha256: string; width: number; height: number;
}

// NOTE (KV-MF-02 audit): this treats any non-SdkError as transient because putBytes()'s own S3 PUT failures
// (below) never go through the SDK's http client — they surface as plain Error objects even when the cause is
// a real dropped connection mid-upload, so "non-SdkError ⇒ transient" is intentional HERE, unlike the
// equivalent-looking bug found in listings.api.ts (where the thrown value legitimately CAN be a typed SdkError
// and was being misclassified). Left unchanged; flagged for a follow-up to give putBytes() typed errors so this
// can be tightened the same way without breaking legitimate S3-upload retry.
const isNetworkish = (e: unknown): boolean => {
  if (e instanceof SdkError) return e.status === 0 || e.status === 408 || e.status === 429 || e.status >= 500;
  return true; // non-SdkError (fetch/timeout/abort/S3 PUT failure) = transient
};

/** PUT the file bytes to the presigned S3 URL with progress + a bounded retry on transient failure. */
async function putBytes(uploadUrl: string, fileUri: string, mimeType: string, onProgress?: ProgressFn): Promise<void> {
  let attempt = 0;
  for (;;) {
    attempt++;
    try {
      const task = FileSystem.createUploadTask(uploadUrl, fileUri, {
        httpMethod: 'PUT',
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: { 'Content-Type': mimeType },
      }, (p) => { if (p.totalBytesExpectedToSend > 0) onProgress?.(p.totalBytesSent / p.totalBytesExpectedToSend); });
      const res = await task.uploadAsync();
      if (res && res.status >= 200 && res.status < 300) return;
      if (res && res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
        throw new Error(`upload rejected ${res.status}`); // permanent
      }
      if (attempt >= 3) throw new Error(`upload failed ${res?.status ?? 'no-response'}`);
    } catch (e) {
      if (attempt >= 3) throw e;
    }
    await new Promise((r) => setTimeout(r, 300 * attempt)); // backoff
  }
}

/** Run the full online upload for an already-processed+hashed asset. Throws on failure (caller decides to queue). */
async function uploadNow(p: MediaOpPayload, idemKey: string, onProgress?: ProgressFn): Promise<string> {
  const client = apiClient();
  const ticket = await client.media.requestUpload({ kind: p.kind, mimeType: p.mimeType, declaredBytes: p.bytes }, idemKey);
  await putBytes(ticket.uploadUrl, p.localUri, p.mimeType, onProgress);
  await client.media.confirmUpload(ticket.mediaId, { bytes: p.bytes, sha256: p.sha256, width: p.width, height: p.height }, `${idemKey}:confirm`);
  return ticket.mediaId;
}

/** Upload an already-processed image. Online → returns mediaId; on a network failure → enqueues + queued=true. */
export async function uploadProcessed(processed: ProcessedImage, opts: { kind?: MediaKind; onProgress?: ProgressFn } = {}): Promise<UploadOutcome> {
  const { sha256, bytes } = await hashFile(processed.uri);
  const payload: MediaOpPayload = {
    localUri: processed.uri, kind: opts.kind ?? 'image', mimeType: processed.mimeType,
    bytes, sha256, width: processed.width, height: processed.height,
  };
  const idemKey = newId();
  try {
    const mediaId = await uploadNow(payload, idemKey, opts.onProgress);
    return { mediaId, queued: false, localUri: processed.uri };
  } catch (e) {
    if (!isNetworkish(e)) throw e; // real client/validation error — surface it (don't silently queue a bad file)
    await enqueueOp({ type: MEDIA_UPLOAD_OP, payload, idempotencyKey: idemKey, id: idemKey, now: Date.now() });
    return { mediaId: null, queued: true, localUri: processed.uri };
  }
}

/** Pick-or-capture → compress → upload, in one call for screens. */
export async function uploadPickedImage(picked: PickedImage, opts: { onProgress?: ProgressFn } = {}): Promise<UploadOutcome> {
  const processed = await processImage(picked);
  return uploadProcessed(processed, { kind: 'image', onProgress: opts.onProgress });
}

// --- offline replay (registered once with the shared queue) ---
async function replayMediaUpload(op: QueuedOp): Promise<ReplayResult> {
  const p = op.payload as MediaOpPayload;
  try {
    const info = await FileSystem.getInfoAsync(p.localUri);
    if (!info.exists) return 'permanent-fail'; // file GC'd before we could replay — can't recover
    await uploadNow(p, op.idempotencyKey);
    return 'ok';
  } catch (e) {
    return isNetworkish(e) ? 'retry' : 'permanent-fail';
  }
}
registerOpHandler(MEDIA_UPLOAD_OP, replayMediaUpload);
