-- REVIEW ONLY. Do not execute without explicit approval.
-- Target: acarsh_db / MySQL 8.0.45
-- Step 1: tenant core + nullable CompanyId columns/indexes.
--
-- MySQL DDL (CREATE/ALTER/DROP) causes an implicit commit and CANNOT be
-- rolled back with ROLLBACK. If this file stops halfway, rerun it: every
-- statement is idempotent via INFORMATION_SCHEMA guards.
--
-- Requires mysql CLI or Workbench (DELIMITER is used).
-- Does not change leads.OwnerId.
-- sowdetail is a VIEW in live schema; it is intentionally not altered.

DROP PROCEDURE IF EXISTS acarsh_mt_add_company_id;
DROP PROCEDURE IF EXISTS acarsh_mt_add_index;

DELIMITER $$

CREATE PROCEDURE acarsh_mt_add_company_id(
  IN p_table VARCHAR(64),
  IN p_after VARCHAR(64)
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table
      AND COLUMN_NAME = 'CompanyId'
  ) THEN
    IF p_after IS NULL OR p_after = '' THEN
      SET @sql := CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN CompanyId INT NULL');
    ELSE
      SET @sql := CONCAT(
        'ALTER TABLE `', p_table, '` ADD COLUMN CompanyId INT NULL AFTER `', p_after, '`'
      );
    END IF;
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

CREATE PROCEDURE acarsh_mt_add_index(
  IN p_table VARCHAR(64),
  IN p_index VARCHAR(64),
  IN p_cols VARCHAR(128)
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table
      AND INDEX_NAME = p_index
  ) THEN
    SET @sql := CONCAT(
      'ALTER TABLE `', p_table, '` ADD KEY `', p_index, '` (', p_cols, ')'
    );
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

DELIMITER ;

