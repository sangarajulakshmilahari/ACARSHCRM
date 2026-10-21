-- Email Engagement Step 4D: unsubscribe / suppression list.
-- Apply locally or at deploy time. The application also creates this table
-- on first use via ensureEmailSuppressionSchema() if it does not exist.
--
-- Uniqueness is on NormalizedEmail (lowercase, trimmed). Active suppression
-- is RevokedAt IS NULL. Re-suppressing a previously revoked row reuses the
-- unique key instead of inserting a duplicate.

CREATE TABLE IF NOT EXISTS email_suppressions (
  SuppressionId BIGINT NOT NULL AUTO_INCREMENT,
  NormalizedEmail VARCHAR(254) NOT NULL,
  Reason VARCHAR(32) NOT NULL,
  Source VARCHAR(32) NOT NULL,
  EmailId BIGINT NULL,
  LeadContactID BIGINT NULL,
  CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CreatedByUserId INT NULL,
  RevokedAt DATETIME NULL,
  RevokedByUserId INT NULL,
  PRIMARY KEY (SuppressionId),
  UNIQUE KEY uq_email_suppressions_normalized_email (NormalizedEmail),
  KEY idx_email_suppressions_active (RevokedAt, NormalizedEmail)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
