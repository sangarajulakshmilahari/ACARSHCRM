import { NextRequest, NextResponse } from "next/server";

import { resolveAuthUser, type ResolvedAuthUser } from "@/app/api/lib/auth";

import { executeConfirmedWrites, runAgent } from "./agent";
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

const CONFIRM_PATTERN = /^(confirm|confirmed|yes|yes,? proceed|proceed|go ahead|do it)$/i;
const CANCEL_PATTERN = /^(cancel|stop|no|never mind|nevermind)$/i;

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

      const isReject =
        body.type === "reject_write" ||
        (body.type === "chat" && CANCEL_PATTERN.test(message));
      if (conversation.pendingWrites.length && isReject) {
        const reply = "Cancelled. No CRM data was changed.";
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

      const previousContext = await getPreviousConversationContext(
        user,
        conversationId,
      );
      const result = await runAgent(user, history, message, previousContext);
      const pendingWrites = result.pendingWrites || [];
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
