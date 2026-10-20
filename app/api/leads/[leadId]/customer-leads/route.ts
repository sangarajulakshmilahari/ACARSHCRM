import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/config/db";
import { resolveAuthUser } from "@/app/api/lib/auth";
import { canUserViewLeadById } from "@/app/api/lib/lead-access";
import { ensureLeadArchiveColumn } from "@/app/api/lib/lead-archive";

function parseScoreBreakdown(raw: unknown): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === "object") return raw as Record<string, any>;
  if (typeof raw !== "string") return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: { leadId: string } }
) {
  try {
    const authUser = await resolveAuthUser(req);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const leadId = Number(params.leadId);
    if (!Number.isFinite(leadId) || leadId <= 0) {
      return NextResponse.json({ error: "Invalid leadId" }, { status: 400 });
    }

    const pool = await getPool();
    await ensureLeadArchiveColumn(pool);
    const hasAccess = await canUserViewLeadById(pool, authUser, leadId);
    if (!hasAccess) {
      return NextResponse.json(
        { error: "You do not have access to this lead" },
        { status: 403 }
      );
    }

    const [rows]: any = await pool.query(
      `
      SELECT
        l.LeadId,
        l.CompanyName,
        l.CompanyLocation,
        l.LeadSource,
        latestStatus.StatusName,
        u.UserName AS OwnerName,
        DATE_FORMAT(l.LeadDate, '%Y-%m-%d') AS LeadDate,
        DATE_FORMAT(l.CreatedOn, '%Y-%m-%d') AS CreatedOn,
        lscr.Score AS LeadScore,
        lscr.Rating AS LeadScoreRating,
        lscr.Breakdown AS LeadScoreBreakdown,
        lc.ContactName,
        lc.ContactTitle,
        lc.ContactEmail,
        lc.ContactPhone,
        cr.Role AS ContactRoleName
      FROM customer_leads cl
      INNER JOIN Leads l
        ON l.LeadId = cl.LeadId
      LEFT JOIN Users u
        ON u.UserId = l.OwnerId
      LEFT JOIN LeadScores lscr
        ON lscr.LeadId = l.LeadId
      LEFT JOIN LeadContacts lc
        ON lc.LeadId = l.LeadId
      LEFT JOIN ContactRoles cr
        ON lc.ContactRoleId = cr.RoleId
      LEFT JOIN (
        SELECT la1.LeadId, ls1.StatusName
        FROM LeadActivities la1
        LEFT JOIN LeadStatuses ls1 ON la1.StatusId = ls1.StatusId
        INNER JOIN (
          SELECT LeadId, MAX(ActivityDate) AS MaxActivityDate
          FROM LeadActivities
          GROUP BY LeadId
        ) la2 ON la1.LeadId = la2.LeadId AND la1.ActivityDate = la2.MaxActivityDate
      ) latestStatus ON latestStatus.LeadId = l.LeadId
      WHERE cl.CustomerId = ?
        AND COALESCE(cl.IsDeleted, 0) = 0
        AND COALESCE(l.IsDeleted, 0) = 0
        AND COALESCE(l.IsArchived, 0) = 0
      ORDER BY l.LeadDate DESC, l.LeadId DESC
      `,
      [leadId]
    );

    const grouped: Record<number, any> = {};

    (Array.isArray(rows) ? rows : []).forEach((row: any) => {
      const mappedLeadId = Number(row.LeadId);
      if (!Number.isFinite(mappedLeadId) || mappedLeadId <= 0) return;

      if (!grouped[mappedLeadId]) {
        grouped[mappedLeadId] = {
          LeadId: mappedLeadId,
          CompanyName: row.CompanyName ?? null,
          CompanyLocation: row.CompanyLocation ?? null,
          LeadSource: row.LeadSource ?? null,
          StatusName: row.StatusName ?? null,
          OwnerName: row.OwnerName ?? null,
          LeadDate: row.LeadDate ?? null,
          CreatedOn: row.CreatedOn ?? null,
          LeadScore: row.LeadScore ?? 0,
          LeadScoreRating: row.LeadScoreRating ?? "COLD",
          LeadScoreBreakdown: parseScoreBreakdown(row.LeadScoreBreakdown),
          Contacts: [] as Array<{
            ContactName?: string | null;
            ContactTitle?: string | null;
            ContactEmail?: string | null;
            ContactPhone?: string | null;
            ContactRoleName?: string | null;
          }>,
        };
      }

      if (row.ContactName || row.ContactEmail || row.ContactPhone) {
        grouped[mappedLeadId].Contacts.push({
          ContactName: row.ContactName ?? null,
          ContactTitle: row.ContactTitle ?? null,
          ContactEmail: row.ContactEmail ?? null,
          ContactPhone: row.ContactPhone ?? null,
          ContactRoleName: row.ContactRoleName ?? null,
        });
      }
    });

    return NextResponse.json({
      leadId,
      customerLeads: Object.values(grouped),
    });
  } catch (error) {
    console.error("Get customer leads error:", error);
    return NextResponse.json(
      { error: "Failed to fetch customer leads" },
      { status: 500 }
    );
  }
}
