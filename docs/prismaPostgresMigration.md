# Prisma Postgres migration guide

This backend now runs on Prisma with PostgreSQL. MongoDB is kept only for legacy data migration and parity checks.

## 1) Prepare environment

Use `.env.example` as reference and set these values in `.env`:

- `MONGO_URI`
- `DATABASE_URL`
- `JWT_SECRET`
- `JWT_REFRESH_SECRET`
- `PAYSTACK_SECRET_KEY`
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

## 2) Create Postgres schema

Use either Prisma migrations or the generated SQL:

1. Prisma migration path:
   - `npm run prisma:migrate:dev`
2. SQL path:
   - Apply `prisma/migrations/0001_initial/migration.sql` to your Postgres database.

## 3) Migrate data from MongoDB to Postgres

Dry run to preview record counts:

```bash
npm run data:migrate:mongo:postgres -- --dry-run
```

Run actual migration without deleting existing Postgres rows:

```bash
npm run data:migrate:mongo:postgres
```

Run migration with reset:

```bash
npm run data:reset:migrate:mongo:postgres
```

## 4) Validate parity

```bash
npm run data:validate:mongo:postgres
```

The script compares MongoDB collection and nested subdocument counts against Postgres relational table counts.

## 5) Runtime cutover strategy

Phase based approach used for safe cutover:

1. Keep MongoDB as source of truth while testing migration scripts in non production.
2. Convert API modules to Prisma in batches with response shape parity.
3. Run parity validation after each migration batch.
4. Switch runtime bootstrap to PostgreSQL only after all runtime modules are converted.
5. Keep migration scripts available for backfill and verification.

## 6) Bootstrap fresh Postgres environments

For a brand new Postgres database with no imported Mongo data, set these `.env` values:

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
3. A super admin user (or promotes the provided user email to super admin).

## 7) Runtime smoke verification

After bootstrap and migration, run an API smoke check:

```bash
npm run verify:smoke:api -- --email "admin@example.com" --password "strong password"
```

Or set env values and run:

```bash
SMOKE_ADMIN_EMAIL=admin@example.com
SMOKE_ADMIN_PASSWORD=strong password
SMOKE_PORT=5000
npm run verify:smoke:api
```

For a full runtime verification pipeline:

```bash
npm run verify:runtime -- --email "admin@example.com" --password "strong password"
```
