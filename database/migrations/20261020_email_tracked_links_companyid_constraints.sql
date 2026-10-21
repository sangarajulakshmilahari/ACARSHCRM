-- REVIEW ONLY. Do not apply until:
--   1) 20261020_email_tracked_links_companyid.sql has been applied
--   2) orphan report returned 0 rows / tracked_links_null_company = 0
-- Aborts if any CompanyId is still NULL. Does not assign a default tenant.
-- Rerun-safe: checks IS NULL count, then NOT NULL + FK if missing.

-- After approval:
--   node scripts/phase2b_run_sql.js sql database/migrations/20261020_email_tracked_links_companyid_constraints.sql

DELIMITER $$

DROP PROCEDURE IF EXISTS acarsh_email_tracked_links_companyid_constraints $$
CREATE PROCEDURE acarsh_email_tracked_links_companyid_constraints()
BEGIN
  DECLARE nulls INT DEFAULT 0;

  IF NOT EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'email_tracked_links'
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'email_tracked_links does not exist; run companyid.sql first';
  END IF;

  SELECT COUNT(*) INTO nulls
  FROM email_tracked_links
  WHERE CompanyId IS NULL;

  IF nulls > 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Aborting: email_tracked_links still has NULL CompanyId';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'email_tracked_links'
      AND COLUMN_NAME = 'CompanyId'
      AND IS_NULLABLE = 'YES'
  ) THEN
    ALTER TABLE email_tracked_links
      MODIFY COLUMN CompanyId INT NOT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'email_tracked_links'
      AND CONSTRAINT_NAME = 'fk_email_tracked_links_company'
  ) THEN
    ALTER TABLE email_tracked_links
      ADD CONSTRAINT fk_email_tracked_links_company
      FOREIGN KEY (CompanyId) REFERENCES companies (CompanyId);
  END IF;
END $$

DELIMITER ;

CALL acarsh_email_tracked_links_companyid_constraints();
DROP PROCEDURE IF EXISTS acarsh_email_tracked_links_companyid_constraints;
