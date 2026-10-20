-- REVIEW ONLY. Do not execute without explicit approval.
-- Step 2: seed Adroitent and stamp existing rows.
-- DML-only (except no DDL here). START TRANSACTION / COMMIT can roll back
-- this file if the client keeps the transaction open until the end.
-- Safe to rerun: all updates are WHERE CompanyId IS NULL; membership insert
-- is guarded by NOT EXISTS.
-- Preserves leads.OwnerId, including the 16 NULL sample rows.
-- Orphans and nullable parents fall back to Adroitent.

START TRANSACTION;

INSERT INTO Companies (CompanyCode, CompanyName, IsActive)
SELECT 'adroitent', 'Adroitent', 1
WHERE NOT EXISTS (
  SELECT 1 FROM Companies WHERE CompanyCode = 'adroitent'
);

SET @adroitent_company_id := (
  SELECT CompanyId FROM Companies WHERE CompanyCode = 'adroitent' LIMIT 1
);

-- Fail if 01 was not applied (Companies missing / insert failed).
SET @assert_adroitent := (
  SELECT CompanyId FROM Companies WHERE CompanyId = @adroitent_company_id LIMIT 1
);

-- RoleId is nullable on users; CompanyUsers.RoleId is NOT NULL.
-- Live data currently has RoleId on all 14 users. Fallback 2 = sales.
INSERT INTO CompanyUsers (CompanyId, UserId, RoleId, IsDefault, IsActive)
SELECT
  @adroitent_company_id,
  u.UserId,
  COALESCE(u.RoleId, 2),
  1,
  COALESCE(u.IsActive, 1)
FROM users u
WHERE NOT EXISTS (
  SELECT 1
  FROM CompanyUsers cu
  WHERE cu.CompanyId = @adroitent_company_id
    AND cu.UserId = u.UserId
);

-- Roots. projects/aaram inherit when a parent lead/project exists.
UPDATE leads
SET CompanyId = @adroitent_company_id
WHERE CompanyId IS NULL;

UPDATE projects p
LEFT JOIN leads l ON l.LeadId = p.CustomerId
SET p.CompanyId = COALESCE(l.CompanyId, @adroitent_company_id)
WHERE p.CompanyId IS NULL;

UPDATE email_sequences SET CompanyId = @adroitent_company_id WHERE CompanyId IS NULL;
UPDATE email_templates SET CompanyId = @adroitent_company_id WHERE CompanyId IS NULL;
UPDATE email_suppressions SET CompanyId = @adroitent_company_id WHERE CompanyId IS NULL;
UPDATE aichatconversations SET CompanyId = @adroitent_company_id WHERE CompanyId IS NULL;
UPDATE sowmaster SET CompanyId = @adroitent_company_id WHERE CompanyId IS NULL;
UPDATE user_lead_access SET CompanyId = @adroitent_company_id WHERE CompanyId IS NULL;

UPDATE aaram_account_map m
LEFT JOIN leads by_lead ON by_lead.LeadId = m.LeadId
LEFT JOIN leads by_cust ON by_cust.LeadId = m.CustomerId
SET m.CompanyId = COALESCE(by_lead.CompanyId, by_cust.CompanyId, @adroitent_company_id)
WHERE m.CompanyId IS NULL;

UPDATE aaram_project_map m
LEFT JOIN projects p ON p.ProjectId = m.ProjectId
SET m.CompanyId = COALESCE(p.CompanyId, @adroitent_company_id)
WHERE m.CompanyId IS NULL;

-- Children: inherit parent CompanyId, else Adroitent (covers orphans).
UPDATE leadcontacts child
LEFT JOIN leads parent ON parent.LeadId = child.LeadId
SET child.CompanyId = COALESCE(parent.CompanyId, @adroitent_company_id)
WHERE child.CompanyId IS NULL;

UPDATE leadactivities child
LEFT JOIN leads parent ON parent.LeadId = child.LeadId
SET child.CompanyId = COALESCE(parent.CompanyId, @adroitent_company_id)
WHERE child.CompanyId IS NULL;

UPDATE leadreminders child
LEFT JOIN leads parent ON parent.LeadId = child.LeadId
SET child.CompanyId = COALESCE(parent.CompanyId, @adroitent_company_id)
WHERE child.CompanyId IS NULL;

UPDATE leadnotes child
LEFT JOIN leads parent ON parent.LeadId = child.LeadId
SET child.CompanyId = COALESCE(parent.CompanyId, @adroitent_company_id)
WHERE child.CompanyId IS NULL;

UPDATE leadmeetings child
LEFT JOIN leads parent ON parent.LeadId = child.LeadId
SET child.CompanyId = COALESCE(parent.CompanyId, @adroitent_company_id)
WHERE child.CompanyId IS NULL;

UPDATE leadcategories child
LEFT JOIN leads parent ON parent.LeadId = child.LeadId
SET child.CompanyId = COALESCE(parent.CompanyId, @adroitent_company_id)
WHERE child.CompanyId IS NULL;

