import "dotenv/config";
import { spawn } from "child_process";

type SmokeResult = {
  name: string;
  ok: boolean;
  detail?: any;
  error?: string;
};

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

    const raw = token.slice(2);
    const key = raw.split("=")[0];
    const inlineValue = raw.includes("=") ? raw.slice(raw.indexOf("=") + 1) : "";
    if (inlineValue) {
      map[key] = inlineValue;
      continue;
    }

    const next = args[i + 1];
    if (next && !next.startsWith("--")) {
      map[key] = next;
      i += 1;
    } else {
      map[key] = "true";
    }
  }

  if (positional.length) {
    if (!map.email && positional[0]) map.email = positional[0];
    if (!map.password && positional[1]) map.password = positional[1];
  }

  return map;
};

const sanitize = (value: string | null | undefined) => {
  if (value === undefined || value === null) return "";
  let next = String(value).trim();
  if (
    (next.startsWith('"') && next.endsWith('"')) ||
    (next.startsWith("'") && next.endsWith("'"))
  ) {
    next = next.slice(1, -1).trim();
  }
  return next;
};

const pick = (...values: Array<string | null | undefined>) => {
  for (const value of values) {
    const normalized = sanitize(value);
    if (normalized) return normalized;
  }
  return "";
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const request = async (
  baseUrl: string,
  method: string,
  path: string,
  token?: string,
  body?: any
) => {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const contentType = response.headers.get("content-type") || "";
  let data: any = null;
  if (contentType.includes("application/json")) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  return {
    ok: response.ok,
    status: response.status,
    contentType,
    data,
  };
};

const waitForServer = async (baseUrl: string) => {
  const timeoutMs = 30000;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return true;
    } catch {
      // keep polling until timeout
    }
    await sleep(500);
  }
  return false;
};

const check = async (
  results: SmokeResult[],
  name: string,
  fn: () => Promise<any>
) => {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
  } catch (error: any) {
    results.push({
      name,
      ok: false,
      error: error?.message || "Unknown error",
    });
  }
};

