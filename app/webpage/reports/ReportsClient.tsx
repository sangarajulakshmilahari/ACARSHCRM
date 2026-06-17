"use client";

import React, { useEffect, useMemo, useState } from "react";
import { formatLocaleDateTime } from "@/app/utils/dateTime";

type ReportRow = {
  ActivityId: number;
  ActivityDate: string;
  ContactName: string;
  CompanyName: string;
  ActivityType: string;
  ActivitySource: "Leads" | "Prospects" | "Accounts" | "Customers";
  Notes: string;
  ActivityOwnerId: number | null;
  ActivityOwnerName: string;
  CreatedByUserId: number | null;
  CreatedByUserName: string;
};

type ReportUser = {
  UserId: number;
  UserName: string;
};

type CurrentUser = {
  userId: number;
  userName: string;
  roleId: number;
};

type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

type ReportResponse = {
  items: ReportRow[];
  users: ReportUser[];
  currentUser: CurrentUser;
  pagination: Pagination;
  filters: {
    from: string;
    to: string;
    userId: number | null;
    search: string;
    source: "all" | "leads" | "prospects" | "accounts";
  };
};

function formatDateTime(value: string): string {
  return formatLocaleDateTime(value, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }, value);
}

function getLast7DaysRange(): { from: string; to: string } {
  const toDate = new Date();
  toDate.setHours(0, 0, 0, 0);
  const fromDate = new Date(toDate);
  fromDate.setDate(fromDate.getDate() - 6);

  const to = `${toDate.getFullYear()}-${`${toDate.getMonth() + 1}`.padStart(2, "0")}-${`${toDate.getDate()}`.padStart(2, "0")}`;
  const from = `${fromDate.getFullYear()}-${`${fromDate.getMonth() + 1}`.padStart(2, "0")}-${`${fromDate.getDate()}`.padStart(2, "0")}`;
  return { from, to };
}

function getLast30DaysRange(): { from: string; to: string } {
  const toDate = new Date();
  toDate.setHours(0, 0, 0, 0);
  const fromDate = new Date(toDate);
  fromDate.setDate(fromDate.getDate() - 29);

  const to = `${toDate.getFullYear()}-${`${toDate.getMonth() + 1}`.padStart(2, "0")}-${`${toDate.getDate()}`.padStart(2, "0")}`;
  const from = `${fromDate.getFullYear()}-${`${fromDate.getMonth() + 1}`.padStart(2, "0")}-${`${fromDate.getDate()}`.padStart(2, "0")}`;
  return { from, to };
}

function getTodayRange(): { from: string; to: string } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const val = `${today.getFullYear()}-${`${today.getMonth() + 1}`.padStart(2, "0")}-${`${today.getDate()}`.padStart(2, "0")}`;
  return { from: val, to: val };
}

