import { createHash, createHmac, timingSafeEqual } from "crypto";
import { insertEmailEventForEmail } from "@/app/api/lib/email-events-write";
import { plainTextToEmailHtmlWithOptions } from "@/app/utils/email-content";

export const SUPPRESSED_STATUS = "SUPPRESSED";
export const SUPPRESSED_EVENT = "SUPPRESSED";
export const UNSUBSCRIBE_PURPOSE = "email_unsubscribe";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

export type UnsubscribeTokenPayload = {
  purpose: typeof UNSUBSCRIBE_PURPOSE;
  emailId: number;
  emailHash: string;
  exp: number;
};

export type UnsubscribeTokenResult =
  | { ok: true; payload: UnsubscribeTokenPayload }
  | { ok: false; reason: "invalid" | "expired" | "secret_missing" };

function trim(value: unknown): string {
  return String(value ?? "").trim();
}

export function normalizeRecipientEmail(value: unknown): string {
  return trim(value).toLowerCase();
}

export function isNormalizedEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value) && value.length <= 254;
}

export function hashNormalizedEmail(normalizedEmail: string): string {
  return createHash("sha256").update(normalizedEmail, "utf8").digest("hex");
}

export function getUnsubscribeSecret(): string | null {
  const secret = trim(process.env.EMAIL_UNSUBSCRIBE_SECRET);
  return secret || null;
}

export function getUnsubscribeTokenTtlSeconds(): number {
  const raw = Number(process.env.EMAIL_UNSUBSCRIBE_TOKEN_TTL_SECONDS || 34_560_000);
  if (!Number.isFinite(raw)) return 34_560_000;
  return Math.max(86_400, Math.min(63_072_000, Math.floor(raw)));
}

export function getUnsubscribePublicBaseUrl(): string | null {
  const explicit = trim(process.env.EMAIL_UNSUBSCRIBE_BASE_URL);
  const publicBase = trim(process.env.NEXT_PUBLIC_BASE_URL);
  const authBase = trim(process.env.NEXTAUTH_URL);
  const base = explicit || publicBase || authBase;
  return base ? base.replace(/\/$/, "") : null;
}

function encodePart(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodePart(value: string): string | null {
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

function signPayload(payloadPart: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadPart).digest("base64url");
}

function signaturesEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function createUnsubscribeToken(input: {
  emailId: number;
  normalizedEmail: string;
  nowMs?: number;
}): string | null {
  const secret = getUnsubscribeSecret();
  if (!secret) return null;
  const emailId = Number(input.emailId || 0);
  const normalizedEmail = normalizeRecipientEmail(input.normalizedEmail);
  if (!Number.isInteger(emailId) || emailId <= 0 || !isNormalizedEmail(normalizedEmail)) {
    return null;
  }
  const nowMs = Number.isFinite(Number(input.nowMs)) ? Number(input.nowMs) : Date.now();
  const payload = {
    p: UNSUBSCRIBE_PURPOSE,
    e: emailId,
    h: hashNormalizedEmail(normalizedEmail),
    exp: Math.floor(nowMs / 1000) + getUnsubscribeTokenTtlSeconds(),
  };
  const payloadPart = encodePart(JSON.stringify(payload));
  return `v1.${payloadPart}.${signPayload(payloadPart, secret)}`;
}

export function validateUnsubscribeToken(
  token: unknown,
  nowMs = Date.now()
): UnsubscribeTokenResult {
  const secret = getUnsubscribeSecret();
  if (!secret) return { ok: false, reason: "secret_missing" };

  const raw = trim(token);
  if (!raw || raw.length > 2000) return { ok: false, reason: "invalid" };

  const parts = raw.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return { ok: false, reason: "invalid" };

  const payloadPart = parts[1];
  const signature = parts[2];
  if (!payloadPart || !signature) return { ok: false, reason: "invalid" };
  if (!signaturesEqual(signPayload(payloadPart, secret), signature)) {
    return { ok: false, reason: "invalid" };
  }

  const json = decodePart(payloadPart);
  if (!json) return { ok: false, reason: "invalid" };

  let parsed: any;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, reason: "invalid" };
  }

  const purpose = trim(parsed?.p);
  const emailId = Number(parsed?.e || 0);
  const emailHash = trim(parsed?.h).toLowerCase();
  const exp = Number(parsed?.exp || 0);
  if (purpose !== UNSUBSCRIBE_PURPOSE) return { ok: false, reason: "invalid" };
  if (!Number.isInteger(emailId) || emailId <= 0) return { ok: false, reason: "invalid" };
  if (!/^[a-f0-9]{64}$/.test(emailHash)) return { ok: false, reason: "invalid" };
  if (!Number.isFinite(exp) || exp <= 0) return { ok: false, reason: "invalid" };
  if (exp * 1000 <= nowMs) return { ok: false, reason: "expired" };

  return {
    ok: true,
    payload: {
      purpose: UNSUBSCRIBE_PURPOSE,
      emailId,
      emailHash,
      exp,
    },
  };
}

