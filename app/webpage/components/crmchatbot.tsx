"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Clock3,
  FileSpreadsheet,
  FileText,
  MessageSquare,
  Paperclip,
  Plus,
  X,
} from "lucide-react";
import styles from "../components/crmchatbot.module.css";
import { droitCommandMessage, type DroitCommand } from "./droitCommands";

type Props = {
  onAction?: (action: any) => void;
  ownerName?: string;
  contextLeadId?: number | string | null;
  contextContactId?: number | string | null;
  pendingCommand?: DroitCommand | null;
  onPendingCommandConsumed?: (commandId: string) => void;
  onClose?: () => void;
  extensions?: ChatbotExtensions;
};

type ChatbotExtensions = {
  roleSuggestions?: Record<string, string[]>;
  transformOutgoingMessage?: (text: string) => string;
  assistantContentRenderer?: (content: string) => React.ReactNode;
  mapToolCallToAction?: (toolName: string) => string | null;
};

type ChatAttachment = {
  attachmentId?: number;
  fileName: string;
  fileType: string;
  fileSize: number;
  uploadRef?: string;
  uploadedAt?: string;
};

type LeadImportCard = {
  fileName: string;
  recordCount: number;
  columns: string[];
  mapping: Record<string, string>;
  unmapped: string[];
  unmappedToNotes: string[];
  suggestions: Array<{ field: string; value: string; reason: string }>;
  missingRequired: Array<{ field: string; label: string }>;
  defaults: {
    companyLocation: string;
    contactTitle: string;
    contactRole: string;
    leadSource: string;
    leadStatus: string;
    ownerName: string;
    leadDate: string;
  };
  lookups: {
    leadSources: string[];
    leadStatuses: string[];
    owners: string[];
    contactRoles: string[];
  };
  summary: {
    valid: number;
    needsAttention: number;
    invalid: number;
    existing: number;
    duplicate: number;
    createCount: number;
  };
  previewRows: Array<{
    rowNumber: number;
    companyName: string;
    contactName: string;
    contactTitle: string;
    linkedInUrl: string;
    status: string;
    reasons: string[];
  }>;
  canConfirm: boolean;
  skipInvalid: boolean;
  result?: {
    createdLeads: number;
    createdContacts: number;
    duplicatesSkipped: number;
    invalidSkipped: number;
    failed: Array<{ rowNumber: number; companyName: string; reason: string }>;
    apolloEnriched: number;
    apolloFailed: number;
    scored: number;
  };
};

type ChatMessage = {
  messageId?: number;
  role: "user" | "assistant";
  content: string;
  toolCalls?: Array<{ name: string; result_summary?: string }>;
  attachments?: ChatAttachment[];
  leadImport?: LeadImportCard;
};

const IMPORT_FIELD_LABELS: Record<string, string> = {
  companyName: "Company Name",
  companyLocation: "Company Location",
  industryFocus: "Industry Focus",
  leadSource: "Lead Source",
  leadDate: "Lead Date",
  leadStatus: "Lead Status",
  leadNotes: "Lead Notes",
  contactName: "Contact Name",
  contactTitle: "Contact Title",
  contactRole: "Contact Role",
  contactEmail: "Email",
  contactPhone: "Phone",
  contactLocation: "Contact Location",
  linkedInUrl: "LinkedIn URL",
  contactNotes: "Contact Notes",
};

type PendingAttachment = {
  id: string;
  file: File;
  fileName: string;
  fileType: string;
  fileSize: number;
};

type ConversationSummary = {
  id: string;
  title: string;
  updatedAt: string;
};

const SUGGESTIONS_BY_ROLE: Record<string, string[]> = {
  sales_executive: [
    "Show my pipeline summary",
    "List my prospects",
    "What did I do this week?",
    "Search my records for Acme Corp",
  ],
  agent: [
    "Show my pipeline summary",
    "List my prospects",
    "What did I do this week?",
    "Search for Acme Corp",
  ],
  manager: [
    "Show team pipeline by agent",
    "Who has the most leads?",
    "Show all prospects this month",
    "Recent activities across the team",
  ],
  admin: [
    "Show full org pipeline",
    "Compare agents by revenue",
    "Show all customers",
  ],
};

const ATTACHMENT_MAX_SIZE_BYTES = 10 * 1024 * 1024;
const ATTACHMENT_ACCEPT = ".pdf,.xls,.xlsx,.csv";
const ATTACHMENT_EXTENSIONS = new Set(["pdf", "xls", "xlsx", "csv"]);
const ATTACHMENT_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "application/csv",
  "text/plain",
]);

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function fileExtension(fileName: string) {
  const name = String(fileName || "").trim();
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "";
  return name.slice(dot + 1).toLowerCase();
}

