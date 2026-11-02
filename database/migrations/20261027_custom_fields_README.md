# Custom fields migration (REVIEW ONLY)

**Do not apply this script until explicitly approved.**
Do not run it against production as part of Phase 4 implementation.

| Item | Value |
|---|---|
| Script | [`20261027_custom_fields.sql`](20261027_custom_fields.sql) |
| Tables | `CustomFieldDefinitions`, `CustomFieldValues` |
| Additive? | Yes — new tables only |
| Existing CRM tables | Unchanged (`Leads`, `LeadContacts` are not altered) |
| Import mapping storage | Reuses `LeadImports.MappingJson` (mixed standard + custom specs) |

ACARSH had no custom-field system. This EAV design is tenant-scoped by `CompanyId`. Entity types are `lead` (company/lead) and `contact`. Values are polymorphic (`EntityType` + `EntityId`) so lead IDs and contact IDs cannot collide.

## Apply (after approval)

Apply the import-jobs migration first if those tables are missing:

```bash
mysql -h "$MYSQL_HOST" -P "$MYSQL_PORT" -u "$MYSQL_USER" -p "$MYSQL_DATABASE" < database/migrations/20261027_import_jobs.sql
mysql -h "$MYSQL_HOST" -P "$MYSQL_PORT" -u "$MYSQL_USER" -p "$MYSQL_DATABASE" < database/migrations/20261027_custom_fields.sql
```

Rerun is safe (`CREATE TABLE IF NOT EXISTS`). MySQL cannot roll back DDL.

Until this script is applied:

- Standard Smart Import still works.
- Mapping a column to a custom field returns HTTP 503.
- Lead Details hides custom-field sections when the tables are absent.

## Rollback (manual)

```sql
DROP TABLE IF EXISTS CustomFieldValues;
DROP TABLE IF EXISTS CustomFieldDefinitions;
```

This does not undo leads/contacts created by a confirmed import. Mapping JSON on existing `LeadImports` rows may still contain custom-field specs.