export function appendUnsubscribeFooter(html: string, token: string | null): string {
  const base = getUnsubscribePublicBaseUrl();
  if (!token || !base) return html;
  const href = `${base}/unsubscribe?token=${encodeURIComponent(token)}`;
  const footer =
    `<p style="font-size:12px;line-height:1.5;color:#64748b;margin-top:24px;padding-top:12px;border-top:1px solid #e2e8f0;">` +
    `If you no longer wish to receive these emails, ` +
    `<a href="${href}" rel="noreferrer noopener">unsubscribe</a>.</p>`;
  return `${html}\n${footer}`;
}

export function buildSendableHtmlWithUnsubscribe(args: {
  body: string;
  inlineContentIds?: string[];
  emailId: number;
  toEmail: string;
}): string {
  const html = plainTextToEmailHtmlWithOptions(String(args.body || ""), {
    inlineContentIds: args.inlineContentIds || [],
  });
  const token = createUnsubscribeToken({
    emailId: args.emailId,
    normalizedEmail: normalizeRecipientEmail(args.toEmail),
  });
  return appendUnsubscribeFooter(html, token);
}

export async function ensureEmailSuppressionSchema(poolOrConn: any): Promise<void> {
  await poolOrConn.query(
    `
      CREATE TABLE IF NOT EXISTS email_suppressions (
        SuppressionId BIGINT NOT NULL AUTO_INCREMENT,
        NormalizedEmail VARCHAR(254) NOT NULL,
        Reason VARCHAR(32) NOT NULL,
        Source VARCHAR(32) NOT NULL,
        EmailId BIGINT NULL,
        LeadContactID BIGINT NULL,
        CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CreatedByUserId INT NULL,
        RevokedAt DATETIME NULL,
        RevokedByUserId INT NULL,
        PRIMARY KEY (SuppressionId),
        UNIQUE KEY uq_email_suppressions_normalized_email (NormalizedEmail),
        KEY idx_email_suppressions_active (RevokedAt, NormalizedEmail)
      )
    `
  );
}

export async function isEmailSuppressed(
  poolOrConn: any,
  email: unknown,
  companyId?: number | null
): Promise<boolean> {
  const normalized = normalizeRecipientEmail(email);
  if (!isNormalizedEmail(normalized)) return false;
  const scopedCompanyId = Number(companyId);
  if (!(scopedCompanyId > 0)) {
    throw new Error("COMPANY_REQUIRED");
  }
  await ensureEmailSuppressionSchema(poolOrConn);
  const [rows]: any = await poolOrConn.query(
    `
      SELECT SuppressionId
      FROM email_suppressions
      WHERE NormalizedEmail = ?
        AND CompanyId = ?
        AND RevokedAt IS NULL
      LIMIT 1
    `,
    [normalized, scopedCompanyId]
  );
  return Array.isArray(rows) && rows.length > 0;
}

