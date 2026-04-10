-- Add notification read tracking
CREATE TABLE IF NOT EXISTS "NotificationRead" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "activityLogId" TEXT,
  "computedKey" TEXT,
  "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationRead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "NotificationRead_userId_activityLogId_key"
  ON "NotificationRead"("userId", "activityLogId");

CREATE UNIQUE INDEX IF NOT EXISTS "NotificationRead_userId_computedKey_key"
  ON "NotificationRead"("userId", "computedKey");

CREATE INDEX IF NOT EXISTS "NotificationRead_userId_readAt_idx"
  ON "NotificationRead"("userId", "readAt");

ALTER TABLE "NotificationRead"
  ADD CONSTRAINT "NotificationRead_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationRead"
  ADD CONSTRAINT "NotificationRead_activityLogId_fkey"
  FOREIGN KEY ("activityLogId") REFERENCES "ActivityLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
