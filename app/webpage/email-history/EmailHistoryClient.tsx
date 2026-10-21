"use client";

import React, { useEffect, useMemo, useState } from "react";
import { formatLocaleDateTime } from "@/app/utils/dateTime";
import MicrosoftMailboxStatus from "@/app/webpage/components/MicrosoftMailboxStatus";
import EmailSuppressionPanel from "@/app/webpage/components/EmailSuppressionPanel";

type EmailHistoryRow = {
  EmailId: number;
  LeadContactID: number;
  LeadId: number;
  SequenceId?: number | null;
  StepId?: number | null;
  ContactName: string | null;
  CompanyName: string | null;
  ToEmail: string;
  Subject: string;
  TemplateId: number | null;
  TemplateName: string | null;
  SequenceName?: string | null;
  StepOrder?: number | null;
  Status: string;
  DeliveryStatus?: string | null;
  SentAt: string | null;
  CreatedAt: string | null;
  ProviderMessageId: string | null;
  ThreadId: string | null;
  Attachments?: Array<{
    attachmentId: number;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    isInline: boolean;
    contentId: string | null;
  }>;
};

type EmailHistoryResponse = {
  items: EmailHistoryRow[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

type EmailEventRow = {
  EventId: number;
  EmailId: number;
  EventType: string;
  EventTime: string;
  Metadata: any;
  CreatedAt: string | null;
};

type EmailDetailResponse = {
  email: EmailHistoryRow & {
    Body: string;
    OwnerName?: string | null;
    Attachments?: Array<{
      attachmentId: number;
      fileName: string;
      contentType: string;
      sizeBytes: number;
      isInline: boolean;
      contentId: string | null;
    }>;
  };
  events: EmailEventRow[];
};

function formatBytes(bytes: number): string {
  const n = Number(bytes || 0);
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function deliveryEvidenceLabel(status: string | null | undefined, deliveryStatus?: string | null): string {
  const normalized = String(status || "").trim().toUpperCase();
  if (normalized !== "SENT") return normalized || "—";
  const delivery = String(deliveryStatus || "").trim().toUpperCase();
  if (delivery === "DELIVERED") return "Delivered";
  if (delivery === "BOUNCED") return "Bounced";
  if (delivery === "DEFERRED") return "Sent (deferred)";
  return "Sent (delivery unknown)";
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

export default function EmailHistoryClient(): JSX.Element {
  const [rows, setRows] = useState<EmailHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [status, setStatus] = useState<string>("");
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 1,
  });

  const [selectedEmailId, setSelectedEmailId] = useState<number | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detail, setDetail] = useState<EmailDetailResponse | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      const next = search.trim();
      if (next !== appliedSearch) {
        setPagination((prev) => ({ ...prev, page: 1 }));
        setAppliedSearch(next);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [search, appliedSearch]);

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          page: String(pagination.page),
          pageSize: String(pagination.pageSize),
        });
        if (appliedSearch) params.set("search", appliedSearch);
        if (status) params.set("status", status);

        const res = await fetch(`/api/email/history?${params.toString()}`, {
          credentials: "include",
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error || `Failed to load email history (${res.status})`);
        }

        const data = (await res.json()) as EmailHistoryResponse;
        if (!mounted) return;

        const normalizedRows = Array.isArray(data.items) ? data.items : [];
        const sortedRows = [...normalizedRows].sort((a, b) => {
          const aTime = new Date(a.SentAt || a.CreatedAt || 0).getTime() || 0;
          const bTime = new Date(b.SentAt || b.CreatedAt || 0).getTime() || 0;
          return bTime - aTime;
        });
        setRows(sortedRows);
        setPagination((prev) => ({
          ...prev,
          page: Number(data?.pagination?.page || prev.page),
          pageSize: Number(data?.pagination?.pageSize || prev.pageSize),
          total: Number(data?.pagination?.total || 0),
          totalPages: Number(data?.pagination?.totalPages || 1),
        }));
      } catch (err: any) {
        if (!mounted) return;
        setRows([]);
        setError(err?.message || "Failed to load email history");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, [appliedSearch, status, pagination.page, pagination.pageSize]);

  useEffect(() => {
    if (!selectedEmailId) {
      setDetail(null);
      setDetailError(null);
      return;
    }

    let mounted = true;
    async function loadDetail() {
      setDetailLoading(true);
      setDetailError(null);
      try {
        const res = await fetch(`/api/email/history/${selectedEmailId}`, {
          credentials: "include",
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error || `Failed to load email detail (${res.status})`);
        }
        const data = (await res.json()) as EmailDetailResponse;
        if (!mounted) return;
        setDetail(data);
      } catch (err: any) {
        if (!mounted) return;
        setDetail(null);
        setDetailError(err?.message || "Failed to load email detail");
      } finally {
        if (mounted) setDetailLoading(false);
      }
    }
    loadDetail();
    return () => {
      mounted = false;
    };
  }, [selectedEmailId]);

  const pageStart = useMemo(() => {
    if (pagination.total === 0) return 0;
    return (pagination.page - 1) * pagination.pageSize + 1;
  }, [pagination]);

  const pageEnd = useMemo(() => {
    if (pagination.total === 0) return 0;
    return Math.min(pagination.page * pagination.pageSize, pagination.total);
  }, [pagination]);

  return (
    <section
      style={{
        background: "#fff",
        border: "1px solid rgba(31, 58, 104, 0.14)",
        borderRadius: 14,
        boxShadow: "0 10px 24px rgba(15, 31, 61, 0.08)",
        padding: 18,
      }}
    >
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 20, color: "#1F3A68" }}>Email History</h2>
        <div style={{ marginTop: 12 }}>
          <MicrosoftMailboxStatus tab="emailHistory" />
        </div>
        <EmailSuppressionPanel />
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by contact, company, recipient email, or subject"
          style={{
            flex: "1 1 440px",
            minWidth: 240,
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid rgba(31, 58, 104, 0.2)",
            fontSize: 13,
            color: "#0F1F3D",
          }}
        />

        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPagination((prev) => ({ ...prev, page: 1 }));
          }}
          style={{
            width: 170,
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid rgba(31, 58, 104, 0.2)",
            background: "#fff",
            color: "#0F1F3D",
          }}
        >
          <option value="">All Statuses</option>
          <option value="QUEUED">QUEUED</option>
          <option value="SENT">SENT</option>
          <option value="FAILED">FAILED</option>
          <option value="SUPPRESSED">SUPPRESSED</option>
        </select>
      </div>

      {error && (
        <div
          style={{
            marginBottom: 12,
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
      )}

      <div style={{ border: "1px solid rgba(31, 58, 104, 0.14)", borderRadius: 10, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1180 }}>
          <thead>
            <tr style={{ background: "#0F1F3D" }}>
              {["Contact", "Company", "Email", "Subject", "Template", "Sequence", "Step", "Sent At", "Status", "Actions"].map((h) => (
                <th
                  key={h}
                  style={{
                    textAlign: "left",
                    fontSize: 12,
                    color: "#ffffff",
                    padding: "10px 12px",
                    borderBottom: "1px solid rgba(248, 244, 239, 0.12)",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={10} style={{ padding: 16, color: "#64748b", textAlign: "center" }}>
                  Loading email history...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ padding: 16, color: "#64748b", textAlign: "center" }}>
                  No email history found.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.EmailId}>
                  <td style={tdStyle}>{row.ContactName || "—"}</td>
                  <td style={tdStyle}>{row.CompanyName || "—"}</td>
                  <td style={tdStyle}>{row.ToEmail || "—"}</td>
                  <td style={tdStyle}>{row.Subject || "—"}</td>
                  <td style={tdStyle}>{row.TemplateName || "—"}</td>
                  <td style={tdStyle}>{row.SequenceName || "—"}</td>
                  <td style={tdStyle}>{row.StepOrder ? `Step ${row.StepOrder}` : "—"}</td>
                  <td style={tdStyle}>{formatDateTime(row.SentAt || row.CreatedAt)}</td>
                  <td style={tdStyle}>
                    <span
                      style={{
                        borderRadius: 999,
                        padding: "3px 8px",
                        fontSize: 11,
                        fontWeight: 700,
                        color:
                          deliveryEvidenceLabel(row.Status, row.DeliveryStatus) === "Delivered"
                            ? "#166534"
                            : deliveryEvidenceLabel(row.Status, row.DeliveryStatus) === "Bounced" ||
                                row.Status === "FAILED"
                              ? "#991b1b"
                              : row.Status === "SUPPRESSED"
                                ? "#334155"
                                : "#1e3a8a",
                        background:
                          deliveryEvidenceLabel(row.Status, row.DeliveryStatus) === "Delivered"
                            ? "#dcfce7"
                            : deliveryEvidenceLabel(row.Status, row.DeliveryStatus) === "Bounced" ||
                                row.Status === "FAILED"
                              ? "#fee2e2"
                              : row.Status === "SUPPRESSED"
                                ? "#e2e8f0"
                                : "#dbeafe",
                      }}
                      title={row.Status || ""}
                    >
                      {deliveryEvidenceLabel(row.Status, row.DeliveryStatus)}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <button
                      type="button"
                      onClick={() => setSelectedEmailId(row.EmailId)}
                      style={{
                        border: "1px solid #1F3A68",
                        background: "#fff",
                        color: "#1F3A68",
                        borderRadius: 8,
                        padding: "6px 10px",
                        fontWeight: 700,
                        cursor: "pointer",
                        fontSize: 12,
                      }}
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "#64748b" }}>
          Showing {pageStart}-{pageEnd} of {pagination.total}
        </span>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            onClick={() => setPagination((p) => ({ ...p, page: Math.max(1, p.page - 1) }))}
            disabled={pagination.page <= 1 || loading}
            style={pagerButtonStyle(pagination.page <= 1)}
          >
            Prev
          </button>
          <span style={{ fontSize: 12, color: "#334155" }}>
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPagination((p) => ({ ...p, page: Math.min(p.totalPages, p.page + 1) }))}
            disabled={pagination.page >= pagination.totalPages || loading}
            style={pagerButtonStyle(pagination.page >= pagination.totalPages)}
          >
            Next
          </button>
        </div>
      </div>

      {selectedEmailId && (
        <div style={overlayStyle} onClick={() => setSelectedEmailId(null)}>
          <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <h3 style={{ margin: 0, color: "#1F3A68" }}>Email Details</h3>
              <button type="button" onClick={() => setSelectedEmailId(null)} style={closeButtonStyle}>
                Close
              </button>
            </div>

            {detailLoading ? (
              <div style={{ color: "#64748b", fontSize: 13 }}>Loading details...</div>
            ) : detailError ? (
              <div style={{ color: "#991b1b", fontSize: 13 }}>{detailError}</div>
            ) : detail?.email ? (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(220px, 1fr))", gap: 10 }}>
                  <DetailField label="Recipient" value={detail.email.ContactName || "—"} />
                  <DetailField label="Company" value={detail.email.CompanyName || "—"} />
                  <DetailField label="Recipient Email" value={detail.email.ToEmail || "—"} />
                  <DetailField label="Template" value={detail.email.TemplateName || "—"} />
                  <DetailField label="Sequence" value={detail.email.SequenceName || "—"} />
                  <DetailField label="Step" value={detail.email.StepOrder ? `Step ${detail.email.StepOrder}` : "—"} />
                  <DetailField label="Status" value={detail.email.Status || "—"} />
                  <DetailField
                    label="Delivery"
                    value={deliveryEvidenceLabel(detail.email.Status, detail.email.DeliveryStatus)}
                  />
                  <DetailField label="Sent At" value={formatDateTime(detail.email.SentAt || detail.email.CreatedAt)} />
                  <DetailField label="Provider Message ID" value={detail.email.ProviderMessageId || "—"} />
                  <DetailField label="Thread ID" value={detail.email.ThreadId || "—"} />
                  <DetailField label="Sender" value={detail.email.OwnerName || "—"} />
                </div>

                <div>
                  <div style={sectionLabelStyle}>Subject</div>
                  <div style={boxStyle}>{detail.email.Subject || "—"}</div>
                </div>

                <div>
                  <div style={sectionLabelStyle}>Body</div>
                  <div style={{ ...boxStyle, whiteSpace: "pre-wrap", maxHeight: 180, overflow: "auto" }}>
                    {detail.email.Body || "—"}
                  </div>
                </div>

                <div>
                  <div style={sectionLabelStyle}>Attachments</div>
                  {(detail.email.Attachments || []).length === 0 ? (
                    <div style={{ color: "#64748b", fontSize: 13 }}>No attachments.</div>
                  ) : (
                    <div style={{ display: "grid", gap: 8 }}>
                      {(detail.email.Attachments || []).map((att) => (
                        <div key={att.attachmentId} style={eventRowStyle}>
                          <div style={{ color: "#0F1F3D", fontWeight: 700 }}>{att.fileName}</div>
                          <div style={{ color: "#475569", fontSize: 12 }}>
                            {formatBytes(att.sizeBytes)} • {att.contentType}
                            {att.isInline ? ` • inline (${att.contentId || "cid"})` : ""}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {(() => {
                  const opensApprox = (detail.events || []).filter((evt) => evt.EventType === "OPEN").length;
                  const clicksApprox = (detail.events || []).filter((evt) => evt.EventType === "CLICK").length;
                  if (!opensApprox && !clicksApprox) return null;
                  return (
                    <div>
                      <div style={sectionLabelStyle}>Engagement (approximate)</div>
                      <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.5 }}>
                        Opens and clicks can be inflated by image blocking, privacy relays, and link scanners.
                        They are not proof of delivery or that a person read the email.
                      </div>
                      <div style={{ marginTop: 8, fontSize: 13, color: "#0F1F3D" }}>
                        {opensApprox ? `Opens (approx.): ${opensApprox}` : null}
                        {opensApprox && clicksApprox ? " · " : null}
                        {clicksApprox ? `Clicks (approx.): ${clicksApprox}` : null}
                      </div>
                    </div>
                  );
                })()}

                <div>
                  <div style={sectionLabelStyle}>Email Activity</div>
                  <div style={{ display: "grid", gap: 8 }}>
                    {(detail.events || []).length === 0 ? (
                      <div style={{ color: "#64748b", fontSize: 13 }}>No email events recorded.</div>
                    ) : (
                      detail.events.map((evt) => (
                        <div key={evt.EventId} style={eventRowStyle}>
                          <div
                            style={{
                              fontWeight: 700,
                              color:
                                evt.EventType === "BOUNCED"
                                  ? "#991b1b"
                                  : evt.EventType === "DELIVERED"
                                    ? "#166534"
                                    : "#1e3a8a",
                            }}
                          >
                            {evt.EventType}
                          </div>
                          <div style={{ color: "#475569", fontSize: 12 }}>{formatDateTime(evt.EventTime)}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}

function DetailField({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 13, color: "#0F1F3D", fontWeight: 600 }}>{value}</div>
    </div>
  );
}

const tdStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid #f1f5f9",
  color: "#334155",
  fontSize: 13,
  verticalAlign: "top",
};

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 31, 61, 0.45)",
  zIndex: 120,
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  padding: 16,
};

const modalStyle: React.CSSProperties = {
  width: "min(900px, 100%)",
  maxHeight: "92vh",
  overflowY: "auto",
  background: "#ffffff",
  borderRadius: 14,
  border: "1px solid #dce4f2",
  boxShadow: "0 24px 60px rgba(15, 23, 42, 0.3)",
  padding: 14,
  display: "grid",
  gap: 12,
};

const closeButtonStyle: React.CSSProperties = {
  border: "1px solid #cbd5e1",
  background: "#fff",
  color: "#334155",
  borderRadius: 8,
  padding: "7px 10px",
  fontWeight: 700,
  cursor: "pointer",
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#1F3A68",
  fontWeight: 700,
  marginBottom: 6,
};

const boxStyle: React.CSSProperties = {
  border: "1px solid #dbe4f2",
  borderRadius: 8,
  background: "#f8fbff",
  padding: 10,
  color: "#1f2937",
  fontSize: 13,
};

const eventRowStyle: React.CSSProperties = {
  border: "1px solid #dcfce7",
  background: "#f0fdf4",
  borderRadius: 8,
  padding: "8px 10px",
  display: "flex",
  justifyContent: "space-between",
  gap: 10,
  flexWrap: "wrap",
};

function pagerButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    border: "1px solid #cbd5e1",
    background: "#fff",
    borderRadius: 8,
    padding: "6px 10px",
    cursor: "pointer",
    opacity: disabled ? 0.5 : 1,
  };
}

