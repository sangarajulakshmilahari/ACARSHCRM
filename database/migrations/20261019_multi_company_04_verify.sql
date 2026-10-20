-- REVIEW ONLY / read-only verification. Safe to run after 02 and after 03.
-- Does not write data. sowdetail is a view; it is counted but has no CompanyId.
-- Expected after 02: every *_null_company = 0, every *_mismatch = 0,
-- every *_orphan = 0, leads_owner_null = 16, users_missing_membership = 0.

SELECT 'adroitent_companies' AS check_name, COUNT(*) AS value
FROM Companies WHERE CompanyCode = 'adroitent'
UNION ALL SELECT 'company_users', COUNT(*) FROM CompanyUsers
UNION ALL SELECT 'users_total', COUNT(*) FROM users
UNION ALL SELECT 'users_null_role', COUNT(*) FROM users WHERE RoleId IS NULL
UNION ALL SELECT 'leads_total', COUNT(*) FROM leads
UNION ALL SELECT 'leads_owner_null', COUNT(*) FROM leads WHERE OwnerId IS NULL
UNION ALL SELECT 'leads_owner_not_null', COUNT(*) FROM leads WHERE OwnerId IS NOT NULL
UNION ALL SELECT 'sowdetail_view_rows', COUNT(*) FROM sowdetail

UNION ALL SELECT 'leads_null_company', COUNT(*) FROM leads WHERE CompanyId IS NULL
UNION ALL SELECT 'projects_null_company', COUNT(*) FROM projects WHERE CompanyId IS NULL
UNION ALL SELECT 'email_sequences_null_company', COUNT(*) FROM email_sequences WHERE CompanyId IS NULL
UNION ALL SELECT 'email_templates_null_company', COUNT(*) FROM email_templates WHERE CompanyId IS NULL
UNION ALL SELECT 'email_suppressions_null_company', COUNT(*) FROM email_suppressions WHERE CompanyId IS NULL
UNION ALL SELECT 'aichatconversations_null_company', COUNT(*) FROM aichatconversations WHERE CompanyId IS NULL
UNION ALL SELECT 'sowmaster_null_company', COUNT(*) FROM sowmaster WHERE CompanyId IS NULL
UNION ALL SELECT 'user_lead_access_null_company', COUNT(*) FROM user_lead_access WHERE CompanyId IS NULL
UNION ALL SELECT 'aaram_account_map_null_company', COUNT(*) FROM aaram_account_map WHERE CompanyId IS NULL
UNION ALL SELECT 'aaram_project_map_null_company', COUNT(*) FROM aaram_project_map WHERE CompanyId IS NULL
UNION ALL SELECT 'leadcontacts_null_company', COUNT(*) FROM leadcontacts WHERE CompanyId IS NULL
UNION ALL SELECT 'leadactivities_null_company', COUNT(*) FROM leadactivities WHERE CompanyId IS NULL
UNION ALL SELECT 'leadreminders_null_company', COUNT(*) FROM leadreminders WHERE CompanyId IS NULL
UNION ALL SELECT 'leadnotes_null_company', COUNT(*) FROM leadnotes WHERE CompanyId IS NULL
UNION ALL SELECT 'leadmeetings_null_company', COUNT(*) FROM leadmeetings WHERE CompanyId IS NULL
UNION ALL SELECT 'leadcategories_null_company', COUNT(*) FROM leadcategories WHERE CompanyId IS NULL
UNION ALL SELECT 'leadservices_null_company', COUNT(*) FROM leadservices WHERE CompanyId IS NULL
UNION ALL SELECT 'leadtags_null_company', COUNT(*) FROM leadtags WHERE CompanyId IS NULL
UNION ALL SELECT 'leadprojects_null_company', COUNT(*) FROM leadprojects WHERE CompanyId IS NULL
UNION ALL SELECT 'leadscores_null_company', COUNT(*) FROM leadscores WHERE CompanyId IS NULL
UNION ALL SELECT 'customer_leads_null_company', COUNT(*) FROM customer_leads WHERE CompanyId IS NULL
UNION ALL SELECT 'opportunities_null_company', COUNT(*) FROM opportunities WHERE CompanyId IS NULL
UNION ALL SELECT 'opportunitycontacts_null_company', COUNT(*) FROM opportunitycontacts WHERE CompanyId IS NULL
UNION ALL SELECT 'opportunity_categories_null_company', COUNT(*) FROM opportunity_categories WHERE CompanyId IS NULL
UNION ALL SELECT 'projectcontacts_null_company', COUNT(*) FROM projectcontacts WHERE CompanyId IS NULL
UNION ALL SELECT 'projectresources_null_company', COUNT(*) FROM projectresources WHERE CompanyId IS NULL
UNION ALL SELECT 'emails_null_company', COUNT(*) FROM emails WHERE CompanyId IS NULL
UNION ALL SELECT 'email_events_null_company', COUNT(*) FROM email_events WHERE CompanyId IS NULL
UNION ALL SELECT 'email_attachments_null_company', COUNT(*) FROM email_attachments WHERE CompanyId IS NULL
UNION ALL SELECT 'email_sequence_steps_null_company', COUNT(*) FROM email_sequence_steps WHERE CompanyId IS NULL
UNION ALL SELECT 'email_sequence_contacts_null_company', COUNT(*) FROM email_sequence_contacts WHERE CompanyId IS NULL
UNION ALL SELECT 'aichatmessages_null_company', COUNT(*) FROM aichatmessages WHERE CompanyId IS NULL
UNION ALL SELECT 'aichatmessageattachments_null_company', COUNT(*) FROM aichatmessageattachments WHERE CompanyId IS NULL
UNION ALL SELECT 'sowposition_null_company', COUNT(*) FROM sowposition WHERE CompanyId IS NULL
UNION ALL SELECT 'sowpositionresource_null_company', COUNT(*) FROM sowpositionresource WHERE CompanyId IS NULL;

