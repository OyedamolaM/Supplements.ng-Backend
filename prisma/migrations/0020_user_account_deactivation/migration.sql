ALTER TABLE "public"."User"
  ADD COLUMN IF NOT EXISTS "deactivatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "accountDeletionRequestedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "accountDeletionScheduledFor" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "accountPurgedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "User_accountPurgedAt_accountDeletionScheduledFor_idx"
ON "public"."User"("accountPurgedAt", "accountDeletionScheduledFor");