export default function ReportsClient(): JSX.Element {
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [appliedFromDate, setAppliedFromDate] = useState<string>("");
  const [appliedToDate, setAppliedToDate] = useState<string>("");
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [users, setUsers] = useState<ReportUser[]>([]);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [appliedUserId, setAppliedUserId] = useState<string>("");
  const [searchText, setSearchText] = useState<string>("");
  const [appliedSearchText, setAppliedSearchText] = useState<string>("");
  const [selectedSource, setSelectedSource] = useState<"all" | "leads" | "prospects" | "accounts">("all");
  const [appliedSource, setAppliedSource] = useState<"all" | "leads" | "prospects" | "accounts">("all");
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 1,
  });
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initial = getLast7DaysRange();
    setFromDate(initial.from);
    setToDate(initial.to);
    setAppliedFromDate(initial.from);
    setAppliedToDate(initial.to);
  }, []);

  useEffect(() => {
    if (!appliedFromDate || !appliedToDate) return;
    loadReports(pagination.page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedFromDate, appliedToDate, appliedUserId, appliedSearchText, appliedSource, pagination.page, pagination.pageSize]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const next = searchText.trim();
      if (next === appliedSearchText) return;
      setPagination((prev) => ({ ...prev, page: 1 }));
      setAppliedSearchText(next);
    }, 400);

    return () => clearTimeout(timer);
  }, [searchText, appliedSearchText]);

  const isManager = currentUser?.roleId === 1;

  async function loadReports(page: number): Promise<void> {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        from: appliedFromDate,
        to: appliedToDate,
        page: String(page),
        pageSize: String(pagination.pageSize),
      });

      if (appliedUserId) {
        params.set("userId", appliedUserId);
      }

      if (appliedSearchText) {
        params.set("search", appliedSearchText);
      }

      if (appliedSource && appliedSource !== "all") {
        params.set("source", appliedSource);
      }

      const res = await fetch(`/api/employees/reports?${params.toString()}`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Failed to load reports (${res.status})`);
      }

      const data: ReportResponse = await res.json();
      setRows(data.items ?? []);
      setUsers(data.users ?? []);
      setCurrentUser(data.currentUser ?? null);
      setPagination(data.pagination ?? { page: 1, pageSize: 20, total: 0, totalPages: 1 });
      setFromDate(data.filters?.from ?? appliedFromDate);
      setToDate(data.filters?.to ?? appliedToDate);
      const normalizedUserId = data.filters?.userId ? String(data.filters.userId) : "";
      setSelectedUserId(normalizedUserId);
      setAppliedUserId(normalizedUserId);
      const normalizedSearch = String(data.filters?.search ?? "");
      setSearchText(normalizedSearch);
      setAppliedSearchText(normalizedSearch);
      const normalizedSource = (data.filters?.source ?? "all") as "all" | "leads" | "prospects" | "accounts";
      setSelectedSource(normalizedSource);
      setAppliedSource(normalizedSource);
    } catch (err: any) {
      setRows([]);
      setError(err?.message ?? "Failed to load reports");
    } finally {
      setLoading(false);
    }
  }

  function applyFilters(): void {
    if (!fromDate || !toDate) {
      setError("Please select both from and to dates");
      return;
    }
    if (fromDate > toDate) {
      setError("From date cannot be after to date");
      return;
    }
    setPagination((prev) => ({ ...prev, page: 1 }));
    setAppliedFromDate(fromDate);
    setAppliedToDate(toDate);
    setAppliedUserId(selectedUserId);
    setAppliedSource(selectedSource);
  }

  function resetFilters(): void {
    const range = getLast7DaysRange();
    setFromDate(range.from);
    setToDate(range.to);
    setPagination((prev) => ({ ...prev, page: 1 }));
    setAppliedFromDate(range.from);
    setAppliedToDate(range.to);
    setSelectedUserId("");
    setAppliedUserId("");
    setSearchText("");
    setAppliedSearchText("");
    setSelectedSource("all");
    setAppliedSource("all");
  }

  function quickRange(kind: "today" | "last7" | "last30"): void {
    const range =
      kind === "today"
        ? getTodayRange()
        : kind === "last30"
          ? getLast30DaysRange()
          : getLast7DaysRange();

    setFromDate(range.from);
    setToDate(range.to);
    setPagination((prev) => ({ ...prev, page: 1 }));
    setAppliedFromDate(range.from);
    setAppliedToDate(range.to);
  }

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
        border: "1px solid #e2e8f0",
        borderRadius: 14,
        boxShadow: "0 10px 24px rgba(15, 23, 42, 0.05)",
        padding: 18,
      }}
    >
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 20, color: "#0f172a" }}>Recent Activities</h2>
        {/* <p style={{ margin: "6px 0 0", color: "#64748b", fontSize: 13 }}>
          Lead activity report with date range filters and latest-first sorting.
        </p> */}
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 32,
          alignItems: "flex-end",
          marginTop: 12,
          marginBottom: 16,
        }}
      >
        <label style={{ fontSize: 12, color: "#334155",  minWidth: 100 }}>
          From Date
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            style={{ width: "100%", marginTop: 6, padding: "8px 10px", borderRadius: 8, border: "1px solid #cbd5e1" }}
          />
        </label>

        <label style={{ fontSize: 12, color: "#334155", minWidth: 100 }}>
          To Date
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            style={{ width: "100%", marginTop: 6, padding: "8px 10px", borderRadius: 8, border: "1px solid #cbd5e1" }}
          />
        </label>

        <label style={{ fontSize: 12, color: "#334155", minWidth: 180 }}>
          Select User
          <select
            value={selectedUserId}
            disabled={!isManager || loading}
            onChange={(e) => setSelectedUserId(e.target.value)}
            style={{
              width: "100%",
              marginTop: 6,
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid #cbd5e1",
              background: !isManager ? "#f8fafc" : "#fff",
              color: "#0f172a",
              cursor: !isManager ? "not-allowed" : "pointer",
            }}
          >
            {isManager ? (
              <option value="">All Users</option>
            ) : null}
            {(users ?? []).map((u) => (
              <option key={u.UserId} value={String(u.UserId)}>
                {u.UserName}
              </option>
            ))}
          </select>
        </label>

        <label style={{ fontSize: 12, color: "#334155", minWidth: 160 }}>
          Activity Source
          <select
            value={selectedSource}
            disabled={loading}
            onChange={(e) => {
              const nextSource = e.target.value as "all" | "leads" | "prospects" | "accounts";
              setSelectedSource(nextSource);
              setPagination((prev) => ({ ...prev, page: 1 }));
              setAppliedSource(nextSource);
            }}
            style={{
              width: "100%",
              marginTop: 6,
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid #cbd5e1",
              background: "#fff",
              color: "#0f172a",
              cursor: "pointer",
            }}
          >
            <option value="all">All Activities</option>
            <option value="leads">Leads</option>
            <option value="prospects">Prospects</option>
            <option value="accounts">Customers</option>
          </select>
        </label>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", flex: "0 1 auto" }}>
          <button
            type="button"
            onClick={applyFilters}
            disabled={loading}
            style={{
              border: "1px solid #2563eb",
              background: "#2563eb",
              color: "#fff",
              borderRadius: 8,
              padding: "8px 12px",
              fontWeight: 600,
              cursor: "pointer",
              opacity: loading ? 0.6 : 1,
            }}
          >
            Apply
          </button>
          <button
            type="button"
            onClick={resetFilters}
            disabled={loading}
            style={{
              border: "1px solid #cbd5e1",
              background: "#fff",
              color: "#0f172a",
              borderRadius: 8,
              padding: "8px 12px",
              fontWeight: 600,
              cursor: "pointer",
              opacity: loading ? 0.6 : 1,
            }}
          >
            Reset
          </button>
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap", alignItems: "center", marginLeft: "auto" }}>
          <button type="button" disabled={loading} onClick={() => quickRange("today")} style={{ border: "1px solid #dbeafe", background: "#eff6ff", color: "#1d4ed8", borderRadius: 999, padding: "6px 10px", cursor: "pointer", opacity: loading ? 0.6 : 1 }}>Today</button>
          <button type="button" disabled={loading} onClick={() => quickRange("last7")} style={{ border: "1px solid #dbeafe", background: "#eff6ff", color: "#1d4ed8", borderRadius: 999, padding: "6px 10px", cursor: "pointer", opacity: loading ? 0.6 : 1 }}>Last 7</button>
          <button type="button" disabled={loading} onClick={() => quickRange("last30")} style={{ border: "1px solid #dbeafe", background: "#eff6ff", color: "#1d4ed8", borderRadius: 999, padding: "6px 10px", cursor: "pointer", opacity: loading ? 0.6 : 1 }}>Last 30</button>
        </div>
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

      <div style={{ marginBottom: 12 }}>
        <input
          type="text"
          value={searchText}
          onChange={(e) => {
            setSearchText(e.target.value);
          }}
          placeholder="Search by Company, Contact, Notes, or Activity Type"
          style={{
            width: "100%",
            maxWidth: 520,
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid #cbd5e1",
            fontSize: 13,
            color: "#0f172a",
          }}
        />
      </div>

      <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1160 }}>
          <thead>
            <tr style={{ background: "#f8fafc" }}>
              {["Activity Date", "Contact Name", "Company Name", "Activity Type", "Activity Source", "Activity Owner", "Created By User", "Notes"].map((h) => (
                <th
                  key={h}
                  style={{
                    textAlign: "left",
                    fontSize: 12,
                    color: "#334155",
                    padding: "10px 12px",
                    borderBottom: "1px solid #e2e8f0",
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
                <td colSpan={8} style={{ padding: 16, color: "#64748b", textAlign: "center" }}>
                  Loading Activities...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: 16, color: "#64748b", textAlign: "center" }}>
                  No activity found for the selected date range.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.ActivityId}>
                  <td style={{ padding: "10px 12px", borderBottom: "1px solid #f1f5f9", color: "#0f172a", fontSize: 13 }}>{formatDateTime(row.ActivityDate)}</td>
                  <td style={{ padding: "10px 12px", borderBottom: "1px solid #f1f5f9", color: "#334155", fontSize: 13 }}>{row.ContactName || "—"}</td>
                  <td style={{ padding: "10px 12px", borderBottom: "1px solid #f1f5f9", color: "#334155", fontSize: 13 }}>{row.CompanyName || "—"}</td>
                  <td style={{ padding: "10px 12px", borderBottom: "1px solid #f1f5f9", color: "#334155", fontSize: 13 }}>{row.ActivityType || "—"}</td>
                  <td style={{ padding: "10px 12px", borderBottom: "1px solid #f1f5f9", color: "#334155", fontSize: 13 }}>{row.ActivitySource || "—"}</td>
                  <td style={{ padding: "10px 12px", borderBottom: "1px solid #f1f5f9", color: "#334155", fontSize: 13 }}>{row.ActivityOwnerName || "—"}</td>
                  <td style={{ padding: "10px 12px", borderBottom: "1px solid #f1f5f9", color: "#334155", fontSize: 13 }}>{row.CreatedByUserName || "—"}</td>
                  <td style={{ padding: "10px 12px", borderBottom: "1px solid #f1f5f9", color: "#334155", fontSize: 13 }}>{row.Notes || "—"}</td>
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
            style={{ border: "1px solid #cbd5e1", background: "#fff", borderRadius: 8, padding: "6px 10px", cursor: "pointer", opacity: pagination.page <= 1 ? 0.5 : 1 }}
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
            style={{ border: "1px solid #cbd5e1", background: "#fff", borderRadius: 8, padding: "6px 10px", cursor: "pointer", opacity: pagination.page >= pagination.totalPages ? 0.5 : 1 }}
          >
            Next
          </button>
        </div>
      </div>
    </section>
  );
}

