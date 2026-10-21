-- REVIEW ONLY. Do not execute without explicit approval.
-- Step 3: NOT NULL, tenant unique key, company FKs.
-- DDL cannot be rolled back transactionally. This file is idempotent;
-- rerun after a partial failure.
-- Run 04_verify first and confirm zero NULL CompanyId rows.
-- sowdetail is a VIEW and is not altered.

DROP PROCEDURE IF EXISTS acarsh_mt_assert;
DROP PROCEDURE IF EXISTS acarsh_mt_not_null_company;
DROP PROCEDURE IF EXISTS acarsh_mt_add_company_fk;
DROP PROCEDURE IF EXISTS acarsh_mt_swap_suppression_unique;

DELIMITER $$

CREATE PROCEDURE acarsh_mt_assert(IN p_ok INT, IN p_msg VARCHAR(255))
BEGIN
  IF p_ok IS NULL OR p_ok = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = p_msg;
  END IF;
END$$

CREATE PROCEDURE acarsh_mt_not_null_company(IN p_table VARCHAR(64))
BEGIN
  IF EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table
      AND COLUMN_NAME = 'CompanyId'
      AND IS_NULLABLE = 'YES'
  ) THEN
    SET @sql := CONCAT('ALTER TABLE `', p_table, '` MODIFY CompanyId INT NOT NULL');
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

CREATE PROCEDURE acarsh_mt_add_company_fk(
  IN p_table VARCHAR(64),
  IN p_constraint VARCHAR(64)
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table
      AND CONSTRAINT_NAME = p_constraint
      AND CONSTRAINT_TYPE = 'FOREIGN KEY'
  ) THEN
    SET @sql := CONCAT(
      'ALTER TABLE `', p_table,
      '` ADD CONSTRAINT `', p_constraint,
      '` FOREIGN KEY (CompanyId) REFERENCES Companies (CompanyId)'
    );
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

CREATE PROCEDURE acarsh_mt_swap_suppression_unique()
BEGIN
  IF EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'email_suppressions'
      AND INDEX_NAME = 'uq_email_suppressions_normalized_email'
  ) THEN
    ALTER TABLE email_suppressions DROP INDEX uq_email_suppressions_normalized_email;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'email_suppressions'
      AND INDEX_NAME = 'uq_email_suppressions_company_email'
  ) THEN
    ALTER TABLE email_suppressions
      ADD UNIQUE KEY uq_email_suppressions_company_email (CompanyId, NormalizedEmail);
  END IF;
END$$

DELIMITER ;

