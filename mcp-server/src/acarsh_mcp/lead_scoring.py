from __future__ import annotations

import json
import re
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Connection

FREE_EMAIL_DOMAINS = {
    "gmail.com",
    "yahoo.com",
    "outlook.com",
    "hotmail.com",
    "live.com",
    "icloud.com",
    "aol.com",
    "protonmail.com",
    "zoho.com",
}

DECISION_MAKER_PATTERN = re.compile(r"\b(ceo|cto|cio|cfo|chro)\b", re.IGNORECASE)
INDUSTRY_HINTS = (
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
)


def _as_text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _has_work_email(email: str) -> bool:
    normalized = email.strip().lower()
    if "@" not in normalized:
        return False
    domain = normalized.rsplit("@", maxsplit=1)[-1]
    return bool(domain) and domain not in FREE_EMAIL_DOMAINS


def _rating(score: int) -> str:
    if score >= 80:
        return "HOT"
    if score >= 50:
        return "WARM"
    return "COLD"


def _extract_max_probability_percent(raw: Any) -> float:
    text = _as_text(raw)
    if not text:
        return 0.0
    matches = re.findall(r"\d+(?:\.\d+)?", text)
    if not matches:
        return 0.0
    values = [float(item) for item in matches]
    return max(values) if values else 0.0


def _clamp(value: int, minimum: int, maximum: int) -> int:
    return max(minimum, min(maximum, value))


def ensure_lead_scores_table(conn: Connection) -> None:
    conn.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS LeadScores (
              LeadId BIGINT NOT NULL PRIMARY KEY,
              Score INT NOT NULL,
              Rating VARCHAR(10) NOT NULL,
              Breakdown JSON NOT NULL,
              CalculatedAt DATETIME NOT NULL
                DEFAULT CURRENT_TIMESTAMP
                ON UPDATE CURRENT_TIMESTAMP
            )
            """
        )
    )


def backfill_lead_scores_once(conn: Connection) -> dict[str, Any]:
    ensure_lead_scores_table(conn)
    conn.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS LeadScoreBackfillState (
              BackfillKey VARCHAR(64) NOT NULL PRIMARY KEY,
              CompletedAt DATETIME NULL
            )
            """
        )
    )

    backfill_key = "initial_v1"
    conn.execute(
        text(
            """
            INSERT IGNORE INTO LeadScoreBackfillState (BackfillKey, CompletedAt)
            VALUES (:backfill_key, NULL)
            """
        ),
        {"backfill_key": backfill_key},
    )

    state_row = (
        conn.execute(
            text(
                """
                SELECT CompletedAt
                FROM LeadScoreBackfillState
                WHERE BackfillKey = :backfill_key
                LIMIT 1
                """
            ),
            {"backfill_key": backfill_key},
        )
        .mappings()
        .first()
    )
    if state_row is not None and state_row.get("CompletedAt"):
        return {"ran": False, "processed": 0}

    missing_rows = list(
        conn.execute(
            text(
                """
                SELECT l.LeadId
                FROM Leads l
                LEFT JOIN LeadScores ls ON ls.LeadId = l.LeadId
                WHERE ls.LeadId IS NULL
                """
            )
        ).mappings()
    )

    processed = 0
    for row in missing_rows:
        try:
            missing_lead_id = int(row["LeadId"])
            calculate_and_store_lead_score(conn, missing_lead_id)
            processed += 1
        except Exception:
            continue

    conn.execute(
        text(
            """
            UPDATE LeadScoreBackfillState
            SET CompletedAt = UTC_TIMESTAMP()
            WHERE BackfillKey = :backfill_key
            """
        ),
        {"backfill_key": backfill_key},
    )

    return {"ran": True, "processed": processed}