SELECT 'leadcontacts_mismatch' AS check_name, COUNT(*) AS value
FROM leadcontacts c INNER JOIN leads p ON p.LeadId = c.LeadId WHERE c.CompanyId <> p.CompanyId
UNION ALL SELECT 'leadactivities_mismatch', COUNT(*)
FROM leadactivities c INNER JOIN leads p ON p.LeadId = c.LeadId WHERE c.CompanyId <> p.CompanyId
UNION ALL SELECT 'leadreminders_mismatch', COUNT(*)
FROM leadreminders c INNER JOIN leads p ON p.LeadId = c.LeadId WHERE c.CompanyId <> p.CompanyId
UNION ALL SELECT 'leadnotes_mismatch', COUNT(*)
FROM leadnotes c INNER JOIN leads p ON p.LeadId = c.LeadId WHERE c.CompanyId <> p.CompanyId
UNION ALL SELECT 'leadmeetings_mismatch', COUNT(*)
FROM leadmeetings c INNER JOIN leads p ON p.LeadId = c.LeadId WHERE c.CompanyId <> p.CompanyId
UNION ALL SELECT 'leadcategories_mismatch', COUNT(*)
FROM leadcategories c INNER JOIN leads p ON p.LeadId = c.LeadId WHERE c.CompanyId <> p.CompanyId
UNION ALL SELECT 'leadservices_mismatch', COUNT(*)
FROM leadservices c INNER JOIN leads p ON p.LeadId = c.LeadId WHERE c.CompanyId <> p.CompanyId
UNION ALL SELECT 'leadtags_mismatch', COUNT(*)
FROM leadtags c INNER JOIN leads p ON p.LeadId = c.LeadId WHERE c.CompanyId <> p.CompanyId
UNION ALL SELECT 'leadprojects_mismatch', COUNT(*)
FROM leadprojects c INNER JOIN leads p ON p.LeadId = c.LeadId WHERE c.CompanyId <> p.CompanyId
UNION ALL SELECT 'leadscores_mismatch', COUNT(*)
FROM leadscores c INNER JOIN leads p ON p.LeadId = c.LeadId WHERE c.CompanyId <> p.CompanyId
UNION ALL SELECT 'customer_leads_lead_mismatch', COUNT(*)
FROM customer_leads c INNER JOIN leads p ON p.LeadId = c.LeadId WHERE c.CompanyId <> p.CompanyId
UNION ALL SELECT 'customer_leads_customer_mismatch', COUNT(*)
FROM customer_leads c INNER JOIN leads p ON p.LeadId = c.CustomerId WHERE c.CompanyId <> p.CompanyId
UNION ALL SELECT 'opportunities_mismatch', COUNT(*)
FROM opportunities c INNER JOIN leads p ON p.LeadId = c.LeadId WHERE c.CompanyId <> p.CompanyId
UNION ALL SELECT 'opportunitycontacts_mismatch', COUNT(*)
FROM opportunitycontacts c INNER JOIN opportunities p ON p.OpportunityId = c.OpportunityId WHERE c.CompanyId <> p.CompanyId
UNION ALL SELECT 'opportunity_categories_mismatch', COUNT(*)
FROM opportunity_categories c INNER JOIN opportunities p ON p.OpportunityId = c.OpportunityId WHERE c.CompanyId <> p.CompanyId
UNION ALL SELECT 'projectcontacts_mismatch', COUNT(*)
FROM projectcontacts c INNER JOIN projects p ON p.ProjectId = c.ProjectId WHERE c.CompanyId <> p.CompanyId
UNION ALL SELECT 'projectresources_mismatch', COUNT(*)
FROM projectresources c INNER JOIN projects p ON p.ProjectId = c.ProjectId WHERE c.CompanyId <> p.CompanyId
UNION ALL SELECT 'projects_customer_mismatch', COUNT(*)
FROM projects c INNER JOIN leads p ON p.LeadId = c.CustomerId WHERE c.CompanyId <> p.CompanyId
UNION ALL SELECT 'emails_mismatch', COUNT(*)
FROM emails c INNER JOIN leadcontacts p ON p.LeadContactID = c.LeadContactID WHERE c.CompanyId <> p.CompanyId
UNION ALL SELECT 'email_events_mismatch', COUNT(*)
FROM email_events c INNER JOIN emails p ON p.EmailId = c.EmailId WHERE c.CompanyId <> p.CompanyId
UNION ALL SELECT 'email_attachments_mismatch', COUNT(*)
FROM email_attachments c INNER JOIN emails p ON p.EmailId = c.EmailId WHERE c.CompanyId <> p.CompanyId
UNION ALL SELECT 'email_sequence_steps_mismatch', COUNT(*)
FROM email_sequence_steps c INNER JOIN email_sequences p ON p.SequenceId = c.SequenceId WHERE c.CompanyId <> p.CompanyId
UNION ALL SELECT 'email_sequence_contacts_seq_mismatch', COUNT(*)
FROM email_sequence_contacts c INNER JOIN email_sequences p ON p.SequenceId = c.SequenceId WHERE c.CompanyId <> p.CompanyId
UNION ALL SELECT 'email_sequence_contacts_contact_mismatch', COUNT(*)
FROM email_sequence_contacts c INNER JOIN leadcontacts p ON p.LeadContactID = c.LeadContactID WHERE c.CompanyId <> p.CompanyId
UNION ALL SELECT 'aichatmessages_mismatch', COUNT(*)
FROM aichatmessages c INNER JOIN aichatconversations p ON p.ConversationId = c.ConversationId WHERE c.CompanyId <> p.CompanyId
UNION ALL SELECT 'aichatmessageattachments_mismatch', COUNT(*)
FROM aichatmessageattachments c INNER JOIN aichatmessages p ON p.MessageId = c.MessageId WHERE c.CompanyId <> p.CompanyId
UNION ALL SELECT 'sowposition_mismatch', COUNT(*)
FROM sowposition c INNER JOIN sowmaster p ON p.SOWId = c.SOWId WHERE c.CompanyId <> p.CompanyId
UNION ALL SELECT 'sowpositionresource_mismatch', COUNT(*)
FROM sowpositionresource c INNER JOIN sowposition p ON p.SOWPositionId = c.SOWPositionId WHERE c.CompanyId <> p.CompanyId
UNION ALL SELECT 'aaram_account_map_mismatch', COUNT(*)
FROM aaram_account_map c INNER JOIN leads p ON p.LeadId = c.LeadId WHERE c.CompanyId <> p.CompanyId
UNION ALL SELECT 'aaram_project_map_mismatch', COUNT(*)
FROM aaram_project_map c INNER JOIN projects p ON p.ProjectId = c.ProjectId WHERE c.CompanyId <> p.CompanyId;

