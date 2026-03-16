// components/CRMChatBot.tsx
// Global AI assistant — Phase 2: adds convert, activity, reminder action cards

"use client";
import React, { useState, useRef, useEffect } from "react";

type Message = {
  role: "user" | "assistant";
  content: string;
  action?: any;
};

type Props = {
  onAction?: (action: any) => void;
};

export default function CRMChatBot({ onAction }: Props) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "Hi! 👋 I'm your CRM assistant. I can search leads, create or update them, convert leads to prospects/accounts, log activities, set reminders, and more. What would you like to do?",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMsg = input.trim();
    setInput("");

    const updatedMessages: Message[] = [
      ...messages,
      { role: "user", content: userMsg },
    ];
    setMessages(updatedMessages);
    setLoading(true);

    try {
      const historyForApi = updatedMessages
        .slice(1)
        .map((m) => ({ role: m.role, content: m.content }));

      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userMessage: userMsg,
          chatHistory: historyForApi,
        }),
      });

      const data = await res.json();
      console.log("Agent response:", data);

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.message || "I processed your request.",
          action: data.action || null,
        },
      ]);

      if (data.action && onAction) {
        onAction(data.action);
      }
    } catch (err: any) {
      console.error("Chat error:", err);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `⚠️ Connection error: ${err.message}. Is the server running?`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // ─── Action card renderer ───
  const renderAction = (action: any) => {
    if (!action) return null;

    switch (action.type) {
      case "lead_created":
        return renderActionCard("✅", "Lead Created", `Lead #${action.leadId}`, "#f0fdf4", "#86efac", "#166534", "#4ade80");

      case "lead_updated":
        return renderActionCard("📝", "Lead Updated", `Lead #${action.leadId}`, "#eff6ff", "#93c5fd", "#1e40af", "#60a5fa");

      case "lead_deleted":
        return renderActionCard("🗑️", "Lead Deleted", `Lead #${action.leadId}`, "#fef2f2", "#fca5a5", "#991b1b", "#f87171");

      case "lead_converted":
        return renderActionCard(
          "🔄",
          "Lead Converted",
          `Lead #${action.leadId}: ${action.from} → ${action.to}`,
          "#f5f3ff", "#c4b5fd", "#5b21b6", "#8b5cf6"
        );

      case "activity_added":
        return renderActionCard(
          "📋",
          "Activity Logged",
          `Lead #${action.leadId}`,
          "#ecfdf5", "#6ee7b7", "#065f46", "#34d399"
        );

      case "reminder_created":
        return renderActionCard(
          "⏰",
          "Reminder Set",
          `Lead #${action.leadId} · Reminder #${action.reminderId}`,
          "#fffbeb", "#fcd34d", "#92400e", "#f59e0b"
        );

      case "search_results":
        if (!action.leads?.length) return null;
        return (
          <div style={{ marginTop: 8, marginLeft: 36 }}>
            {action.leads.slice(0, 5).map((lead: any) => (
              <div key={lead.LeadId} style={searchResultCard}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 600, fontSize: 12, color: "#1f2937" }}>
                    {lead.CompanyName}
                  </span>
                  <span style={badge(
                    lead.AccountType === "Prospect" ? "#f59e0b"
                    : lead.AccountType === "Account" ? "#10b981"
                    : "#3b82f6"
                  )}>
                    {lead.AccountType || "Lead"}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
                  #{lead.LeadId} · {lead.OwnerName || "No owner"} · {lead.StatusName || "New"}
                </div>
                {lead.Contacts?.[0] && (
                  <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 1 }}>
                    {lead.Contacts[0].ContactName} — {lead.Contacts[0].ContactEmail}
                  </div>
                )}
              </div>
            ))}
          </div>
        );

      case "confirmation_needed":
        return renderActionCard("⚠️", "Confirmation Required", "Type 'yes' to proceed", "#fffbeb", "#fcd34d", "#92400e", "#f59e0b");

      default:
        return null;
    }
  };

  // ─── Reusable action card ───
  function renderActionCard(
    icon: string, title: string, subtitle: string,
    bg: string, borderColor: string, titleColor: string, subtitleColor: string
  ) {
    return (
      <div style={{
        marginTop: 8, marginLeft: 36,
        background: bg, border: `1px solid ${borderColor}`,
        borderRadius: 8, padding: "8px 12px",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span style={{ fontSize: 16 }}>{icon}</span>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: titleColor }}>{title}</div>
          <div style={{ fontSize: 11, color: subtitleColor }}>{subtitle}</div>
        </div>
      </div>
    );
  }

  return (
    <div style={panelContainer}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 18 }}>🤖</span>
          <span style={{ fontWeight: 600, fontSize: 14 }}>CRM Assistant</span>
        </div>
        <span style={{
          fontSize: 10, color: "rgba(255,255,255,0.7)",
          background: "rgba(255,255,255,0.15)",
          padding: "2px 8px", borderRadius: 10,
        }}>
          AI Agent v2
        </span>
      </div>

      {/* Messages */}
      <div style={messagesContainer}>
        {messages.map((msg, i) => (
          <div key={i} style={{ marginBottom: 14 }}>
            <div style={{
              display: "flex",
              justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
              alignItems: "flex-start",
            }}>
              {msg.role === "assistant" && <div style={avatarBot}>AI</div>}
              <div style={msg.role === "user" ? userBubble : botBubble}>
                {msg.content.split("\n").map((line, li) => (
                  <React.Fragment key={li}>
                    {line}
                    {li < msg.content.split("\n").length - 1 && <br />}
                  </React.Fragment>
                ))}
              </div>
              {msg.role === "user" && <div style={avatarUser}>You</div>}
            </div>
            {msg.action && renderAction(msg.action)}
          </div>
        ))}

        {loading && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <div style={avatarBot}>AI</div>
            <div style={{ ...botBubble, color: "#9ca3af", display: "flex", gap: 4 }}>
              <span>Thinking</span><span>...</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Quick Actions */}
      <div style={suggestionsBar}>
        {[
          "Search a lead",
          "Log an activity",
          "Set a reminder",
          "Convert a lead",
        ].map((text) => (
          <button
            key={text}
            onClick={() => setInput(text)}
            style={suggestionChip}
          >
            {text}
          </button>
        ))}
      </div>

      {/* Input */}
      <div style={inputContainer}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask me anything about your CRM..."
          style={inputField}
          disabled={loading}
        />
        <button
          onClick={sendMessage}
          disabled={loading || !input.trim()}
          style={{ ...sendButton, opacity: loading || !input.trim() ? 0.5 : 1 }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/* ─── STYLES ─── */

const panelContainer: React.CSSProperties = {
  display: "flex", flexDirection: "column", height: "100%",
  background: "#ffffff", overflow: "hidden",
};

const headerStyle: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center",
  padding: "14px 16px",
  background: "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)",
  color: "#fff",
};

