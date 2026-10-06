-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'AWAITING_PAYMENT';

-- AlterTable
ALTER TABLE "BusinessProfile" ADD COLUMN     "rejectionReason" TEXT;

-- AlterTable
ALTER TABLE "OrderEvent" ADD COLUMN     "internal" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "reference" TEXT;

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "respondedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN     "labelUrl" TEXT;
