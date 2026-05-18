"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
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

const SUGGESTIONS_BY_ROLE: Record<string, string[]> = {
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
    "Show all accounts",
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
                      <td key={`c-${rIdx}-${cIdx}`}>{renderInlineText(cell)}</td>
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
  if (key.includes("create")) return "lead_created";
  if (key.includes("update") || key.includes("edit")) return "lead_updated";
  if (key.includes("delete") || key.includes("remove")) return "lead_deleted";
  if (key.includes("convert")) return "lead_converted";
  return null;
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
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);

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

      setSessionId(data.session_id || "");
      setUserName(data?.user?.name || ownerName || "CRM User");
      setRole((data?.user?.role || "agent").toLowerCase());
      setMessages([]);
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

  async function sendMessage(forcedText?: string) {
    const rawText = (forcedText || input).trim();
    const text = extensions?.transformOutgoingMessage
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
          type: "chat",
          sessionId,
          message: text,
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

  function logout() {
    window.location.href = "/api/auth/logout";
  }

  return (
    <div className={styles.panelContainer}>
      {!sessionId ? (
        <div className={styles.loginWrapper}>
          <div className={styles.loginCard}>
            <div className={styles.loginHeader}>
              <h1 className={styles.loginTitle}>ACARSH</h1>
              <button
                onClick={onClose}
                className={styles.closeBtn}
                aria-label="Close chatbot"
                title="Close chatbot"
              >
                ✕
              </button>
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
            <div>
              <div className={styles.chatTitle}>ACARSH Chat</div>
              <div className={styles.chatSubtitle}>
                {userName} · {role}
              </div>
            </div>
            <div className={styles.headerButtonGroup}>
              <button onClick={logout} className={styles.headSmallBtn}>
                Sign out
              </button>
              <button onClick={onClose} className={styles.headSmallBtn}>
                Close
              </button>
            </div>
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
              <div key={`${msg.role}-${idx}`} className={styles.messageWrapper}>
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
                  <div className={styles.toolsWrap}>
                    <div className={styles.toolsLabel}>
                      {msg.toolCalls.length} tool
                      {msg.toolCalls.length > 1 ? "s" : ""} used
                    </div>
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

          <div className={styles.inputContainer}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a message…"
              rows={1}
              className={styles.inputField}
              disabled={sending}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
            />
            <button
              onClick={() => sendMessage()}
              disabled={sending || !input.trim()}
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