CREATE TABLE IF NOT EXISTS Companies (
  CompanyId INT NOT NULL AUTO_INCREMENT,
  CompanyCode VARCHAR(64) NOT NULL,
  CompanyName VARCHAR(255) NOT NULL,
  IsActive TINYINT(1) NOT NULL DEFAULT 1,
  CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (CompanyId),
  UNIQUE KEY uq_companies_code (CompanyCode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS CompanyUsers (
  CompanyUserId INT NOT NULL AUTO_INCREMENT,
  CompanyId INT NOT NULL,
  UserId INT NOT NULL,
  RoleId INT NOT NULL,
  IsDefault TINYINT(1) NOT NULL DEFAULT 0,
  IsActive TINYINT(1) NOT NULL DEFAULT 1,
  CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (CompanyUserId),
  UNIQUE KEY uq_companyusers_company_user (CompanyId, UserId),
  KEY idx_companyusers_user (UserId),
  KEY idx_companyusers_company_role (CompanyId, RoleId),
  KEY idx_companyusers_company_active (CompanyId, IsActive),
  CONSTRAINT fk_companyusers_company FOREIGN KEY (CompanyId) REFERENCES Companies (CompanyId),
  CONSTRAINT fk_companyusers_user FOREIGN KEY (UserId) REFERENCES users (UserId),
  CONSTRAINT fk_companyusers_role FOREIGN KEY (RoleId) REFERENCES roles (RoleId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Roots
CALL acarsh_mt_add_company_id('leads', 'OwnerId');
CALL acarsh_mt_add_index('leads', 'idx_leads_company', 'CompanyId');
CALL acarsh_mt_add_index('leads', 'idx_leads_company_owner', 'CompanyId, OwnerId');

CALL acarsh_mt_add_company_id('projects', 'CustomerId');
CALL acarsh_mt_add_index('projects', 'idx_projects_company', 'CompanyId');

CALL acarsh_mt_add_company_id('email_sequences', 'CreatedBy');
CALL acarsh_mt_add_index('email_sequences', 'idx_email_sequences_company', 'CompanyId');

CALL acarsh_mt_add_company_id('email_templates', 'CreatedBy');
CALL acarsh_mt_add_index('email_templates', 'idx_email_templates_company', 'CompanyId');

CALL acarsh_mt_add_company_id('email_suppressions', 'SuppressionId');
CALL acarsh_mt_add_index('email_suppressions', 'idx_email_suppressions_company', 'CompanyId');

CALL acarsh_mt_add_company_id('aichatconversations', 'RoleId');
CALL acarsh_mt_add_index('aichatconversations', 'idx_aichatconversations_company', 'CompanyId');

CALL acarsh_mt_add_company_id('sowmaster', 'SOWId');
CALL acarsh_mt_add_index('sowmaster', 'idx_sowmaster_company', 'CompanyId');

CALL acarsh_mt_add_company_id('user_lead_access', 'id');
CALL acarsh_mt_add_index('user_lead_access', 'idx_user_lead_access_company', 'CompanyId');

CALL acarsh_mt_add_company_id('aaram_account_map', '');
CALL acarsh_mt_add_index('aaram_account_map', 'idx_aaram_account_map_company', 'CompanyId');

CALL acarsh_mt_add_company_id('aaram_project_map', '');
CALL acarsh_mt_add_index('aaram_project_map', 'idx_aaram_project_map_company', 'CompanyId');

-- Lead children
CALL acarsh_mt_add_company_id('leadcontacts', 'LeadId');
CALL acarsh_mt_add_index('leadcontacts', 'idx_leadcontacts_company', 'CompanyId');

CALL acarsh_mt_add_company_id('leadactivities', 'LeadId');
CALL acarsh_mt_add_index('leadactivities', 'idx_leadactivities_company', 'CompanyId');

CALL acarsh_mt_add_company_id('leadreminders', 'LeadId');
CALL acarsh_mt_add_index('leadreminders', 'idx_leadreminders_company', 'CompanyId');

CALL acarsh_mt_add_company_id('leadnotes', 'LeadId');
CALL acarsh_mt_add_index('leadnotes', 'idx_leadnotes_company', 'CompanyId');

CALL acarsh_mt_add_company_id('leadmeetings', 'LeadId');
CALL acarsh_mt_add_index('leadmeetings', 'idx_leadmeetings_company', 'CompanyId');

CALL acarsh_mt_add_company_id('leadcategories', 'LeadId');
CALL acarsh_mt_add_index('leadcategories', 'idx_leadcategories_company', 'CompanyId');

CALL acarsh_mt_add_company_id('leadservices', 'LeadId');
CALL acarsh_mt_add_index('leadservices', 'idx_leadservices_company', 'CompanyId');

CALL acarsh_mt_add_company_id('leadtags', 'LeadId');
CALL acarsh_mt_add_index('leadtags', 'idx_leadtags_company', 'CompanyId');

CALL acarsh_mt_add_company_id('leadprojects', 'LeadId');
CALL acarsh_mt_add_index('leadprojects', 'idx_leadprojects_company', 'CompanyId');

CALL acarsh_mt_add_company_id('leadscores', '');
CALL acarsh_mt_add_index('leadscores', 'idx_leadscores_company', 'CompanyId');

CALL acarsh_mt_add_company_id('customer_leads', 'LeadId');
CALL acarsh_mt_add_index('customer_leads', 'idx_customer_leads_company', 'CompanyId');

-- Opportunity / project children
CALL acarsh_mt_add_company_id('opportunities', 'LeadId');
CALL acarsh_mt_add_index('opportunities', 'idx_opportunities_company', 'CompanyId');

CALL acarsh_mt_add_company_id('opportunitycontacts', 'OpportunityId');
CALL acarsh_mt_add_index('opportunitycontacts', 'idx_opportunitycontacts_company', 'CompanyId');

CALL acarsh_mt_add_company_id('opportunity_categories', 'OpportunityId');
CALL acarsh_mt_add_index('opportunity_categories', 'idx_opportunity_categories_company', 'CompanyId');

CALL acarsh_mt_add_company_id('projectcontacts', 'ProjectId');
CALL acarsh_mt_add_index('projectcontacts', 'idx_projectcontacts_company', 'CompanyId');

CALL acarsh_mt_add_company_id('projectresources', 'ProjectId');
CALL acarsh_mt_add_index('projectresources', 'idx_projectresources_company', 'CompanyId');

-- Email children
CALL acarsh_mt_add_company_id('emails', 'LeadContactID');
CALL acarsh_mt_add_index('emails', 'idx_emails_company', 'CompanyId');

CALL acarsh_mt_add_company_id('email_events', 'EmailId');
CALL acarsh_mt_add_index('email_events', 'idx_email_events_company', 'CompanyId');

CALL acarsh_mt_add_company_id('email_attachments', 'EmailId');
CALL acarsh_mt_add_index('email_attachments', 'idx_email_attachments_company', 'CompanyId');

CALL acarsh_mt_add_company_id('email_sequence_steps', 'SequenceId');
CALL acarsh_mt_add_index('email_sequence_steps', 'idx_email_sequence_steps_company', 'CompanyId');

CALL acarsh_mt_add_company_id('email_sequence_contacts', 'SequenceId');
CALL acarsh_mt_add_index('email_sequence_contacts', 'idx_email_sequence_contacts_company', 'CompanyId');

-- AI / SOW children (tables only; skip sowdetail view)
CALL acarsh_mt_add_company_id('aichatmessages', 'ConversationId');
CALL acarsh_mt_add_index('aichatmessages', 'idx_aichatmessages_company', 'CompanyId');

CALL acarsh_mt_add_company_id('aichatmessageattachments', 'MessageId');
CALL acarsh_mt_add_index('aichatmessageattachments', 'idx_aichatmessageattachments_company', 'CompanyId');

CALL acarsh_mt_add_company_id('sowposition', 'SOWId');
CALL acarsh_mt_add_index('sowposition', 'idx_sowposition_company', 'CompanyId');

CALL acarsh_mt_add_company_id('sowpositionresource', 'SOWPositionId');
CALL acarsh_mt_add_index('sowpositionresource', 'idx_sowpositionresource_company', 'CompanyId');

DROP PROCEDURE IF EXISTS acarsh_mt_add_company_id;
DROP PROCEDURE IF EXISTS acarsh_mt_add_index;
