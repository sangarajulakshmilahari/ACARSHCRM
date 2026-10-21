-- REVIEW ONLY. Do not apply until explicitly approved.
-- Local inspect: acarsh_db on localhost does NOT contain email_tracked_links.
-- Compatible with app/api/lib/email-tracking.ts ensureEmailTrackingSchema():
--   * missing table: CREATE with CompanyId NOT NULL (empty table; no silent tenant assignment)
--   * existing table without CompanyId: ADD nullable column + index, then backfill from emails
--   * existing table already with CompanyId: procedure no-ops; UPDATE only fills NULLs
-- Parent emails.CompanyId is the source of truth. Do not trust client CompanyId.
-- Do NOT run the constraints companion until orphan report is 0:
--   database/migrations/20261020_email_tracked_links_companyid_constraints.sql
--
-- Rerun / partial failure:
--   MySQL DDL commits implicitly. Rerun this file safely.
--   Procedure uses INFORMATION_SCHEMA guards.
--   Backfill UPDATE is WHERE CompanyId IS NULL (idempotent).
--   Orphans are reported, never assigned to a default company.
--
-- After approval, from repo root on this machine only:
--   node scripts/phase2b_run_sql.js sql database/migrations/20261020_email_tracked_links_companyid.sql
-- That helper refuses non-localhost and non-acarsh_db. Do not run the constraints file
-- in the same step.

DELIMITER $$

DROP PROCEDURE IF EXISTS acarsh_email_tracked_links_companyid $$
CREATE PROCEDURE acarsh_email_tracked_links_companyid()
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'email_tracked_links'
  ) THEN
    CREATE TABLE email_tracked_links (
      TrackedLinkId BIGINT NOT NULL AUTO_INCREMENT,
      EmailId BIGINT NOT NULL,
      CompanyId INT NOT NULL,
      UrlHash CHAR(64) NOT NULL,
      DestinationUrl VARCHAR(2000) NOT NULL,
      CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (TrackedLinkId),
      UNIQUE KEY uq_email_tracked_links_email_url (EmailId, UrlHash),
      KEY idx_email_tracked_links_emailid (EmailId),
      KEY idx_email_tracked_links_companyid (CompanyId)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'email_tracked_links'
  ) AND NOT EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'email_tracked_links'
      AND COLUMN_NAME = 'CompanyId'
  ) THEN
    ALTER TABLE email_tracked_links
      ADD COLUMN CompanyId INT NULL AFTER EmailId;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'email_tracked_links'
      AND COLUMN_NAME = 'CompanyId'
  ) AND NOT EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'email_tracked_links'
      AND INDEX_NAME = 'idx_email_tracked_links_companyid'
  ) THEN
    ALTER TABLE email_tracked_links
      ADD KEY idx_email_tracked_links_companyid (CompanyId);
  END IF;
END $$

DELIMITER ;

CALL acarsh_email_tracked_links_companyid();
DROP PROCEDURE IF EXISTS acarsh_email_tracked_links_companyid;

UPDATE email_tracked_links t
INNER JOIN emails e ON e.EmailId = t.EmailId
SET t.CompanyId = e.CompanyId
WHERE t.CompanyId IS NULL
  AND e.CompanyId IS NOT NULL;

-- Orphan report: no parent email, parent missing CompanyId, or still-null tracked CompanyId.
-- Do not backfill these to Adroitent or any default tenant.
SELECT
  t.TrackedLinkId,
  t.EmailId,
  t.CompanyId AS tracked_company_id,
  e.CompanyId AS email_company_id
FROM email_tracked_links t
LEFT JOIN emails e ON e.EmailId = t.EmailId
WHERE t.CompanyId IS NULL
   OR e.EmailId IS NULL
   OR e.CompanyId IS NULL;

SELECT
  COUNT(*) AS tracked_links_total,
  SUM(CASE WHEN CompanyId IS NULL THEN 1 ELSE 0 END) AS tracked_links_null_company
FROM email_tracked_links;
