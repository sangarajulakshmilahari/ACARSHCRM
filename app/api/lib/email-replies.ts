import { insertEmailEventForEmail } from "@/app/api/lib/email-events-write";
import {
  getApplicationGraphClient,
  getApplicationGraphMailboxUser,
} from "@/app/api/lib/graph-mail";

export const REPLIED_EVENT = "REPLIED";

export type IncomingGraphMessage = {
  id: string;
  conversationId: string | null;
  internetMessageId: string | null;
  subject: string | null;
  fromAddress: string | null;
  receivedDateTime: string | null;
  inReplyTo: string | null;
  references: string[];
};

export type SentEmailMatchRow = {
  EmailId: number;
  SequenceId: number | null;
  LeadContactID: number;
  CompanyId?: number | null;
  ToEmail: string | null;
  Subject: string | null;
  ProviderMessageId: string | null;
  ThreadId: string | null;
};

export type ReplyMatchResult =
  | { confidence: "high"; email: SentEmailMatchRow }
  | { confidence: "ambiguous" }
  | { confidence: "none" };

function trim(value: unknown): string {
  return String(value ?? "").trim();
}

export function normalizeMessageId(value: unknown): string {
  return trim(value)
    .replace(/^<|>$/g, "")
    .replace(/^<|>$/g, "")
    .toLowerCase();
}

export function headerValue(
  headers: Array<{ name?: unknown; value?: unknown }> | undefined,
  name: string
): string | null {
  const wanted = name.toLowerCase();
  const found = (Array.isArray(headers) ? headers : []).find(
    (header) => trim(header?.name).toLowerCase() === wanted
  );
  const value = trim(found?.value);
  return value || null;
}

export function parseMessageIdList(value: unknown): string[] {
  return trim(value)
    .split(/\s+/)
    .map((part) => normalizeMessageId(part))
    .filter(Boolean);
}

export function mapGraphInboxMessage(raw: any): IncomingGraphMessage | null {
  const id = trim(raw?.id);
  if (!id) return null;
  const headers = Array.isArray(raw?.internetMessageHeaders) ? raw.internetMessageHeaders : [];
  const fromAddress =
    trim(raw?.from?.emailAddress?.address) ||
    trim(raw?.sender?.emailAddress?.address) ||
    null;
  return {
    id,
    conversationId: trim(raw?.conversationId) || null,
    internetMessageId: trim(raw?.internetMessageId) || null,
    subject: trim(raw?.subject) || null,
    fromAddress,
    receivedDateTime: trim(raw?.receivedDateTime) || null,
    inReplyTo: headerValue(headers, "In-Reply-To"),
    references: parseMessageIdList(headerValue(headers, "References")),
  };
}

function idsEqual(left: unknown, right: unknown): boolean {
  const a = normalizeMessageId(left);
  const b = normalizeMessageId(right);
  return Boolean(a && b && a === b);
}

export function matchIncomingReplyToSentEmails(
  incoming: IncomingGraphMessage,
  sentEmails: SentEmailMatchRow[]
): ReplyMatchResult {
  const matches: SentEmailMatchRow[] = [];

  for (const email of sentEmails) {
    const conversationHit =
      Boolean(incoming.conversationId) &&
      Boolean(email.ThreadId) &&
      incoming.conversationId === email.ThreadId;
    const inReplyHit =
      Boolean(email.ProviderMessageId) &&
      (idsEqual(incoming.inReplyTo, email.ProviderMessageId) ||
        incoming.references.some((ref) => idsEqual(ref, email.ProviderMessageId)) ||
        idsEqual(incoming.inReplyTo, email.ThreadId));
    if (conversationHit || inReplyHit) {
      matches.push(email);
    }
  }

  if (matches.length === 0) {
    return { confidence: "none" };
  }

  const keys = new Set(
    matches.map((row) => `${Number(row.SequenceId || 0)}:${Number(row.LeadContactID || 0)}`)
  );
  if (keys.size !== 1) {
    return { confidence: "ambiguous" };
  }

  const latest = matches.reduce((current, row) =>
    Number(row.EmailId) > Number(current.EmailId) ? row : current
  );
  if (!Number(latest.SequenceId || 0) || !Number(latest.LeadContactID || 0)) {
    return { confidence: "none" };
  }
  return { confidence: "high", email: latest };
}

