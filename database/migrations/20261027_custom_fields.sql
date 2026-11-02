-- REVIEW ONLY. Do not execute without explicit approval.
-- Target: acarsh_db / MySQL 8.0+
-- Phase 4 Smart Lead & Contact Import: tenant-scoped custom fields (additive EAV).
--
-- Prerequisite: apply 20261027_import_jobs.sql first if LeadImports does not exist.
-- Do not add arbitrary columns to Leads or LeadContacts.
-- Rerun is safe: CREATE TABLE IF NOT EXISTS.
-- MySQL DDL cannot be rolled back.

CREATE TABLE IF NOT EXISTS CustomFieldDefinitions (
  CustomFieldId BIGINT NOT NULL AUTO_INCREMENT,
  CompanyId INT NOT NULL,
  EntityType VARCHAR(32) NOT NULL,
  FieldName VARCHAR(80) NOT NULL,
  FieldKey VARCHAR(80) NOT NULL,
  FieldType VARCHAR(32) NOT NULL,
  IsRequired TINYINT(1) NOT NULL DEFAULT 0,
  CreatedByUserId INT NOT NULL,
  CreatedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UpdatedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (CustomFieldId),
  UNIQUE KEY uq_customfielddefs_company_entity_key (CompanyId, EntityType, FieldKey),
  KEY idx_customfielddefs_company_entity (CompanyId, EntityType, FieldName),
  CONSTRAINT fk_customfielddefs_company FOREIGN KEY (CompanyId) REFERENCES Companies (CompanyId),
  CONSTRAINT fk_customfielddefs_user FOREIGN KEY (CreatedByUserId) REFERENCES users (UserId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS CustomFieldValues (
  CustomFieldValueId BIGINT NOT NULL AUTO_INCREMENT,
  CompanyId INT NOT NULL,
  CustomFieldId BIGINT NOT NULL,
  EntityType VARCHAR(32) NOT NULL,
  EntityId BIGINT NOT NULL,
  ValueText VARCHAR(4000) NULL,
  CreatedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UpdatedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (CustomFieldValueId),
  UNIQUE KEY uq_customfieldvalues_field_entity (CustomFieldId, EntityType, EntityId),
  KEY idx_customfieldvalues_company_entity (CompanyId, EntityType, EntityId),
  CONSTRAINT fk_customfieldvalues_company FOREIGN KEY (CompanyId) REFERENCES Companies (CompanyId),
  CONSTRAINT fk_customfieldvalues_field FOREIGN KEY (CustomFieldId) REFERENCES CustomFieldDefinitions (CustomFieldId) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
