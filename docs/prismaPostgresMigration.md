# Prisma Postgres runtime guide

This backend now runs only on Prisma with PostgreSQL.

## 1) Prepare environment

Use `.env.example` as reference and set these values in `.env`:

- `DATABASE_URL`
- `JWT_SECRET`
- `JWT_REFRESH_SECRET`
- `PAYSTACK_SECRET_KEY`
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`
- `CLIENT_URL`
- `CLIENT_URL_ADMIN`

## 2) Create or update the schema

Apply the checked-in Prisma migration:

```bash
npm run prisma:migrate:deploy
```

For local development, you can use:

```bash
npm run prisma:migrate:dev
```

Generate the Prisma client:

```bash
npm run prisma:generate
```

## 3) Bootstrap a fresh database

For a brand new Postgres database, set these `.env` values:

- `BOOTSTRAP_SUPER_ADMIN_NAME`
- `BOOTSTRAP_SUPER_ADMIN_EMAIL`
- `BOOTSTRAP_SUPER_ADMIN_PASSWORD`
- `BOOTSTRAP_SUPER_ADMIN_PHONE`
- `BOOTSTRAP_DEFAULT_TAX_RATE`

Then run:

```bash
npm run data:bootstrap:postgres
```

Or pass values directly:

```bash
npm run data:bootstrap:postgres -- --name "Super Admin" --email "admin@example.com" --password "strong password" --phone "08000000000" --tax "7.5"
```

This creates:

1. An online branch if one does not exist.
2. A default VAT tax rate if one does not exist.
3. A super admin user or promotes the provided email to super admin.

## 4) Verify runtime

Run a backend build:

```bash
npm run build
```

Run the API smoke check:

```bash
npm run verify:smoke:api -- --email "admin@example.com" --password "strong password"
```

Or rely on your bootstrap admin env values:

```bash
BOOTSTRAP_SUPER_ADMIN_EMAIL=admin@example.com
BOOTSTRAP_SUPER_ADMIN_PASSWORD=strong password
npm run verify:smoke:api
```

For a full runtime verification pipeline:

```bash
npm run verify:runtime -- --email "admin@example.com" --password "strong password"
```