export async function upsertEmailSuppression(args: {
  poolOrConn: any;
  normalizedEmail: string;
  reason: "UNSUBSCRIBE" | "MANUAL" | "BOUNCE";
  source: "LINK" | "OPERATOR" | "PROVIDER";
  emailId?: number | null;
  leadContactId?: number | null;
  createdByUserId?: number | null;
  companyId?: number | null;
}): Promise<{ created: boolean; already: boolean }> {
  const normalizedEmail = normalizeRecipientEmail(args.normalizedEmail);
  if (!isNormalizedEmail(normalizedEmail)) {
    throw new Error("INVALID_EMAIL");
  }
  await ensureEmailSuppressionSchema(args.poolOrConn);

  let companyId = Number(args.companyId);
  if (!(companyId > 0) && args.emailId) {
    const [emailRows]: any = await args.poolOrConn.query(
      `SELECT CompanyId FROM emails WHERE EmailId = ? LIMIT 1`,
      [args.emailId]
    );
    companyId = Number(emailRows?.[0]?.CompanyId);
  }
  if (!(companyId > 0) && args.leadContactId) {
    const [contactRows]: any = await args.poolOrConn.query(
      `SELECT CompanyId FROM leadcontacts WHERE LeadContactID = ? LIMIT 1`,
      [args.leadContactId]
    );
    companyId = Number(contactRows?.[0]?.CompanyId);
  }
  if (!(companyId > 0)) {
    throw new Error("COMPANY_REQUIRED");
  }

  const [existingRows]: any = await args.poolOrConn.query(
    `
      SELECT SuppressionId, RevokedAt
      FROM email_suppressions
      WHERE NormalizedEmail = ?
        AND CompanyId = ?
      LIMIT 1
    `,
    [normalizedEmail, companyId]
  );
  const existing = Array.isArray(existingRows) && existingRows[0] ? existingRows[0] : null;
  if (existing && existing.RevokedAt == null) {
    return { created: false, already: true };
  }

  await args.poolOrConn.query(
    `
      INSERT INTO email_suppressions (
        CompanyId,
        NormalizedEmail,
        Reason,
        Source,
        EmailId,
        LeadContactID,
        CreatedAt,
        CreatedByUserId,
        RevokedAt,
        RevokedByUserId
      )
      VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), ?, NULL, NULL)
      ON DUPLICATE KEY UPDATE
        Reason = VALUES(Reason),
        Source = VALUES(Source),
        EmailId = VALUES(EmailId),
        LeadContactID = VALUES(LeadContactID),
        CreatedAt = UTC_TIMESTAMP(),
        CreatedByUserId = VALUES(CreatedByUserId),
        RevokedAt = NULL,
        RevokedByUserId = NULL
    `,
    [
      companyId,
      normalizedEmail,
      args.reason,
      args.source,
      args.emailId ?? null,
      args.leadContactId ?? null,
      args.createdByUserId ?? null,
    ]
  );

  return { created: true, already: false };
}

export async function pauseActiveEnrollmentsForNormalizedEmail(args: {
  poolOrConn: any;
  normalizedEmail: string;
  companyId?: number | null;
}): Promise<number> {
  const companyId = Number(args.companyId);
  if (!(companyId > 0)) {
    throw new Error("COMPANY_REQUIRED");
  }
  const [result]: any = await args.poolOrConn.query(
    `
      UPDATE email_sequence_contacts esc
      INNER JOIN leadcontacts lc
        ON lc.LeadContactID = esc.LeadContactID
      SET esc.Status = 'PAUSED',
          esc.NextActionAt = NULL
      WHERE UPPER(esc.Status) = 'ACTIVE'
        AND LOWER(TRIM(lc.ContactEmail)) = ?
        AND lc.CompanyId = ?
    `,
    [args.normalizedEmail, companyId]
  );
  return Number(result?.affectedRows || 0);
}

export async function applyUnsubscribeFromToken(args: {
  pool: any;
  token: unknown;
  confirm: boolean;
  nowMs?: number;
}): Promise<{ ok: boolean; already?: boolean; reason?: string }> {
  if (args.confirm !== true) {
    return { ok: false, reason: "confirm_required" };
  }

  const parsed = validateUnsubscribeToken(args.token, args.nowMs);
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason };
  }

  await ensureEmailSuppressionSchema(args.pool);

  const [emailRows]: any = await args.pool.query(
    `
      SELECT EmailId, ToEmail, LeadContactID, CompanyId
      FROM emails
      WHERE EmailId = ?
      LIMIT 1
    `,
    [parsed.payload.emailId]
  );
  const email = Array.isArray(emailRows) && emailRows[0] ? emailRows[0] : null;
  if (!email) {
    return { ok: true, already: true };
  }

  const normalizedEmail = normalizeRecipientEmail(email.ToEmail);
  if (!isNormalizedEmail(normalizedEmail)) {
    return { ok: false, reason: "invalid" };
  }
  if (hashNormalizedEmail(normalizedEmail) !== parsed.payload.emailHash) {
    return { ok: false, reason: "invalid" };
  }

  const upserted = await upsertEmailSuppression({
    poolOrConn: args.pool,
    normalizedEmail,
    reason: "UNSUBSCRIBE",
    source: "LINK",
    emailId: Number(email.EmailId),
    leadContactId: Number(email.LeadContactID || 0) || null,
    companyId: Number(email.CompanyId) || null,
  });

  if (upserted.created) {
    await pauseActiveEnrollmentsForNormalizedEmail({
      poolOrConn: args.pool,
      normalizedEmail,
      companyId: Number(email.CompanyId) || null,
    });
    await insertEmailEventForEmail({
      poolOrConn: args.pool,
      emailId: Number(email.EmailId),
      eventType: SUPPRESSED_EVENT,
      uniqueByEventType: true,
      metadata: {
        source: "unsubscribe-link",
        reason: "UNSUBSCRIBE",
      },
    });
  }

  return { ok: true, already: upserted.already };
}

