# Multi-company migration (REVIEW ONLY)

**Do not apply these scripts until explicitly approved.**
None of this SQL has been executed against `acarsh_db`.

Inspected via [`config/db.ts`](../../config/db.ts) and [`.env.local`](../../.env.local) (`MYSQL_*` keys only; secrets not recorded).

| Item | Value |
|---|---|
| Database | `acarsh_db` / MySQL 8.0.45 |
| Objects | 53 (51 base tables + 2 views) |
| `Companies` / `CompanyUsers` | absent |
| `users` | 14; RoleId 1=7, 2=6, 3=1 |
| `leads` | 773; **OwnerId IS NULL = 16** (preserve) |
| `sowdetail` | **VIEW** — not altered |
| `email_tracked_links` | absent — skipped |

## Recommended execution order (after approval)

1. [`20261019_multi_company_01_schema.sql`](20261019_multi_company_01_schema.sql) — tables + nullable `CompanyId`
2. [`20261019_multi_company_02_backfill.sql`](20261019_multi_company_02_backfill.sql) — Adroitent seed + stamp
3. [`20261019_multi_company_04_verify.sql`](20261019_multi_company_04_verify.sql) — expect 0 nulls / mismatches; `leads_owner_null` = 16
4. [`20261019_multi_company_03_constraints.sql`](20261019_multi_company_03_constraints.sql) — NOT NULL, FKs, tenant unique
5. [`20261019_multi_company_04_verify.sql`](20261019_multi_company_04_verify.sql) again
6. [`20261019_multi_company_99_rollback.sql`](20261019_multi_company_99_rollback.sql) only to abort

Run 01/03/99 with the `mysql` CLI or Workbench (`DELIMITER` is required).

## Transaction / partial-failure rules

MySQL **cannot roll back DDL**. `CREATE TABLE`, `ALTER TABLE`, `DROP`, `CREATE PROCEDURE` cause an implicit commit.

| Script | Transactional? | Rerun? |
|---|---|---|
| 01 schema | No (DDL) | Yes — column/index guards |
| 02 backfill | Yes (DML `START TRANSACTION`) | Yes — `WHERE CompanyId IS NULL` / `NOT EXISTS` |
| 03 constraints | No (DDL) | Yes — null precheck + IF EXISTS guards |
| 04 verify | Read-only | Yes |
| 99 rollback | No (DDL) | Yes — drop-if-exists helpers |

If 01 or 03 stops mid-file, rerun the same file. Do not start 03 until 04 shows zero `*_null_company` rows.

If 02 errors before `COMMIT`, InnoDB rolls the DML back (client must not autocommit each statement). Then rerun 02.

## Table classification

**Shared (no `CompanyId`):** `roles`, `users`, lookup catalogs (`accounttypes`, `leadstatuses`, `contactroles`, `contacttype`, `category`, `subcategory`, `services`, `engagement_models`, `probability`, `opportunities_status`, `tags`), views (`customers`, `lead_export_view`, `sowdetail`), backup `projects_20260616`, job state `leadscorebackfillstate`.

**Tenant-owned:** `leads`, `projects`, email stack, AI conversations/messages/attachments, `sowmaster` / `sowposition` / `sowpositionresource`, `user_lead_access`, `aaram_*`, and lead/opportunity/project children listed in 01.

`users` stay global; tenancy is `CompanyUsers`. `users.RoleId` is copied into membership and kept as login fallback.

## Backfill behavior

- All current rows go to Adroitent.
- Children inherit parent `CompanyId` via `LEFT JOIN`.
- Orphans and nullable parents (`projects.CustomerId`, `aaram_*`) use `COALESCE(..., @adroitent_company_id)`.
- `leads.OwnerId` is never updated.

## email_suppressions unique key

Live unique: `uq_email_suppressions_normalized_email (NormalizedEmail)` (1 row today).

Script 03 replaces it with `uq_email_suppressions_company_email (CompanyId, NormalizedEmail)`.

Rollback restores the global unique **only if** no duplicate `NormalizedEmail` values exist. Otherwise it leaves the table without that unique and selects a warning.

App note: [`ensureEmailSuppressionSchema()`](../../app/api/lib/email-suppressions.ts:180) still defines the old unique on `CREATE TABLE IF NOT EXISTS` (no-op once the table exists). [`isEmailSuppressed()`](../../app/api/lib/email-suppressions.ts:202) / [`upsertEmailSuppression()`](../../app/api/lib/email-suppressions.ts:219) still look up by `NormalizedEmail` only. After true multi-tenant data exists, those queries must be scoped by `CompanyId`.

## Recovery

- Failed 01/03/99: rerun that file.
- Failed 02: rerun 02 (transaction rollback or `WHERE CompanyId IS NULL`).
- Abort after 01–03: run 99, then 04 should show no `CompanyId` columns.
- Do not restore 99 after new companies have duplicate suppression emails without cleaning duplicates first.
