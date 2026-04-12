import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

const databaseUrl =
  process.env.NODE_ENV === "production"
    ? process.env.DATABASE_URL_PROD
    : process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    process.env.NODE_ENV === "production"
      ? "DATABASE_URL_PROD is not set"
      : "DATABASE_URL is not set"
  );
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({
      connectionString: databaseUrl,
    }),
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "warn", "error"]
        : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
