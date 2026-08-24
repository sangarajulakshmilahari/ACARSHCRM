import { NextRequest, NextResponse } from "next/server";

import { resolveAuthUser, type ResolvedAuthUser } from "@/app/api/lib/auth";

import { addActivityDirect, executeConfirmedWrites, runAgent } from "./agent";
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
    | "load_conversation";
  sessionId?: string;
  message?: string;
};

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

function publicRole(roleId: number) {
  return roleId === 1 ? "manager" : "sales_executive";
}

function serializedMessages(conversation: StoredConversation) {
  return conversation.messages.map((message) => ({
    role: message.role,
    content: message.content,
    tool_calls: message.toolCalls,
  }));
}

async function conversationPayload(
  user: ResolvedAuthUser,
  conversation: StoredConversation,
) {
  return {
    session_id: conversation.id,
    user: { name: user.userName, role: publicRole(user.roleId) },
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
  if (![1, 2].includes(user.roleId)) {
    return NextResponse.json(
      { detail: "Your role is not enabled for the CRM assistant." },
      { status: 403 },
    );
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ detail: "Invalid JSON request." }, { status: 400 });
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
      body.type !== "reject_write"
    ) {
      return NextResponse.json({ detail: "Invalid request type." }, { status: 400 });
    }

    const message =
      body.type === "confirm_write"
        ? "Confirmed"
        : body.type === "reject_write"
          ? "Rejected"
          : String(body.message || "").trim();
    if (body.type === "chat" && !message) {
      return NextResponse.json({ detail: "message is required." }, { status: 400 });
    }
    const conversationId = String(body.sessionId || "").trim();
    if (!conversationId) {
      return NextResponse.json({ detail: "sessionId is required." }, { status: 400 });
    }

    return await withConversationLock(conversationId, async () => {
      const conversation = await requireConversation(user, conversationId);
      const history = agentHistory(conversation.messages);

      const pendingActivity = getPendingActivityDraft(conversationId);

      if (body.type === "chat") {
        if (pendingActivity && CANCEL_PATTERN.test(message)) {
          const reply = "Cancelled. Activity creation was stopped.";
          setPendingActivityDraft(conversationId, null);
          await saveExchange({
            user,
            conversationId,
            userMessage: message,
            assistantReply: reply,
            toolCalls: [],
            pendingWrites: conversation.pendingWrites,
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
              userMessage: message,
              assistantReply: followUp,
              toolCalls: [],
              pendingWrites: conversation.pendingWrites,
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
              userMessage: message,
              assistantReply: question,
              toolCalls: [],
              pendingWrites: conversation.pendingWrites,
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
              userMessage: message,
              assistantReply: reply,
              toolCalls: [],
              pendingWrites: conversation.pendingWrites,
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
            userMessage: message,
            assistantReply: reply,
            toolCalls: [],
            pendingWrites: conversation.pendingWrites,
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
          userMessage: message,
          assistantReply: reply,
          toolCalls: [],
          pendingWrites: [],
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
          userMessage: message,
          assistantReply: result.reply,
          toolCalls: result.toolCalls,
          pendingWrites: [],
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
      const result = await runAgent(user, history, message, previousContext);
      const pendingWrites = result.pendingWrites || [];
      setPendingActivityDraft(conversationId, null);
      await saveExchange({
        user,
        conversationId,
        userMessage: message,
        assistantReply: result.reply,
        toolCalls: result.toolCalls,
        pendingWrites,
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
