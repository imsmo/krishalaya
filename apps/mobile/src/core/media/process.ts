// apps/mobile/src/core/media/process.ts · downscale + compress an image before upload (guide §5 — rural data is
// costly; never upload a 12 MP original over 2G). Re-encoding via expo-image-manipulator also DROPS EXIF
// (incl. GPS) client-side, a privacy win on top of the server's post-scan strip (guide §4). Returns the new
// file uri + real byte size + dimensions.
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy'; // MOB-SDK-1: SDK 54 made the File/Directory API the default export; the classic API (createUploadTask with progress, readAsStringAsync) lives here
import type { PickedImage, ProcessedImage } from './types';

const MAX_DIMENSION = 1600; // longest edge; plenty for listing/KYC photos, small over 2G
const QUALITY = 0.7;        // JPEG quality

export async function processImage(picked: PickedImage, maxDimension = MAX_DIMENSION, quality = QUALITY): Promise<ProcessedImage> {
  const longest = Math.max(picked.width || 0, picked.height || 0);
  const actions: ImageManipulator.Action[] =
    longest > maxDimension
      ? [{ resize: picked.width >= picked.height ? { width: maxDimension } : { height: maxDimension } }]
      : [];
  const out = await ImageManipulator.manipulateAsync(picked.uri, actions, {
    compress: quality, format: ImageManipulator.SaveFormat.JPEG,
  });
  const info = await FileSystem.getInfoAsync(out.uri); // size is always reported for an existing file (the `size` option is gone)
  const bytes = info.exists && typeof info.size === 'number' ? info.size : 0;
  return { uri: out.uri, width: out.width, height: out.height, bytes, mimeType: 'image/jpeg' };
}
