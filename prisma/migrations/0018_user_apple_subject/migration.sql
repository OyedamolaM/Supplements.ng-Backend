-- Add Apple Sign-In subject field
ALTER TABLE "public"."User"
ADD COLUMN IF NOT EXISTS "appleSubject" TEXT;

-- Ensure uniqueness for Apple subject when present
CREATE UNIQUE INDEX IF NOT EXISTS "User_appleSubject_key"
ON "public"."User"("appleSubject");
