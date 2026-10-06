import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { PresignUploadInput, PresignedUpload, StorageDriver } from './storage.driver';

/** Public route prefix (under the global `/api/v1`) that accepts PUTs and serves files. */
export const LOCAL_UPLOADS_ROUTE = 'uploads/local';

/** `folder/file` keys only: lowercase folder, safe file name. No traversal possible. */
export const LOCAL_KEY_PATTERN = /^[a-z0-9-]+\/[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

export class UploadTooLargeError extends Error {}

/**
 * Dev driver: "presigned" URLs point back at this server (`PUT /api/v1/uploads/local/<key>`),
 * signed with an HMAC over key, content type, size and expiry. Files are stored in `dir` and
 * served from the same path. The secret is per-process, so tickets die with a restart.
 */
export class LocalDiskStorageDriver implements StorageDriver {
  readonly name = 'local' as const;
  readonly dir: string;
  private readonly secret: Buffer;

  constructor(
    dir: string,
    private readonly baseUrl: string,
    secret?: Buffer,
  ) {
    this.dir = resolve(dir);
    this.secret = secret ?? randomBytes(32);
  }

  presignUpload(input: PresignUploadInput): PresignedUpload {
    const expires = Math.floor(input.expiresAt.getTime() / 1000);
    const sig = this.sign(input.key, input.contentType, input.size, expires);
    const query = new URLSearchParams({ expires: String(expires), size: String(input.size), sig });
    const publicUrl = `${this.baseUrl.replace(/\/+$/, '')}/api/v1/${LOCAL_UPLOADS_ROUTE}/${input.key}`;
    return {
      uploadUrl: `${publicUrl}?${query.toString()}`,
      headers: { 'Content-Type': input.contentType },
      publicUrl,
    };
  }

  /** Checks a PUT against its ticket. `now` in ms. */
  verify(
    key: string,
    contentType: string,
    size: number,
    expires: number,
    sig: string,
    now = Date.now(),
  ): boolean {
    if (!LOCAL_KEY_PATTERN.test(key) || expires * 1000 < now) return false;
    const expected = Buffer.from(this.sign(key, contentType, size, expires), 'hex');
    const actual = Buffer.from(sig, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  /** Absolute file path for a key, or null if the key is not a valid local key. */
  pathFor(key: string): string | null {
    if (!LOCAL_KEY_PATTERN.test(key)) return null;
    const path = resolve(this.dir, key);
    return path.startsWith(this.dir + sep) ? path : null;
  }

  /** Streams `body` to the key's file, failing (and leaving nothing behind) above `maxBytes`. */
  async write(key: string, body: Readable, maxBytes: number): Promise<number> {
    const path = this.pathFor(key);
    if (!path) throw new Error(`Invalid upload key: ${key}`);
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${randomBytes(6).toString('hex')}.part`;
    let written = 0;
    try {
      await pipeline(
        body,
        async function* limit(source: AsyncIterable<Buffer>) {
          for await (const chunk of source) {
            written += chunk.length;
            if (written > maxBytes)
              throw new UploadTooLargeError(`Upload exceeds ${maxBytes} bytes`);
            yield chunk;
          }
        },
        createWriteStream(tmp),
      );
      await rename(tmp, path);
      return written;
    } catch (error) {
      await rm(tmp, { force: true });
      throw error;
    }
  }

  private sign(key: string, contentType: string, size: number, expires: number): string {
    return createHmac('sha256', this.secret)
      .update(`${key}\n${contentType.toLowerCase()}\n${size}\n${expires}`)
      .digest('hex');
  }
}
