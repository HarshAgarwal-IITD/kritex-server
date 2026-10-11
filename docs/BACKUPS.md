# Database backups and restore

Production data (catalog, customers, orders, invoices, payments) lives in Neon Postgres 18.
There are two layers of protection.

| Layer | What | Kept | Use it for |
|---|---|---|---|
| Neon history | Neon's point-in-time restore (console → Branches → Restore) | Short window on the free plan (hours) | A mistake you notice right away |
| Daily dump | `.github/workflows/db-backup.yml`: `pg_dump` at 03:00 IST → private R2 bucket | 30 daily + 12 monthly | Anything older, or Neon itself being unavailable |

## Daily dump

- **Where:** `kritex-media/db-backups/daily/kritex-<UTC time>.dump`. The first dump of each month is also
  copied to `db-backups/monthly/`. The bucket is private (no public domain). The dumps hold customer
  personal data, so never make this bucket public or share a dump.
- **Format:** `pg_dump --format=custom --no-owner --no-privileges`, about 110 KB today.
- **Checks:** the job fails if the dump lists fewer than 25 tables with data. GitHub emails the repo owner
  when a scheduled run fails.
- **Manual run:** GitHub → kritex-server → Actions → "DB backup" → Run workflow.

One-time setup, in GitHub → kritex-server → Settings → Secrets and variables → Actions → New repository secret:

| Secret | Value |
|---|---|
| `BACKUP_DATABASE_URL` | Neon **direct** connection string (Neon → Connect → turn "Connection pooling" off; the host has no `-pooler`) |
| `R2_ACCOUNT_ID` | same as on Render |
| `R2_ACCESS_KEY_ID` | same as on Render |
| `R2_SECRET_ACCESS_KEY` | same as on Render |

## Restore

Restore into a **new** database first, check it, and only then point the API at it. Never restore over
the live database.

1. **Get a dump.** Cloudflare → R2 → `kritex-media` → `db-backups/daily/` → download the newest file
   (or the last one before the problem).
2. **Make an empty database.** Neon console → Branches → New branch with *no data* (or a new project),
   then copy its direct connection string as `$TARGET`.
3. **Restore** (needs Postgres 18 client tools; `brew install postgresql@18` or the `postgres:18-alpine` image):
   ```bash
   pg_restore --no-owner --no-privileges --exit-on-error -d "$TARGET" kritex-<time>.dump
   ```
4. **Check it.** Compare row counts with the dump's expectations (or with production if it is still up):
   ```bash
   psql "$TARGET" -c 'select count(*) from "Order"' -c 'select max("createdAt") from "Order"' \
     -c 'select last_value from order_number_seq'
   ```
   The order and quote number sequences are in the dump, so new orders continue from the right number.
5. **Switch.** Set `DATABASE_URL` on Render to the new database's **pooled** connection string and redeploy.
   Then place a test order and open the admin dashboard.
6. Anything paid in Razorpay after the dump time will be missing. Reconcile those orders from the
   Razorpay dashboard (payments list) and the order emails.

## Drill log

| Date | Dump | Restore into | Result |
|---|---|---|---|
| 2026-10-11 | Production, 110 KB, 10 s | Empty `postgres:18-alpine` | 0.3 s. All 30 tables' row counts match production, `order_number_seq` and `quote_number_seq` match, `pg_trgm` present. |

Repeat the drill every 3 months, and after any big schema change, using the newest R2 dump.
