import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { presignUrl } from '../catalog/storage/sigv4';
import type { AppConfigService } from '../config/app-config.service';

/** Injection token for the invoice PDF store. */
export const INVOICE_STORAGE = Symbol('INVOICE_STORAGE');

/** How long an invoice link stays valid. */
export const INVOICE_LINK_TTL_SECONDS = 15 * 60;

/** Public route (under /api/v1) that serves local-driver invoices to signed links. */
export const LOCAL_INVOICE_ROUTE = 'invoices/files';

/** Invoice keys: `invoices/<32 hex>.pdf` (unguessable; the number is not in the key). */
export const INVOICE_KEY_PATTERN = /^invoices\/[a-f0-9]{32}\.pdf$/;

export const newInvoiceKey = () => `invoices/${randomBytes(16).toString('hex')}.pdf`;

/**
 * Private object storage for invoice PDFs, following STORAGE_DRIVER (the catalog StorageDriver
 * only presigns browser uploads; invoices are written by the server and must not be public).
 */
export interface InvoiceStorage {
  readonly name: 'local' | 'r2';
  put(key: string, body: Buffer): Promise<void>;
  /** Short-lived URL the browser can GET. */
  signedUrl(key: string, expiresAt: Date): string;
}

/**
 * Dev: files under `<UPLOADS_DIR>/.private/` (outside what the local upload route serves), handed
 * out as `/api/v1/invoices/files/<key>?expires=&sig=` (HMAC over key + expiry).
 */
export class LocalInvoiceStorage implements InvoiceStorage {
  readonly name = 'local' as const;
  readonly dir: string;

  constructor(
    dir: string,
    private readonly secret: Buffer,
    private readonly baseUrl = '',
  ) {
    this.dir = resolve(dir);
  }

  pathFor(key: string): string | null {
    if (!INVOICE_KEY_PATTERN.test(key)) return null;
    const path = resolve(this.dir, key);
    return path.startsWith(this.dir + sep) ? path : null;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const path = this.pathFor(key);
    if (!path) throw new Error(`Invalid invoice key: ${key}`);
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${randomBytes(4).toString('hex')}.part`;
    await writeFile(tmp, body);
    await rename(tmp, path);
  }

  signedUrl(key: string, expiresAt: Date): string {
    const expires = Math.floor(expiresAt.getTime() / 1000);
    const file = key.slice('invoices/'.length);
    const query = new URLSearchParams({ expires: String(expires), sig: this.sign(key, expires) });
    return `${this.baseUrl.replace(/\/+$/, '')}/api/v1/${LOCAL_INVOICE_ROUTE}/${file}?${query.toString()}`;
  }

  /** The file for a signed link, or null when the link is invalid/expired or the file is gone. */
  async read(file: string, expires: number, sig: string, now = Date.now()): Promise<Buffer | null> {
    const key = `invoices/${file}`;
    const path = this.pathFor(key);
    if (!path || !Number.isFinite(expires) || expires * 1000 < now) return null;
    const expected = Buffer.from(this.sign(key, expires), 'hex');
    const actual = Buffer.from(sig, 'hex');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    try {
      return await readFile(path);
    } catch {
      return null;
    }
  }

  private sign(key: string, expires: number): string {
    return createHmac('sha256', this.secret).update(`${key}\n${expires}`).digest('hex');
  }
}

export interface R2InvoiceConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

/** R2 (S3 API): server-side PUT and presigned GET with SigV4, no AWS SDK. */
export class R2InvoiceStorage implements InvoiceStorage {
  readonly name = 'r2' as const;

  constructor(
    private readonly config: R2InvoiceConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private presign(method: 'GET' | 'PUT', key: string, expiresIn: number, headers = {}) {
    return presignUrl({
      method,
      host: `${this.config.accountId}.r2.cloudflarestorage.com`,
      path: `/${this.config.bucket}/${key}`,
      region: 'auto',
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      date: this.now(),
      expiresIn,
      headers,
    });
  }

  async put(key: string, body: Buffer): Promise<void> {
    const headers = { 'Content-Type': 'application/pdf' };
    const res = await this.fetchImpl(this.presign('PUT', key, 300, headers), {
      method: 'PUT',
      headers,
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`R2 PUT ${key} failed: ${res.status}`);
  }

  signedUrl(key: string, expiresAt: Date): string {
    const expiresIn = Math.max(1, Math.round((expiresAt.getTime() - this.now().getTime()) / 1000));
    return this.presign('GET', key, expiresIn);
  }
}

export function createInvoiceStorage(config: AppConfigService): InvoiceStorage {
  if ((config.get('STORAGE_DRIVER') ?? 'local') === 'r2') {
    const accountId = config.get('R2_ACCOUNT_ID');
    const accessKeyId = config.get('R2_ACCESS_KEY_ID');
    const secretAccessKey = config.get('R2_SECRET_ACCESS_KEY');
    const bucket = config.get('R2_BUCKET');
    if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
      throw new Error('STORAGE_DRIVER=r2 needs every R2_* variable');
    }
    return new R2InvoiceStorage({ accountId, accessKeyId, secretAccessKey, bucket });
  }
  const uploads =
    config.get('UPLOADS_DIR') ??
    (config.get('NODE_ENV') === 'test' ? join(tmpdir(), 'kritex-test-uploads') : 'uploads');
  const secret = createHmac('sha256', config.get('BETTER_AUTH_SECRET') ?? 'kritex-dev-secret')
    .update('invoice-links')
    .digest();
  return new LocalInvoiceStorage(
    join(uploads, '.private'),
    secret,
    config.get('UPLOADS_BASE_URL') ?? '',
  );
}
