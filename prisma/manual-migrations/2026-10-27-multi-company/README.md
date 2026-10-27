# Multi-company migration (2026-10-27)

Turns a single-company database into the multi-company schema without losing data. Every existing row
becomes company 1, so the existing company, its logins and all its records stay exactly as they are.
New visitors then create their own companies (ids 2, 3, …) through "Create your company".

This schema change can't be done with a plain `prisma db push`: the new `companyId` columns are required,
and the tables already have rows. It was rehearsed on a copy with the old schema and data: row counts were
identical afterwards, 0 rows ended up outside company 1, and `prisma migrate diff` against the final
schema was empty.

Run against the **direct** Neon URL (without `-pooler`). Each file is one transaction: it applies fully or not at all.

1. **Back up** (keep the file until the live site has been checked):
   `docker run --rm postgres:17 pg_dump "<direct url>" --no-owner -Fc > neon-before-multi-company.dump`
2. **Add the columns** (temporary default 1, per-company unique keys, company id sequence):
   `npx prisma db execute --url "<direct url>" --file prisma/manual-migrations/2026-10-27-multi-company/1-add-company-columns.sql`
   The old code still works after this step: it doesn't send `companyId`, and the default puts its rows in company 1.
3. **Deploy** the new code (push to `main`; Vercel builds it).
4. **Drop the temporary defaults**, so a row without a company is refused from now on:
   `npx prisma db execute --url "<direct url>" --file prisma/manual-migrations/2026-10-27-multi-company/2-drop-temporary-defaults.sql`
5. **Check**: `npx prisma migrate diff --from-url "<direct url>" --to-schema-datamodel prisma/schema.prisma --script`
   prints "This is an empty migration."

To undo before step 4, restore the backup with `pg_restore --clean --no-owner -d "<direct url>" neon-before-multi-company.dump`
and redeploy the previous commit.
