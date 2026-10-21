export type NormalizedEmailAttachment = {
  fileName: string;
  contentType: string;
  sizeBytes: number;
  contentBase64: string;
  isInline: boolean;
  contentId: string | null;
};

export type EmailAttachmentMetadata = {
  attachmentId: number;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  isInline: boolean;
  contentId: string | null;
};

export const EMAIL_ATTACHMENT_ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/png",
  "image/jpeg",
]);

const INLINE_IMAGE_ALLOWED_TYPES = new Set(["image/png", "image/jpeg"]);

export const EMAIL_ATTACHMENT_LIMITS = {
  maxFiles: 10,
  maxFileSizeBytes: 5 * 1024 * 1024,
  maxTotalSizeBytes: 20 * 1024 * 1024,
};

function sanitizeFileName(name: string): string {
  return String(name || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\\/]+/g, "_")
    .trim()
    .slice(0, 255);
}

function normalizeMimeType(contentType: string): string {
  const raw = String(contentType || "").trim().toLowerCase();
  if (raw === "image/jpg") return "image/jpeg";
  return raw;
}

function normalizeContentId(value: string): string {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .slice(0, 120);
}

function stripDataUrlPrefix(base64: string): string {
  const raw = String(base64 || "").trim();
  const match = raw.match(/^data:[^;,]+;base64,(.*)$/i);
  return match?.[1] ? String(match[1]).trim() : raw;
}

function isValidBase64(value: string): boolean {
  if (!value) return false;
  if (!/^[a-zA-Z0-9+/=\s]+$/.test(value)) return false;
  try {
    Buffer.from(value, "base64");
    return true;
  } catch {
    return false;
  }
}

function sizeFromBase64(base64: string): number {
  try {
    return Buffer.from(base64, "base64").length;
  } catch {
    return 0;
  }
}

export function normalizeIncomingEmailAttachments(raw: any): {
  attachments: NormalizedEmailAttachment[];
  error?: string;
} {
  const items = Array.isArray(raw) ? raw : [];
  if (items.length === 0) return { attachments: [] };

  if (items.length > EMAIL_ATTACHMENT_LIMITS.maxFiles) {
    return {
      attachments: [],
      error: `A maximum of ${EMAIL_ATTACHMENT_LIMITS.maxFiles} attachments is allowed`,
    };
  }

  const attachments: NormalizedEmailAttachment[] = [];
  let totalBytes = 0;

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i] || {};
    const fileName = sanitizeFileName(String(item.fileName || ""));
    const contentType = normalizeMimeType(String(item.contentType || ""));
    const contentBase64 = stripDataUrlPrefix(String(item.contentBase64 || ""));
    const isInline = Boolean(item.isInline);
    const contentId = normalizeContentId(String(item.contentId || "")) || null;

    if (!fileName) {
      return { attachments: [], error: `Attachment #${i + 1} is missing file name` };
    }

    if (!EMAIL_ATTACHMENT_ALLOWED_MIME_TYPES.has(contentType)) {
      return {
        attachments: [],
        error: `${fileName} has unsupported file type`,
      };
    }

    if (!isValidBase64(contentBase64)) {
      return {
        attachments: [],
        error: `${fileName} has invalid file data`,
      };
    }

    const sizeBytes = sizeFromBase64(contentBase64);
    if (!sizeBytes) {
      return {
        attachments: [],
        error: `${fileName} is empty or unreadable`,
      };
    }

    if (sizeBytes > EMAIL_ATTACHMENT_LIMITS.maxFileSizeBytes) {
      return {
        attachments: [],
        error: `${fileName} exceeds 5MB size limit`,
      };
    }

    totalBytes += sizeBytes;
    if (totalBytes > EMAIL_ATTACHMENT_LIMITS.maxTotalSizeBytes) {
      return {
        attachments: [],
        error: "Total attachment size exceeds 20MB limit",
      };
    }

    if (isInline) {
      if (!INLINE_IMAGE_ALLOWED_TYPES.has(contentType)) {
        return {
          attachments: [],
          error: `${fileName} cannot be inserted inline (only PNG/JPEG)` ,
        };
      }
      if (!contentId) {
        return {
          attachments: [],
          error: `${fileName} is missing inline content id`,
        };
      }
    }

    attachments.push({
      fileName,
      contentType,
      sizeBytes,
      contentBase64,
      isInline,
      contentId,
    });
  }

  return { attachments };
}

export async function ensureEmailAttachmentSchema(poolOrConn: any): Promise<void> {
  await poolOrConn.query(
    `
      CREATE TABLE IF NOT EXISTS email_attachments (
        AttachmentId bigint NOT NULL AUTO_INCREMENT,
        EmailId bigint NOT NULL,
        CompanyId int NOT NULL,
        FileName varchar(255) NOT NULL,
        ContentType varchar(150) NOT NULL,
        SizeBytes int NOT NULL,
        IsInline tinyint(1) NOT NULL DEFAULT 0,
        ContentId varchar(120) NULL,
        ContentBase64 longtext NOT NULL,
        CreatedAt datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (AttachmentId),
        KEY idx_email_attachments_emailid (EmailId),
        KEY idx_email_attachments_companyid (CompanyId)
      )
    `
  );
}

