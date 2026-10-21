"use client";

import React, { useEffect, useState } from "react";

type GraphStatus = {
  connected: boolean;
  mailbox: string | null;
  displayName: string | null;
  needsReconnect?: boolean;
  error?: string | null;
};

type Props = {
  tab: "emailTemplates" | "emailSequences" | "emailHistory";
};

const GRAPH_ERROR_MESSAGES: Record<string, string> = {
  missing_code: "Microsoft did not return an authorization code.",
  invalid_state: "The Microsoft connection request expired or was invalid. Try connecting again.",
  access_denied: "Microsoft connection was cancelled or denied.",
  invalid_request: "Microsoft rejected the connection request.",
  oauth_error: "Microsoft connection failed.",
  GRAPH_CODE_EXCHANGE_FAILED: "Unable to complete Microsoft authorization.",
  GRAPH_TOKENS_MISSING: "Microsoft did not return a complete authorization.",
  GRAPH_TOKEN_REFRESH_FAILED: "Microsoft authorization expired. Reconnect your mailbox.",
  GRAPH_TOKEN_INVALID: "Microsoft authorization expired. Reconnect your mailbox.",
  AZURE_CONFIG_MISSING: "Microsoft Graph is not configured on the server.",
  unexpected: "Microsoft connection failed unexpectedly.",
};

function readQueryNotice(): { error: string | null; success: string | null } {
  if (typeof window === "undefined") return { error: null, success: null };
  const params = new URLSearchParams(window.location.search);
  const graphError = String(params.get("graphError") || "").trim();
  const connected = params.get("graphConnected") === "1";
  const warning = String(params.get("graphWarning") || "").trim();
  return {
    error: graphError ? GRAPH_ERROR_MESSAGES[graphError] || "Microsoft connection failed." : null,
    success: connected
      ? warning === "mailbox_identity_missing"
        ? "Microsoft 365 connected. Mailbox address was not available."
        : "Microsoft 365 mailbox connected."
      : null,
  };
}

export default function MicrosoftMailboxStatus({ tab }: Props): JSX.Element {
  const [status, setStatus] = useState<GraphStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function loadStatus() {
    setLoading(true);
    try {
      const res = await fetch("/api/email/graph-status", { credentials: "include" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || "Failed to read Microsoft connection status");
      }
      setStatus({
        connected: Boolean(data?.connected),
        mailbox: data?.mailbox ? String(data.mailbox) : null,
        displayName: data?.displayName ? String(data.displayName) : null,
        needsReconnect: Boolean(data?.needsReconnect),
        error: data?.error ? String(data.error) : null,
      });
      if (data?.error && !data?.connected) {
        setError(String(data.error));
      }
    } catch (err: any) {
      setError(err?.message || "Failed to read Microsoft connection status");
      setStatus({ connected: false, mailbox: null, displayName: null });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const notice = readQueryNotice();
    if (notice.error) setError(notice.error);
    if (notice.success) setSuccess(notice.success);
    void loadStatus();
  }, []);

  function connect() {
    window.location.assign(`/api/auth/login/azure-ad?tab=${encodeURIComponent(tab)}`);
  }

  async function disconnect() {
    setActing(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/email/graph-status", {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || "Failed to disconnect Microsoft account");
      }
      setStatus({ connected: false, mailbox: null, displayName: null, needsReconnect: false });
      setSuccess("Microsoft 365 mailbox disconnected.");
    } catch (err: any) {
      setError(err?.message || "Failed to disconnect Microsoft account");
    } finally {
      setActing(false);
    }
  }

  const connected = Boolean(status?.connected);
  const needsReconnect = Boolean(status?.needsReconnect) || (!connected && Boolean(status?.error));

  return (
    <div
      style={{
        border: "1px solid #e2e8f0",
        borderRadius: 10,
        padding: 12,
        background: "#f8fbff",
        display: "grid",
        gap: 8,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, color: "#1F3A68" }}>Microsoft 365 mailbox</div>
      {loading ? (
        <div style={{ fontSize: 12, color: "#64748b" }}>Checking connection...</div>
      ) : connected ? (
        <div style={{ fontSize: 12, color: "#166534" }}>
          Connected{status?.mailbox ? `: ${status.mailbox}` : ", mailbox address unavailable"}
          {status?.displayName ? ` (${status.displayName})` : ""}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: "#64748b" }}>
          Not connected. Connect a mailbox to send one-off emails as yourself. Sequence mail still uses the shared application mailbox.
        </div>
      )}
      {error ? <div style={{ fontSize: 12, color: "#991b1b" }}>{error}</div> : null}
      {success ? <div style={{ fontSize: 12, color: "#166534" }}>{success}</div> : null}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {!connected ? (
          <button
            type="button"
            onClick={connect}
            disabled={acting}
            style={buttonStyle(true)}
          >
            {needsReconnect ? "Reconnect Microsoft 365" : "Connect Microsoft 365"}
          </button>
        ) : (
          <>
            <button type="button" onClick={connect} disabled={acting} style={buttonStyle(false)}>
              Reconnect
            </button>
            <button type="button" onClick={disconnect} disabled={acting} style={buttonStyle(false)}>
              {acting ? "Working..." : "Disconnect"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function buttonStyle(primary: boolean): React.CSSProperties {
  return {
    border: primary ? "1px solid #F26522" : "1px solid #1F3A68",
    background: primary ? "#F26522" : "#fff",
    color: primary ? "#fff" : "#1F3A68",
    borderRadius: 8,
    padding: "7px 10px",
    fontWeight: 700,
    fontSize: 12,
    cursor: "pointer",
  };
}
