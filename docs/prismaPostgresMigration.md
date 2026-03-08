# Prisma Postgres migration guide

This backend currently runs on MongoDB and Mongoose. Prisma and PostgreSQL have been added as a full relational target schema and data migration path.

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

To avoid feature loss, cut over in phases:

1. Keep MongoDB as runtime source while running Postgres migration repeatedly in non production.
2. Convert one API module at a time to Prisma with response parity checks.
3. Run parity validation after each module cutover.
4. Enable Postgres in production only after all modules pass parity.
5. Keep rollback path to MongoDB until production stability is confirmed.
