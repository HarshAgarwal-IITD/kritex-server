import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { LocalDiskStorageDriver, UploadTooLargeError } from './local-disk.driver';

describe('LocalDiskStorageDriver', () => {
  let dir: string;
  let driver: LocalDiskStorageDriver;
  const key = 'products/abc-shirt.jpg';
  const expiresAt = new Date('2026-10-07T10:15:00Z');

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kritex-uploads-'));
    driver = new LocalDiskStorageDriver(dir, '', Buffer.alloc(32, 1));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const ticket = () =>
    new URL(
      driver.presignUpload({ key, contentType: 'image/jpeg', size: 4, expiresAt }).uploadUrl,
      'http://localhost',
    );

  it('issues same-origin URLs under /api/v1/uploads/local', () => {
    const result = driver.presignUpload({ key, contentType: 'image/jpeg', size: 4, expiresAt });
    expect(result.publicUrl).toBe('/api/v1/uploads/local/products/abc-shirt.jpg');
    expect(result.uploadUrl.startsWith(`${result.publicUrl}?`)).toBe(true);
    expect(result.headers).toEqual({ 'Content-Type': 'image/jpeg' });

    const withBase = new LocalDiskStorageDriver(dir, 'http://localhost:4000/');
    expect(
      withBase.presignUpload({ key, contentType: 'image/png', size: 1, expiresAt }).publicUrl,
    ).toBe('http://localhost:4000/api/v1/uploads/local/products/abc-shirt.jpg');
  });

  it('verify accepts the exact ticket and rejects any change or expiry', () => {
    const url = ticket();
    const expires = Number(url.searchParams.get('expires'));
    const sig = url.searchParams.get('sig')!;
    const now = expiresAt.getTime() - 1000;

    expect(driver.verify(key, 'image/jpeg', 4, expires, sig, now)).toBe(true);
    expect(driver.verify(key, 'image/png', 4, expires, sig, now)).toBe(false);
    expect(driver.verify(key, 'image/jpeg', 5, expires, sig, now)).toBe(false);
    expect(driver.verify('products/other.jpg', 'image/jpeg', 4, expires, sig, now)).toBe(false);
    expect(driver.verify(key, 'image/jpeg', 4, expires + 1, sig, now)).toBe(false);
    expect(driver.verify(key, 'image/jpeg', 4, expires, sig, expiresAt.getTime() + 1000)).toBe(
      false,
    );
    expect(driver.verify(key, 'image/jpeg', 4, expires, 'zz', now)).toBe(false);
  });

  it('pathFor rejects traversal and malformed keys', () => {
    expect(driver.pathFor(key)).toBe(join(dir, key));
    expect(driver.pathFor('../etc/passwd')).toBeNull();
    expect(driver.pathFor('products/../../x')).toBeNull();
    expect(driver.pathFor('products/.hidden')).toBeNull();
    expect(driver.pathFor('a/b/c.jpg')).toBeNull();
  });

  it('write stores the bytes, and leaves nothing behind when the size limit is exceeded', async () => {
    await expect(
      driver.write(key, Readable.from([Buffer.from('ab'), Buffer.from('cd')]), 4),
    ).resolves.toBe(4);
    expect(readFileSync(join(dir, key), 'utf8')).toBe('abcd');

    await expect(
      driver.write('products/big.jpg', Readable.from([Buffer.from('abcde')]), 4),
    ).rejects.toBeInstanceOf(UploadTooLargeError);
    expect(readdirSync(join(dir, 'products'))).toEqual(['abc-shirt.jpg']);
  });
});
