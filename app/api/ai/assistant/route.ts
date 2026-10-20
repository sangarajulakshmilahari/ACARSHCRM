import { NextRequest, NextResponse } from "next/server";

import { resolveAuthUser, type ResolvedAuthUser } from "@/app/api/lib/auth";

import { addActivityDirect, executeConfirmedWrites, runAgent, type AssistantPageContext } from "./agent";
import {
  buildAttachmentContextMessage,
  processAttachmentsForAssistant,
  tryBuildDirectAttachmentAnswer,
} from "./document-parser";
import {
  applyImportMessage,
  applyLeadImportUpdate,
  clearPendingLeadImport,
  confirmLeadImport,
  getPendingLeadImport,
  importReply,
  isLeadImportIntent,
  previewPendingLeadImport,
  startLeadImport,
} from "./lead-import/service";
import type { AcarshField } from "./lead-import/mapping";
import {
  agentHistory,
  createConversation,
  getOrCreateConversation,
  getPreviousConversationContext,
  listConversations,
  loadConversation,
  saveExchange,
  type StoredConversation,
} from "./history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RequestBody = {
  type:
    | "bootstrap"
    | "session"
    | "chat"
    | "confirm_write"
    | "reject_write"
    | "new_conversation"
    | "load_conversation"
    | "lead_import_confirm"
    | "lead_import_cancel"
    | "lead_import_update";
  sessionId?: string;
  message?: string;
  contextLeadId?: number | string;
  contextContactId?: number | string;
  droitCommand?: string;
  mapping?: Record<string, string>;
  defaults?: Record<string, string>;
  unmappedToNotes?: string[];
  skipInvalid?: boolean;
};

type IncomingAttachment = {
  originalFileName: string;
  fileType: string;
  fileSize: number;
  fileBuffer: Buffer;
};

const CHAT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const CHAT_ATTACHMENT_ALLOWED_EXTENSIONS = new Set([".pdf", ".xls", ".xlsx", ".csv"]);
const CHAT_ATTACHMENT_ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "application/csv",
  "text/plain",
]);

function fileExtension(name: string) {
  const value = String(name || "").trim().toLowerCase();
  const index = value.lastIndexOf(".");
  if (index < 0) return "";
  return value.slice(index);
}

function validateAttachmentType(fileName: string, mimeType: string) {
  const extension = fileExtension(fileName);
  if (!CHAT_ATTACHMENT_ALLOWED_EXTENSIONS.has(extension)) {
    return `${fileName || "Attachment"} has an unsupported format. Only PDF, XLS, XLSX, and CSV are allowed.`;
  }
  const normalizedMime = String(mimeType || "").trim().toLowerCase();
  if (!normalizedMime) return "";
  const genericMime =
    normalizedMime === "application/octet-stream" ||
    normalizedMime === "application/zip" ||
    normalizedMime === "application/x-zip-compressed" ||
    normalizedMime === "binary/octet-stream";
  if (genericMime) return "";
  if (!CHAT_ATTACHMENT_ALLOWED_MIME_TYPES.has(normalizedMime)) {
    return `${fileName || "Attachment"} has an unsupported file type.`;
  }
  return "";
}

async function parseIncomingRequest(req: NextRequest): Promise<{
  body: RequestBody;
  attachments: IncomingAttachment[];
}> {
  const contentType = String(req.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData();
    const body: RequestBody = {
      type: String(formData.get("type") || "").trim() as RequestBody["type"],
      sessionId: String(formData.get("sessionId") || "").trim() || undefined,
      message: String(formData.get("message") || "").trim() || undefined,
      contextLeadId: String(formData.get("contextLeadId") || "").trim() || undefined,
      contextContactId: String(formData.get("contextContactId") || "").trim() || undefined,
      droitCommand: String(formData.get("droitCommand") || "").trim() || undefined,
    };
    const files = formData
      .getAll("attachments")
      .filter((item): item is File => item instanceof File);
    const attachments: IncomingAttachment[] = [];
    for (const file of files) {
      const originalFileName = String(file.name || "").trim();
      if (!originalFileName) {
        throw new Error("Attachment file name is required.");
      }
      if (!Number.isFinite(file.size) || file.size <= 0) {
        throw new Error(`${originalFileName} is empty or unreadable.`);
      }
      if (file.size > CHAT_ATTACHMENT_MAX_BYTES) {
        throw new Error(`${originalFileName} exceeds the 10 MB file size limit.`);
      }
      const typeError = validateAttachmentType(originalFileName, String(file.type || ""));
      if (typeError) throw new Error(typeError);
      const fileBuffer = Buffer.from(await file.arrayBuffer());
      if (!fileBuffer.length) {
        throw new Error(`${originalFileName} is empty or unreadable.`);
      }
      attachments.push({
        originalFileName,
        fileType: String(file.type || "application/octet-stream"),
        fileSize: fileBuffer.length,
        fileBuffer,
      });
    }
    return { body, attachments };
  }

  const body = (await req.json()) as RequestBody;
  return { body, attachments: [] };
}

