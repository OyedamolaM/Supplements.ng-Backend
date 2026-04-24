CREATE TABLE IF NOT EXISTS "public"."NewsletterSubscriber" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "firstOrderDiscountPercent" DOUBLE PRECISION NOT NULL DEFAULT 5,
  "firstOrderDiscountUsedAt" TIMESTAMP(3),
  "firstOrderDiscountUsedOrderId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NewsletterSubscriber_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "NewsletterSubscriber_email_key"
ON "public"."NewsletterSubscriber"("email");

CREATE INDEX IF NOT EXISTS "NewsletterSubscriber_isActive_email_idx"
ON "public"."NewsletterSubscriber"("isActive", "email");
