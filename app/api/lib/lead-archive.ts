export async function ensureLeadArchiveColumn(poolOrConn: any): Promise<void> {
  const [cols]: any = await poolOrConn.query(
    `SHOW COLUMNS FROM Leads LIKE 'IsArchived'`
  );

  if (Array.isArray(cols) && cols.length > 0) {
    return;
  }

  await poolOrConn.query(
    `ALTER TABLE Leads
     ADD COLUMN IsArchived TINYINT(1) NOT NULL DEFAULT 0`
  );
}

export function wantsArchivedList(reqUrl: string): boolean {
  const raw = String(new URL(reqUrl).searchParams.get("archived") || "")
    .trim()
    .toLowerCase();
  return raw === "1" || raw === "true" || raw === "archived";
}

export function leadArchiveWhereClause(archived: boolean): string {
  return archived
    ? "COALESCE(l.IsArchived, 0) = 1"
    : "COALESCE(l.IsArchived, 0) = 0";
}

export async function setLeadArchived(
  poolOrConn: any,
  leadId: number,
  isArchived: boolean
): Promise<boolean> {
  await ensureLeadArchiveColumn(poolOrConn);
  const value = isArchived ? 1 : 0;

  try {
    const [result]: any = await poolOrConn.query(
      `
      UPDATE Leads
      SET IsArchived = ?,
          ModifiedOn = NOW()
      WHERE LeadId = ?
      `,
      [value, leadId]
    );
    return Number(result?.affectedRows || 0) > 0;
  } catch {
    const [result]: any = await poolOrConn.query(
      `
      UPDATE Leads
      SET IsArchived = ?
      WHERE LeadId = ?
      `,
      [value, leadId]
    );
    return Number(result?.affectedRows || 0) > 0;
  }
}