type PendingActivityDraft = {
  lead_id?: string;
  activity_type?: string;
  notes?: string;
  status?: string;
  contact_id?: string;
};

const activityDraftGlobal = globalThis as typeof globalThis & {
  __acarshPendingActivityDrafts?: Map<string, PendingActivityDraft>;
};
const pendingActivityDrafts =
  activityDraftGlobal.__acarshPendingActivityDrafts || new Map<string, PendingActivityDraft>();
activityDraftGlobal.__acarshPendingActivityDrafts = pendingActivityDrafts;

function getPendingActivityDraft(conversationId: string) {
  return pendingActivityDrafts.get(conversationId) || null;
}

function setPendingActivityDraft(conversationId: string, draft: PendingActivityDraft | null) {
  if (!draft) {
    pendingActivityDrafts.delete(conversationId);
    return;
  }
  pendingActivityDrafts.set(conversationId, draft);
}

const CONFIRM_PATTERN = /^(confirm|confirmed|yes|yes,? proceed|proceed|go ahead|do it)$/i;
const CANCEL_PATTERN = /^(cancel|stop|no|never mind|nevermind)$/i;

const ACTIVITY_TYPE_VALUES = [
  "Call",
  "Email",
  "Meeting",
  "Demo",
  "Follow-Up",
  "Visit",
  "WhatsApp",
  "SMS",
] as const;

const STATUS_VALUES = [
  "New",
  "Contacted",
  "Follow-Up",
  "Qualified",
  "Unqualified",
  "Lost",
  "Converted",
  "Open",
  "In Progress",
  "Completed",
  "Pending",
  "Closed",
] as const;