export async function blockDispatchIfSuppressed(args: {
  pool: any;
  emailId: number;
  toEmail: string;
  sequenceId?: number | null;
  leadContactId?: number | null;
}): Promise<{ blocked: boolean; reason?: string }> {
  const [emailRows]: any = await args.pool.query(
    `SELECT CompanyId FROM emails WHERE EmailId = ? LIMIT 1`,
    [args.emailId]
  );
  const companyId = Number(emailRows?.[0]?.CompanyId);
  if (!(companyId > 0)) {
    return { blocked: true, reason: "COMPANY_REQUIRED" };
  }

  const suppressed = await isEmailSuppressed(args.pool, args.toEmail, companyId);
  if (!suppressed) {
    return { blocked: false };
  }

  await args.pool.query(
    `
      UPDATE emails
      SET Status = ?
      WHERE EmailId = ?
        AND Status = 'SENDING'
        AND CompanyId = ?
    `,
    [SUPPRESSED_STATUS, args.emailId, companyId]
  );

  await insertEmailEventForEmail({
    poolOrConn: args.pool,
    emailId: args.emailId,
    eventType: SUPPRESSED_EVENT,
    uniqueByEventType: true,
    metadata: {
      source: "dispatch",
      reason: "RECIPIENT_SUPPRESSED",
    },
  });

  if (Number(args.sequenceId || 0) > 0 && Number(args.leadContactId || 0) > 0) {
    await args.pool.query(
      `
        UPDATE email_sequence_contacts esc
        INNER JOIN leadcontacts lc
          ON lc.LeadContactID = esc.LeadContactID
         AND lc.CompanyId = ?
        SET esc.Status = 'PAUSED',
            esc.NextActionAt = NULL
        WHERE esc.SequenceId = ?
          AND esc.LeadContactID = ?
          AND UPPER(esc.Status) = 'ACTIVE'
      `,
      [companyId, Number(args.sequenceId), Number(args.leadContactId)]
    );
  }

  return { blocked: true, reason: "RECIPIENT_SUPPRESSED" };
}

export async function listActiveSuppressions(
  pool: any,
  companyId?: number | null
): Promise<
  Array<{
    suppressionId: number;
    normalizedEmail: string;
    reason: string;
    source: string;
    createdAt: string | null;
  }>
> {
  const scopedCompanyId = Number(companyId);
  if (!(scopedCompanyId > 0)) {
    throw new Error("COMPANY_REQUIRED");
  }
  await ensureEmailSuppressionSchema(pool);
  const [rows]: any = await pool.query(
    `
      SELECT SuppressionId, NormalizedEmail, Reason, Source, CreatedAt
      FROM email_suppressions
      WHERE RevokedAt IS NULL
        AND CompanyId = ?
      ORDER BY CreatedAt DESC, SuppressionId DESC
      LIMIT 200
    `,
    [scopedCompanyId]
  );
  return (Array.isArray(rows) ? rows : []).map((row: any) => ({
    suppressionId: Number(row.SuppressionId),
    normalizedEmail: String(row.NormalizedEmail || ""),
    reason: String(row.Reason || ""),
    source: String(row.Source || ""),
    createdAt: row.CreatedAt ? String(row.CreatedAt) : null,
  }));
}

export async function revokeSuppression(args: {
  pool: any;
  suppressionId: number;
  revokedByUserId: number;
  companyId?: number | null;
}): Promise<{ revoked: boolean }> {
  const companyId = Number(args.companyId);
  if (!(companyId > 0)) {
    throw new Error("COMPANY_REQUIRED");
  }
  await ensureEmailSuppressionSchema(args.pool);
  const [result]: any = await args.pool.query(
    `
      UPDATE email_suppressions
      SET RevokedAt = UTC_TIMESTAMP(),
          RevokedByUserId = ?
      WHERE SuppressionId = ?
        AND CompanyId = ?
        AND RevokedAt IS NULL
    `,
    [args.revokedByUserId, args.suppressionId, companyId]
  );
  return { revoked: Number(result?.affectedRows || 0) > 0 };
}
