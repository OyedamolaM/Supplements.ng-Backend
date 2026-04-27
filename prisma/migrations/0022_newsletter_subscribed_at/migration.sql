ALTER TABLE "public"."NewsletterSubscriber"
ADD COLUMN IF NOT EXISTS "subscribedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "public"."NewsletterSubscriber"
SET "subscribedAt" = COALESCE("createdAt", "subscribedAt", CURRENT_TIMESTAMP);
