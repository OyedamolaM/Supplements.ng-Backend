-- AlterTable
ALTER TABLE "User"
ADD COLUMN     "dateOfBirth" TIMESTAMP(3),
ADD COLUMN     "gender" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "bloodGroup" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "allergies" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "medications" TEXT NOT NULL DEFAULT '';
