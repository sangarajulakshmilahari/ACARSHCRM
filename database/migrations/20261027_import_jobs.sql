-- REVIEW ONLY. Do not execute without explicit approval.
-- Target: acarsh_db / MySQL 8.0+
-- Phase 1 Smart Lead & Contact Import: persistent imports (additive, no existing-table rewrite).
--
-- Raw spreadsheet bytes are intentionally NOT stored. Parsed row JSON is stored
-- only long enough to preview/confirm. Recommended retention: 30 days after
-- CompletedAt, then delete LeadImportRows + LeadImports (ON DELETE CASCADE).
--
-- MySQL DDL cannot be rolled back. Rerun is safe: CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS LeadImports (
  ImportId BIGINT NOT NULL AUTO_INCREMENT,
  CompanyId INT NOT NULL,
  CreatedByUserId INT NOT NULL,
  SourceFileName VARCHAR(260) NOT NULL,
  SourceFileSha256 CHAR(64) NOT NULL,
  SourceFileType VARCHAR(32) NOT NULL,
  SourceFileSizeBytes INT UNSIGNED NOT NULL,
  SheetName VARCHAR(190) NOT NULL,
  Status VARCHAR(32) NOT NULL,
  ColumnsJson LONGTEXT NOT NULL,
  MappingJson LONGTEXT NOT NULL,
  UnmappedJson LONGTEXT NOT NULL,
  UnmappedToNotesJson LONGTEXT NOT NULL,
  SuggestionsJson LONGTEXT NOT NULL,
  DefaultsJson LONGTEXT NOT NULL,
  DuplicatePolicy VARCHAR(32) NOT NULL DEFAULT 'skip',
  SkipInvalid TINYINT(1) NOT NULL DEFAULT 1,
  PreviewSummaryJson LONGTEXT NULL,
  ResultSummaryJson LONGTEXT NULL,
  ErrorMessage VARCHAR(500) NULL,
  RowCount INT NOT NULL DEFAULT 0,
  StartedAt DATETIME(6) NULL,
  ConfirmedAt DATETIME(6) NULL,
  CompletedAt DATETIME(6) NULL,
  CreatedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UpdatedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (ImportId),
  KEY idx_leadimports_company_created (CompanyId, CreatedAt),
  KEY idx_leadimports_company_status (CompanyId, Status),
  KEY idx_leadimports_company_hash (CompanyId, SourceFileSha256),
  KEY idx_leadimports_creator (CreatedByUserId, CompanyId),
  CONSTRAINT fk_leadimports_company FOREIGN KEY (CompanyId) REFERENCES Companies (CompanyId),
  CONSTRAINT fk_leadimports_user FOREIGN KEY (CreatedByUserId) REFERENCES users (UserId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS LeadImportRows (
  ImportRowId BIGINT NOT NULL AUTO_INCREMENT,
  ImportId BIGINT NOT NULL,
  CompanyId INT NOT NULL,
  RowNumber INT NOT NULL,
  RowHash CHAR(64) NOT NULL,
  SourceJson LONGTEXT NOT NULL,
  PreviewStatus VARCHAR(40) NOT NULL DEFAULT 'pending',
  PreviewReasonsJson LONGTEXT NOT NULL,
  ExistingLeadId BIGINT NULL,
  DuplicateAction VARCHAR(32) NOT NULL DEFAULT 'skip',
  CommitStatus VARCHAR(32) NOT NULL DEFAULT 'pending',
  ErrorReason VARCHAR(500) NULL,
  CreatedLeadId BIGINT NULL,
  CreatedLeadContactId BIGINT NULL,
  CreatedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UpdatedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (ImportRowId),
  UNIQUE KEY uq_leadimportrows_import_row (ImportId, RowNumber),
  KEY idx_leadimportrows_company_import (CompanyId, ImportId),
  KEY idx_leadimportrows_import_commit (ImportId, CommitStatus),
  CONSTRAINT fk_leadimportrows_import FOREIGN KEY (ImportId) REFERENCES LeadImports (ImportId) ON DELETE CASCADE,
  CONSTRAINT fk_leadimportrows_company FOREIGN KEY (CompanyId) REFERENCES Companies (CompanyId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