UPDATE leadservices child
LEFT JOIN leads parent ON parent.LeadId = child.LeadId
SET child.CompanyId = COALESCE(parent.CompanyId, @adroitent_company_id)
WHERE child.CompanyId IS NULL;

UPDATE leadtags child
LEFT JOIN leads parent ON parent.LeadId = child.LeadId
SET child.CompanyId = COALESCE(parent.CompanyId, @adroitent_company_id)
WHERE child.CompanyId IS NULL;

UPDATE leadprojects child
LEFT JOIN leads parent ON parent.LeadId = child.LeadId
SET child.CompanyId = COALESCE(parent.CompanyId, @adroitent_company_id)
WHERE child.CompanyId IS NULL;

UPDATE leadscores child
LEFT JOIN leads parent ON parent.LeadId = child.LeadId
SET child.CompanyId = COALESCE(parent.CompanyId, @adroitent_company_id)
WHERE child.CompanyId IS NULL;

UPDATE customer_leads child
LEFT JOIN leads by_lead ON by_lead.LeadId = child.LeadId
LEFT JOIN leads by_cust ON by_cust.LeadId = child.CustomerId
SET child.CompanyId = COALESCE(by_lead.CompanyId, by_cust.CompanyId, @adroitent_company_id)
WHERE child.CompanyId IS NULL;

UPDATE opportunities child
LEFT JOIN leads parent ON parent.LeadId = child.LeadId
SET child.CompanyId = COALESCE(parent.CompanyId, @adroitent_company_id)
WHERE child.CompanyId IS NULL;

UPDATE opportunitycontacts child
LEFT JOIN opportunities parent ON parent.OpportunityId = child.OpportunityId
SET child.CompanyId = COALESCE(parent.CompanyId, @adroitent_company_id)
WHERE child.CompanyId IS NULL;

UPDATE opportunity_categories child
LEFT JOIN opportunities parent ON parent.OpportunityId = child.OpportunityId
SET child.CompanyId = COALESCE(parent.CompanyId, @adroitent_company_id)
WHERE child.CompanyId IS NULL;

UPDATE projectcontacts child
LEFT JOIN projects parent ON parent.ProjectId = child.ProjectId
SET child.CompanyId = COALESCE(parent.CompanyId, @adroitent_company_id)
WHERE child.CompanyId IS NULL;

UPDATE projectresources child
LEFT JOIN projects parent ON parent.ProjectId = child.ProjectId
SET child.CompanyId = COALESCE(parent.CompanyId, @adroitent_company_id)
WHERE child.CompanyId IS NULL;

UPDATE emails child
LEFT JOIN leadcontacts parent ON parent.LeadContactID = child.LeadContactID
SET child.CompanyId = COALESCE(parent.CompanyId, @adroitent_company_id)
WHERE child.CompanyId IS NULL;

UPDATE email_events child
LEFT JOIN emails parent ON parent.EmailId = child.EmailId
SET child.CompanyId = COALESCE(parent.CompanyId, @adroitent_company_id)
WHERE child.CompanyId IS NULL;

UPDATE email_attachments child
LEFT JOIN emails parent ON parent.EmailId = child.EmailId
SET child.CompanyId = COALESCE(parent.CompanyId, @adroitent_company_id)
WHERE child.CompanyId IS NULL;

UPDATE email_sequence_steps child
LEFT JOIN email_sequences parent ON parent.SequenceId = child.SequenceId
SET child.CompanyId = COALESCE(parent.CompanyId, @adroitent_company_id)
WHERE child.CompanyId IS NULL;

UPDATE email_sequence_contacts child
LEFT JOIN email_sequences parent ON parent.SequenceId = child.SequenceId
SET child.CompanyId = COALESCE(parent.CompanyId, @adroitent_company_id)
WHERE child.CompanyId IS NULL;

UPDATE aichatmessages child
LEFT JOIN aichatconversations parent ON parent.ConversationId = child.ConversationId
SET child.CompanyId = COALESCE(parent.CompanyId, @adroitent_company_id)
WHERE child.CompanyId IS NULL;

UPDATE aichatmessageattachments child
LEFT JOIN aichatmessages parent ON parent.MessageId = child.MessageId
SET child.CompanyId = COALESCE(parent.CompanyId, @adroitent_company_id)
WHERE child.CompanyId IS NULL;

UPDATE sowposition child
LEFT JOIN sowmaster parent ON parent.SOWId = child.SOWId
SET child.CompanyId = COALESCE(parent.CompanyId, @adroitent_company_id)
WHERE child.CompanyId IS NULL;

UPDATE sowpositionresource child
LEFT JOIN sowposition parent ON parent.SOWPositionId = child.SOWPositionId
SET child.CompanyId = COALESCE(parent.CompanyId, @adroitent_company_id)
WHERE child.CompanyId IS NULL;

COMMIT;
