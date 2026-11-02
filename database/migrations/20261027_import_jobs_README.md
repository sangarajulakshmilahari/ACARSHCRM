# Lead import jobs migration (REVIEW ONLY)

**Do not apply this script until explicitly approved.**
Do not run it against production as part of Phase 1 implementation.

| Item | Value |
|---|---|
| Script | [`20261027_import_jobs.sql`](20261027_import_jobs.sql) |
| Tables | `LeadImports`, `LeadImportRows` |
| Additive? | Yes — new tables only |
| Existing CRM tables | Unchanged |
| Raw file blobs | Not stored |

## Apply (after approval)

```bash
mysql -h "$MYSQL_HOST" -P "$MYSQL_PORT" -u "$MYSQL_USER" -p "$MYSQL_DATABASE" < database/migrations/20261027_import_jobs.sql
```

Rerun is safe (`CREATE TABLE IF NOT EXISTS`). MySQL cannot roll back DDL.

## Retention / cleanup

Parsed `SourceJson` contains contact fields. Recommended:

1. Keep completed jobs 30 days after `CompletedAt`.
2. Delete expired imports (`DELETE FROM LeadImports WHERE CompletedAt < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)`). Rows cascade.
3. Do not log `SourceJson`, emails, phones, or spreadsheet contents.

There is no in-app blob store for original `.xlsx/.xls/.csv` bytes. The file is hashed, parsed, discarded, and only normalized row JSON is persisted for restart-safe preview/confirm.

## Rollback (manual)

```sql
DROP TABLE IF EXISTS LeadImportRows;
DROP TABLE IF EXISTS LeadImports;
```

This does not undo leads/contacts created by a confirmed job.
