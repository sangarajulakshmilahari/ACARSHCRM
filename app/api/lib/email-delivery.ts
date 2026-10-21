import { timingSafeEqual } from "crypto";
import { insertEmailEventForEmail } from "@/app/api/lib/email-events-write";
import {
  normalizeRecipientEmail,
  pauseActiveEnrollmentsForNormalizedEmail,
  upsertEmailSuppression,
} from "@/app/api/lib/email-suppressions";

export const EMAIL_DELIVERY_TOKEN_HEADER = "x-email-delivery-token";
export const DELIVERED_EVENT = "DELIVERED";
export const BOUNCED_EVENT = "BOUNCED";
export const DEFERRED_EVENT = "DEFERRED";

export type DeliveryStatus = "UNKNOWN" | "DELIVERED" | "BOUNCED" | "DEFERRED";
export type DeliveryEventType = "delivered" | "bounced" | "deferred";

export type IncomingDeliveryEvent = {
  provider: string;
  providerEventId: string;
  type: DeliveryEventType;
  bounceClass?: "permanent" | "transient" | null;
  occurredAt: string;
  emailId?: number | null;
  internetMessageId?: string | null;
  conversationId?: string | null;
  graphMessageId?: string | null;
};

export type ParsedDeliveryEvent =
  | { ok: true; event: IncomingDeliveryEvent }
  | { ok: false; reason: "invalid_payload" };

function trim(value: unknown): string {
  return String(value ?? "").trim();
}

function tokensMatch(expected: string, incoming: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(incoming);
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Shared webhook token only. CompanyId is taken from the matched email row. */
export function authorizeEmailDeliveryRequest(headerToken: string | null | undefined): {
  ok: boolean;
  status?: number;
  error?: string;
} {
  const configured = trim(process.env.EMAIL_DELIVERY_WEBHOOK_TOKEN);
  if (!configured) {
    return { ok: false, status: 503, error: "Email delivery ingestion is not configured" };
  }
  if (!tokensMatch(configured, trim(headerToken))) {
    return { ok: false, status: 403, error: "Forbidden" };
  }
  return { ok: true };
}

export function normalizeDeliveryStatus(value: unknown): DeliveryStatus {
  const status = trim(value).toUpperCase();
  if (status === "DELIVERED" || status === "BOUNCED" || status === "DEFERRED") {
    return status;
  }
  return "UNKNOWN";
}

export function deliveryEvidenceLabel(input: {
  status?: unknown;
  deliveryStatus?: unknown;
}): string {
  const status = trim(input.status).toUpperCase();
  if (status !== "SENT") return status || "UNKNOWN";
  const delivery = normalizeDeliveryStatus(input.deliveryStatus);
  if (delivery === "DELIVERED") return "Delivered";
  if (delivery === "BOUNCED") return "Bounced";
  if (delivery === "DEFERRED") return "Sent (deferred)";
  return "Sent (delivery unknown)";
}

export function eventTypeForDelivery(type: DeliveryEventType): string {
  if (type === "delivered") return DELIVERED_EVENT;
  if (type === "bounced") return BOUNCED_EVENT;
  return DEFERRED_EVENT;
}

export function parseIncomingDeliveryEvent(raw: unknown): ParsedDeliveryEvent {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "invalid_payload" };
  const body = raw as Record<string, unknown>;
  const provider = trim(body.provider).slice(0, 64);
  const providerEventId = trim(body.providerEventId).slice(0, 191);
  const typeRaw = trim(body.type).toLowerCase();
  const type = typeRaw as DeliveryEventType;
  const occurredAt = trim(body.occurredAt);
  const bounceClassRaw = trim(body.bounceClass).toLowerCase();

  if (!provider || !providerEventId) return { ok: false, reason: "invalid_payload" };
  if (type !== "delivered" && type !== "bounced" && type !== "deferred") {
    return { ok: false, reason: "invalid_payload" };
  }
  const occurredMs = Date.parse(occurredAt);
  if (!occurredAt || !Number.isFinite(occurredMs)) {
    return { ok: false, reason: "invalid_payload" };
  }

  const emailIdRaw = Number(body.emailId || 0);
  const bounceClass =
    bounceClassRaw === "permanent" || bounceClassRaw === "transient"
      ? bounceClassRaw
      : type === "bounced"
        ? "permanent"
        : type === "deferred"
          ? "transient"
          : null;

  return {
    ok: true,
    event: {
      provider,
      providerEventId,
      type,
      bounceClass,
      occurredAt: new Date(occurredMs).toISOString(),
      emailId: Number.isInteger(emailIdRaw) && emailIdRaw > 0 ? emailIdRaw : null,
      internetMessageId: trim(body.internetMessageId) || null,
      conversationId: trim(body.conversationId) || null,
      graphMessageId: trim(body.graphMessageId) || null,
    },
  };
}

