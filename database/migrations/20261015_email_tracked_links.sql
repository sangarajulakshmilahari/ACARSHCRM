-- Email Engagement Step 4F: optional click-destination store.
-- Used only when EMAIL_TRACKING_ENABLED=true. Destinations are looked up
-- by signed token; request query strings never supply the redirect target.
-- Apply locally or at deploy time. ensureEmailTrackingSchema() also creates
-- this table if it does not exist.

CREATE TABLE IF NOT EXISTS email_tracked_links (
  TrackedLinkId BIGINT NOT NULL AUTO_INCREMENT,
  EmailId BIGINT NOT NULL,
  UrlHash CHAR(64) NOT NULL,
  DestinationUrl VARCHAR(2000) NOT NULL,
  CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (TrackedLinkId),
  UNIQUE KEY uq_email_tracked_links_email_url (EmailId, UrlHash),
  KEY idx_email_tracked_links_emailid (EmailId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
