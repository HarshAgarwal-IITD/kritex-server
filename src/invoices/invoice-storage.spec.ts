import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalInvoiceStorage, newInvoiceKey, R2InvoiceStorage } from './invoice-storage';

describe('LocalInvoiceStorage', () => {
  let dir: string;
  beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'kritex-inv-'))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('stores privately and serves only valid, unexpired signed links', async () => {
    const store = new LocalInvoiceStorage(dir, Buffer.alloc(32, 7), 'http://api.test');
    const key = newInvoiceKey();
    await store.put(key, Buffer.from('%PDF-1'));
    const url = new URL(store.signedUrl(key, new Date(Date.now() + 60_000)));
    expect(url.origin + url.pathname).toBe(`http://api.test/api/v1/invoices/files/${key.slice(9)}`);
    const file = url.pathname.split('/').pop()!;
    const expires = Number(url.searchParams.get('expires'));
    const sig = url.searchParams.get('sig')!;

    expect((await store.read(file, expires, sig))?.toString()).toBe('%PDF-1');
    expect(await store.read(file, expires + 1, sig)).toBeNull();
    expect(await store.read(file, expires, sig, (expires + 1) * 1000)).toBeNull();
    expect(await store.read(file, expires, 'ab'.repeat(32))).toBeNull();
    expect(await store.read('../x.pdf', expires, sig)).toBeNull();
    expect(store.pathFor('invoices/../../etc.pdf')).toBeNull();
    await expect(store.put('products/x.pdf', Buffer.from(''))).rejects.toThrow(/Invalid/);
  });
});

describe('R2InvoiceStorage', () => {
  it('PUTs with a presigned URL and presigns short-lived GETs', async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response('', { status: 200 }));
    const now = new Date('2026-10-09T10:00:00Z');
    const store = new R2InvoiceStorage(
      { accountId: 'acc', accessKeyId: 'AK', secretAccessKey: 'SK', bucket: 'kritex' },
      fetchMock as typeof fetch,
      () => now,
    );
    await store.put('invoices/abc.pdf', Buffer.from('pdf'));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(
      /^https:\/\/acc\.r2\.cloudflarestorage\.com\/kritex\/invoices\/abc\.pdf\?X-Amz-/,
    );
    expect(init.method).toBe('PUT');

    const get = new URL(store.signedUrl('invoices/abc.pdf', new Date(now.getTime() + 900_000)));
    expect(get.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(get.searchParams.get('X-Amz-SignedHeaders')).toBe('host');

    fetchMock.mockResolvedValueOnce(new Response('', { status: 403 }));
    await expect(store.put('invoices/abc.pdf', Buffer.from('pdf'))).rejects.toThrow(/403/);
  });
});