export function nextDeliveryStatus(current: DeliveryStatus, incoming: DeliveryEventType): DeliveryStatus {
  if (current === "BOUNCED") return "BOUNCED";
  if (incoming === "bounced") return "BOUNCED";
  if (incoming === "delivered") return "DELIVERED";
  if (incoming === "deferred" && current === "UNKNOWN") return "DEFERRED";
  return current;
}

export function foldDeliveryStatus(
  events: Array<{ type: DeliveryEventType; occurredAt: string }>
): DeliveryStatus {
  const sorted = [...events].sort((a, b) => {
    const delta = Date.parse(a.occurredAt) - Date.parse(b.occurredAt);
    if (delta !== 0) return delta;
    return a.type.localeCompare(b.type);
  });
  return sorted.reduce<DeliveryStatus>(
    (status, event) => nextDeliveryStatus(status, event.type),
    "UNKNOWN"
  );
}

export function isPermanentBounce(event: IncomingDeliveryEvent): boolean {
  return event.type === "bounced" && event.bounceClass !== "transient";
}

export async function ensureEmailDeliverySchema(poolOrConn: any): Promise<void> {
  const [cols]: any = await poolOrConn.query(`SHOW COLUMNS FROM emails LIKE 'DeliveryStatus'`);
  if (!Array.isArray(cols) || cols.length === 0) {
    await poolOrConn.query(
      `ALTER TABLE emails ADD COLUMN DeliveryStatus varchar(20) NOT NULL DEFAULT 'UNKNOWN'`
    );
  }
}

async function findEmailForDeliveryEvent(args: {
  pool: any;
  event: IncomingDeliveryEvent;
}): Promise<{
  EmailId: number;
  ToEmail: string | null;
  SequenceId: number | null;
  LeadContactID: number | null;
  CompanyId: number | null;
  Status: string;
  DeliveryStatus: string;
} | null | "ambiguous"> {
  const event = args.event;
  if (event.emailId) {
    const [rows]: any = await args.pool.query(
      `
        SELECT EmailId, ToEmail, SequenceId, LeadContactID, CompanyId, Status, DeliveryStatus
        FROM emails
        WHERE EmailId = ?
          AND CompanyId IS NOT NULL
        LIMIT 1
      `,
      [event.emailId]
    );
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  }

  if (event.internetMessageId) {
    const [rows]: any = await args.pool.query(
      `
        SELECT EmailId, ToEmail, SequenceId, LeadContactID, CompanyId, Status, DeliveryStatus
        FROM emails
        WHERE ProviderMessageId = ?
          AND CompanyId IS NOT NULL
        LIMIT 2
      `,
      [event.internetMessageId]
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      // continue to other identifiers
    } else if (rows.length > 1) {
      return "ambiguous";
    } else {
      return rows[0];
    }
  }

  if (event.graphMessageId) {
    const [rows]: any = await args.pool.query(
      `
        SELECT e.EmailId, e.ToEmail, e.SequenceId, e.LeadContactID, e.CompanyId, e.Status, e.DeliveryStatus
        FROM emails e
        INNER JOIN email_events ev
          ON ev.EmailId = e.EmailId
         AND ev.CompanyId = e.CompanyId
         AND ev.EventType = 'SENT'
         AND JSON_UNQUOTE(JSON_EXTRACT(ev.Metadata, '$.graphMessageId')) = ?
        WHERE e.CompanyId IS NOT NULL
        LIMIT 2
      `,
      [event.graphMessageId]
    );
    if (Array.isArray(rows) && rows.length > 1) return "ambiguous";
    if (Array.isArray(rows) && rows.length === 1) return rows[0];
  }

  if (event.conversationId) {
    const [rows]: any = await args.pool.query(
      `
        SELECT EmailId, ToEmail, SequenceId, LeadContactID, CompanyId, Status, DeliveryStatus
        FROM emails
        WHERE ThreadId = ?
          AND CompanyId IS NOT NULL
        LIMIT 2
      `,
      [event.conversationId]
    );
    if (Array.isArray(rows) && rows.length > 1) return "ambiguous";
    if (Array.isArray(rows) && rows.length === 1) return rows[0];
  }

  return null;
}