export function paginateGraphMessages<T>(pages: T[][], maxPages: number): T[] {
  const limit = Math.max(1, maxPages);
  return pages.slice(0, limit).flat();
}

export function resolveReplySyncWindow(input?: {
  lookbackHours?: number;
  pageSize?: number;
  maxPages?: number;
  nowMs?: number;
}): {
  lookbackHours: number;
  pageSize: number;
  maxPages: number;
  maxMessages: number;
  sinceIso: string;
} {
  const lookbackHours = Math.max(
    1,
    Math.min(
      168,
      Number(input?.lookbackHours ?? process.env.EMAIL_REPLY_LOOKBACK_HOURS ?? 24)
    )
  );
  const pageSize = Math.max(1, Math.min(50, Number(input?.pageSize ?? 25)));
  const maxPages = Math.max(1, Math.min(20, Number(input?.maxPages ?? 8)));
  const nowMs = Number.isFinite(Number(input?.nowMs)) ? Number(input?.nowMs) : Date.now();
  return {
    lookbackHours,
    pageSize,
    maxPages,
    maxMessages: pageSize * maxPages,
    sinceIso: new Date(nowMs - lookbackHours * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
}

async function listSharedInboxMessages(args: {
  sinceIso: string;
  pageSize: number;
  maxPages: number;
}): Promise<IncomingGraphMessage[]> {
  const { client, senderUser } = await getApplicationGraphClient();
  const collected: IncomingGraphMessage[] = [];
  let url: string | null =
    `/users/${encodeURIComponent(senderUser)}/mailFolders/inbox/messages` +
    `?$filter=receivedDateTime ge ${args.sinceIso}` +
    `&$orderby=receivedDateTime asc` +
    `&$select=id,conversationId,internetMessageId,subject,from,sender,receivedDateTime,internetMessageHeaders,isDraft` +
    `&$top=${Math.max(1, Math.min(50, args.pageSize))}`;

  for (let page = 0; page < args.maxPages && url; page += 1) {
    try {
      const payload: any = await client
        .api(url)
        .header("Prefer", 'IdType="ImmutableId"')
        .get();
      const values = Array.isArray(payload?.value) ? payload.value : [];
      for (const raw of values) {
        if (raw?.isDraft) continue;
        const mapped = mapGraphInboxMessage(raw);
        if (mapped) collected.push(mapped);
      }
      const nextLink = trim(payload?.["@odata.nextLink"]);
      url = nextLink || null;
    } catch {
      console.error("[email-replies] Shared inbox page failed; processing messages collected so far");
      break;
    }
  }

  return collected;
}

export async function pauseEnrollmentAfterVerifiedReply(args: {
  pool: any;
  sequenceId: number;
  leadContactId: number;
  companyId?: number | null;
}): Promise<{ paused: boolean }> {
  const conn = await args.pool.getConnection();
  try {
    await conn.beginTransaction();
    const companyId = Number(args.companyId);
    const [rows]: any = await conn.query(
      `
        SELECT esc.SequenceContactId, esc.Status
        FROM email_sequence_contacts esc
        INNER JOIN leadcontacts lc
          ON lc.LeadContactID = esc.LeadContactID
        WHERE esc.SequenceId = ?
          AND esc.LeadContactID = ?
          ${companyId > 0 ? "AND lc.CompanyId = ?" : "AND lc.CompanyId IS NOT NULL"}
        LIMIT 1
        FOR UPDATE
      `,
      companyId > 0 ? [args.sequenceId, args.leadContactId, companyId] : [args.sequenceId, args.leadContactId]
    );
    const enrollment = Array.isArray(rows) && rows[0] ? rows[0] : null;
    if (!enrollment) {
      await conn.rollback();
      return { paused: false };
    }
    if (String(enrollment.Status || "").toUpperCase() !== "ACTIVE") {
      await conn.commit();
      return { paused: false };
    }
    await conn.query(
      `
        UPDATE email_sequence_contacts
        SET Status = 'PAUSED'
        WHERE SequenceContactId = ?
          AND UPPER(Status) = 'ACTIVE'
      `,
      [enrollment.SequenceContactId]
    );
    await conn.commit();
    return { paused: true };
  } catch (error) {
    try {
      await conn.rollback();
    } catch {
      // ignore
    }
    throw error;
  } finally {
    conn.release();
  }
}

export async function processIncomingReplyMessages(args: {
  pool: any;
  incoming: IncomingGraphMessage[];
  sentEmails: SentEmailMatchRow[];
}): Promise<{
  scanned: number;
  matched: number;
  paused: number;
  skippedUncertain: number;
  skippedDuplicate: number;
  skippedError: number;
}> {
  let matched = 0;
  let paused = 0;
  let skippedUncertain = 0;
  let skippedDuplicate = 0;
  let skippedError = 0;

  for (const message of args.incoming) {
    try {
      const result = matchIncomingReplyToSentEmails(message, args.sentEmails);
      if (result.confidence !== "high") {
        skippedUncertain += 1;
        continue;
      }

      // Pause before recording REPLIED so a crash cannot skip pause on the next sync.
      const pauseResult = await pauseEnrollmentAfterVerifiedReply({
        pool: args.pool,
        sequenceId: Number(result.email.SequenceId),
        leadContactId: Number(result.email.LeadContactID),
        companyId: Number(result.email.CompanyId) || null,
      });
      if (pauseResult.paused) paused += 1;

      const insertResult = await insertEmailEventForEmail({
        poolOrConn: args.pool,
        emailId: result.email.EmailId,
        eventType: REPLIED_EVENT,
        uniqueByEventType: true,
        uniqueMetadataPath: "$.incomingMessageId",
        uniqueMetadataValue: message.id,
        metadata: {
          incomingMessageId: message.id,
          conversationId: message.conversationId,
          sender: message.fromAddress,
          receivedDateTime: message.receivedDateTime,
        },
      });
      if (insertResult.inserted) {
        matched += 1;
      } else {
        skippedDuplicate += 1;
      }
    } catch {
      skippedError += 1;
      console.error(
        `[email-replies] Failed to process incoming Graph message id=${String(message.id || "").slice(0, 80)}`
      );
    }
  }

  return {
    scanned: args.incoming.length,
    matched,
    paused,
    skippedUncertain,
    skippedDuplicate,
    skippedError,
  };
}

export async function processSharedMailboxReplies(args: {
  pool: any;
  lookbackHours?: number;
  pageSize?: number;
  maxPages?: number;
  listInbox?: (input: {
    sinceIso: string;
    pageSize: number;
    maxPages: number;
  }) => Promise<IncomingGraphMessage[]>;
}): Promise<{
  scanned: number;
  matched: number;
  paused: number;
  skippedUncertain: number;
  skippedDuplicate: number;
  skippedError: number;
}> {
  const window = resolveReplySyncWindow({
    lookbackHours: args.lookbackHours,
    pageSize: args.pageSize,
    maxPages: args.maxPages,
  });

  if (!args.listInbox) {
    void getApplicationGraphMailboxUser();
  }

  const incoming = args.listInbox
    ? await args.listInbox({
        sinceIso: window.sinceIso,
        pageSize: window.pageSize,
        maxPages: window.maxPages,
      })
    : await listSharedInboxMessages({
        sinceIso: window.sinceIso,
        pageSize: window.pageSize,
        maxPages: window.maxPages,
      });

  const [sentRows]: any = await args.pool.query(
    `
      SELECT
        EmailId,
        SequenceId,
        LeadContactID,
        CompanyId,
        ToEmail,
        Subject,
        ProviderMessageId,
        ThreadId
      FROM emails
      WHERE Status = 'SENT'
        AND CompanyId IS NOT NULL
        AND SequenceId IS NOT NULL
        AND (ProviderMessageId IS NOT NULL OR ThreadId IS NOT NULL)
    `
  );

  return processIncomingReplyMessages({
    pool: args.pool,
    incoming,
    sentEmails: Array.isArray(sentRows) ? sentRows : [],
  });
}
