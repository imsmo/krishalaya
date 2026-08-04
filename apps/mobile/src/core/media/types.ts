// apps/mobile/src/core/media/types.ts · shared shapes for the media pipeline (pick → process → hash → upload).
import type { MediaKind } from '@krishalaya/sdk-js';

export type { MediaKind };

/** Raw asset returned by the picker (camera/gallery), before compression. */
export interface PickedImage { uri: string; width: number; height: number; mimeType: string; fileName?: string }

/** Compressed/resized asset ready to upload — EXIF dropped by the re-encode. */
export interface ProcessedImage { uri: string; width: number; height: number; bytes: number; mimeType: string }

/** Result of an upload attempt. Online → mediaId set, queued=false. Offline/persisted → queued=true, mediaId
 * null (the create flow references it once the queue replays). `localUri` lets the UI show a pending thumbnail. */
export interface UploadOutcome { mediaId: string | null; queued: boolean; localUri: string }

/** Progress callback: 0..1. */
export type ProgressFn = (fraction: number) => void;