export async function ingestDeliveryEvents(args: {
  pool: any;
  events: unknown[];
}): Promise<{
  processed: number;
  applied: number;
  duplicate: number;
  unknown: number;
  invalid: number;
  suppressed: number;
}> {
  await ensureEmailDeliverySchema(args.pool);

  let processed = 0;
  let applied = 0;
  let duplicate = 0;
  let unknown = 0;
  let invalid = 0;
  let suppressed = 0;

  const incoming = Array.isArray(args.events) ? args.events : [];
  for (const raw of incoming) {
    processed += 1;
    const parsed = parseIncomingDeliveryEvent(raw);
    if (!parsed.ok) {
      invalid += 1;
      continue;
    }

    const matched = await findEmailForDeliveryEvent({ pool: args.pool, event: parsed.event });
    if (matched === "ambiguous" || !matched) {
      unknown += 1;
      continue;
    }
    const companyId = Number(matched.CompanyId);
    if (!(companyId > 0)) {
      unknown += 1;
      continue;
    }

    const [existing]: any = await args.pool.query(
      `
        SELECT EventId
        FROM email_events
        WHERE EmailId = ?
          AND CompanyId = ?
          AND EventType IN (?, ?, ?)
          AND JSON_UNQUOTE(JSON_EXTRACT(Metadata, '$.providerEventId')) = ?
        LIMIT 1
      `,
      [
        Number(matched.EmailId),
        companyId,
        DELIVERED_EVENT,
        BOUNCED_EVENT,
        DEFERRED_EVENT,
        parsed.event.providerEventId,
      ]
    );
    if (Array.isArray(existing) && existing.length > 0) {
      duplicate += 1;
      continue;
    }

    const eventType = eventTypeForDelivery(parsed.event.type);
    await insertEmailEventForEmail({
      poolOrConn: args.pool,
      emailId: Number(matched.EmailId),
      eventType,
      eventTimeSql: parsed.event.occurredAt.slice(0, 19).replace("T", " "),
      metadata: {
        provider: parsed.event.provider,
        providerEventId: parsed.event.providerEventId,
        bounceClass: parsed.event.bounceClass,
        occurredAt: parsed.event.occurredAt,
      },
    });
    applied += 1;

    const [history]: any = await args.pool.query(
      `
        SELECT EventType, EventTime, Metadata
        FROM email_events
        WHERE EmailId = ?
          AND CompanyId = ?
          AND EventType IN (?, ?, ?)
        ORDER BY EventTime ASC, EventId ASC
      `,
      [Number(matched.EmailId), companyId, DELIVERED_EVENT, BOUNCED_EVENT, DEFERRED_EVENT]
    );
    const folded = foldDeliveryStatus(
      (Array.isArray(history) ? history : []).map((row: any) => {
        let occurredAt = String(row.EventTime || parsed.event.occurredAt);
        try {
          const meta =
            typeof row.Metadata === "string" ? JSON.parse(row.Metadata) : row.Metadata;
          if (meta?.occurredAt) occurredAt = String(meta.occurredAt);
        } catch {
          // keep EventTime
        }
        return {
          type:
            String(row.EventType || "") === DELIVERED_EVENT
              ? "delivered"
              : String(row.EventType || "") === BOUNCED_EVENT
                ? "bounced"
                : "deferred",
          occurredAt,
        };
      })
    );

    await args.pool.query(
      `
        UPDATE emails
        SET DeliveryStatus = ?
        WHERE EmailId = ?
          AND CompanyId = ?
      `,
      [folded, Number(matched.EmailId), companyId]
    );

    if (folded === "BOUNCED" && isPermanentBounce(parsed.event)) {
      const toEmail = normalizeRecipientEmail(matched.ToEmail);
      try {
        const result = await upsertEmailSuppression({
          poolOrConn: args.pool,
          normalizedEmail: toEmail,
          reason: "BOUNCE",
          source: "PROVIDER",
          emailId: Number(matched.EmailId),
          leadContactId: Number(matched.LeadContactID || 0) || null,
          companyId,
        });
        if (result.created) {
          await pauseActiveEnrollmentsForNormalizedEmail({
            poolOrConn: args.pool,
            normalizedEmail: toEmail,
            companyId,
          });
          suppressed += 1;
        }
      } catch {
        // Invalid recipient addresses are not suppressed.
      }
    }
  }

  return { processed, applied, duplicate, unknown, invalid, suppressed };
}
