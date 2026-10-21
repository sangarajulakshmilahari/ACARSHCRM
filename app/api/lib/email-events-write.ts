export async function insertEmailEventForEmail(args: {
  poolOrConn: any;
  emailId: number;
  eventType: string;
  metadata?: unknown;
  eventTimeSql?: string | null;
  uniqueByEventType?: boolean;
  uniqueMetadataPath?: string;
  uniqueMetadataValue?: string;
}): Promise<{ inserted: boolean }> {
  const uniqueClauses: string[] = [];
  const uniqueParams: Array<string | number> = [];

  if (args.uniqueByEventType) {
    uniqueClauses.push("AND ev.EventType = ?");
    uniqueParams.push(args.eventType);
  }
  if (args.uniqueMetadataPath && args.uniqueMetadataValue != null) {
    uniqueClauses.push("AND JSON_UNQUOTE(JSON_EXTRACT(ev.Metadata, ?)) = ?");
    uniqueParams.push(args.uniqueMetadataPath, args.uniqueMetadataValue);
  }

  const notExistsSql = uniqueClauses.length
    ? `
        AND NOT EXISTS (
          SELECT 1
          FROM email_events ev
          WHERE ev.EmailId = e.EmailId
            ${uniqueClauses.join("\n            ")}
        )
      `
    : "";

  const [result]: any = await args.poolOrConn.query(
    `
      INSERT INTO email_events (EmailId, CompanyId, EventType, EventTime, Metadata)
      SELECT e.EmailId, e.CompanyId, ?, COALESCE(?, UTC_TIMESTAMP()), ?
      FROM emails e
      WHERE e.EmailId = ?
        AND e.CompanyId IS NOT NULL
        ${notExistsSql}
    `,
    [
      args.eventType,
      args.eventTimeSql || null,
      args.metadata == null ? null : JSON.stringify(args.metadata),
      args.emailId,
      ...uniqueParams,
    ]
  );

  return { inserted: Number(result?.affectedRows || 0) > 0 };
}
