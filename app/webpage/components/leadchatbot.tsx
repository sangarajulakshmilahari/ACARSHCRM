"use client";
import React, { useState, useRef, useEffect } from "react";

type Message = {
  role: "user" | "assistant";
  content: string;
  filledFields?: string[];
  showConfirmButton?: boolean; // show "Create Lead" button on this message
};

type Props = {
  currentForm: Record<string, any>;
  onFieldsExtracted: (fields: Record<string, any>) => void;
  companies: string[];
  roles: string[];
  owners: string[];
  sources: string[];
  onConfirmCreate: () => void;
};

export default function LeadChatBot({
  currentForm,
  onFieldsExtracted,
  companies,
  roles,
  owners,
  sources,
  onConfirmCreate,
}: Props) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        'Hi! 👋 Need help with the system?',
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const getMissingRequired = () => {
    const required = [
      "CompanyName",
      "ContactName",
      "ContactEmail",
      "ContactRoleName",
      "OwnerName",
    ];
    return required.filter((f) => !currentForm[f]);
  };

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMsg = input.trim();
    setInput("");

    // Check if user is confirming lead creation
    const confirmWords = ["yes", "confirm", "create", "go ahead", "submit"];
    if (confirmWords.some((w) => userMsg.toLowerCase().includes(w))) {
      const missing = getMissingRequired();
      if (missing.length === 0) {
        setMessages((prev) => [
          ...prev,
          { role: "user", content: userMsg },
          { role: "assistant", content: "✅ Creating the lead now..." },
        ]);
        onConfirmCreate();
        return;
      }
    }

    const updatedMessages: Message[] = [
      ...messages,
      { role: "user", content: userMsg },
    ];
    setMessages(updatedMessages);
    setLoading(true);

    try {
      // Prepare chat history — only send user/assistant pairs
      const historyForApi = updatedMessages
        .slice(1)
        .map((m) => ({ role: m.role, content: m.content }));

      const requestBody = {
        userMessage: userMsg,
        chatHistory: historyForApi,
        currentForm,
        companies,
        roles,
        owners,
        sources,
      };

      console.log("=== SENDING TO CHAT API ===");
      console.log("Companies:", companies);
      console.log("Roles:", roles);
      console.log("Owners:", owners);
      console.log("Sources:", sources);
      console.log("Request body:", JSON.stringify(requestBody).substring(0, 500));

      const res = await fetch("/api/employees/leads/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const data = await res.json();

      console.log("=== RESPONSE FROM CHAT API ===");
      console.log("Full response:", JSON.stringify(data));

      // Apply extracted fields to the form
      const filledFieldNames: string[] = [];
      if (
        data.extractedFields &&
        typeof data.extractedFields === "object" &&
        Object.keys(data.extractedFields).length > 0
      ) {
        console.log("Applying fields to form:", data.extractedFields);
        onFieldsExtracted(data.extractedFields);
        filledFieldNames.push(...Object.keys(data.extractedFields));
      } else {
        console.warn("No fields extracted! Response was:", data);
      }

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.message || "I processed your message but couldn't extract any fields.",
          filledFields: filledFieldNames,
          // Show confirm button when no required fields are missing
          showConfirmButton:
            Array.isArray(data.missingRequired) && data.missingRequired.length === 0,
        },
      ]);
    } catch (err: any) {
      console.error("Chat fetch error:", err);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `⚠️ Network error: ${err.message}. Is your server running?`,
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

  const fieldLabel = (key: string) => {
    const map: Record<string, string> = {
      CompanyName: "Company",
      CompanyLocation: "Location",
      ContactName: "Name",
      ContactTitle: "Title",
      ContactEmail: "Email",
      ContactPhone: "Phone",
      ContactRoleName: "Role",
      ContactLocation: "Contact Location",
      ExpansionAreas: "Interests",
      Tags: "Tags",
      Notes: "Notes",
      OwnerName: "Owner",
      LeadSource: "Source",
    };
    return map[key] || key;
  };

  return (
    <div style={panelContainer}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 18 }}>🤖</span>
          <span style={{ fontWeight: 600, fontSize: 14 }}>
            AI Lead Assistant
          </span>
        </div>
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.7)" }}>
          Grok
        </span>
      </div>

      {/* Messages area */}
      <div style={messagesContainer}>
        {messages.map((msg, i) => (
          <div key={i} style={{ marginBottom: 14 }}>
            <div
              style={{
                display: "flex",
                justifyContent:
                  msg.role === "user" ? "flex-end" : "flex-start",
                alignItems: "flex-start",
              }}
            >
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

           

            {/* Show Create Lead button when all required fields are filled */}
            {msg.showConfirmButton && (
              <div style={{ marginTop: 10, marginLeft: 36 }}>
                <div
                  style={{
                    background: "#f0fdf4",
                    border: "1px solid #86efac",
                    borderRadius: 10,
                    padding: "12px 16px",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <span style={{ fontSize: 18 }}>✅</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#166534" }}>
                      All required fields are filled!
                    </div>
                    <div style={{ fontSize: 12, color: "#4ade80", marginTop: 2 }}>
                      Ready to create the lead
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setMessages((prev) => [
                        ...prev,
                        { role: "assistant", content: "✅ Creating the lead now..." },
                      ]);
                      onConfirmCreate();
                    }}
                    style={{
                      background: "#16a34a",
                      color: "#fff",
                      border: "none",
                      borderRadius: 8,
                      padding: "8px 20px",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Create Lead
                  </button>
                  <button
                    onClick={() => {
                      setMessages((prev) => [
                        ...prev,
                        {
                          role: "assistant",
                          content:
                            "No problem! You can continue editing the form or tell me any changes.",
                        },
                      ]);
                    }}
                    style={{
                      background: "transparent",
                      color: "#6b7280",
                      border: "1px solid #d1d5db",
                      borderRadius: 8,
                      padding: "8px 14px",
                      fontSize: 13,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Edit More
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 10,
            }}
          >
            <div style={avatarBot}>AI</div>
            <div
              style={{
                ...botBubble,
                color: "#9ca3af",
                display: "flex",
                gap: 4,
                alignItems: "center",
              }}
            >
              <span>Analyzing</span>
              <span>...</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      

      {/* Input area */}
      <div style={inputContainer}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe the lead..."
          style={inputField}
          disabled={loading}
        />
        <button
          onClick={sendMessage}
          disabled={loading || !input.trim()}
          style={{
            ...sendButton,
            opacity: loading || !input.trim() ? 0.5 : 1,
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
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
  display: "flex",
  flexDirection: "column",
  height: "100%",
  background: "#ffffff",
  overflow: "hidden",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "14px 16px",
  background: "#3a77e3",
  color: "#fff",
};

const messagesContainer: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: 16,
  background: "#f8f9fb",
};

const avatarBot: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: "50%",
  background: "#3a77e3",
  color: "#fff",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 10,
  fontWeight: 700,
  flexShrink: 0,
  marginRight: 8,
  marginTop: 2,
};

const avatarUser: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: "50%",
  background: "#f56c00",
  color: "#fff",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 9,
  fontWeight: 700,
  flexShrink: 0,
  marginLeft: 8,
  marginTop: 2,
};

const botBubble: React.CSSProperties = {
  background: "#ffffff",
  color: "#374151",
  padding: "10px 14px",
  borderRadius: "2px 12px 12px 12px",
  maxWidth: "82%",
  fontSize: 13,
  lineHeight: 1.55,
  boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
  border: "1px solid #e5e7eb",
};

const userBubble: React.CSSProperties = {
  background: "#f56c00",
  color: "#ffffff",
  padding: "10px 14px",
  borderRadius: "12px 2px 12px 12px",
  maxWidth: "82%",
  fontSize: 13,
  lineHeight: 1.55,
};

const fieldBadge: React.CSSProperties = {
  background: "#dcfce7",
  color: "#166534",
  fontSize: 11,
  fontWeight: 600,
  padding: "2px 8px",
  borderRadius: 12,
  border: "1px solid #bbf7d0",
};

const suggestionsBar: React.CSSProperties = {
  display: "flex",
  gap: 6,
  padding: "8px 16px",
  borderTop: "1px solid #f0f0f0",
  background: "#fafbfc",
  flexWrap: "wrap",
};

const suggestionChip: React.CSSProperties = {
  background: "#eef2ff",
  border: "1px solid #c7d2fe",
  borderRadius: 20,
  padding: "4px 12px",
  fontSize: 11,
  color: "#4338ca",
  cursor: "pointer",
  fontWeight: 500,
};

const inputContainer: React.CSSProperties = {
  display: "flex",
  gap: 8,
  padding: "12px 16px",
  borderTop: "1px solid #e5e7eb",
  background: "#ffffff",
};

const inputField: React.CSSProperties = {
  flex: 1,
  padding: "10px 14px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  fontSize: 13,
  outline: "none",
  fontFamily: "inherit",
};

const sendButton: React.CSSProperties = {
  background: "#3a77e3",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  width: 40,
  height: 40,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  flexShrink: 0,
};