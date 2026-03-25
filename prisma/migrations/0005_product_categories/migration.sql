ALTER TABLE "Product" ADD COLUMN "categories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "Product" SET "categories" = ARRAY["category"];