function fileIconByType(fileType: string, fileName: string) {
  const extension = fileExtension(fileName);
  if (fileType.includes("spreadsheet") || fileType.includes("excel") || extension === "xls" || extension === "xlsx") {
    return <FileSpreadsheet size={14} strokeWidth={2.2} aria-hidden="true" />;
  }
  return <FileText size={14} strokeWidth={2.2} aria-hidden="true" />;
}

function parsePipeRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isSeparatorRow(line: string) {
  const cells = parsePipeRow(line);
  if (cells.length === 0) return false;
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function safeHttpUrl(raw: string): string | null {
  const value = raw.trim().replace(/[),.;]+$/, "");
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function linkLabel(text: string, href: string) {
  const trimmed = text.trim();
  if (trimmed && trimmed !== href && !/^https?:\/\//i.test(trimmed)) return trimmed;
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return href;
  }
}

function renderInlineText(value: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern =
    /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*(?!\*)[^*]+\*)|(_(?!_)[^_]+_)|(\[[^\]]+\]\([^)]+\))|(https?:\/\/[^\s<]+)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(value))) {
    if (match.index > last) {
      nodes.push(<React.Fragment key={`t-${key++}`}>{value.slice(last, match.index)}</React.Fragment>);
    }
    const token = match[0];
    if (token.startsWith("`")) {
      nodes.push(<code key={`c-${key++}`}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={`b-${key++}`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*") || token.startsWith("_")) {
      nodes.push(<em key={`i-${key++}`}>{token.slice(1, -1)}</em>);
    } else if (token.startsWith("[")) {
      const linked = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const href = linked ? safeHttpUrl(linked[2]) : null;
      if (href && linked) {
        nodes.push(
          <a
            key={`a-${key++}`}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {linkLabel(linked[1], href)}
          </a>,
        );
      } else {
        nodes.push(<React.Fragment key={`t-${key++}`}>{token}</React.Fragment>);
      }
    } else {
      const href = safeHttpUrl(token);
      nodes.push(
        href ? (
          <a
            key={`u-${key++}`}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {linkLabel(token, href)}
          </a>
        ) : (
          <React.Fragment key={`t-${key++}`}>{token}</React.Fragment>
        ),
      );
    }
    last = match.index + token.length;
  }
  if (last < value.length) {
    nodes.push(<React.Fragment key={`t-${key++}`}>{value.slice(last)}</React.Fragment>);
  }
  return nodes;
}

function renderAssistantContent(content: string) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const parts: React.ReactNode[] = [];
  let index = 0;

  const push = (node: React.ReactNode) => parts.push(node);

  while (index < lines.length) {
    const raw = lines[index] || "";
    const trimmed = raw.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const fence: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] || "").trim().startsWith("```")) {
        fence.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      push(
        <pre className={styles.assistantCodeBlock} key={`code-${index}`}>
          <code>{fence.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    if (trimmed.startsWith("|")) {
      const tableLines: string[] = [];
      while (index < lines.length && (lines[index] || "").trim().startsWith("|")) {
        tableLines.push(lines[index]);
        index += 1;
      }
      if (tableLines.length >= 2 && isSeparatorRow(tableLines[1])) {
        const headers = parsePipeRow(tableLines[0]);
        const bodyRows = tableLines.slice(2).map(parsePipeRow);
        push(
          <div className={styles.assistantTableWrap} key={`tbl-${index}`}>
            <table className={styles.assistantTable}>
              <thead>
                <tr>
                  {headers.map((cell, hIdx) => (
                    <th key={`h-${hIdx}`}>{renderInlineText(cell)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bodyRows.map((row, rIdx) => (
                  <tr key={`r-${rIdx}`}>
                    {row.map((cell, cIdx) => (
                      <td key={`c-${rIdx}-${cIdx}`} data-label={headers[cIdx] || "Value"}>
                        {renderInlineText(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        );
      } else {
        push(
          <div className={styles.assistantTableWrap} key={`pre-${index}`}>
            <pre className={styles.assistantTablePre}>{tableLines.join("\n")}</pre>
          </div>,
        );
      }
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const Tag = (level === 1 ? "h3" : level === 2 ? "h4" : "h5") as "h3" | "h4" | "h5";
      push(
        <Tag className={styles.assistantHeading} key={`h-${index}`}>
          {renderInlineText(heading[2])}
        </Tag>,
      );
      index += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      push(<hr className={styles.assistantRule} key={`hr-${index}`} />);
      index += 1;
      continue;
    }

    const unordered = trimmed.match(/^[-*+]\s+(.+)$/);
    const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      const items: string[] = [];
      const orderedList = Boolean(ordered);
      while (index < lines.length) {
        const itemLine = (lines[index] || "").trim();
        const next = orderedList
          ? itemLine.match(/^\d+[.)]\s+(.+)$/)
          : itemLine.match(/^[-*+]\s+(.+)$/);
        if (!next) break;
        items.push(next[1]);
        index += 1;
      }
      const ListTag = orderedList ? "ol" : "ul";
      push(
        <ListTag className={styles.assistantList} key={`list-${index}`}>
          {items.map((item, itemIdx) => (
            <li key={`li-${itemIdx}`}>{renderInlineText(item)}</li>
          ))}
        </ListTag>,
      );
      continue;
    }

    const paragraph: string[] = [trimmed];
    index += 1;
    while (index < lines.length) {
      const next = (lines[index] || "").trim();
      if (
        !next ||
        next.startsWith("|") ||
        next.startsWith("#") ||
        next.startsWith("```") ||
        /^[-*+]\s+/.test(next) ||
        /^\d+[.)]\s+/.test(next) ||
        /^(-{3,}|\*{3,}|_{3,})$/.test(next)
      ) {
        break;
      }
      paragraph.push(next);
      index += 1;
    }
    push(
      <p className={styles.assistantTextBlock} key={`p-${index}`}>
        {renderInlineText(paragraph.join(" "))}
      </p>,
    );
  }

  return <div className={styles.assistantMarkdown}>{parts}</div>;
}

function mapToolNameToActionType(name: string): string | null {
  const key = name.toLowerCase();
  if (key === "create_lead") return "lead_created";
  if (key === "delete_lead") return "lead_deleted";
  if (/^(add|assign|convert|create|delete|remove|schedule|update)_/.test(key)) {
    return "lead_updated";
  }
  return null;
}

function formatConversationTime(value: string) {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return "Recent conversation";

  const now = new Date();
  const sameDay =
    timestamp.getFullYear() === now.getFullYear() &&
    timestamp.getMonth() === now.getMonth() &&
    timestamp.getDate() === now.getDate();

  const options: Intl.DateTimeFormatOptions = sameDay
    ? { hour: "numeric", minute: "2-digit" }
    : { month: "short", day: "numeric", year: "numeric" };

  return new Intl.DateTimeFormat(undefined, options).format(timestamp);
}

export default function CRMChatBot({
  onAction,
  onClose,
  ownerName,
  contextLeadId,
  contextContactId,
  pendingCommand,
  onPendingCommandConsumed,
  extensions,
}: Props) {
  const [loginError, setLoginError] = useState<string>("");
  const [loadingLogin, setLoadingLogin] = useState(true);

  const [sessionId, setSessionId] = useState<string>("");
  const [userName, setUserName] = useState<string>(ownerName || "CRM User");
  const [role, setRole] = useState<string>("agent");

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [switchingConversation, setSwitchingConversation] = useState(false);
  const [conversationMenuOpen, setConversationMenuOpen] = useState(false);
  const [confirmationRequired, setConfirmationRequired] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState("");

  const bottomRef = useRef<HTMLDivElement>(null);
  const conversationMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const consumedCommandId = useRef<string | null>(null);
  const activeCommandRef = useRef<DroitCommand | null>(null);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === sessionId),
    [conversations, sessionId],
  );

  const suggestions = useMemo(
    () => {
      const merged = {
        ...SUGGESTIONS_BY_ROLE,
        ...(extensions?.roleSuggestions || {}),
      };
      return merged[role] || merged.agent || SUGGESTIONS_BY_ROLE.agent;
    },
    [role, extensions?.roleSuggestions],
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  useEffect(() => {
    if (!conversationMenuOpen) return;

    function closeConversationMenu(event: MouseEvent) {
      if (
        conversationMenuRef.current &&
        !conversationMenuRef.current.contains(event.target as Node)
      ) {
        setConversationMenuOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setConversationMenuOpen(false);
    }

    document.addEventListener("mousedown", closeConversationMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeConversationMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [conversationMenuOpen]);

  function messagesFromPayload(value: unknown): ChatMessage[] {
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (message: any) =>
          message?.role === "user" || message?.role === "assistant",
      )
      .map((message: any) => ({
        messageId: Number(message.message_id || 0) || undefined,
        role: message.role,
        content: String(message.content || ""),
        toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls : [],
        attachments: Array.isArray(message.attachments)
          ? message.attachments
              .map((item: any) => ({
                attachmentId: Number(item?.attachmentId || 0) || undefined,
                fileName: String(item?.fileName || ""),
                fileType: String(item?.fileType || "application/octet-stream"),
                fileSize: Number(item?.fileSize || 0),
                uploadRef: String(item?.uploadRef || ""),
                uploadedAt: String(item?.uploadedAt || ""),
              }))
              .filter((item: ChatAttachment) => !!item.fileName && item.fileSize > 0)
          : [],
      }));
  }

  function validateAttachment(file: File): string {
    if (!file || !file.name) return "Invalid file selected.";
    const extension = fileExtension(file.name);
    if (!ATTACHMENT_EXTENSIONS.has(extension)) {
      return `${file.name} is not supported. Only PDF, XLS and XLSX are allowed.`;
    }
    const normalizedType = String(file.type || "").trim().toLowerCase();
    const genericType =
      !normalizedType ||
      normalizedType === "application/octet-stream" ||
      normalizedType === "application/zip" ||
      normalizedType === "application/x-zip-compressed";
    if (!genericType && !ATTACHMENT_MIME_TYPES.has(normalizedType)) {
      return `${file.name} has an unsupported type.`;
    }
    if (!Number.isFinite(file.size) || file.size <= 0) {
      return `${file.name} is empty or unreadable.`;
    }
    if (file.size > ATTACHMENT_MAX_SIZE_BYTES) {
      return `${file.name} exceeds the 10 MB size limit.`;
    }
    return "";
  }

  function onAttachmentPick(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    const next: PendingAttachment[] = [];
    for (const file of files) {
      const error = validateAttachment(file);
      if (error) {
        setAttachmentError(error);
        continue;
      }
      next.push({
        id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        fileName: file.name,
        fileType: file.type || "application/octet-stream",
        fileSize: file.size,
      });
    }

    if (next.length) {
      setPendingAttachments((prev) => {
        const existing = new Set(prev.map((item) => `${item.fileName}-${item.fileSize}`));
        const unique = next.filter((item) => !existing.has(`${item.fileName}-${item.fileSize}`));
        return [...prev, ...unique];
      });
      setAttachmentError("");
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function removeAttachment(id: string) {
    setPendingAttachments((prev) => prev.filter((item) => item.id !== id));
  }

  function applyConversationPayload(data: any) {
    setSessionId(String(data?.session_id || ""));
    setMessages(messagesFromPayload(data?.messages));
    setConversations(
      Array.isArray(data?.conversations) ? data.conversations : [],
    );
    setConfirmationRequired(Boolean(data?.confirmation_required));
  }

  async function login() {
    setLoadingLogin(true);
    setLoginError("");

    try {
      const res = await fetch("/api/ai/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "bootstrap" }),
      });

      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) {
          window.location.href = "/api/auth/login";
          return;
        }
        setLoginError(data?.detail || "Unable to start assistant.");
        return;
      }

      applyConversationPayload(data);
      setUserName(data?.user?.name || ownerName || "CRM User");
      setRole((data?.user?.role || "agent").toLowerCase());
    } catch {
      setLoginError("Unable to connect to assistant service.");
    } finally {
      setLoadingLogin(false);
    }
  }

  useEffect(() => {
    login();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function changeConversation(
    type: "new_conversation" | "load_conversation",
    targetSessionId?: string,
  ) {
    if (sending || switchingConversation) return;
    setConversationMenuOpen(false);
    setSwitchingConversation(true);
    setLoginError("");
    try {
      const res = await fetch("/api/ai/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, sessionId: targetSessionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || "Unable to load conversation.");
      applyConversationPayload(data);
    } catch (error: any) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: error?.message || "Unable to load conversation.",
          toolCalls: [],
        },
      ]);
    } finally {
      setSwitchingConversation(false);
    }
  }

  async function sendMessage(
    forcedText?: string,
    requestType: "chat" | "confirm_write" | "reject_write" = "chat",
  ) {
    const rawText = (forcedText || input).trim();
    const text = requestType === "chat" && extensions?.transformOutgoingMessage
      ? extensions.transformOutgoingMessage(rawText).trim()
      : rawText;
    const hasAttachments = pendingAttachments.length > 0;
    if ((!text && !hasAttachments) || sending || !sessionId) return;

    const optimisticAttachments: ChatAttachment[] = pendingAttachments.map((attachment) => ({
      fileName: attachment.fileName,
      fileType: attachment.fileType,
      fileSize: attachment.fileSize,
      uploadRef: "pending",
      uploadedAt: new Date().toISOString(),
    }));

    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: text || "Sent attachment(s)",
        attachments: optimisticAttachments,
      },
    ]);
    setInput("");
    setAttachmentError("");
    setSending(true);

    try {
      let res: Response;
      if (requestType === "chat") {
        const formData = new FormData();
        formData.set("type", requestType);
        formData.set("sessionId", sessionId);
        if (contextLeadId != null && String(contextLeadId).trim()) {
          formData.set("contextLeadId", String(contextLeadId));
        }
        if (contextContactId != null && String(contextContactId).trim()) {
          formData.set("contextContactId", String(contextContactId));
        }
        if (activeCommandRef.current?.type) {
          formData.set("droitCommand", activeCommandRef.current.type);
        }
        if (text) formData.set("message", text);
        for (const attachment of pendingAttachments) {
          formData.append("attachments", attachment.file, attachment.fileName);
        }
        res = await fetch("/api/ai/assistant", {
          method: "POST",
          body: formData,
        });
      } else {
        res = await fetch("/api/ai/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: requestType,
            sessionId,
          }),
        });
      }

      const raw = await res.text();
      let data: any = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        data = { detail: raw || "The assistant returned an unexpected response." };
      }
      if (!res.ok) {
        if (res.status === 401) {
          window.location.href = "/api/auth/login";
          return;
        }
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: data?.detail || "Something went wrong. Please try again.",
            toolCalls: [],
          },
        ]);
        return;
      }

      if (requestType === "chat") {
        setPendingAttachments([]);
      }

      const toolCalls = Array.isArray(data.tool_calls) ? data.tool_calls : [];
      setSessionId(data.session_id || sessionId);
      if (Array.isArray(data.conversations)) {
        setConversations(data.conversations);
      }
      setConfirmationRequired(Boolean(data.confirmation_required));
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.reply || "I processed your request.",
          toolCalls,
          leadImport: data.lead_import || undefined,
        },
      ]);

      if (onAction && toolCalls.length > 0) {
        const toolName = String(toolCalls[0]?.name || "");
        const mappedType = extensions?.mapToolCallToAction
          ? extensions.mapToolCallToAction(toolName)
          : mapToolNameToActionType(toolName);
        if (mappedType) onAction({ type: mappedType });
      }
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            error instanceof Error && error.message
              ? `I couldn't complete that request: ${error.message}`
              : "I couldn't reach the assistant service. Please retry in a moment.",
          toolCalls: [],
        },
      ]);
    } finally {
      activeCommandRef.current = null;
      setSending(false);
    }
  }

  useEffect(() => {
    if (
      !pendingCommand ||
      loadingLogin ||
      !sessionId ||
      sending ||
      confirmationRequired ||
      switchingConversation
    ) {
      return;
    }
    if (consumedCommandId.current === pendingCommand.id) return;
    consumedCommandId.current = pendingCommand.id;
    activeCommandRef.current = pendingCommand;
    onPendingCommandConsumed?.(pendingCommand.id);
    void sendMessage(droitCommandMessage(pendingCommand));
  }, [
    confirmationRequired,
    loadingLogin,
    onPendingCommandConsumed,
    pendingCommand,
    sending,
    sessionId,
    switchingConversation,
  ]);

  async function sendImportAction(
    type: "lead_import_update" | "lead_import_confirm" | "lead_import_cancel",
    extra?: Record<string, unknown>,
  ) {
    if (!sessionId || sending) return;
    setSending(true);
    try {
      const res = await fetch("/api/ai/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          sessionId,
          ...extra,
        }),
      });
      const raw = await res.text();
      const data = raw ? JSON.parse(raw) : {};
      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data?.detail || "Unable to update the import.", toolCalls: [] },
        ]);
        return;
      }
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.reply || "Import updated.",
          toolCalls: [],
          leadImport: data.lead_import || undefined,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Unable to update the import right now.", toolCalls: [] },
      ]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={styles.panelContainer}>
      {!sessionId ? (
        <div className={styles.loginWrapper}>
          <div className={styles.loginCard}>
            <div className={styles.loginHeader}>
              <h1 className={styles.loginTitle}>DROIT buddy</h1>
              {onClose ? (
                <button
                  type="button"
                  onClick={onClose}
                  className={styles.closeBtn}
                  aria-label="Close Droit Buddy"
                  title="Close Droit Buddy"
                >
                  <X size={17} strokeWidth={2.25} aria-hidden="true" />
                </button>
              ) : null}
            </div>
            <p className={styles.loginSubtitle}>
              Natural-language CRM analytics assistant
            </p>
            {loginError ? (
              <div className={styles.loginError}>{loginError}</div>
            ) : null}
            <button
              onClick={login}
              disabled={loadingLogin}
              className={styles.loginButton}
            >
              {loadingLogin ? "Starting assistant…" : "Retry"}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className={styles.headerStyle}>
            <div className={styles.chatIdentity}>
              <div className={styles.chatAvatar} aria-hidden="true">
                D
              </div>
              <div className={styles.chatHeading}>
                <div className={styles.chatTitle}>DROIT buddy</div>
                <div className={styles.chatSubtitle}>
                  {userName}
                  <span className={styles.rolePill}>{role.replace(/_/g, " ")}</span>
                </div>
              </div>
            </div>
            {onClose ? (
              <button
                type="button"
                onClick={onClose}
                className={styles.headerCloseBtn}
                aria-label="Close Droit Buddy"
                title="Close Droit Buddy"
              >
                <X size={18} strokeWidth={2.25} aria-hidden="true" />
              </button>
            ) : null}
          </div>

          <div className={styles.conversationBar}>
            <div className={styles.conversationPicker} ref={conversationMenuRef}>
              <button
                type="button"
                className={styles.conversationTrigger}
                disabled={sending || switchingConversation}
                aria-haspopup="listbox"
                aria-expanded={conversationMenuOpen}
                onClick={() => setConversationMenuOpen((open) => !open)}
              >
                <span className={styles.conversationTriggerIcon} aria-hidden="true">
                  <Clock3 size={16} strokeWidth={2} />
                </span>
                <span className={styles.conversationTriggerCopy}>
                  <span className={styles.conversationLabel}>Previous chats</span>
                  <span className={styles.conversationCurrentTitle}>
                    {activeConversation?.title || "Current conversation"}
                  </span>
                </span>
                <ChevronDown
                  size={17}
                  strokeWidth={2}
                  aria-hidden="true"
                  className={conversationMenuOpen ? styles.chevronOpen : undefined}
                />
              </button>

              {conversationMenuOpen ? (
                <div
                  className={styles.conversationMenu}
                  role="listbox"
                  aria-label="Previous chats"
                >
                  <div className={styles.conversationMenuHeader}>Previous chats</div>
                  <div className={styles.conversationMenuList}>
                    {conversations.map((conversation) => {
                      const selected = conversation.id === sessionId;
                      return (
                        <button
                          type="button"
                          role="option"
                          aria-selected={selected}
                          key={conversation.id}
                          className={`${styles.conversationOption} ${
                            selected ? styles.conversationOptionActive : ""
                          }`}
                          onClick={() =>
                            changeConversation("load_conversation", conversation.id)
                          }
                        >
                          <span className={styles.conversationOptionIcon} aria-hidden="true">
                            <MessageSquare size={15} strokeWidth={2} />
                          </span>
                          <span className={styles.conversationOptionCopy}>
                            <span className={styles.conversationOptionTitle}>
                              {conversation.title || "Untitled conversation"}
                            </span>
                            <span className={styles.conversationOptionTime}>
                              {formatConversationTime(conversation.updatedAt)}
                            </span>
                          </span>
                          {selected ? (
                            <Check size={16} strokeWidth={2.25} aria-hidden="true" />
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className={styles.newConversationBtn}
              disabled={sending || switchingConversation}
              onClick={() => changeConversation("new_conversation")}
            >
              <Plus size={16} strokeWidth={2.25} aria-hidden="true" />
              <span>New</span>
            </button>
          </div>

          <div className={styles.messagesContainer}>
            {messages.length === 0 && (
              <div className={styles.emptyState}>
                <p className={styles.emptyStateText}>
                  Ask anything about your leads, pipeline, or activities
                </p>
                <div className={styles.suggestionsWrap}>
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      onClick={() => sendMessage(s)}
                      className={styles.suggestionChip}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, idx) => (
              <div
                key={`${msg.role}-${idx}`}
                className={`${styles.messageWrapper} ${
                  msg.role === "assistant"
                    ? styles.assistantMessageGroup
                    : styles.userMessageGroup
                }`}
              >
                {msg.role === "assistant" ? (
                  <div className={styles.assistantMessageHeader}>
                    <span className={styles.assistantMessageAvatar} aria-hidden="true">
                      D
                    </span>
                    <span className={styles.assistantMessageName}>DROIT buddy</span>
                  </div>
                ) : null}
                <div
                  className={
                    msg.role === "user"
                      ? styles.messageAlignEnd
                      : styles.messageAlignStart
                  }
                >
                  <div className={styles.userMessageStack}>
                    <div
                      className={
                        msg.role === "assistant"
                          ? styles.assistantBubble
                          : styles.userBubble
                      }
                    >
                      {msg.role === "assistant"
                        ? extensions?.assistantContentRenderer
                          ? extensions.assistantContentRenderer(msg.content)
                          : renderAssistantContent(msg.content)
                        : msg.content}
                    </div>
                    {msg.role === "assistant" && msg.leadImport ? (
                      <LeadImportPanel
                        card={msg.leadImport}
                        disabled={sending || switchingConversation}
                        onUpdate={(payload) => sendImportAction("lead_import_update", payload)}
                        onConfirm={() => sendImportAction("lead_import_confirm")}
                        onCancel={() => sendImportAction("lead_import_cancel")}
                      />
                    ) : null}
                    {msg.role === "user" && Array.isArray(msg.attachments) && msg.attachments.length > 0 ? (
                      <div className={styles.messageAttachmentList}>
                        {msg.attachments.map((attachment, attachmentIndex) => (
                          <div
                            key={`${attachment.fileName}-${attachment.fileSize}-${attachment.attachmentId || attachmentIndex}`}
                            className={styles.messageAttachmentCard}
                          >
                            <span className={styles.messageAttachmentIcon} aria-hidden="true">
                              {fileIconByType(attachment.fileType, attachment.fileName)}
                            </span>
                            <span className={styles.messageAttachmentName} title={attachment.fileName}>
                              {attachment.fileName}
                            </span>
                            <span className={styles.messageAttachmentSize}>
                              {formatFileSize(attachment.fileSize)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>

                {!!msg.toolCalls?.filter((tool) => tool.name !== "browser_search").length && (
                  <details className={styles.toolsWrap}>
                    <summary className={styles.toolsLabel}>
                      <span>
                        {msg.toolCalls.filter((tool) => tool.name !== "browser_search").length} tool
                        {msg.toolCalls.filter((tool) => tool.name !== "browser_search").length > 1 ? "s" : ""} used
                      </span>
                      <ChevronDown
                        size={14}
                        strokeWidth={2.25}
                        className={styles.toolsChevron}
                        aria-hidden="true"
                      />
                    </summary>
                    <div className={styles.toolsList}>
                      {msg.toolCalls
                        .filter((tool) => tool.name !== "browser_search")
                        .map((tc, i) => (
                        <div key={`${tc.name}-${i}`} className={styles.toolChip}>
                          <strong>{tc.name}</strong>
                          {tc.result_summary ? (
                            <div className={styles.toolSummary}>
                              {tc.result_summary}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            ))}

            {sending && (
              <div
                className={`${styles.assistantBubble} ${styles.assistantThinking}`}
              >
                Thinking…
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {confirmationRequired ? (
            <div className={styles.confirmationPanel} role="status">
              <div className={styles.confirmationText}>
                Review the proposed change above, then choose an action.
              </div>
              <div className={styles.confirmationActions}>
                <button
                  type="button"
                  className={styles.confirmButton}
                  disabled={sending || switchingConversation}
                  onClick={() => sendMessage("Confirm", "confirm_write")}
                >
                  Confirm
                </button>
                <button
                  type="button"
                  className={styles.rejectButton}
                  disabled={sending || switchingConversation}
                  onClick={() => sendMessage("Reject", "reject_write")}
                >
                  Reject
                </button>
              </div>
            </div>
          ) : null}

          <div className={styles.inputContainer}>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ATTACHMENT_ACCEPT}
              className={styles.hiddenFileInput}
              onChange={onAttachmentPick}
              disabled={sending || switchingConversation || confirmationRequired}
            />
            {pendingAttachments.length > 0 ? (
              <div className={styles.pendingAttachmentsWrap}>
                {pendingAttachments.map((attachment) => (
                  <div key={attachment.id} className={styles.pendingAttachmentChip}>
                    <span className={styles.pendingAttachmentIcon} aria-hidden="true">
                      {fileIconByType(attachment.fileType, attachment.fileName)}
                    </span>
                    <span className={styles.pendingAttachmentName} title={attachment.fileName}>
                      {attachment.fileName}
                    </span>
                    <span className={styles.pendingAttachmentSize}>
                      {formatFileSize(attachment.fileSize)}
                    </span>
                    <button
                      type="button"
                      className={styles.pendingAttachmentRemove}
                      onClick={() => removeAttachment(attachment.id)}
                      aria-label={`Remove ${attachment.fileName}`}
                      disabled={sending || switchingConversation}
                    >
                      <X size={13} strokeWidth={2.4} aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            {attachmentError ? <div className={styles.attachmentError}>{attachmentError}</div> : null}
            <button
              type="button"
              className={styles.attachButton}
              aria-label="Attach files"
              title="Attach PDF or Excel files"
              disabled={sending || switchingConversation || confirmationRequired}
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip size={17} strokeWidth={2.2} aria-hidden="true" />
            </button>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                confirmationRequired
                  ? "Use Confirm or Reject above"
                  : "Type a message…"
              }
              rows={1}
              className={styles.inputField}
              disabled={sending || switchingConversation || confirmationRequired}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
            />
            <button
              onClick={() => sendMessage()}
              disabled={
                sending ||
                switchingConversation ||
                confirmationRequired ||
                (!input.trim() && pendingAttachments.length === 0)
              }
              className={styles.sendButton}
              style={{ opacity: sending || (!input.trim() && pendingAttachments.length === 0) ? 0.5 : 1 }}
            >
              Send
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function LeadImportPanel({
  card,
  disabled,
  onUpdate,
  onConfirm,
  onCancel,
}: {
  card: LeadImportCard;
  disabled: boolean;
  onUpdate: (payload: Record<string, unknown>) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [titleValue, setTitleValue] = React.useState(card.defaults.contactTitle);
  const [locationValue, setLocationValue] = React.useState(card.defaults.companyLocation);

  if (card.result) {
    return (
      <div className={styles.importCard}>
        <div className={styles.importTitle}>Lead Import Completed</div>
        <div className={styles.importSummary}>
          ✓ {card.result.createdLeads} leads created<br />
          ✓ {card.result.createdContacts} contacts created<br />
          ⚠ {card.result.duplicatesSkipped} duplicate skipped<br />
          ⚠ {card.result.invalidSkipped} invalid skipped<br />
          ✕ {card.result.failed.length} failed
        </div>
        <div className={styles.importHint}>
          Apollo: ✓ {card.result.apolloEnriched} enriched, ⚠ {card.result.apolloFailed} could not be enriched.
          Scoring calculated for imported leads.
        </div>
      </div>
    );
  }

  return (
    <div className={styles.importCard}>
      <div className={styles.importTitle}>Lead Import</div>
      <div className={styles.importHint}>{card.fileName} · {card.recordCount} records</div>
      <div className={styles.importSummary}>
        ✓ {card.summary.valid} valid · ⚠ {card.summary.needsAttention} need attention · ✕ {card.summary.invalid} invalid
      </div>
      <div className={styles.importMapList}>
        {card.columns.map((column) => (
          <div key={column} className={styles.importMapRow}>
            <span className={styles.importCol}>{column}</span>
            <span>→</span>
            <select
              className={styles.importSelect}
              disabled={disabled}
              value={card.mapping[column] || ""}
              onChange={(event) =>
                onUpdate({ mapping: { ...card.mapping, [column]: event.target.value } })
              }
            >
              <option value="">Unmapped</option>
              {Object.entries(IMPORT_FIELD_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
      {card.unmapped.length ? (
        <div className={styles.importHint}>
          Unmapped: {card.unmapped.join(", ")}
          <button
            type="button"
            className={styles.importMiniBtn}
            disabled={disabled}
            onClick={() => onUpdate({ unmappedToNotes: card.unmapped })}
          >
            Map to Notes
          </button>
        </div>
      ) : null}
      {card.missingRequired.map((item) => (
        <div key={item.field} className={styles.importMissing}>
          Required field needs attention: {item.label}
          {item.field === "contactTitle" ? (
            <>
              {card.suggestions[0] ? (
                <div className={styles.importHint}>{card.suggestions[0].reason}</div>
              ) : null}
              <input
                className={styles.importInput}
                value={titleValue}
                placeholder="e.g. CEO"
                onChange={(event) => setTitleValue(event.target.value)}
              />
              <button
                type="button"
                className={styles.importMiniBtn}
                disabled={disabled || !titleValue.trim()}
                onClick={() => onUpdate({ defaults: { ...card.defaults, contactTitle: titleValue.trim() } })}
              >
                Apply to all records
              </button>
            </>
          ) : null}
          {item.field === "companyLocation" ? (
            <>
              <input
                className={styles.importInput}
                value={locationValue}
                placeholder="Company location"
                onChange={(event) => setLocationValue(event.target.value)}
              />
              <button
                type="button"
                className={styles.importMiniBtn}
                disabled={disabled || !locationValue.trim()}
                onClick={() => onUpdate({ defaults: { ...card.defaults, companyLocation: locationValue.trim() } })}
              >
                Apply to all records
              </button>
            </>
          ) : null}
          {item.field === "contactRole" ? (
            <select
              className={styles.importSelect}
              disabled={disabled}
              value={card.defaults.contactRole}
              onChange={(event) => onUpdate({ defaults: { ...card.defaults, contactRole: event.target.value } })}
            >
              {card.lookups.contactRoles.map((role) => (
                <option key={role} value={role}>{role}</option>
              ))}
            </select>
          ) : null}
        </div>
      ))}
      <div className={styles.importPreview}>
        <div className={styles.importHint}>
          Showing all {card.previewRows.length} of {card.recordCount} companies
        </div>
        {card.previewRows.map((row) => (
          <div key={row.rowNumber} className={styles.importPreviewRow}>
            <strong>{row.companyName || "(no company)"}</strong> · {row.contactName || "—"} · {row.contactTitle || "—"} · {row.status}
            {row.reasons.length ? <div>{row.reasons.join(", ")}</div> : null}
          </div>
        ))}
      </div>
      <div className={styles.importActions}>
        <button type="button" className={styles.importCancel} disabled={disabled} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className={styles.importConfirm}
          disabled={disabled || !card.canConfirm}
          onClick={onConfirm}
        >
          Create {card.summary.createCount} Leads
        </button>
      </div>
    </div>
  );
}
