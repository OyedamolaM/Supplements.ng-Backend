import prisma from "./prisma";

const connectDB = async (): Promise<void> => {
  try {
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
    console.log("PostgreSQL connected via Prisma");
  } catch (err: any) {
    console.error("PostgreSQL connection error:", err.message);
    process.exit(1);
  }
};

export default connectDB;
