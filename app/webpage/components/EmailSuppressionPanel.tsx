"use client";

import React, { useEffect, useState } from "react";
import { formatLocaleDateTime } from "@/app/utils/dateTime";

type SuppressionItem = {
  suppressionId: number;
  normalizedEmail: string;
  reason: string;
  source: string;
  createdAt: string | null;
};

export default function EmailSuppressionPanel(): JSX.Element | null {
  const [allowed, setAllowed] = useState(false);
  const [items, setItems] = useState<SuppressionItem[]>([]);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/email/suppressions", { credentials: "include" });
      if (res.status === 401 || res.status === 403) {
        setAllowed(false);
        setItems([]);
        return;
      }
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || "Failed to load suppressions");
      }
      setAllowed(true);
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch (err: any) {
      setAllowed(false);
      setError(err?.message || "Failed to load suppressions");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function addSuppression() {
    if (acting) return;
    setActing(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/email/suppressions", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || "Failed to add suppression");
      }
      setEmail("");
      setSuccess(data?.message || "Address suppressed.");
      await load();
    } catch (err: any) {
      setError(err?.message || "Failed to add suppression");
    } finally {
      setActing(false);
    }
  }

  async function removeSuppression(suppressionId: number) {
    if (acting) return;
    const confirmed = window.confirm(
      "Remove this suppression? Existing paused enrollments stay paused until re-enrolled."
    );
    if (!confirmed) return;
    setActing(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/email/suppressions", {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suppressionId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || "Failed to remove suppression");
      }
      setSuccess(data?.message || "Suppression removed.");
      await load();
    } catch (err: any) {
      setError(err?.message || "Failed to remove suppression");
    } finally {
      setActing(false);
    }
  }

  if (!allowed && !loading && !error) return null;

  return (
    <div
      style={{
        marginTop: 14,
        border: "1px solid rgba(31, 58, 104, 0.14)",
        borderRadius: 10,
        padding: 12,
        background: "#f8fafc",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: "#1F3A68" }}>
        Email suppressions
      </div>
      <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
        Unsubscribed and manually suppressed addresses are blocked at send time.
      </div>

      {error ? (
        <div
          style={{
            marginTop: 8,
            border: "1px solid #fecaca",
            background: "#fef2f2",
            color: "#991b1b",
            borderRadius: 8,
            padding: "8px 10px",
            fontSize: 12,
          }}
        >
          {error}
        </div>
      ) : null}
      {success ? (
        <div
          style={{
            marginTop: 8,
            border: "1px solid #bbf7d0",
            background: "#f0fdf4",
            color: "#166534",
            borderRadius: 8,
            padding: "8px 10px",
            fontSize: 12,
          }}
        >
          {success}
        </div>
      ) : null}

      {allowed ? (
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="address@example.com"
            style={{
              flex: "1 1 240px",
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid rgba(31, 58, 104, 0.2)",
              fontSize: 13,
            }}
          />
          <button
            type="button"
            onClick={addSuppression}
            disabled={acting || !email.trim()}
            style={{
              border: 0,
              borderRadius: 8,
              background: acting ? "#94a3b8" : "#1F3A68",
              color: "#fff",
              padding: "8px 12px",
              fontSize: 13,
              cursor: acting ? "not-allowed" : "pointer",
            }}
          >
            Suppress
          </button>
        </div>
      ) : null}

      <div style={{ marginTop: 10, overflow: "auto" }}>
        {loading ? (
          <div style={{ fontSize: 12, color: "#64748b" }}>Loading suppressions…</div>
        ) : items.length === 0 ? (
          <div style={{ fontSize: 12, color: "#64748b" }}>No active suppressions.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
            <thead>
              <tr>
                {["Email", "Reason", "Source", "Created", ""].map((header) => (
                  <th
                    key={header}
                    style={{
                      textAlign: "left",
                      fontSize: 11,
                      color: "#475569",
                      padding: "6px 8px",
                      borderBottom: "1px solid #e2e8f0",
                    }}
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.suppressionId}>
                  <td style={{ fontSize: 12, padding: "6px 8px", color: "#0F1F3D" }}>
                    {item.normalizedEmail}
                  </td>
                  <td style={{ fontSize: 12, padding: "6px 8px", color: "#334155" }}>
                    {item.reason}
                  </td>
                  <td style={{ fontSize: 12, padding: "6px 8px", color: "#334155" }}>
                    {item.source}
                  </td>
                  <td style={{ fontSize: 12, padding: "6px 8px", color: "#334155" }}>
                    {formatLocaleDateTime(item.createdAt, undefined, "—")}
                  </td>
                  <td style={{ fontSize: 12, padding: "6px 8px" }}>
                    <button
                      type="button"
                      onClick={() => removeSuppression(item.suppressionId)}
                      disabled={acting}
                      style={{
                        border: "1px solid #cbd5e1",
                        background: "#fff",
                        borderRadius: 6,
                        padding: "4px 8px",
                        fontSize: 12,
                        cursor: acting ? "not-allowed" : "pointer",
                      }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