SET @null_company_rows := (
  SELECT SUM(cnt) FROM (
    SELECT COUNT(*) cnt FROM leads WHERE CompanyId IS NULL
    UNION ALL SELECT COUNT(*) FROM projects WHERE CompanyId IS NULL
    UNION ALL SELECT COUNT(*) FROM email_sequences WHERE CompanyId IS NULL
    UNION ALL SELECT COUNT(*) FROM email_templates WHERE CompanyId IS NULL
    UNION ALL SELECT COUNT(*) FROM email_suppressions WHERE CompanyId IS NULL
    UNION ALL SELECT COUNT(*) FROM aichatconversations WHERE CompanyId IS NULL
    UNION ALL SELECT COUNT(*) FROM sowmaster WHERE CompanyId IS NULL
    UNION ALL SELECT COUNT(*) FROM user_lead_access WHERE CompanyId IS NULL
    UNION ALL SELECT COUNT(*) FROM aaram_account_map WHERE CompanyId IS NULL
    UNION ALL SELECT COUNT(*) FROM aaram_project_map WHERE CompanyId IS NULL
    UNION ALL SELECT COUNT(*) FROM leadcontacts WHERE CompanyId IS NULL
    UNION ALL SELECT COUNT(*) FROM leadactivities WHERE CompanyId IS NULL
    UNION ALL SELECT COUNT(*) FROM leadreminders WHERE CompanyId IS NULL
    UNION ALL SELECT COUNT(*) FROM leadnotes WHERE CompanyId IS NULL
    UNION ALL SELECT COUNT(*) FROM leadmeetings WHERE CompanyId IS NULL
    UNION ALL SELECT COUNT(*) FROM leadcategories WHERE CompanyId IS NULL
    UNION ALL SELECT COUNT(*) FROM leadservices WHERE CompanyId IS NULL
    UNION ALL SELECT COUNT(*) FROM leadtags WHERE CompanyId IS NULL
    UNION ALL SELECT COUNT(*) FROM leadprojects WHERE CompanyId IS NULL
    UNION ALL SELECT COUNT(*) FROM leadscores WHERE CompanyId IS NULL
    UNION ALL SELECT COUNT(*) FROM customer_leads WHERE CompanyId IS NULL
    UNION ALL SELECT COUNT(*) FROM opportunities WHERE CompanyId IS NULL
    UNION ALL SELECT COUNT(*) FROM opportunitycontacts WHERE CompanyId IS NULL
    UNION ALL SELECT COUNT(*) FROM opportunity_categories WHERE CompanyId IS NULL
    UNION ALL SELECT COUNT(*) FROM projectcontacts WHERE CompanyId IS NULL
    UNION ALL SELECT COUNT(*) FROM projectresources WHERE CompanyId IS NULL
    UNION ALL SELECT COUNT(*) FROM emails WHERE CompanyId IS NULL
    UNION ALL SELECT COUNT(*) FROM email_events WHERE CompanyId IS NULL
    UNION ALL SELECT COUNT(*) FROM email_attachments WHERE CompanyId IS NULL
    UNION ALL SELECT COUNT(*) FROM email_sequence_steps WHERE CompanyId IS NULL
    UNION ALL SELECT COUNT(*) FROM email_sequence_contacts WHERE CompanyId IS NULL
    UNION ALL SELECT COUNT(*) FROM aichatmessages WHERE CompanyId IS NULL
    UNION ALL SELECT COUNT(*) FROM aichatmessageattachments WHERE CompanyId IS NULL
    UNION ALL SELECT COUNT(*) FROM sowposition WHERE CompanyId IS NULL
    UNION ALL SELECT COUNT(*) FROM sowpositionresource WHERE CompanyId IS NULL
  ) t
);

CALL acarsh_mt_assert(
  IF(@null_company_rows = 0, 1, 0),
  'NULL CompanyId remains; rerun 02_backfill and 04_verify before 03'
);

CALL acarsh_mt_not_null_company('leads');
CALL acarsh_mt_not_null_company('projects');
CALL acarsh_mt_not_null_company('email_sequences');
CALL acarsh_mt_not_null_company('email_templates');
CALL acarsh_mt_not_null_company('email_suppressions');
CALL acarsh_mt_not_null_company('aichatconversations');
CALL acarsh_mt_not_null_company('sowmaster');
CALL acarsh_mt_not_null_company('user_lead_access');
CALL acarsh_mt_not_null_company('aaram_account_map');
CALL acarsh_mt_not_null_company('aaram_project_map');
CALL acarsh_mt_not_null_company('leadcontacts');
CALL acarsh_mt_not_null_company('leadactivities');
CALL acarsh_mt_not_null_company('leadreminders');
CALL acarsh_mt_not_null_company('leadnotes');
CALL acarsh_mt_not_null_company('leadmeetings');
CALL acarsh_mt_not_null_company('leadcategories');
CALL acarsh_mt_not_null_company('leadservices');
CALL acarsh_mt_not_null_company('leadtags');
CALL acarsh_mt_not_null_company('leadprojects');
CALL acarsh_mt_not_null_company('leadscores');
CALL acarsh_mt_not_null_company('customer_leads');
CALL acarsh_mt_not_null_company('opportunities');
CALL acarsh_mt_not_null_company('opportunitycontacts');
CALL acarsh_mt_not_null_company('opportunity_categories');
CALL acarsh_mt_not_null_company('projectcontacts');
CALL acarsh_mt_not_null_company('projectresources');
CALL acarsh_mt_not_null_company('emails');
CALL acarsh_mt_not_null_company('email_events');
CALL acarsh_mt_not_null_company('email_attachments');
CALL acarsh_mt_not_null_company('email_sequence_steps');
CALL acarsh_mt_not_null_company('email_sequence_contacts');
CALL acarsh_mt_not_null_company('aichatmessages');
CALL acarsh_mt_not_null_company('aichatmessageattachments');
CALL acarsh_mt_not_null_company('sowposition');
CALL acarsh_mt_not_null_company('sowpositionresource');

