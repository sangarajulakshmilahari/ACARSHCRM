import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/config/db";
import { getAuthUser } from "@/app/api/lib/auth";

async function getTableColumns(pool: any, tableName: string): Promise<Set<string>> {
  const [rows]: any = await pool.query(
    `
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
    `,
    [tableName]
  );
  return new Set((rows || []).map((r: any) => String(r.COLUMN_NAME)));
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const customerId = Number(params.id);
    if (!customerId || Number.isNaN(customerId)) {
      return NextResponse.json({ error: "Invalid customerId" }, { status: 400 });
    }

    const pool = await getPool();
    const masterCols = await getTableColumns(pool, "SOWMaster");

    const has = (name: string) => masterCols.has(name);
    const colOrNull = (name: string, alias?: string) =>
      has(name) ? `s.${name}` : `NULL AS ${alias || name}`;

    const [customerRows]: any = await pool.query(
      `
      SELECT LeadId, CompanyName
      FROM Leads
      WHERE LeadId = ?
      LIMIT 1
      `,
      [customerId]
    );

    const customer = customerRows?.[0];
    if (!customer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    const customerName = String(customer.CompanyName || "").trim();

    const [rows]: any = await pool.query(
      `
      SELECT
        s.SOWId,
        ${colOrNull("ProjectId")},
        p.ProjectName,
        ${colOrNull("SOWName")},
        ${colOrNull("Client")},
        ${has("FileName") ? "s.FileName" : has("SOWFileName") ? "s.SOWFileName AS FileName" : "NULL AS FileName"},
        ${colOrNull("EffectiveDate")},
        ${colOrNull("StartDate")},
        ${colOrNull("EndDate")},
        ${colOrNull("NumberOfPositions")},
        ${colOrNull("NumberOfResources")},
        ${colOrNull("UploadedOn")},
        ${colOrNull("ParseStatus")},
        ${colOrNull("ParseMessage")},
        ${colOrNull("VersionNo")},
        ${colOrNull("Status")},
        ${colOrNull("IsCurrent")},
        ${colOrNull("ReplacesSOWId")},
        ${colOrNull("ReplacedBySOWId")}
      FROM SOWMaster s
      LEFT JOIN Projects p
        ON ${has("ProjectId") ? "p.ProjectId = s.ProjectId" : "1 = 0"}
      WHERE ${has("IsActive") ? "s.IsActive = 1" : "1 = 1"}
        AND (
          (
            ${has("ProjectId") ? "s.ProjectId IS NOT NULL" : "1 = 0"}
            AND ${has("ProjectId") ? "s.ProjectId" : "0"} IN (
              SELECT ProjectId
              FROM Projects
              WHERE CustomerId = ?
                AND COALESCE(IsDeleted, 0) = 0
            )
          )
          OR (
            ${has("ProjectId") ? "s.ProjectId IS NULL" : "1 = 1"}
            AND LOWER(TRIM(COALESCE(${has("Client") ? "s.Client" : "''"}, ''))) = LOWER(TRIM(?))
          )
        )
      ORDER BY COALESCE(${has("IsCurrent") ? "s.IsCurrent" : "0"}, 0) DESC, ${has("UploadedOn") ? "s.UploadedOn" : "s.SOWId"} DESC, s.SOWId DESC
      `,
      [customerId, customerName]
    );

    const mapped = (rows || []).map((s: any) => ({
      SOWId: Number(s.SOWId),
      ProjectId: s.ProjectId === null || s.ProjectId === undefined ? null : Number(s.ProjectId),
      ProjectName: s.ProjectName || null,
      LinkedProjectLabel: s.ProjectId ? String(s.ProjectName || `Project #${s.ProjectId}`) : "Not Linked",
      SOWName: s.SOWName,
      Client: s.Client,
      FileName: s.FileName,
      EffectiveDate: s.EffectiveDate,
      StartDate: s.StartDate,
      EndDate: s.EndDate,
      NumberOfPositions: Number(s.NumberOfPositions || 0),
      NumberOfResources: Number(s.NumberOfResources || 0),
      UploadedOn: s.UploadedOn,
      ParseStatus: s.ParseStatus,
      ParseMessage: s.ParseMessage,
      VersionNo: Number(s.VersionNo || 1),
      Status: s.Status || "Active",
      IsCurrent: Number(s.IsCurrent || 0) === 1,
      ReplacesSOWId: s.ReplacesSOWId === null || s.ReplacesSOWId === undefined ? null : Number(s.ReplacesSOWId),
      ReplacedBySOWId:
        s.ReplacedBySOWId === null || s.ReplacedBySOWId === undefined ? null : Number(s.ReplacedBySOWId),
    }));

    // Fallback for legacy schemas that do not have version/current columns:
    // keep only the latest row per scope so Replace behaves as expected in UI list.
    const effectiveSows = has("IsCurrent")
      ? mapped
      : mapped.filter((item: any, idx: number, arr: any[]) => {
          const scopeKey = item.ProjectId !== null && item.ProjectId !== undefined
            ? `project:${item.ProjectId}`
            : `client:${String(item.Client || "").trim().toLowerCase()}`;
          const firstIndex = arr.findIndex((x: any) => {
            const otherScopeKey = x.ProjectId !== null && x.ProjectId !== undefined
              ? `project:${x.ProjectId}`
              : `client:${String(x.Client || "").trim().toLowerCase()}`;
            return otherScopeKey === scopeKey;
          });
          return firstIndex === idx;
        });

    return NextResponse.json({
      customer: {
        LeadId: Number(customer.LeadId),
        CompanyName: customerName,
      },
      sows: effectiveSows,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to fetch customer SOWs" }, { status: 500 });
  }
}