const main = async () => {
  const args = parseArgs();

  const adminEmail = pick(
    args.email,
    process.env.SMOKE_ADMIN_EMAIL,
    process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL
  ).toLowerCase();
  const adminPassword = pick(
    args.password,
    process.env.SMOKE_ADMIN_PASSWORD,
    process.env.BOOTSTRAP_SUPER_ADMIN_PASSWORD
  );
  const port = pick(args.port, process.env.SMOKE_PORT, process.env.PORT, "5000");
  const useRunning = pick(args["use-running"], process.env.SMOKE_USE_RUNNING_SERVER) === "true";

  if (!adminEmail || !adminPassword) {
    throw new Error(
      "Missing admin credentials. Pass --email and --password or set SMOKE_ADMIN_EMAIL and SMOKE_ADMIN_PASSWORD."
    );
  }

  const baseUrl = `http://127.0.0.1:${port}`;
  const results: SmokeResult[] = [];

  let server: any = null;
  if (!useRunning) {
    server = spawn("node", ["dist/server.js"], {
      cwd: process.cwd(),
      env: { ...process.env, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout.on("data", (chunk) => process.stdout.write(`[server] ${chunk}`));
    server.stderr.on("data", (chunk) => process.stderr.write(`[server-error] ${chunk}`));
  }

  try {
    const up = await waitForServer(baseUrl);
    if (!up) {
      throw new Error(`Server not reachable at ${baseUrl} within timeout`);
    }

    let adminToken = "";
    let customerToken = "";
    let orderId = "";
    let productId = "";

    await check(results, "health liveness", async () => {
      const res = await request(baseUrl, "GET", "/api/health");
      if (!res.ok) throw new Error(`Expected 200 got ${res.status}`);
      return { status: res.status };
    });

    await check(results, "health readiness", async () => {
      const res = await request(baseUrl, "GET", "/api/health/ready");
      if (!res.ok) throw new Error(`Expected 200 got ${res.status}`);
      return { status: res.status, payload: res.data };
    });

    await check(results, "admin login", async () => {
      const res = await request(baseUrl, "POST", "/api/auth/login", "", {
        email: adminEmail,
        password: adminPassword,
      });
      if (!res.ok) {
        throw new Error(`Expected 200 got ${res.status} ${JSON.stringify(res.data)}`);
      }
      adminToken = res.data?.accessToken || "";
      if (!adminToken) throw new Error("Admin access token missing");
      return { status: res.status, role: res.data?.role };
    });

    await check(results, "create product admin", async () => {
      const res = await request(
        baseUrl,
        "POST",
        "/api/admin/products",
        adminToken,
        {
          title: `Smoke Product ${Date.now()}`,
          description: "Smoke test product",
          price: 1500,
          sellingPrice: 1500,
          stock: 100,
          quantityAvailable: 100,
          category: "General",
        }
      );
      if (!res.ok) {
        throw new Error(`Expected 201 got ${res.status} ${JSON.stringify(res.data)}`);
      }
      productId = res.data?._id || res.data?.id;
      if (!productId) throw new Error("Product ID missing");
      return { status: res.status, productId };
    });

    const customerEmail = `smoke_${Date.now()}@example.com`;
    const customerPassword = "SmokePass123!";

    await check(results, "register customer", async () => {
      const res = await request(baseUrl, "POST", "/api/auth/register", "", {
        name: "Smoke Customer",
        email: customerEmail,
        password: customerPassword,
        phone: "08000000001",
      });
      if (!res.ok) throw new Error(`Expected 201 got ${res.status}`);
      return { status: res.status };
    });

    await check(results, "customer login", async () => {
      const res = await request(baseUrl, "POST", "/api/auth/login", "", {
        email: customerEmail,
        password: customerPassword,
      });
      if (!res.ok) throw new Error(`Expected 200 got ${res.status}`);
      customerToken = res.data?.accessToken || "";
      if (!customerToken) throw new Error("Customer access token missing");
      return { status: res.status, role: res.data?.role };
    });

    await check(results, "customer create order", async () => {
      const res = await request(baseUrl, "POST", "/api/orders", customerToken, {
        products: [{ product: productId, quantity: 2 }],
        shippingAddress: {
          fullName: "Smoke Customer",
          addressLine1: "1 Smoke Street",
          addressLine2: "",
          city: "Lagos",
          state: "Lagos",
          country: "Nigeria",
          postalCode: "100001",
          phone: "08000000001",
        },
        paymentMethod: "Cash on Delivery",
      });
      if (!res.ok) throw new Error(`Expected 201 got ${res.status}`);
      orderId = res.data?._id || res.data?.id;
      if (!orderId) throw new Error("Order ID missing");
      return { status: res.status, orderId };
    });

    await check(results, "admin list orders", async () => {
      const res = await request(baseUrl, "GET", "/api/admin/orders", adminToken);
      if (!res.ok) throw new Error(`Expected 200 got ${res.status}`);
      const hasOrder = Array.isArray(res.data)
        ? res.data.some((order: any) => (order._id || order.id) === orderId)
        : false;
      return {
        status: res.status,
        count: Array.isArray(res.data) ? res.data.length : 0,
        hasOrder,
      };
    });

    await check(results, "admin update order status", async () => {
      const res = await request(
        baseUrl,
        "PUT",
        `/api/admin/orders/${orderId}`,
        adminToken,
        { status: "Shipped" }
      );
      if (!res.ok) throw new Error(`Expected 200 got ${res.status}`);
      return { status: res.status, orderStatus: res.data?.orderStatus };
    });

    await check(results, "admin receipt", async () => {
      const res = await fetch(`${baseUrl}/api/admin/orders/${orderId}/receipt`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (!res.ok) throw new Error(`Expected 200 got ${res.status}`);
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/pdf")) {
        throw new Error(`Unexpected content type ${contentType}`);
      }
      return { status: res.status, contentType };
    });

    await check(results, "reports sales summary", async () => {
      const today = new Date().toISOString().slice(0, 10);
      const res = await request(
        baseUrl,
        "GET",
        `/api/reports/sales-summary?from=${today}&to=${today}&group=day`,
        adminToken
      );
      if (!res.ok) throw new Error(`Expected 200 got ${res.status}`);
      return { status: res.status, rows: Array.isArray(res.data) ? res.data.length : 0 };
    });
  } finally {
    if (server && !server.killed) {
      server.kill("SIGTERM");
    }
  }

  console.log(JSON.stringify(results, null, 2));
  const failed = results.filter((result) => !result.ok);
  if (failed.length) {
    process.exitCode = 1;
    return;
  }
};

main().catch((error: any) => {
  console.error("smoke run failed", error?.message || error);
  process.exit(1);
});