SELECT 'leadcontacts_orphan' AS check_name, COUNT(*) AS value
FROM leadcontacts c LEFT JOIN leads p ON p.LeadId = c.LeadId WHERE p.LeadId IS NULL
UNION ALL SELECT 'leadactivities_orphan', COUNT(*)
FROM leadactivities c LEFT JOIN leads p ON p.LeadId = c.LeadId WHERE p.LeadId IS NULL
UNION ALL SELECT 'leadreminders_orphan', COUNT(*)
FROM leadreminders c LEFT JOIN leads p ON p.LeadId = c.LeadId WHERE p.LeadId IS NULL
UNION ALL SELECT 'leadnotes_orphan', COUNT(*)
FROM leadnotes c LEFT JOIN leads p ON p.LeadId = c.LeadId WHERE p.LeadId IS NULL
UNION ALL SELECT 'leadmeetings_orphan', COUNT(*)
FROM leadmeetings c LEFT JOIN leads p ON p.LeadId = c.LeadId WHERE p.LeadId IS NULL
UNION ALL SELECT 'leadcategories_orphan', COUNT(*)
FROM leadcategories c LEFT JOIN leads p ON p.LeadId = c.LeadId WHERE p.LeadId IS NULL
UNION ALL SELECT 'leadservices_orphan', COUNT(*)
FROM leadservices c LEFT JOIN leads p ON p.LeadId = c.LeadId WHERE p.LeadId IS NULL
UNION ALL SELECT 'leadtags_orphan', COUNT(*)
FROM leadtags c LEFT JOIN leads p ON p.LeadId = c.LeadId WHERE p.LeadId IS NULL
UNION ALL SELECT 'leadprojects_orphan', COUNT(*)
FROM leadprojects c LEFT JOIN leads p ON p.LeadId = c.LeadId WHERE p.LeadId IS NULL
UNION ALL SELECT 'leadscores_orphan', COUNT(*)
FROM leadscores c LEFT JOIN leads p ON p.LeadId = c.LeadId WHERE p.LeadId IS NULL
UNION ALL SELECT 'customer_leads_orphan', COUNT(*)
FROM customer_leads c LEFT JOIN leads p ON p.LeadId = c.LeadId WHERE p.LeadId IS NULL
UNION ALL SELECT 'opportunities_orphan', COUNT(*)
FROM opportunities c LEFT JOIN leads p ON p.LeadId = c.LeadId WHERE p.LeadId IS NULL
UNION ALL SELECT 'opportunitycontacts_orphan', COUNT(*)
FROM opportunitycontacts c LEFT JOIN opportunities p ON p.OpportunityId = c.OpportunityId WHERE p.OpportunityId IS NULL
UNION ALL SELECT 'opportunity_categories_orphan', COUNT(*)
FROM opportunity_categories c LEFT JOIN opportunities p ON p.OpportunityId = c.OpportunityId WHERE p.OpportunityId IS NULL
UNION ALL SELECT 'projectcontacts_orphan', COUNT(*)
FROM projectcontacts c LEFT JOIN projects p ON p.ProjectId = c.ProjectId WHERE p.ProjectId IS NULL
UNION ALL SELECT 'projectresources_orphan', COUNT(*)
FROM projectresources c LEFT JOIN projects p ON p.ProjectId = c.ProjectId WHERE p.ProjectId IS NULL
UNION ALL SELECT 'emails_orphan', COUNT(*)
FROM emails c LEFT JOIN leadcontacts p ON p.LeadContactID = c.LeadContactID WHERE p.LeadContactID IS NULL
UNION ALL SELECT 'email_events_orphan', COUNT(*)
FROM email_events c LEFT JOIN emails p ON p.EmailId = c.EmailId WHERE p.EmailId IS NULL
UNION ALL SELECT 'email_attachments_orphan', COUNT(*)
FROM email_attachments c LEFT JOIN emails p ON p.EmailId = c.EmailId WHERE p.EmailId IS NULL
UNION ALL SELECT 'email_sequence_steps_orphan', COUNT(*)
FROM email_sequence_steps c LEFT JOIN email_sequences p ON p.SequenceId = c.SequenceId WHERE p.SequenceId IS NULL
UNION ALL SELECT 'email_sequence_contacts_orphan', COUNT(*)
FROM email_sequence_contacts c LEFT JOIN email_sequences p ON p.SequenceId = c.SequenceId WHERE p.SequenceId IS NULL
UNION ALL SELECT 'aichatmessages_orphan', COUNT(*)
FROM aichatmessages c LEFT JOIN aichatconversations p ON p.ConversationId = c.ConversationId WHERE p.ConversationId IS NULL
UNION ALL SELECT 'aichatmessageattachments_orphan', COUNT(*)
FROM aichatmessageattachments c LEFT JOIN aichatmessages p ON p.MessageId = c.MessageId WHERE p.MessageId IS NULL
UNION ALL SELECT 'sowposition_orphan', COUNT(*)
FROM sowposition c LEFT JOIN sowmaster p ON p.SOWId = c.SOWId WHERE p.SOWId IS NULL
UNION ALL SELECT 'sowpositionresource_orphan', COUNT(*)
FROM sowpositionresource c LEFT JOIN sowposition p ON p.SOWPositionId = c.SOWPositionId WHERE p.SOWPositionId IS NULL;

