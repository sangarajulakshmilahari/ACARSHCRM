"use client";

import { useEffect, useState } from "react";

export default function UnsubscribeClient(): JSX.Element {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const nextToken = String(params.get("token") || "").trim();
    setToken(nextToken);
    if (nextToken) {
      window.history.replaceState({}, "", "/unsubscribe");
    }
  }, []);

  async function confirmUnsubscribe() {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/email/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, confirm: true }),
        referrerPolicy: "no-referrer",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || "This unsubscribe request could not be completed.");
        return;
      }
      setDone(true);
      setToken("");
    } catch {
      setError("This unsubscribe request could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#F8F4EF",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: 480,
          background: "#fff",
          border: "1px solid rgba(31, 58, 104, 0.14)",
          borderRadius: 14,
          boxShadow: "0 10px 24px rgba(15, 31, 61, 0.08)",
          padding: 28,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 22, color: "#1F3A68" }}>Email unsubscribe</h1>
        {done ? (
          <p style={{ marginTop: 14, color: "#334155", fontSize: 14, lineHeight: 1.6 }}>
            You will no longer receive these emails.
          </p>
        ) : (
          <>
            <p style={{ marginTop: 14, color: "#334155", fontSize: 14, lineHeight: 1.6 }}>
              Confirm below to stop future sequence and outreach emails from ACARSH. Opening this
              page does not change your subscription.
            </p>
            {error ? (
              <div
                style={{
                  marginTop: 12,
                  border: "1px solid #fecaca",
                  background: "#fef2f2",
                  color: "#991b1b",
                  borderRadius: 8,
                  padding: "9px 10px",
                  fontSize: 13,
                }}
              >
                {error}
              </div>
            ) : null}
            <button
              type="button"
              onClick={confirmUnsubscribe}
              disabled={busy || !token}
              style={{
                marginTop: 18,
                border: 0,
                borderRadius: 8,
                background: busy || !token ? "#94a3b8" : "#1F3A68",
                color: "#fff",
                padding: "10px 14px",
                fontSize: 14,
                cursor: busy || !token ? "not-allowed" : "pointer",
              }}
            >
              {busy ? "Working…" : "Confirm unsubscribe"}
            </button>
            {!token ? (
              <p style={{ marginTop: 12, color: "#64748b", fontSize: 12 }}>
                This unsubscribe link is missing or no longer valid.
              </p>
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}
