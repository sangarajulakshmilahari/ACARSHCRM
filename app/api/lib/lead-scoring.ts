type LeadScoreRating = "HOT" | "WARM" | "COLD";

const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "aol.com",
  "protonmail.com",
  "zoho.com",
]);

const DECISION_MAKER_TITLE_REGEX = /\b(ceo|cto|cio|cfo|chro)\b/i;

const INDUSTRY_HINTS = [
  "it",
  "software",
  "technology",
  "healthcare",
  "finance",
  "banking",
  "insurance",
  "manufacturing",
  "retail",
  "education",
  "telecom",
  "logistics",
];

type ContactRow = {
  ContactTitle?: string | null;
  ContactEmail?: string | null;
  ContactPhone?: string | null;
  LinkedInProfile?: string | null;
};

function asCleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function looksLikeWorkEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  const atIndex = normalized.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === normalized.length - 1) return false;
  const domain = normalized.slice(atIndex + 1);
  return !FREE_EMAIL_DOMAINS.has(domain);
}

function toRating(score: number): LeadScoreRating {
  if (score >= 80) return "HOT";
  if (score >= 50) return "WARM";
  return "COLD";
}

function toBreakdownJsonValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "{}";
  }
}

function extractMaxProbabilityPercent(raw: unknown): number {
  const text = asCleanText(raw);
  if (!text) return 0;
  const matches = text.match(/\d+(?:\.\d+)?/g);
  if (!matches?.length) return 0;
  return matches.reduce((max, token) => {
    const value = Number(token);
    if (!Number.isFinite(value)) return max;
    return Math.max(max, value);
  }, 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export async function ensureLeadScoresTable(conn: any): Promise<void> {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS LeadScores (
      LeadId BIGINT NOT NULL PRIMARY KEY,
      Score INT NOT NULL,
      Rating VARCHAR(10) NOT NULL,
      Breakdown JSON NOT NULL,
      CalculatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
}

export async function backfillLeadScoresOnce(conn: any): Promise<{ ran: boolean; processed: number }> {
  await ensureLeadScoresTable(conn);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS LeadScoreBackfillState (
      BackfillKey VARCHAR(64) NOT NULL PRIMARY KEY,
      CompletedAt DATETIME NULL
    )
  `);

  const backfillKey = "initial_v1";
  await conn.query(
    `
    INSERT IGNORE INTO LeadScoreBackfillState (BackfillKey, CompletedAt)
    VALUES (?, NULL)
    `,
    [backfillKey],
  );

  const [stateRows]: any = await conn.query(
    `
    SELECT CompletedAt
    FROM LeadScoreBackfillState
    WHERE BackfillKey = ?
    LIMIT 1
    `,
    [backfillKey],
  );

  if (Array.isArray(stateRows) && stateRows[0]?.CompletedAt) {
    return { ran: false, processed: 0 };
  }

  const [missingRows]: any = await conn.query(
    `
    SELECT l.LeadId
    FROM Leads l
    LEFT JOIN LeadScores ls ON ls.LeadId = l.LeadId
    WHERE ls.LeadId IS NULL
    `,
  );

  const missingLeadIds = (Array.isArray(missingRows) ? missingRows : [])
    .map((row: any) => Number(row?.LeadId))
    .filter((id: number) => Number.isFinite(id) && id > 0);

  let processed = 0;
  for (const missingLeadId of missingLeadIds) {
    try {
      await calculateAndStoreLeadScore(conn, missingLeadId);
      processed += 1;
    } catch (error) {
      console.error(`[lead-scoring] backfill failed for lead ${missingLeadId}:`, error);
    }
  }

  await conn.query(
    `
    UPDATE LeadScoreBackfillState
    SET CompletedAt = UTC_TIMESTAMP()
    WHERE BackfillKey = ?
    `,
    [backfillKey],
  );

  return { ran: true, processed };
}

export async function calculateAndStoreLeadScore(
  conn: any,
  leadId: number,
): Promise<{ lead_id: number; score: number; rating: LeadScoreRating; breakdown: Record<string, any> }> {
  await ensureLeadScoresTable(conn);

  const [sizeColumns]: any = await conn.query(
    `
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'Leads'
      AND COLUMN_NAME IN ('CompanySize', 'EmployeeSize', 'CompanyEmployeeSize', 'EmployeeCount')
    `,
  );

  const available = new Set<string>((sizeColumns || []).map((r: any) => String(r.COLUMN_NAME)));
  const companySizeExpr = available.has("CompanySize")
    ? "CAST(l.CompanySize AS CHAR)"
    : available.has("EmployeeSize")
      ? "CAST(l.EmployeeSize AS CHAR)"
      : available.has("CompanyEmployeeSize")
        ? "CAST(l.CompanyEmployeeSize AS CHAR)"
        : available.has("EmployeeCount")
          ? "CAST(l.EmployeeCount AS CHAR)"
          : "NULL";

  const [leadRows]: any = await conn.query(
    `
    SELECT
      l.LeadId,
      ${companySizeExpr} AS CompanySize,
      COALESCE(at.Name, 'Lead') AS AccountTypeName,
      COALESCE(l.IndustryFocus, '') AS IndustryFocus,
      COALESCE(l.Tags, '') AS Tags,
      (
        SELECT COUNT(*)
        FROM LeadContacts lc
        WHERE lc.LeadId = l.LeadId
      ) AS ContactCount,
      (
        SELECT COUNT(*)
        FROM LeadContacts lc
        WHERE lc.LeadId = l.LeadId
          AND TRIM(COALESCE(lc.ContactEmail, '')) <> ''
      ) AS ContactsWithEmail,
      (
        SELECT COUNT(*)
        FROM LeadContacts lc
        WHERE lc.LeadId = l.LeadId
          AND TRIM(COALESCE(lc.ContactPhone, '')) <> ''
      ) AS ContactsWithPhone,
      (
        SELECT COUNT(*)
        FROM LeadContacts lc
        WHERE lc.LeadId = l.LeadId
          AND TRIM(COALESCE(lc.LinkedInProfile, '')) <> ''
      ) AS ContactsWithLinkedIn,
      (
        SELECT COUNT(*)
        FROM LeadContacts lc
        WHERE lc.LeadId = l.LeadId
          AND LOWER(COALESCE(lc.ContactTitle, '')) REGEXP '(ceo|cto|cio|cfo|chro)'
      ) AS DecisionMakerContacts,
      (
        SELECT COUNT(*)
        FROM LeadActivities la
        WHERE la.LeadId = l.LeadId
      ) AS ActivityCount,
      (
        SELECT COUNT(*)
        FROM LeadActivities la
        WHERE la.LeadId = l.LeadId
          AND la.ActivityDate >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)
      ) AS RecentActivityCount,
      (
        SELECT COUNT(DISTINCT COALESCE(NULLIF(TRIM(la.ActivityType), ''), 'unknown'))
        FROM LeadActivities la
        WHERE la.LeadId = l.LeadId
      ) AS ActivityTypeCount,
      (
        SELECT COUNT(*)
        FROM Opportunities o
        WHERE o.LeadId = l.LeadId
          AND COALESCE(o.IsDeleted, 0) = 0
      ) AS OpportunityCount,
      (
        SELECT MAX(COALESCE(p.ProbabilityRange, ''))
        FROM Opportunities o
        LEFT JOIN Probability p ON p.ProbabilityId = o.ProbabilityId
        WHERE o.LeadId = l.LeadId
          AND COALESCE(o.IsDeleted, 0) = 0
      ) AS MaxProbabilityRange,
      (
        SELECT COUNT(*)
        FROM Opportunities o
        WHERE o.LeadId = l.LeadId
          AND COALESCE(o.IsDeleted, 0) = 0
          AND o.EngagementId IS NOT NULL
      ) AS OpportunitiesWithEngagement,
      (
        SELECT COUNT(*)
        FROM Projects p
        WHERE p.CustomerId = l.LeadId
          AND COALESCE(p.IsHidden, 0) = 0
      ) AS ProjectCount
    FROM Leads l
    LEFT JOIN AccountTypes at ON at.AccountTypeId = l.AccountTypeId
    WHERE l.LeadId = ?
    LIMIT 1
    `,
    [leadId],
  );

  if (!Array.isArray(leadRows) || leadRows.length === 0) {
    throw new Error(`Lead ${leadId} not found for scoring`);
  }

  const lead = leadRows[0] as {
    LeadId: number;
    AccountTypeName?: string | null;
    CompanySize?: string | null;
    IndustryFocus?: string | null;
    Tags?: string | null;
    ContactCount?: number;
    ContactsWithEmail?: number;
    ContactsWithPhone?: number;
    ContactsWithLinkedIn?: number;
    DecisionMakerContacts?: number;
    ActivityCount?: number;
    RecentActivityCount?: number;
    ActivityTypeCount?: number;
    OpportunityCount?: number;
    MaxProbabilityRange?: string | null;
    OpportunitiesWithEngagement?: number;
    ProjectCount?: number;
  };

  const [contactRows]: any = await conn.query(
    `
    SELECT
      ContactTitle,
      ContactEmail,
      ContactPhone,
      LinkedInProfile
    FROM LeadContacts
    WHERE LeadId = ?
    `,
    [leadId],
  );

  const contacts = (Array.isArray(contactRows) ? contactRows : []) as ContactRow[];
  const hasCompanySize = asCleanText(lead.CompanySize).length > 0;
  const hasSeniorDecisionMaker =
    Number(lead.DecisionMakerContacts ?? 0) > 0 ||
    contacts.some((c) => DECISION_MAKER_TITLE_REGEX.test(asCleanText(c.ContactTitle)));
  const hasWorkEmail =
    Number(lead.ContactsWithEmail ?? 0) > 0 ||
    contacts.some((c) => looksLikeWorkEmail(asCleanText(c.ContactEmail)));
  const hasMobilePhone =
    Number(lead.ContactsWithPhone ?? 0) > 0 ||
    contacts.some((c) => asCleanText(c.ContactPhone).length > 0);
  const hasLinkedIn =
    Number(lead.ContactsWithLinkedIn ?? 0) > 0 ||
    contacts.some((c) => asCleanText(c.LinkedInProfile).length > 0);

  const industryFocus = asCleanText(lead.IndustryFocus).toLowerCase();
  const tags = asCleanText(lead.Tags).toLowerCase();
  const hasIndustryMatch = industryFocus.length > 0 || INDUSTRY_HINTS.some((hint) => tags.includes(hint));
  const contactCount = Number(lead.ContactCount ?? contacts.length ?? 0);
  const activityCount = Number(lead.ActivityCount ?? 0);
  const recentActivityCount = Number(lead.RecentActivityCount ?? 0);
  const activityTypeCount = Number(lead.ActivityTypeCount ?? 0);
  const opportunityCount = Number(lead.OpportunityCount ?? 0);
  const opportunitiesWithEngagement = Number(lead.OpportunitiesWithEngagement ?? 0);
  const projectCount = Number(lead.ProjectCount ?? 0);
  const maxProbability = extractMaxProbabilityPercent(lead.MaxProbabilityRange);

  const contactSignalsScore =
    (hasWorkEmail ? 5 : 0) +
    (hasMobilePhone ? 5 : 0) +
    (hasLinkedIn ? 5 : 0) +
    (hasSeniorDecisionMaker ? 5 : 0);

  const activitiesRecentScore =
    (activityCount > 0 ? 10 : 0) +
    (recentActivityCount > 0 ? 10 : 0);

  const opportunityPresenceScore = opportunityCount > 0 ? 10 : 0;
  const probabilityScore =
    maxProbability >= 80
      ? 20
      : maxProbability >= 60
        ? 16
        : maxProbability >= 40
          ? 12
          : maxProbability >= 20
            ? 8
            : maxProbability > 0
              ? 4
              : 0;
  const opportunitiesProbabilityScore = opportunityPresenceScore + probabilityScore;

  const accountTypeName = asCleanText(lead.AccountTypeName).toLowerCase();
  const isCustomerLike = accountTypeName === "account" || accountTypeName === "master account";
  const customerProjectRelationshipScore =
    (isCustomerLike ? 8 : 0) +
    (projectCount > 0 ? 7 : 0);

  const engagementMultipleContactsScore =
    (opportunitiesWithEngagement > 0 ? 7 : 0) +
    (contactCount >= 2 ? 5 : 0) +
    (activityTypeCount >= 2 ? 3 : 0);

  const profileContextScore =
    (hasCompanySize ? 2 : 0) +
    (hasIndustryMatch ? 3 : 0);

  const breakdown = {
    contact_reachability_decision_maker: {
      max: 20,
      earned: clamp(contactSignalsScore, 0, 20),
      details: {
        has_work_email: hasWorkEmail,
        has_mobile_phone: hasMobilePhone,
        has_linkedin: hasLinkedIn,
        has_senior_decision_maker: hasSeniorDecisionMaker,
      },
    },
    activities_recent_interactions: {
      max: 20,
      earned: clamp(activitiesRecentScore, 0, 20),
      details: { activity_count: activityCount, recent_activity_count: recentActivityCount },
    },
    opportunities_probability: {
      max: 30,
      earned: clamp(opportunitiesProbabilityScore, 0, 30),
      details: {
        opportunity_count: opportunityCount,
        max_probability_percent: maxProbability,
      },
    },
    customer_project_relationship: {
      max: 15,
      earned: clamp(customerProjectRelationshipScore, 0, 15),
      details: {
        account_type: lead.AccountTypeName ?? "Lead",
        project_count: projectCount,
      },
    },
    engagement_multiple_contacts: {
      max: 15,
      earned: clamp(engagementMultipleContactsScore, 0, 15),
      details: {
        opportunities_with_engagement: opportunitiesWithEngagement,
        contact_count: contactCount,
        activity_type_count: activityTypeCount,
      },
    },
    profile_context: {
      max: 5,
      earned: clamp(profileContextScore, 0, 5),
      details: {
        has_company_size: hasCompanySize,
        has_industry_match: hasIndustryMatch,
      },
    },
  };

  const score = Object.values(breakdown).reduce(
    (sum, item) => sum + Number(item.earned || 0),
    0,
  );
  const rating = toRating(score);

  await conn.query(
    `
    INSERT INTO LeadScores (LeadId, CompanyId, Score, Rating, Breakdown, CalculatedAt)
    SELECT ?, l.CompanyId, ?, ?, ?, UTC_TIMESTAMP()
    FROM leads l
    WHERE l.LeadId = ?
    ON DUPLICATE KEY UPDATE
      Score = VALUES(Score),
      Rating = VALUES(Rating),
      Breakdown = VALUES(Breakdown),
      CalculatedAt = UTC_TIMESTAMP()
    `,
    [leadId, score, rating, toBreakdownJsonValue(breakdown), leadId],
  );

  return {
    lead_id: leadId,
    score,
    rating,
    breakdown,
  };
}