def calculate_and_store_lead_score(conn: Connection, lead_id: int) -> dict[str, Any]:
    ensure_lead_scores_table(conn)

    size_rows = list(
        conn.execute(
            text(
                """
                SELECT COLUMN_NAME
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = 'Leads'
                  AND COLUMN_NAME IN (
                    'CompanySize',
                    'EmployeeSize',
                    'CompanyEmployeeSize',
                    'EmployeeCount'
                  )
                """
            )
        ).mappings()
    )
    size_columns = {str(row["COLUMN_NAME"]) for row in size_rows}
    company_size_expr = "NULL"
    if "CompanySize" in size_columns:
        company_size_expr = "CAST(l.CompanySize AS CHAR)"
    elif "EmployeeSize" in size_columns:
        company_size_expr = "CAST(l.EmployeeSize AS CHAR)"
    elif "CompanyEmployeeSize" in size_columns:
        company_size_expr = "CAST(l.CompanyEmployeeSize AS CHAR)"
    elif "EmployeeCount" in size_columns:
        company_size_expr = "CAST(l.EmployeeCount AS CHAR)"

    lead = (
        conn.execute(
            text(
                f"""
                SELECT
                  l.LeadId,
                  {company_size_expr} AS CompanySize,
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
                WHERE l.LeadId = :lead_id
                  AND COALESCE(l.IsDeleted, 0) = 0
                LIMIT 1
                """
            ),
            {"lead_id": lead_id},
        )
        .mappings()
        .first()
    )
    if lead is None:
        raise ValueError(f"Lead {lead_id} was not found")

    contacts = list(
        conn.execute(
            text(
                """
                SELECT ContactTitle, ContactEmail, ContactPhone, LinkedInProfile
                FROM LeadContacts
                WHERE LeadId = :lead_id
                """
            ),
            {"lead_id": lead_id},
        ).mappings()
    )

    has_company_size = bool(_as_text(lead["CompanySize"]))
    has_senior_dm = int(lead["DecisionMakerContacts"] or 0) > 0 or any(
        DECISION_MAKER_PATTERN.search(_as_text(row["ContactTitle"])) for row in contacts
    )
    has_work_email = int(lead["ContactsWithEmail"] or 0) > 0 or any(
        _has_work_email(_as_text(row["ContactEmail"])) for row in contacts
    )
    has_mobile_phone = int(lead["ContactsWithPhone"] or 0) > 0 or any(
        bool(_as_text(row["ContactPhone"])) for row in contacts
    )
    has_linkedin = int(lead["ContactsWithLinkedIn"] or 0) > 0 or any(
        bool(_as_text(row["LinkedInProfile"])) for row in contacts
    )

    industry_focus = _as_text(lead["IndustryFocus"]).lower()
    tags = _as_text(lead["Tags"]).lower()
    has_industry_match = bool(industry_focus) or any(hint in tags for hint in INDUSTRY_HINTS)
    contact_count = int(lead["ContactCount"] or len(contacts) or 0)
    activity_count = int(lead["ActivityCount"] or 0)
    recent_activity_count = int(lead["RecentActivityCount"] or 0)
    activity_type_count = int(lead["ActivityTypeCount"] or 0)
    opportunity_count = int(lead["OpportunityCount"] or 0)
    opportunities_with_engagement = int(lead["OpportunitiesWithEngagement"] or 0)
    project_count = int(lead["ProjectCount"] or 0)
    max_probability = _extract_max_probability_percent(lead["MaxProbabilityRange"])

    contact_signals_score = (
        (5 if has_work_email else 0)
        + (5 if has_mobile_phone else 0)
        + (5 if has_linkedin else 0)
        + (5 if has_senior_dm else 0)
    )
    activities_recent_score = (10 if activity_count > 0 else 0) + (10 if recent_activity_count > 0 else 0)

    opportunity_presence_score = 10 if opportunity_count > 0 else 0
    if max_probability >= 80:
        probability_score = 20
    elif max_probability >= 60:
        probability_score = 16
    elif max_probability >= 40:
        probability_score = 12
    elif max_probability >= 20:
        probability_score = 8
    elif max_probability > 0:
        probability_score = 4
    else:
        probability_score = 0
    opportunities_probability_score = opportunity_presence_score + probability_score

    account_type_name = _as_text(lead["AccountTypeName"]).lower()
    is_customer_like = account_type_name in {"account", "master account"}
    customer_project_relationship_score = (8 if is_customer_like else 0) + (7 if project_count > 0 else 0)

    engagement_multiple_contacts_score = (
        (7 if opportunities_with_engagement > 0 else 0)
        + (5 if contact_count >= 2 else 0)
        + (3 if activity_type_count >= 2 else 0)
    )

    profile_context_score = (2 if has_company_size else 0) + (3 if has_industry_match else 0)

    breakdown = {
        "contact_reachability_decision_maker": {
            "max": 20,
            "earned": _clamp(contact_signals_score, 0, 20),
            "details": {
                "has_work_email": has_work_email,
                "has_mobile_phone": has_mobile_phone,
                "has_linkedin": has_linkedin,
                "has_senior_decision_maker": has_senior_dm,
            },
        },
        "activities_recent_interactions": {
            "max": 20,
            "earned": _clamp(activities_recent_score, 0, 20),
            "details": {
                "activity_count": activity_count,
                "recent_activity_count": recent_activity_count,
            },
        },
        "opportunities_probability": {
            "max": 30,
            "earned": _clamp(opportunities_probability_score, 0, 30),
            "details": {
                "opportunity_count": opportunity_count,
                "max_probability_percent": max_probability,
            },
        },
        "customer_project_relationship": {
            "max": 15,
            "earned": _clamp(customer_project_relationship_score, 0, 15),
            "details": {
                "account_type": lead["AccountTypeName"] or "Lead",
                "project_count": project_count,
            },
        },
        "engagement_multiple_contacts": {
            "max": 15,
            "earned": _clamp(engagement_multiple_contacts_score, 0, 15),
            "details": {
                "opportunities_with_engagement": opportunities_with_engagement,
                "contact_count": contact_count,
                "activity_type_count": activity_type_count,
            },
        },
        "profile_context": {
            "max": 5,
            "earned": _clamp(profile_context_score, 0, 5),
            "details": {
                "has_company_size": has_company_size,
                "has_industry_match": has_industry_match,
            },
        },
    }

    score = int(sum(int(item["earned"]) for item in breakdown.values()))
    rating = _rating(score)
    breakdown_json = json.dumps(breakdown)

    conn.execute(
        text(
            """
            INSERT INTO LeadScores (LeadId, CompanyId, Score, Rating, Breakdown, CalculatedAt)
            SELECT :lead_id, l.CompanyId, :score, :rating, CAST(:breakdown AS JSON), UTC_TIMESTAMP()
            FROM Leads l
            WHERE l.LeadId = :lead_id
              AND l.CompanyId IS NOT NULL
            ON DUPLICATE KEY UPDATE
              Score = VALUES(Score),
              Rating = VALUES(Rating),
              Breakdown = VALUES(Breakdown),
              CalculatedAt = UTC_TIMESTAMP()
            """
        ),
        {
            "lead_id": lead_id,
            "score": score,
            "rating": rating,
            "breakdown": breakdown_json,
        },
    )

    return {
        "lead_id": lead_id,
        "score": score,
        "rating": rating,
        "breakdown": breakdown,
    }
