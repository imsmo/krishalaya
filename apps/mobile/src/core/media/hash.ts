// apps/mobile/src/core/media/hash.ts · compute the SHA-256 + byte size of a local file. Reads the file as base64
// (expo-file-system), decodes to the EXACT raw bytes, and hashes them with our pure sha256 — so the digest we
// send to confirmUpload matches the bytes S3 stores (integrity, guide §4). Used for images post-compression
// (small files); large media would stream-hash, deferred until video upload lands.
import * as FileSystem from 'expo-file-system/legacy'; // MOB-SDK-1: SDK 54 made the File/Directory API the default export; the classic API (createUploadTask with progress, readAsStringAsync) lives here
import { base64ToBytes } from '../util/base64';
import { sha256Hex } from '../util/sha256';

export async function hashFile(uri: string): Promise<{ sha256: string; bytes: number }> {
  const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  const bytes = base64ToBytes(b64);
  return { sha256: sha256Hex(bytes), bytes: bytes.length };
}
