import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/config/db";
import { getAuthUser } from "@/app/api/lib/auth";
import { CompanyRequiredError, requireCompanyId } from "@/app/api/lib/company-tenancy";
import {
  buildLeadOwnerVisibilityClause,
  hasGlobalLeadAccess,
} from "@/app/api/lib/lead-access";

function toStartOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function toEndOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function parseDateParam(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toDateInputValue(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function GET(req: NextRequest) {
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const companyId = requireCompanyId(authUser);

    const pool = await getPool();
    const hasGlobalAccess = hasGlobalLeadAccess(authUser.roleId);
    const visibility = buildLeadOwnerVisibilityClause(authUser, "l");

    const query = req.nextUrl.searchParams;
    const requestedFrom = parseDateParam(query.get("from"));
    const requestedTo = parseDateParam(query.get("to"));
    const requestedUserIdRaw = query.get("userId");
    const requestedSearchRaw = query.get("search");
    const requestedSourceRaw = query.get("source")?.toLowerCase() ?? "all";

    if (
      requestedUserIdRaw !== null &&
      (requestedUserIdRaw.trim() === "" || !Number.isInteger(Number(requestedUserIdRaw)) || Number(requestedUserIdRaw) <= 0)
    ) {
      return NextResponse.json({ error: "Invalid userId filter" }, { status: 400 });
    }

    const requestedUserId = requestedUserIdRaw ? Number(requestedUserIdRaw) : null;
    const requestedSearch = (requestedSearchRaw ?? "").trim();

    if (requestedSearch.length > 150) {
      return NextResponse.json({ error: "Search text is too long" }, { status: 400 });
    }

    const allowedSources = new Set(["all", "leads", "prospects", "accounts"]);
    if (!allowedSources.has(requestedSourceRaw)) {
      return NextResponse.json({ error: "Invalid activity source filter" }, { status: 400 });
    }

    const now = new Date();
    const defaultTo = toStartOfDay(now);
    const defaultFrom = new Date(defaultTo);
    defaultFrom.setDate(defaultFrom.getDate() - 6);

    const fromDate = toStartOfDay(requestedFrom ?? defaultFrom);
    const toDate = toEndOfDay(requestedTo ?? defaultTo);

    if (fromDate > toDate) {
      return NextResponse.json(
        { error: "Invalid date range: from date cannot be after to date" },
        { status: 400 }
      );
    }

    const page = Math.max(1, Number(query.get("page") ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.get("pageSize") ?? 20)));
    const offset = (page - 1) * pageSize;

    const whereClauses: string[] = ["la.ActivityDate BETWEEN ? AND ?", "l.CompanyId = ?"];
    const baseParams: (string | number | Date)[] = [fromDate, toDate, companyId];
    const effectiveUserId = hasGlobalAccess ? requestedUserId : null;

    if (requestedSourceRaw === "leads") {
      whereClauses.push("(at.Name IS NULL OR at.Name NOT IN ('Prospect', 'Account'))");
    } else if (requestedSourceRaw === "prospects") {
      whereClauses.push("at.Name = 'Prospect'");
    } else if (requestedSourceRaw === "accounts") {
      whereClauses.push("at.Name = 'Account'");
    }

    if (requestedSearch) {
      whereClauses.push("(l.CompanyName LIKE ? OR COALESCE(lc.ContactName, '') LIKE ? OR COALESCE(la.Notes, '') LIKE ? OR COALESCE(la.ActivityType, '') LIKE ?)");
      const likeSearch = `%${requestedSearch}%`;
      baseParams.push(likeSearch, likeSearch, likeSearch, likeSearch);
    }

    if (effectiveUserId) {
      whereClauses.push("(la.CreatedBy = ? OR l.OwnerId = ?)");
      baseParams.push(effectiveUserId, effectiveUserId);
    } else if (!hasGlobalAccess) {
      whereClauses.push(visibility.clause);
      baseParams.push(...visibility.params);
    }

    const whereSql = `WHERE ${whereClauses.join(" AND ")}`;

    const [countRows]: any = await pool.query(
      `
      SELECT COUNT(*) AS total
      FROM LeadActivities la
      INNER JOIN Leads l
        ON l.LeadId = la.LeadId
      LEFT JOIN LeadContacts lc
        ON lc.LeadContactID = la.ContactId
      LEFT JOIN AccountTypes at
        ON at.AccountTypeId = l.AccountTypeId
      ${whereSql}
      `,
      baseParams
    );

    const total = Number(countRows?.[0]?.total ?? 0);

    const [rows]: any = await pool.query(
      `
      SELECT
        la.ActivityId,
        la.ActivityDate,
        COALESCE(lc.ContactName, '') AS ContactName,
        l.CompanyName,
        la.ActivityType,
        la.Notes,
        CASE
          WHEN at.Name = 'Prospect' THEN 'Prospects'
          WHEN at.Name = 'Account' THEN 'Customers'
          ELSE 'Leads'
        END AS ActivitySource,
        l.OwnerId AS ActivityOwnerId,
        COALESCE(ownerUser.UserName, '') AS ActivityOwnerName,
        la.CreatedBy AS CreatedByUserId,
        COALESCE(createdByUser.UserName, '') AS CreatedByUserName
      FROM LeadActivities la
      INNER JOIN Leads l
        ON l.LeadId = la.LeadId
      LEFT JOIN LeadContacts lc
        ON lc.LeadContactID = la.ContactId
      LEFT JOIN AccountTypes at
        ON at.AccountTypeId = l.AccountTypeId
      LEFT JOIN Users ownerUser
        ON ownerUser.UserId = l.OwnerId
      LEFT JOIN Users createdByUser
        ON createdByUser.UserId = la.CreatedBy
      ${whereSql}
      ORDER BY la.ActivityDate DESC, la.ActivityId DESC
      LIMIT ? OFFSET ?
      `,
      [...baseParams, pageSize, offset]
    );

    const [currentUserRows]: any = await pool.query(
      `
      SELECT UserId, UserName, RoleId
      FROM Users
      WHERE UserId = ?
      LIMIT 1
      `,
      [authUser.userId]
    );

    const currentUser = currentUserRows?.[0]
      ? {
          userId: Number(currentUserRows[0].UserId),
          userName: String(currentUserRows[0].UserName ?? ""),
          roleId: Number(currentUserRows[0].RoleId),
        }
      : {
          userId: authUser.userId,
          userName: "",
          roleId: authUser.roleId,
        };

    const [userRows]: any = await pool.query(
      hasGlobalAccess
        ? `
          SELECT DISTINCT u.UserId, u.UserName
          FROM Users u
          INNER JOIN CompanyUsers cu
            ON cu.UserId = u.UserId
           AND cu.CompanyId = ?
           AND cu.IsActive = 1
          WHERE u.UserName IS NOT NULL
          ORDER BY u.UserName
        `
        : `
          SELECT UserId, UserName
          FROM Users
          WHERE UserId = ?
          LIMIT 1
        `,
      hasGlobalAccess ? [companyId] : [authUser.userId]
    );

    const users = (userRows ?? []).map((u: any) => ({
      UserId: Number(u.UserId),
      UserName: String(u.UserName ?? ""),
    }));

    return NextResponse.json({
      items: rows,
      users,
      currentUser,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
      filters: {
        from: toDateInputValue(fromDate),
        to: toDateInputValue(toDate),
        userId: effectiveUserId,
        search: requestedSearch,
        source: requestedSourceRaw,
      },
    });
  } catch (error) {
    if (error instanceof CompanyRequiredError) {
      return NextResponse.json({ error: "Company membership required" }, { status: 403 });
    }
    console.error("Reports API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch reports" },
      { status: 500 }
    );
  }
}