const messagesContainer: React.CSSProperties = {
  flex: 1, overflowY: "auto", padding: 16, background: "#f8f9fb",
};

const avatarBot: React.CSSProperties = {
  width: 28, height: 28, borderRadius: "50%", background: "#2563eb",
  color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
  fontSize: 10, fontWeight: 700, flexShrink: 0, marginRight: 8, marginTop: 2,
};

const avatarUser: React.CSSProperties = {
  width: 28, height: 28, borderRadius: "50%", background: "#f56c00",
  color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
  fontSize: 9, fontWeight: 700, flexShrink: 0, marginLeft: 8, marginTop: 2,
};

const botBubble: React.CSSProperties = {
  background: "#ffffff", color: "#374151", padding: "10px 14px",
  borderRadius: "2px 12px 12px 12px", maxWidth: "82%", fontSize: 13,
  lineHeight: 1.55, boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
  border: "1px solid #e5e7eb",
};

const userBubble: React.CSSProperties = {
  background: "#f56c00", color: "#ffffff", padding: "10px 14px",
  borderRadius: "12px 2px 12px 12px", maxWidth: "82%", fontSize: 13,
  lineHeight: 1.55,
};

const suggestionsBar: React.CSSProperties = {
  display: "flex", gap: 6, padding: "8px 16px",
  borderTop: "1px solid #f0f0f0", background: "#fafbfc", flexWrap: "wrap",
};

const suggestionChip: React.CSSProperties = {
  background: "#eef2ff", border: "1px solid #c7d2fe", borderRadius: 20,
  padding: "4px 12px", fontSize: 11, color: "#4338ca", cursor: "pointer", fontWeight: 500,
};

const inputContainer: React.CSSProperties = {
  display: "flex", gap: 8, padding: "12px 16px",
  borderTop: "1px solid #e5e7eb", background: "#ffffff",
};

const inputField: React.CSSProperties = {
  flex: 1, padding: "10px 14px", borderRadius: 8,
  border: "1px solid #d1d5db", fontSize: 13, outline: "none", fontFamily: "inherit",
};

const sendButton: React.CSSProperties = {
  background: "#2563eb", color: "#fff", border: "none", borderRadius: 8,
  width: 40, height: 40, display: "flex", alignItems: "center",
  justifyContent: "center", cursor: "pointer", flexShrink: 0,
};

const searchResultCard: React.CSSProperties = {
  background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8,
  padding: "8px 12px", marginBottom: 6, fontSize: 12,
};

function badge(color: string): React.CSSProperties {
  return {
    fontSize: 10, fontWeight: 600, color: "#fff", background: color,
    padding: "1px 6px", borderRadius: 10,
  };
}