export async function saveEmailAttachments(args: {
  poolOrConn: any;
  emailId: number;
  attachments: NormalizedEmailAttachment[];
}): Promise<void> {
  const { poolOrConn, emailId, attachments } = args;
  if (!attachments.length) return;

  await ensureEmailAttachmentSchema(poolOrConn);

  for (const attachment of attachments) {
    await poolOrConn.query(
      `
        INSERT INTO email_attachments (
          EmailId,
          CompanyId,
          FileName,
          ContentType,
          SizeBytes,
          IsInline,
          ContentId,
          ContentBase64,
          CreatedAt
        )
        SELECT
          e.EmailId,
          e.CompanyId,
          ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP()
        FROM emails e
        WHERE e.EmailId = ?
          AND e.CompanyId IS NOT NULL
      `,
      [
        attachment.fileName,
        attachment.contentType,
        attachment.sizeBytes,
        attachment.isInline ? 1 : 0,
        attachment.contentId,
        attachment.contentBase64,
        emailId,
      ]
    );
  }
}

export async function getEmailAttachments(args: {
  poolOrConn: any;
  emailId: number;
  companyId?: number | null;
  includeContent?: boolean;
}): Promise<Array<EmailAttachmentMetadata & { contentBase64?: string }>> {
  const { poolOrConn, emailId, includeContent = false } = args;
  const companyId = Number(args.companyId);

  await ensureEmailAttachmentSchema(poolOrConn);

  const [rows]: any = await poolOrConn.query(
    `
      SELECT
        a.AttachmentId,
        a.FileName,
        a.ContentType,
        a.SizeBytes,
        a.IsInline,
        a.ContentId,
        ${includeContent ? "a.ContentBase64" : "NULL AS ContentBase64"}
      FROM email_attachments a
      INNER JOIN emails e
        ON e.EmailId = a.EmailId
       AND e.CompanyId IS NOT NULL
      WHERE a.EmailId = ?
        ${companyId > 0 ? "AND e.CompanyId = ?" : ""}
      ORDER BY a.AttachmentId ASC
    `,
    companyId > 0 ? [emailId, companyId] : [emailId]
  );

  return (Array.isArray(rows) ? rows : []).map((row: any) => ({
    attachmentId: Number(row.AttachmentId || 0),
    fileName: String(row.FileName || ""),
    contentType: String(row.ContentType || ""),
    sizeBytes: Number(row.SizeBytes || 0),
    isInline: Boolean(Number(row.IsInline || 0)),
    contentId: row.ContentId ? String(row.ContentId) : null,
    ...(includeContent ? { contentBase64: String(row.ContentBase64 || "") } : {}),
  }));
}

export async function getEmailAttachmentSummaryByEmailIds(args: {
  poolOrConn: any;
  emailIds: number[];
}): Promise<Map<number, EmailAttachmentMetadata[]>> {
  const ids = Array.from(
    new Set((Array.isArray(args.emailIds) ? args.emailIds : []).map((v) => Number(v || 0)))
  ).filter((id) => Number.isInteger(id) && id > 0);

  const map = new Map<number, EmailAttachmentMetadata[]>();
  if (!ids.length) return map;

  await ensureEmailAttachmentSchema(args.poolOrConn);

  const [rows]: any = await args.poolOrConn.query(
    `
      SELECT
        AttachmentId,
        EmailId,
        FileName,
        ContentType,
        SizeBytes,
        IsInline,
        ContentId
      FROM email_attachments
      WHERE EmailId IN (${ids.map(() => "?").join(",")})
      ORDER BY AttachmentId ASC
    `,
    ids
  );

  for (const row of Array.isArray(rows) ? rows : []) {
    const emailId = Number(row.EmailId || 0);
    if (!emailId) continue;
    const current = map.get(emailId) || [];
    current.push({
      attachmentId: Number(row.AttachmentId || 0),
      fileName: String(row.FileName || ""),
      contentType: String(row.ContentType || ""),
      sizeBytes: Number(row.SizeBytes || 0),
      isInline: Boolean(Number(row.IsInline || 0)),
      contentId: row.ContentId ? String(row.ContentId) : null,
    });
    map.set(emailId, current);
  }

  return map;
}

export function mapToGraphFileAttachments(
  attachments: Array<EmailAttachmentMetadata & { contentBase64?: string }>
): Array<{
  name: string;
  contentType: string;
  contentBytes: string;
  isInline: boolean;
  contentId?: string;
}> {
  return (Array.isArray(attachments) ? attachments : []).map((att) => ({
    name: String(att.fileName || ""),
    contentType: String(att.contentType || "application/octet-stream"),
    contentBytes: String(att.contentBase64 || ""),
    isInline: Boolean(att.isInline),
    ...(att.contentId ? { contentId: String(att.contentId) } : {}),
  }));
}

