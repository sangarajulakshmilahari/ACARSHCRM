-- REVIEW ONLY. Do not execute without explicit approval.
-- Reverses 01-03. DDL cannot be rolled back transactionally; this file is
-- idempotent so a partial rollback can be rerun.
-- sowdetail is a VIEW and is not altered.
--
-- email_suppressions unique-key rollback:
-- Restores global UNIQUE(NormalizedEmail) only if no duplicate emails exist
-- across companies. If duplicates exist, the global unique is NOT recreated
-- and a warning row is selected instead.

DROP PROCEDURE IF EXISTS acarsh_mt_drop_fk;
DROP PROCEDURE IF EXISTS acarsh_mt_drop_index;
DROP PROCEDURE IF EXISTS acarsh_mt_drop_column;
DROP PROCEDURE IF EXISTS acarsh_mt_restore_suppression_unique;

DELIMITER $$

CREATE PROCEDURE acarsh_mt_drop_fk(IN p_table VARCHAR(64), IN p_constraint VARCHAR(64))
BEGIN
  IF EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table
      AND CONSTRAINT_NAME = p_constraint
      AND CONSTRAINT_TYPE = 'FOREIGN KEY'
  ) THEN
    SET @sql := CONCAT('ALTER TABLE `', p_table, '` DROP FOREIGN KEY `', p_constraint, '`');
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

CREATE PROCEDURE acarsh_mt_drop_index(IN p_table VARCHAR(64), IN p_index VARCHAR(64))
BEGIN
  IF EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table
      AND INDEX_NAME = p_index
  ) THEN
    SET @sql := CONCAT('ALTER TABLE `', p_table, '` DROP INDEX `', p_index, '`');
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

CREATE PROCEDURE acarsh_mt_drop_column(IN p_table VARCHAR(64), IN p_column VARCHAR(64))
BEGIN
  IF EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table
      AND COLUMN_NAME = p_column
  ) THEN
    SET @sql := CONCAT('ALTER TABLE `', p_table, '` DROP COLUMN `', p_column, '`');
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

CREATE PROCEDURE acarsh_mt_restore_suppression_unique()
BEGIN
  CALL acarsh_mt_drop_index('email_suppressions', 'uq_email_suppressions_company_email');

  SET @dupes := (
    SELECT COUNT(*) FROM (
      SELECT NormalizedEmail
      FROM email_suppressions
      GROUP BY NormalizedEmail
      HAVING COUNT(*) > 1
    ) d
  );

  IF @dupes = 0 THEN
    IF NOT EXISTS (
      SELECT 1
      FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'email_suppressions'
        AND INDEX_NAME = 'uq_email_suppressions_normalized_email'
    ) THEN
      ALTER TABLE email_suppressions
        ADD UNIQUE KEY uq_email_suppressions_normalized_email (NormalizedEmail);
    END IF;
  ELSE
    SELECT CONCAT(
      'Skipped restoring uq_email_suppressions_normalized_email; duplicate emails=',
      @dupes
    ) AS rollback_warning;
  END IF;
END$$

DELIMITER ;

CALL acarsh_mt_drop_fk('sowpositionresource', 'fk_sowpositionresource_company');
CALL acarsh_mt_drop_fk('sowposition', 'fk_sowposition_company');
CALL acarsh_mt_drop_fk('aichatmessageattachments', 'fk_aichatmessageattachments_company');
CALL acarsh_mt_drop_fk('aichatmessages', 'fk_aichatmessages_company');
CALL acarsh_mt_drop_fk('email_sequence_contacts', 'fk_email_sequence_contacts_company');
CALL acarsh_mt_drop_fk('email_sequence_steps', 'fk_email_sequence_steps_company');
CALL acarsh_mt_drop_fk('email_attachments', 'fk_email_attachments_company');
CALL acarsh_mt_drop_fk('email_events', 'fk_email_events_company');
CALL acarsh_mt_drop_fk('emails', 'fk_emails_company');
CALL acarsh_mt_drop_fk('projectresources', 'fk_projectresources_company');
CALL acarsh_mt_drop_fk('projectcontacts', 'fk_projectcontacts_company');
CALL acarsh_mt_drop_fk('opportunity_categories', 'fk_opportunity_categories_company');
CALL acarsh_mt_drop_fk('opportunitycontacts', 'fk_opportunitycontacts_company');
CALL acarsh_mt_drop_fk('opportunities', 'fk_opportunities_company');
CALL acarsh_mt_drop_fk('customer_leads', 'fk_customer_leads_company');
CALL acarsh_mt_drop_fk('leadscores', 'fk_leadscores_company');
CALL acarsh_mt_drop_fk('leadprojects', 'fk_leadprojects_company');
CALL acarsh_mt_drop_fk('leadtags', 'fk_leadtags_company');
CALL acarsh_mt_drop_fk('leadservices', 'fk_leadservices_company');
CALL acarsh_mt_drop_fk('leadcategories', 'fk_leadcategories_company');
CALL acarsh_mt_drop_fk('leadmeetings', 'fk_leadmeetings_company');
CALL acarsh_mt_drop_fk('leadnotes', 'fk_leadnotes_company');
CALL acarsh_mt_drop_fk('leadreminders', 'fk_leadreminders_company');
CALL acarsh_mt_drop_fk('leadactivities', 'fk_leadactivities_company');
CALL acarsh_mt_drop_fk('leadcontacts', 'fk_leadcontacts_company');
CALL acarsh_mt_drop_fk('aaram_project_map', 'fk_aaram_project_map_company');
CALL acarsh_mt_drop_fk('aaram_account_map', 'fk_aaram_account_map_company');
CALL acarsh_mt_drop_fk('user_lead_access', 'fk_user_lead_access_company');
CALL acarsh_mt_drop_fk('sowmaster', 'fk_sowmaster_company');
CALL acarsh_mt_drop_fk('aichatconversations', 'fk_aichatconversations_company');
CALL acarsh_mt_drop_fk('email_suppressions', 'fk_email_suppressions_company');
CALL acarsh_mt_drop_fk('email_templates', 'fk_email_templates_company');
CALL acarsh_mt_drop_fk('email_sequences', 'fk_email_sequences_company');
CALL acarsh_mt_drop_fk('projects', 'fk_projects_company');
CALL acarsh_mt_drop_fk('leads', 'fk_leads_company');

