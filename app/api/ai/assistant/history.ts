import { randomUUID } from "crypto";

import { getPool } from "@/config/db";

import type { ResolvedAuthUser } from "@/app/api/lib/auth";
import type { AgentMessage, PendingWrite, ToolLog } from "./agent";

export type StoredChatMessage = {
  role: "user" | "assistant";
  content: string;
  toolCalls: ToolLog[];
};

export type ConversationSummary = {
  id: string;
  title: string;
  updatedAt: string;
};

export type StoredConversation = {
  id: string;
  userId: number;
  roleId: number;
  title: string;
  pendingWrites: PendingWrite[];
  messages: StoredChatMessage[];
};

const historyGlobal = globalThis as typeof globalThis & {
  __acarshChatStoragePromise?: Promise<void>;
};

function parseJsonArray<T>(value: unknown): T[] {
  if (!value) return [];
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function titleFromMessage(message: string) {
  const compact = message.replace(/\s+/g, " ").trim();
  if (!compact) return "New conversation";
  return compact.length > 90 ? `${compact.slice(0, 87)}…` : compact;
}

async function createTables() {
  const pool = await getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS AIChatConversations (
      ConversationId VARCHAR(36) NOT NULL PRIMARY KEY,
      UserId INT NOT NULL,
      RoleId INT NOT NULL,
      Title VARCHAR(160) NOT NULL DEFAULT 'New conversation',
      PendingWritesJson LONGTEXT NULL,
      IsArchived TINYINT(1) NOT NULL DEFAULT 0,
      CreatedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      UpdatedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
        ON UPDATE CURRENT_TIMESTAMP(6),
      INDEX IX_AIChatConversations_UserRoleUpdated
        (UserId, RoleId, IsArchived, UpdatedAt)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS AIChatMessages (
      MessageId BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      ConversationId VARCHAR(36) NOT NULL,
      Role VARCHAR(16) NOT NULL,
      Content LONGTEXT NOT NULL,
      ToolCallsJson LONGTEXT NULL,
      CreatedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      INDEX IX_AIChatMessages_ConversationMessage (ConversationId, MessageId),
      CONSTRAINT FK_AIChatMessages_Conversation
        FOREIGN KEY (ConversationId)
        REFERENCES AIChatConversations (ConversationId)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

export async function ensureChatStorage() {
  if (!historyGlobal.__acarshChatStoragePromise) {
    historyGlobal.__acarshChatStoragePromise = createTables().catch((error) => {
      historyGlobal.__acarshChatStoragePromise = undefined;
      throw error;
    });
  }
  return historyGlobal.__acarshChatStoragePromise;
}

export async function createConversation(
  user: ResolvedAuthUser,
): Promise<StoredConversation> {
  await ensureChatStorage();
  const id = randomUUID();
  const pool = await getPool();
  await pool.execute(
    `INSERT INTO AIChatConversations
      (ConversationId, UserId, RoleId, Title, PendingWritesJson)
     VALUES (?, ?, ?, 'New conversation', '[]')`,
    [id, user.userId, user.roleId],
  );
  return {
    id,
    userId: user.userId,
    roleId: user.roleId,
    title: "New conversation",
    pendingWrites: [],
    messages: [],
  };
}

export async function listConversations(
  user: ResolvedAuthUser,
  limit = 20,
): Promise<ConversationSummary[]> {
  await ensureChatStorage();
  const pool = await getPool();
  // Some MySQL/MariaDB versions reject a bound parameter in LIMIT when using
  // the binary prepared-statement protocol. This value is locally clamped to
  // an integer, so interpolating it as SQL syntax is both compatible and safe.
  const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 50));
  const [rows]: any = await pool.execute(
    `SELECT ConversationId, Title, UpdatedAt
     FROM AIChatConversations
     WHERE UserId = ? AND RoleId = ? AND IsArchived = 0
     ORDER BY UpdatedAt DESC
     LIMIT ${safeLimit}`,
    [user.userId, user.roleId],
  );
  return (rows || []).map((row: any) => ({
    id: String(row.ConversationId),
    title: String(row.Title || "New conversation"),
    updatedAt: new Date(row.UpdatedAt).toISOString(),
  }));
}

export async function loadConversation(
  user: ResolvedAuthUser,
  conversationId: string,
): Promise<StoredConversation | null> {
  await ensureChatStorage();
  const pool = await getPool();
  const [conversationRows]: any = await pool.execute(
    `SELECT ConversationId, UserId, RoleId, Title, PendingWritesJson
     FROM AIChatConversations
     WHERE ConversationId = ? AND UserId = ? AND RoleId = ? AND IsArchived = 0
     LIMIT 1`,
    [conversationId, user.userId, user.roleId],
  );
  if (!conversationRows?.length) return null;

  const [messageRows]: any = await pool.execute(
    `SELECT MessageId, Role, Content, ToolCallsJson
     FROM (
       SELECT MessageId, Role, Content, ToolCallsJson
       FROM AIChatMessages
       WHERE ConversationId = ?
       ORDER BY MessageId DESC
       LIMIT 60
     ) recent
     ORDER BY MessageId ASC`,
    [conversationId],
  );
  const row = conversationRows[0];
  return {
    id: String(row.ConversationId),
    userId: Number(row.UserId),
    roleId: Number(row.RoleId),
    title: String(row.Title || "New conversation"),
    pendingWrites: parseJsonArray<PendingWrite>(row.PendingWritesJson),
    messages: (messageRows || [])
      .filter((message: any) => message.Role === "user" || message.Role === "assistant")
      .map((message: any) => ({
        role: message.Role as "user" | "assistant",
        content: String(message.Content || ""),
        toolCalls: parseJsonArray<ToolLog>(message.ToolCallsJson),
      })),
  };
}

export async function getOrCreateConversation(user: ResolvedAuthUser) {
  const conversations = await listConversations(user, 1);
  if (conversations.length) {
    const existing = await loadConversation(user, conversations[0].id);
    if (existing) return existing;
  }
  return createConversation(user);
}

export async function saveExchange(options: {
  user: ResolvedAuthUser;
  conversationId: string;
  userMessage: string;
  assistantReply: string;
  toolCalls: ToolLog[];
  pendingWrites: PendingWrite[];
}) {
  await ensureChatStorage();
  const pool = await getPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [ownership]: any = await connection.execute(
      `SELECT ConversationId, Title
       FROM AIChatConversations
       WHERE ConversationId = ? AND UserId = ? AND RoleId = ? AND IsArchived = 0
       FOR UPDATE`,
      [options.conversationId, options.user.userId, options.user.roleId],
    );
    if (!ownership?.length) throw new Error("Conversation is unavailable");

    await connection.execute(
      `INSERT INTO AIChatMessages (ConversationId, Role, Content, ToolCallsJson)
       VALUES (?, 'user', ?, '[]'), (?, 'assistant', ?, ?)`,
      [
        options.conversationId,
        options.userMessage,
        options.conversationId,
        options.assistantReply,
        JSON.stringify(options.toolCalls),
      ],
    );
    const currentTitle = String(ownership[0].Title || "");
    const title =
      currentTitle === "New conversation"
        ? titleFromMessage(options.userMessage)
        : currentTitle;
    await connection.execute(
      `UPDATE AIChatConversations
       SET Title = ?, PendingWritesJson = ?, UpdatedAt = CURRENT_TIMESTAMP(6)
       WHERE ConversationId = ?`,
      [title, JSON.stringify(options.pendingWrites), options.conversationId],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function getPreviousConversationContext(
  user: ResolvedAuthUser,
  currentConversationId: string,
) {
  const conversations = (await listConversations(user, 6)).filter(
    (conversation) => conversation.id !== currentConversationId,
  );
  if (!conversations.length) return "";

  const pool = await getPool();
  const sections: string[] = [];
  for (const conversation of conversations.slice(0, 4)) {
    const [rows]: any = await pool.execute(
      `SELECT Role, Content
       FROM AIChatMessages
       WHERE ConversationId = ?
       ORDER BY MessageId DESC
       LIMIT 4`,
      [conversation.id],
    );
    const messages = (rows || [])
      .reverse()
      .map((row: any) => {
        const content = String(row.Content || "").replace(/\s+/g, " ").slice(0, 500);
        return `${row.Role}: ${content}`;
      })
      .join("\n");
    if (messages) sections.push(`[${conversation.title}]\n${messages}`);
  }
  return sections.join("\n\n").slice(0, 5000);
}

export function agentHistory(messages: StoredChatMessage[]): AgentMessage[] {
  const selected: StoredChatMessage[] = [];
  let characters = 0;
  for (const message of messages.slice(-24).reverse()) {
    const content = message.content.slice(0, 4000);
    if (selected.length && characters + content.length > 24000) break;
    selected.unshift({ ...message, content });
    characters += content.length;
  }
  return selected.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}
