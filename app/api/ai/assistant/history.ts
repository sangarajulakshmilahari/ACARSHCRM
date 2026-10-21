import { randomUUID } from "crypto";

import { getPool } from "@/config/db";

import type { ResolvedAuthUser } from "@/app/api/lib/auth";
import type { AgentMessage, PendingWrite, ToolLog } from "./agent";

export type StoredChatMessage = {
  messageId: number;
  role: "user" | "assistant";
  content: string;
  toolCalls: ToolLog[];
  attachments: StoredAttachment[];
};

export type StoredAttachment = {
  attachmentId: number;
  fileName: string;
  fileType: string;
  fileSize: number;
  uploadRef: string;
  uploadedAt: string;
};

type NewUserAttachment = {
  originalFileName: string;
  fileType: string;
  fileSize: number;
  fileBuffer: Buffer;
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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS AIChatMessageAttachments (
      AttachmentId BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      MessageId BIGINT UNSIGNED NOT NULL,
      OriginalFileName VARCHAR(260) NOT NULL,
      FileType VARCHAR(120) NOT NULL,
      FileSizeBytes INT UNSIGNED NOT NULL,
      StorageRef VARCHAR(190) NOT NULL,
      FileData LONGBLOB NOT NULL,
      UploadedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      INDEX IX_AIChatMessageAttachments_Message (MessageId),
      CONSTRAINT FK_AIChatMessageAttachments_Message
        FOREIGN KEY (MessageId)
        REFERENCES AIChatMessages (MessageId)
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
      (ConversationId, UserId, RoleId, CompanyId, Title, PendingWritesJson)
     VALUES (?, ?, ?, ?, 'New conversation', '[]')`,
    [id, user.userId, user.roleId, user.companyId],
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
     WHERE UserId = ? AND RoleId = ? AND CompanyId <=> ? AND IsArchived = 0
     ORDER BY UpdatedAt DESC
     LIMIT ${safeLimit}`,
    [user.userId, user.roleId, user.companyId],
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
     WHERE ConversationId = ? AND UserId = ? AND RoleId = ? AND CompanyId <=> ? AND IsArchived = 0
     LIMIT 1`,
    [conversationId, user.userId, user.roleId, user.companyId],
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
  const messageIds = (messageRows || [])
    .map((message: any) => Number(message.MessageId || 0))
    .filter((value: number) => Number.isInteger(value) && value > 0);
  const attachmentsByMessageId = new Map<number, StoredAttachment[]>();
  if (messageIds.length > 0) {
    const placeholders = messageIds.map(() => "?").join(",");
    const [attachmentRows]: any = await pool.execute(
      `SELECT AttachmentId, MessageId, OriginalFileName, FileType, FileSizeBytes, StorageRef, UploadedAt
       FROM AIChatMessageAttachments
       WHERE MessageId IN (${placeholders})
       ORDER BY AttachmentId ASC`,
      messageIds,
    );
    for (const row of attachmentRows || []) {
      const messageId = Number(row.MessageId || 0);
      if (!messageId) continue;
      const current = attachmentsByMessageId.get(messageId) || [];
      current.push({
        attachmentId: Number(row.AttachmentId || 0),
        fileName: String(row.OriginalFileName || ""),
        fileType: String(row.FileType || "application/octet-stream"),
        fileSize: Number(row.FileSizeBytes || 0),
        uploadRef: String(row.StorageRef || ""),
        uploadedAt: row.UploadedAt ? new Date(row.UploadedAt).toISOString() : new Date().toISOString(),
      });
      attachmentsByMessageId.set(messageId, current);
    }
  }
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
        messageId: Number(message.MessageId || 0),
        role: message.Role as "user" | "assistant",
        content: String(message.Content || ""),
        toolCalls: parseJsonArray<ToolLog>(message.ToolCallsJson),
        attachments: attachmentsByMessageId.get(Number(message.MessageId || 0)) || [],
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
  userAttachments?: NewUserAttachment[];
}) {
  await ensureChatStorage();
  const pool = await getPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [ownership]: any = await connection.execute(
      `SELECT ConversationId, Title
       FROM AIChatConversations
       WHERE ConversationId = ? AND UserId = ? AND RoleId = ? AND CompanyId <=> ? AND IsArchived = 0
       FOR UPDATE`,
      [options.conversationId, options.user.userId, options.user.roleId, options.user.companyId],
    );
    if (!ownership?.length) throw new Error("Conversation is unavailable");

    const [userInsert]: any = await connection.execute(
      `INSERT INTO AIChatMessages (ConversationId, CompanyId, Role, Content, ToolCallsJson)
       VALUES (?, ?, 'user', ?, '[]')`,
      [options.conversationId, options.user.companyId, options.userMessage],
    );
    const userMessageId = Number(userInsert?.insertId || 0);
    if (userMessageId > 0 && Array.isArray(options.userAttachments) && options.userAttachments.length) {
      for (const attachment of options.userAttachments) {
        const [attachmentInsert]: any = await connection.execute(
          `INSERT INTO AIChatMessageAttachments
            (MessageId, CompanyId, OriginalFileName, FileType, FileSizeBytes, StorageRef, FileData)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            userMessageId,
            options.user.companyId,
            attachment.originalFileName,
            attachment.fileType,
            attachment.fileSize,
            "pending",
            attachment.fileBuffer,
          ],
        );
        const attachmentId = Number(attachmentInsert?.insertId || 0);
        if (attachmentId > 0) {
          await connection.execute(
            `UPDATE AIChatMessageAttachments
             SET StorageRef = ?
             WHERE AttachmentId = ?`,
            [`db://ai-chat-message-attachments/${attachmentId}`, attachmentId],
          );
        }
      }
    }

    await connection.execute(
      `INSERT INTO AIChatMessages (ConversationId, CompanyId, Role, Content, ToolCallsJson)
       VALUES (?, ?, 'assistant', ?, ?)`,
      [
        options.conversationId,
        options.user.companyId,
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
