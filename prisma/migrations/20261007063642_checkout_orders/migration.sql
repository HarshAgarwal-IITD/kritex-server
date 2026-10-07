-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "cartId" TEXT,
ADD COLUMN     "idempotencyHash" TEXT;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "discount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "netTotal" INTEGER NOT NULL DEFAULT 0;

-- Existing order lines had no coupon split recorded: netTotal = lineTotal.
UPDATE "OrderItem" SET "netTotal" = "lineTotal" - "discount";

-- Human order numbers KTX-100001, KTX-100002, ... (race-free, no table lock).
CREATE SEQUENCE IF NOT EXISTS "order_number_seq" START WITH 100001;