CALL acarsh_mt_swap_suppression_unique();

CALL acarsh_mt_add_company_fk('leads', 'fk_leads_company');
CALL acarsh_mt_add_company_fk('projects', 'fk_projects_company');
CALL acarsh_mt_add_company_fk('email_sequences', 'fk_email_sequences_company');
CALL acarsh_mt_add_company_fk('email_templates', 'fk_email_templates_company');
CALL acarsh_mt_add_company_fk('email_suppressions', 'fk_email_suppressions_company');
CALL acarsh_mt_add_company_fk('aichatconversations', 'fk_aichatconversations_company');
CALL acarsh_mt_add_company_fk('sowmaster', 'fk_sowmaster_company');
CALL acarsh_mt_add_company_fk('user_lead_access', 'fk_user_lead_access_company');
CALL acarsh_mt_add_company_fk('aaram_account_map', 'fk_aaram_account_map_company');
CALL acarsh_mt_add_company_fk('aaram_project_map', 'fk_aaram_project_map_company');
CALL acarsh_mt_add_company_fk('leadcontacts', 'fk_leadcontacts_company');
CALL acarsh_mt_add_company_fk('leadactivities', 'fk_leadactivities_company');
CALL acarsh_mt_add_company_fk('leadreminders', 'fk_leadreminders_company');
CALL acarsh_mt_add_company_fk('leadnotes', 'fk_leadnotes_company');
CALL acarsh_mt_add_company_fk('leadmeetings', 'fk_leadmeetings_company');
CALL acarsh_mt_add_company_fk('leadcategories', 'fk_leadcategories_company');
CALL acarsh_mt_add_company_fk('leadservices', 'fk_leadservices_company');
CALL acarsh_mt_add_company_fk('leadtags', 'fk_leadtags_company');
CALL acarsh_mt_add_company_fk('leadprojects', 'fk_leadprojects_company');
CALL acarsh_mt_add_company_fk('leadscores', 'fk_leadscores_company');
CALL acarsh_mt_add_company_fk('customer_leads', 'fk_customer_leads_company');
CALL acarsh_mt_add_company_fk('opportunities', 'fk_opportunities_company');
CALL acarsh_mt_add_company_fk('opportunitycontacts', 'fk_opportunitycontacts_company');
CALL acarsh_mt_add_company_fk('opportunity_categories', 'fk_opportunity_categories_company');
CALL acarsh_mt_add_company_fk('projectcontacts', 'fk_projectcontacts_company');
CALL acarsh_mt_add_company_fk('projectresources', 'fk_projectresources_company');
CALL acarsh_mt_add_company_fk('emails', 'fk_emails_company');
CALL acarsh_mt_add_company_fk('email_events', 'fk_email_events_company');
CALL acarsh_mt_add_company_fk('email_attachments', 'fk_email_attachments_company');
CALL acarsh_mt_add_company_fk('email_sequence_steps', 'fk_email_sequence_steps_company');
CALL acarsh_mt_add_company_fk('email_sequence_contacts', 'fk_email_sequence_contacts_company');
CALL acarsh_mt_add_company_fk('aichatmessages', 'fk_aichatmessages_company');
CALL acarsh_mt_add_company_fk('aichatmessageattachments', 'fk_aichatmessageattachments_company');
CALL acarsh_mt_add_company_fk('sowposition', 'fk_sowposition_company');
CALL acarsh_mt_add_company_fk('sowpositionresource', 'fk_sowpositionresource_company');

DROP PROCEDURE IF EXISTS acarsh_mt_assert;
DROP PROCEDURE IF EXISTS acarsh_mt_not_null_company;
DROP PROCEDURE IF EXISTS acarsh_mt_add_company_fk;
DROP PROCEDURE IF EXISTS acarsh_mt_swap_suppression_unique;
