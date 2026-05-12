CREATE TABLE IF NOT EXISTS "public"."BusinessExpense" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'General',
    "description" TEXT NOT NULL DEFAULT '',
    "vendor" TEXT NOT NULL DEFAULT '',
    "paymentMethod" TEXT NOT NULL DEFAULT '',
    "reference" TEXT NOT NULL DEFAULT '',
    "amount" DOUBLE PRECISION NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'recorded',
    "branchId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessExpense_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BusinessExpense_date_idx" ON "public"."BusinessExpense"("date");
CREATE INDEX IF NOT EXISTS "BusinessExpense_category_date_idx" ON "public"."BusinessExpense"("category", "date");
CREATE INDEX IF NOT EXISTS "BusinessExpense_branchId_date_idx" ON "public"."BusinessExpense"("branchId", "date");
CREATE INDEX IF NOT EXISTS "BusinessExpense_status_date_idx" ON "public"."BusinessExpense"("status", "date");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BusinessExpense_branchId_fkey'
  ) THEN
    ALTER TABLE "public"."BusinessExpense"
    ADD CONSTRAINT "BusinessExpense_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "public"."Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BusinessExpense_createdById_fkey'
  ) THEN
    ALTER TABLE "public"."BusinessExpense"
    ADD CONSTRAINT "BusinessExpense_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
