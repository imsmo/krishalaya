// apps/mobile/src/core/media/mime.ts · PURE helpers mapping mime types to the API's MediaKind + an allowlist
// guard. Kept separate from the expo-dependent code so it can be unit-tested offline (see __tests__).
import type { MediaKind } from '@krishalaya/sdk-js';

const IMAGE = /^image\/(jpeg|png|webp|heic|heif)$/i;
const VIDEO = /^video\/(mp4|quicktime|3gpp|webm)$/i;
const AUDIO = /^audio\/(mpeg|mp4|aac|ogg|wav|m4a|x-m4a)$/i;
const DOCUMENT = /^application\/(pdf)$/i;

/** Resolve a mime type to the API MediaKind, or null if we don't allow uploading it from the app. */
export function mediaKindForMime(mime: string): MediaKind | null {
  if (IMAGE.test(mime)) return 'image';
  if (VIDEO.test(mime)) return 'video';
  if (AUDIO.test(mime)) return 'audio';
  if (DOCUMENT.test(mime)) return 'document';
  return null;
}

export function isUploadableMime(mime: string): boolean {
  return mediaKindForMime(mime) !== null;
}
