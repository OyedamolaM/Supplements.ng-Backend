import "dotenv/config";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, UserRole } from "@prisma/client";

const parseArgs = () => {
  const map: Record<string, string> = {};
  const positional: string[] = [];
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }

    const rawKey = token.slice(2);
    const key = rawKey.split("=")[0];
    const inlineValue = rawKey.includes("=")
      ? rawKey.slice(rawKey.indexOf("=") + 1)
      : "";

    if (inlineValue) {
      map[key] = inlineValue;
    } else {
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        map[key] = next;
        i += 1;
      } else {
        map[key] = "true";
      }
    }
  }

  if (positional.length) {
    if (!map.name && positional[0]) map.name = positional[0];
    if (!map.email && positional[1]) map.email = positional[1];
    if (!map.password && positional[2]) map.password = positional[2];
    if (!map.phone && positional[3]) map.phone = positional[3];
    if (!map.tax && positional[4]) map.tax = positional[4];
  }

  return map;
};

const toNumber = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const pick = (...values: Array<string | undefined | null>) => {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    let normalized = String(value).trim();
    if (
      (normalized.startsWith('"') && normalized.endsWith('"')) ||
      (normalized.startsWith("'") && normalized.endsWith("'"))
    ) {
      normalized = normalized.slice(1, -1).trim();
    }
    if (normalized) return normalized;
  }
  return "";
};

const main = async () => {
  const args = parseArgs();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const adminName = pick(
    args.name,
    process.env.BOOTSTRAP_SUPER_ADMIN_NAME,
    "Super Admin"
  );
  const adminEmail = pick(
    args.email,
    process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL
  ).toLowerCase();
  const adminPassword = pick(
    args.password,
    process.env.BOOTSTRAP_SUPER_ADMIN_PASSWORD
  );
  const adminPhone = pick(
    args.phone,
    process.env.BOOTSTRAP_SUPER_ADMIN_PHONE
  );
  const defaultTaxRate = toNumber(
    pick(args.tax, process.env.BOOTSTRAP_DEFAULT_TAX_RATE),
    7.5
  );

  if (!adminEmail || !adminPassword) {
    throw new Error(
      "Super admin credentials are required. Set BOOTSTRAP_SUPER_ADMIN_EMAIL and BOOTSTRAP_SUPER_ADMIN_PASSWORD or run with --email and --password"
    );
  }

  const adapter = new PrismaPg({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter });

  try {
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;

    let onlineBranch = await prisma.branch.findFirst({
      where: { isOnline: true },
    });
    if (!onlineBranch) {
      onlineBranch = await prisma.branch.create({
        data: {
          id: randomUUID(),
          name: "Online",
          address: "Online Store",
          phone: "N/A",
          region: "",
          isOnline: true,
        },
      });
      console.log("created online branch", onlineBranch.id);
    } else {
      console.log("online branch exists", onlineBranch.id);
    }

    let defaultTax = await prisma.taxRate.findFirst({
      where: { isDefault: true },
      orderBy: { effectiveFrom: "desc" },
    });
    if (!defaultTax) {
      defaultTax = await prisma.taxRate.create({
        data: {
          id: randomUUID(),
          name: "VAT",
          rate: defaultTaxRate,
          effectiveFrom: new Date(),
          isDefault: true,
        },
      });
      console.log("created default tax rate", defaultTax.id, defaultTax.rate);
    } else {
      console.log("default tax rate exists", defaultTax.id, defaultTax.rate);
    }

    const existing = await prisma.user.findUnique({
      where: { email: adminEmail },
      select: { id: true, role: true },
    });

    if (existing) {
      if (existing.role !== UserRole.SUPER_ADMIN) {
        await prisma.user.update({
          where: { id: existing.id },
          data: {
            role: UserRole.SUPER_ADMIN,
            name: adminName,
            phone: adminPhone,
          },
        });
        console.log("promoted existing user to super admin", existing.id);
      } else {
        console.log("super admin already exists", existing.id);
      }
      return;
    }

    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        name: adminName,
        email: adminEmail,
        phone: adminPhone,
        password: hashedPassword,
        role: UserRole.SUPER_ADMIN,
        branchId: null,
        region: "",
      },
      select: { id: true, email: true, role: true },
    });
    console.log("created super admin", user.id, user.email, user.role);
  } finally {
    await prisma.$disconnect();
  }
};

main().catch((error) => {
  console.error("bootstrap failed", error.message);
  process.exit(1);
});
