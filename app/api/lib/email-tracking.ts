import { createHash, createHmac, timingSafeEqual } from "crypto";
import { insertEmailEventForEmail } from "@/app/api/lib/email-events-write";
import {
  getUnsubscribePublicBaseUrl,
  hashNormalizedEmail,
  normalizeRecipientEmail,
} from "@/app/api/lib/email-suppressions";

export const OPEN_EVENT = "OPEN";
export const CLICK_EVENT = "CLICK";
export const OPEN_PURPOSE = "email_open";
export const CLICK_PURPOSE = "email_click";

export const TRANSPARENT_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

const OPEN_TOKEN_TTL_SECONDS = 34_560_000;

function trim(value: unknown): string {
  return String(value ?? "").trim();
}

export function isEmailTrackingEnabled(): boolean {
  return trim(process.env.EMAIL_TRACKING_ENABLED).toLowerCase() === "true";
}

export function getTrackingSecret(): string | null {
  const secret = trim(process.env.EMAIL_TRACKING_SECRET);
  return secret || null;
}

function getTrackingBaseUrl(): string | null {
  const explicit = trim(process.env.EMAIL_TRACKING_BASE_URL);
  return explicit ? explicit.replace(/\/$/, "") : getUnsubscribePublicBaseUrl();
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

export function hashDestinationUrl(url: string): string {
  return createHash("sha256").update(url, "utf8").digest("hex");
}

export function trackingPixelHeaders(): Record<string, string> {
  return {
    "Content-Type": "image/gif",
    "Cache-Control": "no-store, no-cache, must-revalidate, private",
    Pragma: "no-cache",
    Expires: "0",
    "Content-Length": String(TRANSPARENT_GIF.length),
  };
}

export function isSafeHttpUrl(raw: unknown): boolean {
  const value = trim(raw);
  if (!value || value.length > 2000) return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (!parsed.hostname) return false;
  if (parsed.username || parsed.password) return false;
  return true;
}

export function isUnsubscribeOrTrackingUrl(raw: unknown, publicBase?: string | null): boolean {
  const value = trim(raw);
  if (!value) return true;
  const lower = value.toLowerCase();
  if (lower.includes("/unsubscribe")) return true;
  if (lower.includes("/api/email/t/")) return true;
  if (lower.includes("javascript:") || lower.includes("data:") || lower.startsWith("mailto:")) {
    return true;
  }
  const base = trim(publicBase || "");
  if (base && lower.startsWith(base.toLowerCase()) && lower.includes("/unsubscribe")) return true;
  return false;
}

export function shouldTrackHref(raw: unknown): boolean {
  if (!isSafeHttpUrl(raw)) return false;
  if (isUnsubscribeOrTrackingUrl(raw, getTrackingBaseUrl())) return false;
  return true;
}

function createSignedToken(payload: Record<string, unknown>): string | null {
  const secret = getTrackingSecret();
  if (!secret || !isEmailTrackingEnabled()) return null;
  const payloadPart = encodePart(JSON.stringify(payload));
  return `v1.${payloadPart}.${signPayload(payloadPart, secret)}`;
}

function readSignedToken(token: unknown, nowMs: number): {
  ok: boolean;
  payload?: any;
  reason?: string;
} {
  if (!isEmailTrackingEnabled()) return { ok: false, reason: "disabled" };
  const secret = getTrackingSecret();
  if (!secret) return { ok: false, reason: "disabled" };
  const raw = trim(token);
  if (!raw || raw.length > 2000) return { ok: false, reason: "invalid" };
  const parts = raw.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return { ok: false, reason: "invalid" };
  if (!signaturesEqual(signPayload(parts[1], secret), parts[2])) {
    return { ok: false, reason: "invalid" };
  }
  const json = decodePart(parts[1]);
  if (!json) return { ok: false, reason: "invalid" };
  try {
    const payload = JSON.parse(json);
    const exp = Number(payload?.exp || 0);
    if (!Number.isFinite(exp) || exp * 1000 <= nowMs) return { ok: false, reason: "expired" };
    return { ok: true, payload };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

export function createOpenToken(input: {
  emailId: number;
  normalizedEmail: string;
  nowMs?: number;
}): string | null {
  const emailId = Number(input.emailId || 0);
  const normalizedEmail = normalizeRecipientEmail(input.normalizedEmail);
  if (!Number.isInteger(emailId) || emailId <= 0 || !normalizedEmail) return null;
  const nowMs = Number.isFinite(Number(input.nowMs)) ? Number(input.nowMs) : Date.now();
  return createSignedToken({
    p: OPEN_PURPOSE,
    e: emailId,
    h: hashNormalizedEmail(normalizedEmail),
    exp: Math.floor(nowMs / 1000) + OPEN_TOKEN_TTL_SECONDS,
  });
}

export function createClickToken(input: {
  emailId: number;
  normalizedEmail: string;
  urlHash: string;
  nowMs?: number;
}): string | null {
  const emailId = Number(input.emailId || 0);
  const normalizedEmail = normalizeRecipientEmail(input.normalizedEmail);
  const urlHash = trim(input.urlHash).toLowerCase();
  if (!Number.isInteger(emailId) || emailId <= 0 || !normalizedEmail) return null;
  if (!/^[a-f0-9]{64}$/.test(urlHash)) return null;
  const nowMs = Number.isFinite(Number(input.nowMs)) ? Number(input.nowMs) : Date.now();
  return createSignedToken({
    p: CLICK_PURPOSE,
    e: emailId,
    h: hashNormalizedEmail(normalizedEmail),
    u: urlHash,
    exp: Math.floor(nowMs / 1000) + OPEN_TOKEN_TTL_SECONDS,
  });
}

export function validateOpenToken(token: unknown, nowMs = Date.now()): {
  ok: boolean;
  emailId?: number;
  emailHash?: string;
  reason?: string;
} {
  const parsed = readSignedToken(token, nowMs);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  if (trim(parsed.payload?.p) !== OPEN_PURPOSE) return { ok: false, reason: "invalid" };
  const emailId = Number(parsed.payload?.e || 0);
  const emailHash = trim(parsed.payload?.h).toLowerCase();
  if (!Number.isInteger(emailId) || emailId <= 0 || !/^[a-f0-9]{64}$/.test(emailHash)) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, emailId, emailHash };
}

export function validateClickToken(token: unknown, nowMs = Date.now()): {
  ok: boolean;
  emailId?: number;
  emailHash?: string;
  urlHash?: string;
  reason?: string;
} {
  const parsed = readSignedToken(token, nowMs);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  if (trim(parsed.payload?.p) !== CLICK_PURPOSE) return { ok: false, reason: "invalid" };
  const emailId = Number(parsed.payload?.e || 0);
  const emailHash = trim(parsed.payload?.h).toLowerCase();
  const urlHash = trim(parsed.payload?.u).toLowerCase();
  if (!Number.isInteger(emailId) || emailId <= 0) return { ok: false, reason: "invalid" };
  if (!/^[a-f0-9]{64}$/.test(emailHash) || !/^[a-f0-9]{64}$/.test(urlHash)) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, emailId, emailHash, urlHash };
}

export async function ensureEmailTrackingSchema(poolOrConn: any): Promise<void> {
  await poolOrConn.query(
    `
      CREATE TABLE IF NOT EXISTS email_tracked_links (
        TrackedLinkId BIGINT NOT NULL AUTO_INCREMENT,
        EmailId BIGINT NOT NULL,
        CompanyId INT NOT NULL,
        UrlHash CHAR(64) NOT NULL,
        DestinationUrl VARCHAR(2000) NOT NULL,
        CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (TrackedLinkId),
        UNIQUE KEY uq_email_tracked_links_email_url (EmailId, UrlHash),
        KEY idx_email_tracked_links_emailid (EmailId),
        KEY idx_email_tracked_links_companyid (CompanyId)
      )
    `
  );
}

async function trackedLinksHasCompanyId(poolOrConn: any): Promise<boolean> {
  const [rows]: any = await poolOrConn.query(
    `SHOW COLUMNS FROM email_tracked_links LIKE 'CompanyId'`
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function storeTrackedLink(args: {
  pool: any;
  emailId: number;
  destinationUrl: string;
}): Promise<string | null> {
  if (!isSafeHttpUrl(args.destinationUrl)) return null;
  const urlHash = hashDestinationUrl(args.destinationUrl);
  await ensureEmailTrackingSchema(args.pool);
  const hasCompanyId = await trackedLinksHasCompanyId(args.pool);
  if (hasCompanyId) {
    await args.pool.query(
      `
        INSERT INTO email_tracked_links (EmailId, CompanyId, UrlHash, DestinationUrl, CreatedAt)
        SELECT e.EmailId, e.CompanyId, ?, ?, UTC_TIMESTAMP()
        FROM emails e
        WHERE e.EmailId = ?
          AND e.CompanyId IS NOT NULL
        ON DUPLICATE KEY UPDATE DestinationUrl = VALUES(DestinationUrl)
      `,
      [urlHash, args.destinationUrl, args.emailId]
    );
  } else {
    await args.pool.query(
      `
        INSERT INTO email_tracked_links (EmailId, UrlHash, DestinationUrl, CreatedAt)
        SELECT e.EmailId, ?, ?, UTC_TIMESTAMP()
        FROM emails e
        WHERE e.EmailId = ?
          AND e.CompanyId IS NOT NULL
        ON DUPLICATE KEY UPDATE DestinationUrl = VALUES(DestinationUrl)
      `,
      [urlHash, args.destinationUrl, args.emailId]
    );
  }
  return urlHash;
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function linkifyPlainHttpUrls(html: string): string {
  return html.replace(/(^|>)([^<]+)/g, (full, prefix: string, text: string) => {
    const linked = text.replace(/\bhttps?:\/\/[^\s<>"']+/gi, (url) => {
      if (!isSafeHttpUrl(url) || isUnsubscribeOrTrackingUrl(url, getTrackingBaseUrl())) {
        return url;
      }
      return `<a href="${escapeHtmlAttr(url)}">${url}</a>`;
    });
    return `${prefix}${linked}`;
  });
}

export async function applyOptionalEmailTracking(args: {
  pool: any;
  html: string;
  emailId: number;
  toEmail: string;
}): Promise<string> {
  if (!isEmailTrackingEnabled() || !getTrackingSecret()) return args.html;
  const base = getTrackingBaseUrl();
  if (!base) return args.html;

  const normalizedEmail = normalizeRecipientEmail(args.toEmail);
  let html = linkifyPlainHttpUrls(args.html);

  const replacements: Array<{ from: string; to: string }> = [];
  const hrefPattern = /href\s*=\s*(["'])(.*?)\1/gi;
  let match: RegExpExecArray | null;
  while ((match = hrefPattern.exec(html))) {
    const dest = String(match[2] || "").trim();
    if (!shouldTrackHref(dest)) continue;
    const urlHash = await storeTrackedLink({
      pool: args.pool,
      emailId: args.emailId,
      destinationUrl: dest,
    });
    if (!urlHash) continue;
    const token = createClickToken({
      emailId: args.emailId,
      normalizedEmail,
      urlHash,
    });
    if (!token) continue;
    const tracked = `${base}/api/email/t/click?t=${encodeURIComponent(token)}`;
    replacements.push({ from: match[0], to: `href=${match[1]}${tracked}${match[1]}` });
  }
  for (const item of replacements) {
    html = html.replace(item.from, item.to);
  }

  const openToken = createOpenToken({
    emailId: args.emailId,
    normalizedEmail,
  });
  if (openToken) {
    const pixelUrl = `${base}/api/email/t/open?t=${encodeURIComponent(openToken)}`;
    html +=
      `<img src="${pixelUrl}" width="1" height="1" alt="" ` +
      `style="display:block;width:1px;height:1px;border:0;" />`;
  }
  return html;
}

export async function recordOpenEvent(args: { pool: any; emailId: number }): Promise<{ recorded: boolean }> {
  const result = await insertEmailEventForEmail({
    poolOrConn: args.pool,
    emailId: args.emailId,
    eventType: OPEN_EVENT,
    uniqueByEventType: true,
    metadata: { source: "pixel" },
  });
  return { recorded: result.inserted };
}

export async function recordClickEvent(args: {
  pool: any;
  emailId: number;
  urlHash: string;
}): Promise<{ recorded: boolean }> {
  const result = await insertEmailEventForEmail({
    poolOrConn: args.pool,
    emailId: args.emailId,
    eventType: CLICK_EVENT,
    uniqueByEventType: true,
    uniqueMetadataPath: "$.urlHash",
    uniqueMetadataValue: args.urlHash,
    metadata: { source: "redirect", urlHash: args.urlHash },
  });
  return { recorded: result.inserted };
}

export async function handleOpenPixel(args: {
  pool: any;
  token: unknown;
}): Promise<{ status: number; body: Buffer; headers: Record<string, string> }> {
  const headers = trackingPixelHeaders();
  const parsed = validateOpenToken(args.token);
  if (parsed.ok && parsed.emailId) {
    try {
      await recordOpenEvent({ pool: args.pool, emailId: parsed.emailId });
    } catch {
      // Pixel must still return.
    }
  }
  return { status: 200, body: TRANSPARENT_GIF, headers };
}

export async function resolveTrackedClick(args: {
  pool: any;
  token: unknown;
}): Promise<{ ok: true; url: string } | { ok: false }> {
  const parsed = validateClickToken(args.token);
  if (!parsed.ok || !parsed.emailId || !parsed.urlHash) return { ok: false };
  await ensureEmailTrackingSchema(args.pool);
  const [rows]: any = await args.pool.query(
    `
      SELECT t.DestinationUrl
      FROM email_tracked_links t
      INNER JOIN emails e
        ON e.EmailId = t.EmailId
       AND e.CompanyId IS NOT NULL
      WHERE t.EmailId = ?
        AND t.UrlHash = ?
      LIMIT 1
    `,
    [parsed.emailId, parsed.urlHash]
  );
  const destination = Array.isArray(rows) && rows[0] ? trim(rows[0].DestinationUrl) : "";
  if (!isSafeHttpUrl(destination)) return { ok: false };
  try {
    await recordClickEvent({
      pool: args.pool,
      emailId: parsed.emailId,
      urlHash: parsed.urlHash,
    });
  } catch {
    // Redirect still proceeds.
  }
  return { ok: true, url: destination };
}

export function summarizeTrackingEvents(
  events: Array<{ EventType?: unknown }>
): { opensApprox: number; clicksApprox: number } {
  const list = Array.isArray(events) ? events : [];
  return {
    opensApprox: list.filter((event) => String(event?.EventType || "").toUpperCase() === OPEN_EVENT).length,
    clicksApprox: list.filter((event) => String(event?.EventType || "").toUpperCase() === CLICK_EVENT).length,
  };
}
