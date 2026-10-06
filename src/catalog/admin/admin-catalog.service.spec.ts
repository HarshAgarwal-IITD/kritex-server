import type { PrismaService } from '../../prisma/prisma.service';
import type { StorageDriver } from '../storage/storage.driver';
import { AdminCatalogService } from './admin-catalog.service';

describe('AdminCatalogService', () => {
  const tx = {
    $queryRaw: jest.fn(),
    inventoryMovement: { create: jest.fn() },
    variant: { update: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
    category: { findUnique: jest.fn() },
    product: { findFirst: jest.fn() },
  };
  const storage: StorageDriver = {
    name: 'local',
    presignUpload: jest.fn(({ key }: { key: string }) => ({
      uploadUrl: `/put/${key}`,
      headers: { 'Content-Type': 'image/png' },
      publicUrl: `/get/${key}`,
    })),
  };
  const service = new AdminCatalogService(prisma as unknown as PrismaService, storage);

  beforeEach(() => jest.clearAllMocks());

  describe('adjustStock', () => {
    const variantRow = {
      id: 'v1',
      productId: 'p1',
      sku: 'KTX-A',
      title: 'Default',
      options: {},
      price: null,
      stock: 7,
      reserved: 2,
      isActive: true,
      product: { basePrice: 1000 },
    };

    it('locks the row, writes the movement and the new stock in one transaction', async () => {
      tx.$queryRaw.mockResolvedValue([{ stock: 5, reserved: 2 }]);
      tx.variant.update.mockResolvedValue(variantRow);

      const result = await service.adjustStock('v1', { delta: 2, reason: 'RESTOCK' }, 'admin1');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.inventoryMovement.create).toHaveBeenCalledWith({
        data: { variantId: 'v1', delta: 2, reason: 'RESTOCK', actorId: 'admin1', note: null },
      });
      expect(tx.variant.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'v1' }, data: { stock: 7 } }),
      );
      expect(result).toMatchObject({ stock: 7, reserved: 2, available: 5, effectivePrice: 1000 });
    });

    it('refuses to drop stock below reserved → 409 INSUFFICIENT_STOCK, nothing written', async () => {
      tx.$queryRaw.mockResolvedValue([{ stock: 5, reserved: 2 }]);
      await expect(
        service.adjustStock('v1', { delta: -4, reason: 'ADJUST' }),
      ).rejects.toMatchObject({
        code: 'INSUFFICIENT_STOCK',
        details: { stock: 5, reserved: 2, delta: -4 },
      });
      expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
      expect(tx.variant.update).not.toHaveBeenCalled();
    });

    it('404 NOT_FOUND for an unknown variant', async () => {
      tx.$queryRaw.mockResolvedValue([]);
      await expect(
        service.adjustStock('nope', { delta: 1, reason: 'RESTOCK' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('createUpload', () => {
    it('builds a namespaced, sanitised key and returns the driver ticket', async () => {
      const ticket = await service.createUpload({
        purpose: 'PRODUCT_IMAGE',
        filename: 'Combat Shirt (Olive) FINAL.PNG',
        contentType: 'image/png',
        size: 1234,
      });
      expect(ticket.key).toMatch(/^products\/[0-9a-f-]{36}-combat-shirt-olive-final\.png$/);
      expect(ticket).toMatchObject({
        method: 'PUT',
        uploadUrl: `/put/${ticket.key}`,
        publicUrl: `/get/${ticket.key}`,
        headers: { 'Content-Type': 'image/png' },
      });
      expect(new Date(ticket.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('spec sheets may be PDFs; images may not', async () => {
      const sheet = await service.createUpload({
        purpose: 'SPEC_SHEET',
        filename: 'sheet.pdf',
        contentType: 'application/pdf',
        size: 10,
      });
      expect(sheet.key).toMatch(/^spec-sheets\/.+-sheet\.pdf$/);

      await expect(
        service.createUpload({
          purpose: 'CATEGORY_IMAGE',
          filename: 'x.pdf',
          contentType: 'application/pdf',
          size: 10,
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });
  });

  it('createProduct rejects duplicate option names / tier quantities before touching the DB', async () => {
    await expect(
      service.createProduct({
        slug: 'x',
        name: 'X',
        categoryId: 'c1',
        saleChannel: 'RETAIL',
        status: 'DRAFT',
        specs: [],
        images: [],
        options: [
          { name: 'Size', values: ['M', 'M'] },
          { name: 'size', values: ['L'] },
        ],
        specSheets: [],
        priceTiers: [
          { minQty: 10, unitPrice: 1 },
          { minQty: 10, unitPrice: 2 },
        ],
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [
        expect.objectContaining({ path: 'options.0.values' }),
        expect.objectContaining({ path: 'options.1.name' }),
        expect.objectContaining({ path: 'priceTiers.1.minQty' }),
      ],
    });
    expect(prisma.category.findUnique).not.toHaveBeenCalled();
  });
});
