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
    if (!authUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sowId = Number(params.id);
    if (!sowId || Number.isNaN(sowId)) {
      return NextResponse.json({ error: "Invalid sowId" }, { status: 400 });
    }

    const pool = await getPool();
    const masterCols = await getTableColumns(pool, "SOWMaster");
    const has = (name: string) => masterCols.has(name);
    const fileNameSelect = has("FileName")
      ? "FileName"
      : has("SOWFileName")
        ? "SOWFileName AS FileName"
        : "NULL AS FileName";
    const fileDataSelect = has("FileData")
      ? "FileData"
      : has("SOWFileData")
        ? "SOWFileData AS FileData"
        : "NULL AS FileData";

    const [rows]: any = await pool.query(
      `
      SELECT ${fileNameSelect}, ${fileDataSelect}
      FROM SOWMaster
      WHERE SOWId = ?
        ${has("IsActive") ? "AND IsActive = 1" : ""}
      LIMIT 1
      `,
      [sowId]
    );

    const row = rows?.[0];
    if (!row || !row.FileData) {
      return NextResponse.json({ error: "SOW file not found" }, { status: 404 });
    }

    const fileName = String(row.FileName || `SOW-${sowId}.docx`);
    const fileBuffer = Buffer.isBuffer(row.FileData) ? row.FileData : Buffer.from(row.FileData);

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${fileName.replace(/"/g, "")}"`,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to download SOW" }, { status: 500 });
  }
}

