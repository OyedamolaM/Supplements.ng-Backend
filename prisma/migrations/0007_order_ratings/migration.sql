-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "customerRating" INTEGER;
ALTER TABLE "Order" ADD COLUMN     "customerRatingNote" TEXT DEFAULT '';
ALTER TABLE "Order" ADD COLUMN     "customerRatedAt" TIMESTAMP(3);
