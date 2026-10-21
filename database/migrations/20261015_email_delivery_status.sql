-- Email Engagement Step 4E: delivery evidence on emails.
-- SENT remains Graph submission. DeliveryStatus is UNKNOWN until a
-- validated provider event is ingested. Do not treat Graph send success
-- as recipient delivery.
--
-- Apply locally or at deploy time. ensureEmailDeliverySchema() also
-- adds this column if it is missing.

ALTER TABLE emails
  ADD COLUMN DeliveryStatus varchar(20) NOT NULL DEFAULT 'UNKNOWN';
