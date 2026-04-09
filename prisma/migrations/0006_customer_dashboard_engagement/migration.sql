-- CreateEnum
CREATE TYPE "PrescriptionStatus" AS ENUM ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'FULFILLED');

-- CreateTable
CREATE TABLE "Prescription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orderId" TEXT,
    "title" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "attachmentUrl" TEXT NOT NULL DEFAULT '',
    "attachmentName" TEXT NOT NULL DEFAULT '',
    "status" "PrescriptionStatus" NOT NULL DEFAULT 'PENDING',
    "pharmacistNotes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Prescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerReminder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orderId" TEXT,
    "productId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "intervalDays" INTEGER NOT NULL DEFAULT 30,
    "nextDueDate" TIMESTAMP(3) NOT NULL,
    "lastOrderedAt" TIMESTAMP(3),
    "note" TEXT NOT NULL DEFAULT '',
    "isPaused" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Prescription_userId_createdAt_idx" ON "Prescription"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Prescription_orderId_idx" ON "Prescription"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerReminder_userId_productId_key" ON "CustomerReminder"("userId", "productId");

-- CreateIndex
CREATE INDEX "CustomerReminder_userId_nextDueDate_idx" ON "CustomerReminder"("userId", "nextDueDate");

-- CreateIndex
CREATE INDEX "CustomerReminder_orderId_idx" ON "CustomerReminder"("orderId");

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerReminder" ADD CONSTRAINT "CustomerReminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerReminder" ADD CONSTRAINT "CustomerReminder_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerReminder" ADD CONSTRAINT "CustomerReminder_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
