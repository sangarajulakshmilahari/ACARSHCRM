"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Clock3,
  MessageSquare,
  Plus,
  X,
} from "lucide-react";
import styles from "../components/crmchatbot.module.css";

type Props = {
  onAction?: (action: any) => void;
  ownerName?: string;
  contextLeadId?: number | string | null;
  onClose?: () => void;
  extensions?: ChatbotExtensions;
};

type ChatbotExtensions = {
  roleSuggestions?: Record<string, string[]>;
  transformOutgoingMessage?: (text: string) => string;
  assistantContentRenderer?: (content: string) => React.ReactNode;
  mapToolCallToAction?: (toolName: string) => string | null;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  toolCalls?: Array<{ name: string; result_summary?: string }>;
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

function renderInlineText(value: string) {
  return value.split(/(\*\*[^*]+\*\*)/g).map((chunk, idx) => {
    if (chunk.startsWith("**") && chunk.endsWith("**") && chunk.length > 4) {
      return <strong key={`b-${idx}`}>{chunk.slice(2, -2)}</strong>;
    }
    return <React.Fragment key={`t-${idx}`}>{chunk}</React.Fragment>;
  });
}

function renderTextWithLineBreaks(value: string) {
  const lines = value.split("\n");
  return lines.map((line, idx) => (
    <React.Fragment key={`line-${idx}`}>
      {renderInlineText(line)}
      {idx < lines.length - 1 ? <br /> : null}
    </React.Fragment>
  ));
}

function renderAssistantContent(content: string) {
  const lines = content.split("\n");
  const parts: React.ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const current = lines[index] || "";

    if (current.trim().startsWith("|")) {
      const tableLines: string[] = [];
      while (index < lines.length && (lines[index] || "").trim().startsWith("|")) {
        tableLines.push(lines[index]);
        index += 1;
      }

      if (tableLines.length >= 2 && isSeparatorRow(tableLines[1])) {
        const headers = parsePipeRow(tableLines[0]);
        const bodyRows = tableLines.slice(2).map(parsePipeRow);

        parts.push(
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
                      <td
                        key={`c-${rIdx}-${cIdx}`}
                        data-label={headers[cIdx] || "Value"}
                      >
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
        parts.push(
          <div className={styles.assistantTableWrap} key={`pre-${index}`}>
            <pre className={styles.assistantTablePre}>{tableLines.join("\n")}</pre>
          </div>,
        );
      }
      continue;
    }

    const textLines: string[] = [];
    while (index < lines.length && !(lines[index] || "").trim().startsWith("|")) {
      textLines.push(lines[index]);
      index += 1;
    }

    const text = textLines.join("\n").trim();
    if (text) {
      parts.push(
        <div className={styles.assistantTextBlock} key={`txt-${index}`}>
          {renderTextWithLineBreaks(text)}
        </div>,
      );
    }
  }

  return parts;
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

  const bottomRef = useRef<HTMLDivElement>(null);
  const conversationMenuRef = useRef<HTMLDivElement>(null);

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
        role: message.role,
        content: String(message.content || ""),
        toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls : [],
      }));
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
    if (!text || sending || !sessionId) return;

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setSending(true);

    try {
      const res = await fetch("/api/ai/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: requestType,
          sessionId,
          ...(requestType === "chat" ? { message: text } : {}),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
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
        },
      ]);

      if (onAction && toolCalls.length > 0) {
        const toolName = String(toolCalls[0]?.name || "");
        const mappedType = extensions?.mapToolCallToAction
          ? extensions.mapToolCallToAction(toolName)
          : mapToolNameToActionType(toolName);
        if (mappedType) onAction({ type: mappedType });
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Network error — is the server running?",
          toolCalls: [],
        },
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
                  aria-label="Close DROIT buddy"
                  title="Close"
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
                aria-label="Close DROIT buddy"
                title="Close"
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
                </div>

                {!!msg.toolCalls?.length && (
                  <details className={styles.toolsWrap}>
                    <summary className={styles.toolsLabel}>
                      <span>
                        {msg.toolCalls.length} tool
                        {msg.toolCalls.length > 1 ? "s" : ""} used
                      </span>
                      <ChevronDown
                        size={14}
                        strokeWidth={2.25}
                        className={styles.toolsChevron}
                        aria-hidden="true"
                      />
                    </summary>
                    <div className={styles.toolsList}>
                      {msg.toolCalls.map((tc, i) => (
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
                !input.trim()
              }
              className={styles.sendButton}
              style={{ opacity: sending || !input.trim() ? 0.5 : 1 }}
            >
              Send
            </button>
          </div>
        </>
      )}
    </div>
  );
}