function mapStatusToLeadStatus(value: string) {
  const normalized = normalizeText(value).toLowerCase();
  if (["completed", "complete", "done", "closed", "resolved"].includes(normalized)) {
    return "Follow-Up";
  }
  if (["open", "in progress", "pending", "new"].includes(normalized)) {
    return "New";
  }
  return titleCase(value);
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function titleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function detectAddActivityIntent(message: string) {
  return /\b(?:create|add|log|record)\b[\s\S]*\bactivit(?:y|ies|iy)\b/i.test(message);
}

function extractLeadReference(message: string) {
  const normalized = normalizeText(message);
  const match = normalized.match(
    /\bfor\s+(.+?)(?:\s+(?:with|without|type|activity\s*type|notes?|status|on|at|date|time|contact)\b|[.!?]|$)/i,
  );
  if (!match?.[1]) return undefined;
  const value = match[1].replace(/^(?:the\s+)?(?:company|lead)\s+/i, "").trim();
  return value || undefined;
}

function pickFromList(message: string, options: readonly string[]) {
  const normalized = message.trim().toLowerCase();
  const found = options.find((option) => normalized === option.toLowerCase());
  if (found) return found;
  return options.find((option) => {
    const pattern = option
      .split(/[-\s]+/)
      .filter(Boolean)
      .map((part) => escapeRegex(part))
      .join("[-\\s]*");
    return new RegExp(`\\b${pattern}\\b`, "i").test(message);
  });
}

function extractByLabel(message: string, label: string) {
  const normalized = normalizeText(message);
  const match = normalized.match(
    new RegExp(`${label}\\s*(?:is|:)?\\s*(.+)$`, "i"),
  );
  return match?.[1]?.trim();
}

function updateDraftFromMessage(
  current: PendingActivityDraft,
  message: string,
): PendingActivityDraft {
  const updated: PendingActivityDraft = { ...current };
  const before = { ...updated };

  if (!updated.lead_id) {
    const lead = extractLeadReference(message);
    if (lead) updated.lead_id = lead;
  }

  if (!updated.activity_type) {
    const labeled = extractByLabel(message, "(?:activity\\s*type|type)");
    const fromList = pickFromList(message, ACTIVITY_TYPE_VALUES);
    if (fromList) updated.activity_type = fromList;
    else if (labeled) updated.activity_type = titleCase(labeled);
  }

  if (!updated.notes) {
    const notes = extractByLabel(message, "notes?");
    if (notes) updated.notes = notes;
  }

  if (!updated.status) {
    const labeled = extractByLabel(message, "status");
    const fromList = pickFromList(message, STATUS_VALUES);
    if (fromList) updated.status = mapStatusToLeadStatus(fromList);
    else if (labeled) updated.status = mapStatusToLeadStatus(labeled);
  }

  const noContact = /\b(?:no\s+contact|without\s+contact|proceed\s+without\s+contact)\b/i.test(
    message,
  );
  if (noContact) {
    updated.contact_id = "";
  } else if (!updated.contact_id) {
    const normalized = normalizeText(message);
    const contactNamed =
      normalized.match(/\bcontact\b\s*(?::|is)?\s+([A-Za-z][A-Za-z\s.'-]{1,80})$/i)?.[1]?.trim() ||
      "";
    const withContact =
      normalized.match(/\bwith\s+([A-Za-z][A-Za-z\s.'-]{1,80})$/i)?.[1]?.trim() || "";
    if (contactNamed) updated.contact_id = contactNamed;
    else if (withContact) updated.contact_id = withContact;
  }

  const changed =
    before.lead_id !== updated.lead_id ||
    before.activity_type !== updated.activity_type ||
    before.status !== updated.status ||
    before.notes !== updated.notes ||
    before.contact_id !== updated.contact_id;

  if (!changed && !updated.notes) {
    const raw = normalizeText(message);
    if (
      raw &&
      !detectAddActivityIntent(raw) &&
      !CANCEL_PATTERN.test(raw) &&
      !/^(confirm|confirmed|yes|proceed|go ahead|do it)$/i.test(raw) &&
      !/\b(?:no\s+contact|without\s+contact|proceed\s+without\s+contact)\b/i.test(raw)
    ) {
      updated.notes = raw;
    }
  }

  return updated;
}

function nextActivityQuestion(draft: PendingActivityDraft): string | null {
  if (!draft.lead_id) return "Which lead or company should I add this activity to?";
  if (!draft.activity_type) return "What type of activity would you like to create?";
  if (!draft.status) return "What status should I set?";
  if (!draft.notes) return "What notes should I add?";
  return null;
}

function isNeedsInput(payload: unknown): payload is { status: "needs_input"; questions?: string[] } {
  if (!payload || typeof payload !== "object") return false;
  return String((payload as Record<string, unknown>).status || "") === "needs_input";
}

function isErrorPayload(payload: unknown): payload is { status: "error"; error?: { message?: string } } {
  if (!payload || typeof payload !== "object") return false;
  return String((payload as Record<string, unknown>).status || "") === "error";
}

const lockGlobal = globalThis as typeof globalThis & {
  __acarshConversationLocks?: Map<string, Promise<void>>;
};
const conversationLocks =
  lockGlobal.__acarshConversationLocks || new Map<string, Promise<void>>();
lockGlobal.__acarshConversationLocks = conversationLocks;

async function withConversationLock<T>(
  conversationId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = conversationLocks.get(conversationId) || Promise.resolve();
  const run = previous.catch(() => undefined).then(operation);
  const barrier = run.then(
    () => undefined,
    () => undefined,
  );
  conversationLocks.set(conversationId, barrier);
  try {
    return await run;
  } finally {
    if (conversationLocks.get(conversationId) === barrier) {
      conversationLocks.delete(conversationId);
    }
  }
}

function publicRole(roleId: number, roleName?: string) {
  const normalized = String(roleName || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");

  if (normalized === "manager") return "manager";
  if (normalized === "admin") return "admin";
  if (normalized === "sales_executive") return "sales_executive";

  if (roleId === 1) return "manager";
  if (roleId === 3) return "admin";
  return "sales_executive";
}

function serializedMessages(conversation: StoredConversation) {
  return conversation.messages.map((message) => ({
    message_id: message.messageId,
    role: message.role,
    content: message.content,
    tool_calls: message.toolCalls,
    attachments: message.attachments,
  }));
}

async function conversationPayload(
  user: ResolvedAuthUser,
  conversation: StoredConversation,
) {
  return {
    session_id: conversation.id,
    user: { name: user.userName, role: publicRole(user.roleId, user.roleName) },
    messages: serializedMessages(conversation),
    conversations: await listConversations(user),
    confirmation_required: conversation.pendingWrites.length > 0,
  };
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected assistant error";
  console.error("[crm-assistant]", error);
  const unavailable =
    message.includes("ECONNREFUSED") ||
    message.includes("fetch failed") ||
    message.includes("MCP");
  return NextResponse.json(
    {
      detail: unavailable
        ? "The CRM assistant service is unavailable. Your conversation was preserved; please retry."
        : message,
    },
    { status: 502 },
  );
}

async function requireConversation(
  user: ResolvedAuthUser,
  conversationId: string,
) {
  const conversation = await loadConversation(user, conversationId);
  if (!conversation) throw new Error("Conversation is missing or unavailable");
  return conversation;
}

export async function POST(req: NextRequest) {
  const user = await resolveAuthUser(req);
  if (!user) {
    return NextResponse.json({ detail: "No logged-in user found." }, { status: 401 });
  }
  if (![1, 2, 3].includes(user.roleId)) {
    return NextResponse.json(
      { detail: "Your role is not enabled for the CRM assistant." },
      { status: 403 },
    );
  }

  let body: RequestBody;
  let attachments: IncomingAttachment[] = [];
  try {
    const parsed = await parseIncomingRequest(req);
    body = parsed.body;
    attachments = parsed.attachments;
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : "Invalid request payload." },
      { status: 400 },
    );
  }

  try {
    if (body.type === "bootstrap" || body.type === "session") {
      const conversation = await getOrCreateConversation(user);
      return NextResponse.json(await conversationPayload(user, conversation));
    }

    if (body.type === "new_conversation") {
      const conversation = await createConversation(user);
      return NextResponse.json(await conversationPayload(user, conversation));
    }

    if (body.type === "load_conversation") {
      const conversationId = String(body.sessionId || "").trim();
      const conversation = await loadConversation(user, conversationId);
      if (!conversation) {
        return NextResponse.json(
          { detail: "Conversation was not found." },
          { status: 404 },
        );
      }
      return NextResponse.json(await conversationPayload(user, conversation));
    }

    if (
      body.type !== "chat" &&
      body.type !== "confirm_write" &&
      body.type !== "reject_write" &&
      body.type !== "lead_import_confirm" &&
      body.type !== "lead_import_cancel" &&
      body.type !== "lead_import_update"
    ) {
      return NextResponse.json({ detail: "Invalid request type." }, { status: 400 });
    }
    if (body.type !== "chat" && attachments.length > 0) {
      return NextResponse.json(
        { detail: "Attachments are supported only for chat messages." },
        { status: 400 },
      );
    }

    const message =
      body.type === "confirm_write"
        ? "Confirmed"
        : body.type === "reject_write"
          ? "Rejected"
          : String(body.message || "").trim();
    if (body.type === "chat" && !message && attachments.length === 0) {
      return NextResponse.json(
        { detail: "message or at least one valid attachment is required." },
        { status: 400 },
      );
    }
    const conversationId = String(body.sessionId || "").trim();
    if (!conversationId) {
      return NextResponse.json({ detail: "sessionId is required." }, { status: 400 });
    }

    const assistantQuestion = message || "Please analyze the attached files.";
    let parsedAttachments = {
      processed: [] as Awaited<ReturnType<typeof processAttachmentsForAssistant>>["processed"],
      failed: [] as Array<{ fileName: string; reason: string }>,
    };
    if (attachments.length) {
      try {
        parsedAttachments = await processAttachmentsForAssistant({
          attachments: attachments.map((attachment) => ({
            fileName: attachment.originalFileName,
            fileType: attachment.fileType,
            fileSize: attachment.fileSize,
            fileBuffer: attachment.fileBuffer,
          })),
          question: assistantQuestion,
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Unknown parsing error";
        parsedAttachments = {
          processed: [],
          failed: attachments.map((attachment) => ({
            fileName: attachment.originalFileName,
            reason,
          })),
        };
      }
    }

    if (attachments.length && parsedAttachments.processed.length === 0 && parsedAttachments.failed.length > 0) {
      const detail = parsedAttachments.failed
        .map((item) =>
          /\.(xls|xlsx)$/i.test(item.fileName)
            ? `${item.fileName}: I couldn't read this Excel file. Please make sure it is a valid .xls or .xlsx file.`
            : `${item.fileName}: ${item.reason}`,
        )
        .join(" ");
      return NextResponse.json({ detail }, { status: 400 });
    }

    const documentContext = buildAttachmentContextMessage({
      question: assistantQuestion,
      processed: parsedAttachments.processed,
      failed: parsedAttachments.failed,
    });

    const directAttachmentAnswer = tryBuildDirectAttachmentAnswer({
      question: assistantQuestion,
      processed: parsedAttachments.processed,
    });

    const messageForAssistant = documentContext
      ? `${assistantQuestion}${documentContext}`
      : assistantQuestion;
    const userMessageForStorage = message || "Sent attachment(s)";

    return await withConversationLock(conversationId, async () => {
      const conversation = await requireConversation(user, conversationId);
      const history = agentHistory(conversation.messages);

      const spreadsheetAttachment = attachments.find((file) =>
        /\.(xlsx|xls|csv)$/i.test(file.originalFileName),
      );
      const importIntent =
        body.type === "lead_import_confirm" ||
        body.type === "lead_import_cancel" ||
        body.type === "lead_import_update" ||
        (body.type === "chat" && (isLeadImportIntent(assistantQuestion) || Boolean(getPendingLeadImport(conversationId))));

      if (importIntent && !conversation.pendingWrites.length) {
        if (body.type === "lead_import_cancel" || (body.type === "chat" && /^(cancel|stop|never mind)/i.test(message))) {
          clearPendingLeadImport(conversationId);
          const reply = "Lead import cancelled. No CRM records were created.";
          await saveExchange({
            user,
            conversationId,
            userMessage: userMessageForStorage,
            assistantReply: reply,
            toolCalls: [],
            pendingWrites: [],
            userAttachments: attachments,
          });
          return NextResponse.json({
            session_id: conversationId,
            reply,
            tool_calls: [],
            conversations: await listConversations(user),
            confirmation_required: false,
          });
        }

        if (body.type === "lead_import_confirm" || (body.type === "chat" && /^(confirm|create leads|yes,? create)/i.test(message) && getPendingLeadImport(conversationId))) {
          if (!user.companyId) {
            return NextResponse.json({ error: "Company membership required" }, { status: 403 });
          }
          const card = await confirmLeadImport(conversationId, user.companyId);
          const reply = importReply(card);
          await saveExchange({
            user,
            conversationId,
            userMessage: userMessageForStorage,
            assistantReply: reply,
            toolCalls: [],
            pendingWrites: [],
            userAttachments: attachments,
          });
          return NextResponse.json({
            session_id: conversationId,
            reply,
            lead_import: card,
            tool_calls: [],
            conversations: await listConversations(user),
            confirmation_required: false,
          });
        }

        if (body.type === "lead_import_update" && getPendingLeadImport(conversationId)) {
          applyLeadImportUpdate(conversationId, {
            mapping: body.mapping as Record<string, AcarshField> | undefined,
            defaults: body.defaults,
            unmappedToNotes: body.unmappedToNotes,
            skipInvalid: body.skipInvalid,
          });
        } else if (body.type === "chat" && getPendingLeadImport(conversationId)) {
          applyImportMessage(conversationId, assistantQuestion);
        }

        let card = getPendingLeadImport(conversationId)
          ? await previewPendingLeadImport(conversationId)
          : null;
        if (!card && spreadsheetAttachment) {
          card = await startLeadImport({
            conversationId,
            fileName: spreadsheetAttachment.originalFileName,
            fileBuffer: spreadsheetAttachment.fileBuffer,
            ownerName: user.userName,
          });
        }
        if (!card) {
          return NextResponse.json(
            { detail: "Attach an Excel or CSV file to import leads." },
            { status: 400 },
          );
        }
        const reply = importReply(card);
        await saveExchange({
          user,
          conversationId,
          userMessage: userMessageForStorage,
          assistantReply: reply,
          toolCalls: [],
          pendingWrites: conversation.pendingWrites,
          userAttachments: attachments,
        });
        return NextResponse.json({
          session_id: conversationId,
          reply,
          lead_import: card,
          tool_calls: [],
          conversations: await listConversations(user),
          confirmation_required: false,
        });
      }

      if (body.type === "chat" && directAttachmentAnswer && !conversation.pendingWrites.length) {
        setPendingActivityDraft(conversationId, null);
        await saveExchange({
          user,
          conversationId,
          userMessage: userMessageForStorage,
          assistantReply: directAttachmentAnswer.reply,
          toolCalls: [],
          pendingWrites: conversation.pendingWrites,
          userAttachments: attachments,
        });
        return NextResponse.json({
          session_id: conversationId,
          reply: directAttachmentAnswer.reply,
          tool_calls: [],
          conversations: await listConversations(user),
          confirmation_required: false,
        });
      }

      const pendingActivity = getPendingActivityDraft(conversationId);

      if (body.type === "chat") {
        if (pendingActivity && CANCEL_PATTERN.test(message)) {
          const reply = "Cancelled. Activity creation was stopped.";
          setPendingActivityDraft(conversationId, null);
          await saveExchange({
            user,
            conversationId,
            userMessage: userMessageForStorage,
            assistantReply: reply,
            toolCalls: [],
            pendingWrites: conversation.pendingWrites,
            userAttachments: attachments,
          });
          return NextResponse.json({
            session_id: conversationId,
            reply,
            tool_calls: [],
            conversations: await listConversations(user),
            confirmation_required: conversation.pendingWrites.length > 0,
          });
        }

        if (pendingActivity || detectAddActivityIntent(message)) {
          const updatedDraft = updateDraftFromMessage(pendingActivity || {}, message);
          const followUp = nextActivityQuestion(updatedDraft);
          if (followUp) {
            setPendingActivityDraft(conversationId, updatedDraft);
            await saveExchange({
              user,
              conversationId,
              userMessage: userMessageForStorage,
              assistantReply: followUp,
              toolCalls: [],
              pendingWrites: conversation.pendingWrites,
              userAttachments: attachments,
            });
            return NextResponse.json({
              session_id: conversationId,
              reply: followUp,
              tool_calls: [],
              conversations: await listConversations(user),
              confirmation_required: conversation.pendingWrites.length > 0,
            });
          }

          const payload = await addActivityDirect(user, updatedDraft);
          if (isNeedsInput(payload)) {
            const question = Array.isArray(payload.questions) && payload.questions.length
              ? String(payload.questions[0])
              : "I still need one more detail to create this activity.";
            setPendingActivityDraft(conversationId, updatedDraft);
            await saveExchange({
              user,
              conversationId,
              userMessage: userMessageForStorage,
              assistantReply: question,
              toolCalls: [],
              pendingWrites: conversation.pendingWrites,
              userAttachments: attachments,
            });
            return NextResponse.json({
              session_id: conversationId,
              reply: question,
              tool_calls: [],
              conversations: await listConversations(user),
              confirmation_required: conversation.pendingWrites.length > 0,
            });
          }

          if (isErrorPayload(payload)) {
            const reply = String(payload.error?.message || "I could not create that activity.");
            setPendingActivityDraft(conversationId, updatedDraft);
            await saveExchange({
              user,
              conversationId,
              userMessage: userMessageForStorage,
              assistantReply: reply,
              toolCalls: [],
              pendingWrites: conversation.pendingWrites,
              userAttachments: attachments,
            });
            return NextResponse.json({
              session_id: conversationId,
              reply,
              tool_calls: [],
              conversations: await listConversations(user),
              confirmation_required: conversation.pendingWrites.length > 0,
            });
          }

          const reply = "Activity created successfully.";
          setPendingActivityDraft(conversationId, null);
          await saveExchange({
            user,
            conversationId,
            userMessage: userMessageForStorage,
            assistantReply: reply,
            toolCalls: [],
            pendingWrites: conversation.pendingWrites,
            userAttachments: attachments,
          });
          return NextResponse.json({
            session_id: conversationId,
            reply,
            tool_calls: [],
            conversations: await listConversations(user),
            confirmation_required: conversation.pendingWrites.length > 0,
          });
        }
      }

      const isReject =
        body.type === "reject_write" ||
        (body.type === "chat" && CANCEL_PATTERN.test(message));
      if (conversation.pendingWrites.length && isReject) {
        const reply = "Cancelled. No CRM data was changed.";
        setPendingActivityDraft(conversationId, null);
        await saveExchange({
          user,
          conversationId,
          userMessage: userMessageForStorage,
          assistantReply: reply,
          toolCalls: [],
          pendingWrites: [],
          userAttachments: attachments,
        });
        return NextResponse.json({
          session_id: conversationId,
          reply,
          tool_calls: [],
          conversations: await listConversations(user),
          confirmation_required: false,
        });
      }

      const isConfirm =
        body.type === "confirm_write" ||
        (body.type === "chat" && CONFIRM_PATTERN.test(message));
      if (conversation.pendingWrites.length && isConfirm) {
        const result = await executeConfirmedWrites(
          user,
          history,
          conversation.pendingWrites,
        );
        setPendingActivityDraft(conversationId, null);
        await saveExchange({
          user,
          conversationId,
          userMessage: userMessageForStorage,
          assistantReply: result.reply,
          toolCalls: result.toolCalls,
          pendingWrites: [],
          userAttachments: attachments,
        });
        return NextResponse.json({
          session_id: conversationId,
          reply: result.reply,
          tool_calls: result.toolCalls,
          conversations: await listConversations(user),
          confirmation_required: false,
        });
      }

      if (body.type === "confirm_write" || body.type === "reject_write") {
        return NextResponse.json(
          {
            detail: "There is no pending CRM change to confirm or reject.",
            confirmation_required: false,
          },
          { status: 409 },
        );
      }

      if (conversation.pendingWrites.length) {
        return NextResponse.json(
          {
            detail:
              "A CRM change is awaiting your decision. Use Confirm or Reject before continuing.",
            confirmation_required: true,
          },
          { status: 409 },
        );
      }

      const useCrossConversationContext =
        process.env.ACARSH_ENABLE_CROSS_CONVERSATION_CONTEXT === "1" &&
        conversation.messages.length > 0;
      const previousContext = useCrossConversationContext
        ? await getPreviousConversationContext(user, conversationId)
        : "";
      const parsedLeadId = Number(body.contextLeadId);
      const parsedContactId = Number(body.contextContactId);
      const researchKind =
        body.droitCommand === "research_contact"
          ? "contact"
          : body.droitCommand === "research_company"
            ? "company"
            : body.droitCommand === "meeting_brief"
              ? "meeting"
              : undefined;
      const pageContext: AssistantPageContext | undefined =
        (Number.isInteger(parsedLeadId) && parsedLeadId > 0) ||
        (Number.isInteger(parsedContactId) && parsedContactId > 0) ||
        researchKind
          ? {
              leadId: Number.isInteger(parsedLeadId) && parsedLeadId > 0 ? parsedLeadId : undefined,
              contactId:
                Number.isInteger(parsedContactId) && parsedContactId > 0
                  ? parsedContactId
                  : undefined,
              researchKind,
            }
          : undefined;
      const result = await runAgent(
        user,
        history,
        messageForAssistant,
        previousContext,
        pageContext,
      );
      const pendingWrites = result.pendingWrites || [];
      setPendingActivityDraft(conversationId, null);
      await saveExchange({
        user,
        conversationId,
        userMessage: userMessageForStorage,
        assistantReply: result.reply,
        toolCalls: result.toolCalls,
        pendingWrites,
        userAttachments: attachments,
      });
      return NextResponse.json({
        session_id: conversationId,
        reply: result.reply,
        tool_calls: result.toolCalls,
        conversations: await listConversations(user),
        confirmation_required: pendingWrites.length > 0,
      });
    });
  } catch (error) {
    return errorResponse(error);
  }
}
