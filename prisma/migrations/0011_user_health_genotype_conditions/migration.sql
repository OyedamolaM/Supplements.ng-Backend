-- AlterTable
ALTER TABLE "User"
ADD COLUMN     "genotype" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "conditions" TEXT NOT NULL DEFAULT '';