SELECT 'users_missing_membership' AS check_name, COUNT(*) AS value
FROM users u
LEFT JOIN CompanyUsers cu
  ON cu.UserId = u.UserId
 AND cu.CompanyId = (SELECT CompanyId FROM Companies WHERE CompanyCode = 'adroitent' LIMIT 1)
WHERE cu.CompanyUserId IS NULL
UNION ALL SELECT 'membership_without_user', COUNT(*)
FROM CompanyUsers cu
LEFT JOIN users u ON u.UserId = cu.UserId
WHERE u.UserId IS NULL
UNION ALL SELECT 'users_with_multiple_defaults', COUNT(*)
FROM (
  SELECT UserId
  FROM CompanyUsers
  WHERE IsDefault = 1 AND IsActive = 1
  GROUP BY UserId
  HAVING COUNT(*) > 1
) d;

SELECT INDEX_NAME, NON_UNIQUE, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columns
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'email_suppressions'
GROUP BY INDEX_NAME, NON_UNIQUE
ORDER BY INDEX_NAME;

SELECT TABLE_NAME, COLUMN_NAME, IS_NULLABLE, COLUMN_TYPE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND COLUMN_NAME = 'CompanyId'
ORDER BY TABLE_NAME;

SELECT TABLE_NAME, TABLE_TYPE
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('sowdetail', 'Companies', 'CompanyUsers', 'email_tracked_links')
ORDER BY TABLE_NAME;