CALL acarsh_mt_restore_suppression_unique();

CALL acarsh_mt_drop_column('sowpositionresource', 'CompanyId');
CALL acarsh_mt_drop_column('sowposition', 'CompanyId');
CALL acarsh_mt_drop_column('aichatmessageattachments', 'CompanyId');
CALL acarsh_mt_drop_column('aichatmessages', 'CompanyId');
CALL acarsh_mt_drop_column('email_sequence_contacts', 'CompanyId');
CALL acarsh_mt_drop_column('email_sequence_steps', 'CompanyId');
CALL acarsh_mt_drop_column('email_attachments', 'CompanyId');
CALL acarsh_mt_drop_column('email_events', 'CompanyId');
CALL acarsh_mt_drop_column('emails', 'CompanyId');
CALL acarsh_mt_drop_column('projectresources', 'CompanyId');
CALL acarsh_mt_drop_column('projectcontacts', 'CompanyId');
CALL acarsh_mt_drop_column('opportunity_categories', 'CompanyId');
CALL acarsh_mt_drop_column('opportunitycontacts', 'CompanyId');
CALL acarsh_mt_drop_column('opportunities', 'CompanyId');
CALL acarsh_mt_drop_column('customer_leads', 'CompanyId');
CALL acarsh_mt_drop_column('leadscores', 'CompanyId');
CALL acarsh_mt_drop_column('leadprojects', 'CompanyId');
CALL acarsh_mt_drop_column('leadtags', 'CompanyId');
CALL acarsh_mt_drop_column('leadservices', 'CompanyId');
CALL acarsh_mt_drop_column('leadcategories', 'CompanyId');
CALL acarsh_mt_drop_column('leadmeetings', 'CompanyId');
CALL acarsh_mt_drop_column('leadnotes', 'CompanyId');
CALL acarsh_mt_drop_column('leadreminders', 'CompanyId');
CALL acarsh_mt_drop_column('leadactivities', 'CompanyId');
CALL acarsh_mt_drop_column('leadcontacts', 'CompanyId');
CALL acarsh_mt_drop_column('aaram_project_map', 'CompanyId');
CALL acarsh_mt_drop_column('aaram_account_map', 'CompanyId');
CALL acarsh_mt_drop_column('user_lead_access', 'CompanyId');
CALL acarsh_mt_drop_column('sowmaster', 'CompanyId');
CALL acarsh_mt_drop_column('aichatconversations', 'CompanyId');
CALL acarsh_mt_drop_column('email_suppressions', 'CompanyId');
CALL acarsh_mt_drop_column('email_templates', 'CompanyId');
CALL acarsh_mt_drop_column('email_sequences', 'CompanyId');
CALL acarsh_mt_drop_column('projects', 'CompanyId');
CALL acarsh_mt_drop_column('leads', 'CompanyId');

DROP TABLE IF EXISTS CompanyUsers;
DROP TABLE IF EXISTS Companies;

DROP PROCEDURE IF EXISTS acarsh_mt_drop_fk;
DROP PROCEDURE IF EXISTS acarsh_mt_drop_index;
DROP PROCEDURE IF EXISTS acarsh_mt_drop_column;
DROP PROCEDURE IF EXISTS acarsh_mt_restore_suppression_unique;
