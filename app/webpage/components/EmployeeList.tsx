
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createPortal } from "react-dom";
import { Filter, X } from "lucide-react";
import { formatLocaleDate } from "@/app/utils/dateTime";
import {
  convertLeadDirectToAccountWithExistingFlow,
  convertLeadWithExistingFlow,
} from "../leads/convert-actions";

export type Contact = {
  LeadContactID?: number | string | null;
  ContactName: string | null;
  ContactRoleName: string | null;
  ContactTitle: string | null;
  ContactEmail: string | null;
  ContactPhone: string | null;
};

export type Employee = {
  LeadId: number | string;
  CompanyName: string;
  CompanyLocation: string;
  LeadSource: string;
  LeadDate: string | number | Date;
  CreatedOn?: string | number | Date | null;
  LeadNotes: string | null;
  StatusName: string | null;
  LatestActivityId?: number | string | null;
  LatestActivityNotes?: string | null;
  OwnerName: string | null;
  AccountTypeId?: number | string | null;
  AccountTypeName?: string | null;
  LeadScore?: number | null;
  LeadScoreRating?: "HOT" | "WARM" | "COLD" | string | null;
  LeadScoreBreakdown?: Record<string, any> | null;
  Name?: string | null;
  RecordType?: string | null;
  IsArchived?: number | boolean | null;
  Contacts: Contact[];
};

type EntityType = "lead" | "prospect" | "account";
type DetailsOrigin = "leads" | "Prospect" | "Account";

type Props = {
  employees: Employee[] | null | undefined;
  loading?: boolean;
  error?: string | null;
  onAddLead: () => void;
  onAddLead2?: () => void;
  addButtonLabelOverride?: string;
  secondaryAddButtonLabelOverride?: string;
  showAnalyticsCards?: boolean;
  showToolbar?: boolean;
  fillHeight?: boolean;
  tableMaxHeight?: number | string;
  belowFiltersContent?: React.ReactNode;
  onOpenLeadDetails?: (
    leadId: number | string,
    origin?: DetailsOrigin
  ) => void;
  onDeleteLead?: (leadId: number | string, type: EntityType) => Promise<void> | void;
  type: EntityType;
};

type OutreachAnalytics = {
  totalLinkedInRequestsSent: number;
  totalLinkedInRequestsAccepted: number;
  totalEmailsSent: number;
  acceptanceRate: number;
};

type LeadListFilters = {
  dateFrom: string;
  dateTo: string;
  owner: string;
  company: string;
  source: string;
  status: string;
};

const EMPTY_LEAD_FILTERS: LeadListFilters = {
  dateFrom: "",
  dateTo: "",
  owner: "",
  company: "",
  source: "",
  status: "",
};

export default function EmployeeList({
  employees,
  loading,
  error,
  onAddLead,
  onAddLead2,
  addButtonLabelOverride,
  secondaryAddButtonLabelOverride,
  showAnalyticsCards = true,
  showToolbar = true,
  fillHeight = true,
  tableMaxHeight,
  belowFiltersContent,
  onOpenLeadDetails,
  onDeleteLead,
  type,
}: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [draftFilters, setDraftFilters] = useState<LeadListFilters>(EMPTY_LEAD_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<LeadListFilters>(EMPTY_LEAD_FILTERS);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [openConvertMenuLeadId, setOpenConvertMenuLeadId] = useState<
    number | string | null
  >(null);
  const [hoveredConvertMenuItem, setHoveredConvertMenuItem] = useState<
    string | null
  >(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [analytics, setAnalytics] = useState<OutreachAnalytics>({
    totalLinkedInRequestsSent: 0,
    totalLinkedInRequestsAccepted: 0,
    totalEmailsSent: 0,
    acceptanceRate: 0,
  });
  const [deletingLeadId, setDeletingLeadId] = useState<number | string | null>(null);
  const [pendingDeleteLead, setPendingDeleteLead] = useState<Employee | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [archivedEmployees, setArchivedEmployees] = useState<Employee[]>([]);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const [archivedError, setArchivedError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const fetchOutreachAnalytics = async () => {
      try {
        setAnalyticsLoading(true);
        const res = await fetch(`/api/employees/outreach-analytics?type=${type}`, {
          credentials: "include",
        });

        if (!res.ok) {
          throw new Error(`Failed to fetch outreach analytics: ${res.status}`);
        }

        const data = (await res.json()) as OutreachAnalytics;
        if (!isMounted) return;

        setAnalytics({
          totalLinkedInRequestsSent: Number(
            data?.totalLinkedInRequestsSent ?? 0
          ),
          totalLinkedInRequestsAccepted: Number(
            data?.totalLinkedInRequestsAccepted ?? 0
          ),
          totalEmailsSent: Number(data?.totalEmailsSent ?? 0),
          acceptanceRate: Number(data?.acceptanceRate ?? 0),
        });
      } catch (err) {
        console.error("Failed to load outreach analytics", err);
        if (!isMounted) return;
        setAnalytics({
          totalLinkedInRequestsSent: 0,
          totalLinkedInRequestsAccepted: 0,
          totalEmailsSent: 0,
          acceptanceRate: 0,
        });
      } finally {
        if (isMounted) setAnalyticsLoading(false);
      }
    };

    fetchOutreachAnalytics();

    return () => {
      isMounted = false;
    };
  }, [type]);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('[data-convert-menu-root="true"]')
      ) {
        return;
      }

      setOpenConvertMenuLeadId(null);
    };

    document.addEventListener("click", handleOutsideClick);

    return () => {
      document.removeEventListener("click", handleOutsideClick);
    };
  }, []);
  useEffect(() => {
    setDraftFilters(EMPTY_LEAD_FILTERS);
    setAppliedFilters(EMPTY_LEAD_FILTERS);
    setPage(1);
    setShowArchived(false);
    setArchivedEmployees([]);
    setArchivedError(null);
  }, [type]);

  const listApiPath =
    type === "prospect"
      ? "/api/employees/prospects"
      : type === "account"
        ? "/api/employees/account"
        : "/api/employees/leads";

  const loadArchivedEmployees = async () => {
    try {
      setArchivedLoading(true);
      setArchivedError(null);
      const res = await fetch(`${listApiPath}?archived=1`, { credentials: "include" });
      const data = await res.json().catch(() => []);
      if (!res.ok) {
        throw new Error(data?.error || `Failed to load archived records (${res.status})`);
      }
      setArchivedEmployees(Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : []);
    } catch (error: any) {
      setArchivedEmployees([]);
      setArchivedError(error?.message || "Failed to load archived records");
    } finally {
      setArchivedLoading(false);
    }
  };

  useEffect(() => {
    if (!showArchived) return;
    loadArchivedEmployees();
  }, [showArchived, type]);

  const addButtonLabel = useMemo(() => {
    if (addButtonLabelOverride) return addButtonLabelOverride;
    switch (type) {
      case "prospect":
        return "Add Prospect";
      case "account":
        return "Add Customer";
      case "lead":
      default:
        return "Add Lead";
    }
  }, [addButtonLabelOverride, type]);

  const sourceEmployees = showArchived
    ? archivedEmployees
    : Array.isArray(employees)
      ? employees
      : employees &&
        (employees as any).data &&
        Array.isArray((employees as any).data)
        ? (employees as any).data
        : [];
  const employeesList: Employee[] = Array.isArray(sourceEmployees) ? sourceEmployees : [];
  const listLoading = showArchived ? archivedLoading : Boolean(loading);
  const listError = showArchived ? archivedError : error;

  const scopedEmployees = useMemo(() => {
    const q = (query || "").toLowerCase();
    return employeesList.filter((emp) => {
      const recordType = getRecordType(emp).type;

      if (q && type === "lead") return true;
      if (q && type === "prospect") return recordType !== "lead";

      return recordType === type;
    });
  }, [employeesList, query, type]);

  function requestArchiveLeadRecord(emp: Employee): void {
    const leadId = String(emp.LeadId ?? "").trim();
    if (!leadId) {
      window.alert("Invalid lead id.");
      return;
    }

    setOpenConvertMenuLeadId(null);
    setPendingDeleteLead(emp);
  }

  function closeDeleteConfirmModal(): void {
    if (deletingLeadId != null) return;
    setPendingDeleteLead(null);
  }

  async function confirmArchiveLeadRecord(): Promise<void> {
    const emp = pendingDeleteLead;
    if (!emp) return;

    const leadId = String(emp.LeadId ?? "").trim();
    if (!leadId) {
      window.alert("Invalid lead id.");
      setPendingDeleteLead(null);
      return;
    }

    const restoring = showArchived;
    setDeletingLeadId(emp.LeadId);

    try {
      const response = restoring
        ? await fetch(`/api/employees/leads?leadId=${encodeURIComponent(leadId)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ isArchived: false }),
          })
        : await fetch(`/api/employees/leads?leadId=${encodeURIComponent(leadId)}`, {
            method: "DELETE",
          });

      if (!response.ok) {
        let errorMessage = restoring
          ? `Failed to restore record (${response.status})`
          : `Failed to archive record (${response.status})`;
        try {
          const payload = await response.json();
          if (payload?.error) errorMessage = String(payload.error);
        } catch {}
        throw new Error(errorMessage);
      }

      setPendingDeleteLead(null);

      if (restoring) {
        await loadArchivedEmployees();
        if (onDeleteLead) await onDeleteLead(emp.LeadId, type);
      } else if (onDeleteLead) {
        await onDeleteLead(emp.LeadId, type);
      } else {
        router.refresh();
      }
    } catch (error: any) {
      window.alert(error?.message || (showArchived ? "Failed to restore record" : "Failed to archive record"));
    } finally {
      setDeletingLeadId(null);
    }
  }

  const filterOptions = useMemo(() => {
    const owners = new Set<string>();
    const companies = new Set<string>();
    const sources = new Set<string>();
    const statuses = new Set<string>();

    scopedEmployees.forEach((emp) => {
      const owner = emp.OwnerName?.trim();
      const company = emp.CompanyName?.trim();
      const source = emp.LeadSource?.trim();
      const status = emp.StatusName?.trim();

      if (owner) owners.add(owner);
      if (company) companies.add(company);
      if (source) sources.add(source);
      if (status) statuses.add(status);
    });

    const sortAlpha = (values: Set<string>) =>
      Array.from(values).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

    return {
      owners: sortAlpha(owners),
      companies: sortAlpha(companies),
      sources: sortAlpha(sources),
      statuses: sortAlpha(statuses),
    };
  }, [scopedEmployees]);

  const filteredEmployees = useMemo(() => {
    const q = (query || "").toLowerCase();
    const dateFrom = (appliedFilters.dateFrom || "").trim();
    const dateTo = (appliedFilters.dateTo || "").trim();
    const ownerFilter = (appliedFilters.owner || "").trim().toLowerCase();
    const companyFilter = (appliedFilters.company || "").trim().toLowerCase();
    const sourceFilter = (appliedFilters.source || "").trim().toLowerCase();
    const statusFilter = (appliedFilters.status || "").trim().toLowerCase();

    const matchedEmployees = scopedEmployees.filter((emp) => {
      const entryDateKey = toLocalDateKey(emp.CreatedOn ?? emp.LeadDate);

      if (dateFrom && (!entryDateKey || entryDateKey < dateFrom)) return false;
      if (dateTo && (!entryDateKey || entryDateKey > dateTo)) return false;

      if (ownerFilter) {
        const owner = (emp.OwnerName || "").trim().toLowerCase();
        if (owner !== ownerFilter) return false;
      }

      if (companyFilter) {
        const company = (emp.CompanyName || "").trim().toLowerCase();
        if (!company.includes(companyFilter)) return false;
      }

      if (sourceFilter) {
        const source = (emp.LeadSource || "").trim().toLowerCase();
        if (source !== sourceFilter) return false;
      }

      if (statusFilter) {
        const status = (emp.StatusName || "").trim().toLowerCase();
        if (status !== statusFilter) return false;
      }

      if (!q) return true;

      const recordType = getRecordType(emp);
      const haystack = [
        recordType.label,
        emp.CompanyName,
        emp.CompanyLocation,
        emp.LeadSource,
        emp.StatusName,
        emp.OwnerName,
        emp.CreatedOn,
        emp.LatestActivityNotes,
        emp.LeadNotes,
        ...(emp.Contacts || []).flatMap((c) => [
          c.ContactName,
          c.ContactRoleName,
          c.ContactTitle,
          c.ContactEmail,
          c.ContactPhone,
        ]),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(q);
    });

    return matchedEmployees.sort((a, b) => {
      const aCreatedOn = a.CreatedOn ? new Date(a.CreatedOn).getTime() : 0;
      const bCreatedOn = b.CreatedOn ? new Date(b.CreatedOn).getTime() : 0;

      if (bCreatedOn !== aCreatedOn) {
        return bCreatedOn - aCreatedOn;
      }

      const aLeadDate = a.LeadDate ? new Date(a.LeadDate).getTime() : 0;
      const bLeadDate = b.LeadDate ? new Date(b.LeadDate).getTime() : 0;

      if (bLeadDate !== aLeadDate) {
        return bLeadDate - aLeadDate;
      }

      return Number(b.LeadId || 0) - Number(a.LeadId || 0);
    });
  }, [appliedFilters, query, scopedEmployees]);

  const activeFilterChips = useMemo(() => {
    const chips: Array<{ key: keyof LeadListFilters | "dateRange"; label: string }> = [];

    if (appliedFilters.dateFrom || appliedFilters.dateTo) {
      const fromLabel = appliedFilters.dateFrom
        ? formatDisplayDate(appliedFilters.dateFrom)
        : "Any";
      const toLabel = appliedFilters.dateTo
        ? formatDisplayDate(appliedFilters.dateTo)
        : "Any";
      chips.push({
        key: "dateRange",
        label: `Date of Entry: ${fromLabel} - ${toLabel}`,
      });
    }

    if (appliedFilters.owner) {
      chips.push({ key: "owner", label: `Owner: ${appliedFilters.owner}` });
    }

    if (appliedFilters.company) {
      chips.push({ key: "company", label: `Company: ${appliedFilters.company}` });
    }

    if (appliedFilters.source) {
      chips.push({ key: "source", label: `Source: ${appliedFilters.source}` });
    }

    if (appliedFilters.status) {
      chips.push({ key: "status", label: `Status: ${appliedFilters.status}` });
    }

    return chips;
  }, [appliedFilters]);

  const activeFilterCount = activeFilterChips.length;

  const totalFiltered = filteredEmployees.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize) || 1);
  const currentPage = Math.min(page, totalPages);
  const pageStartIndex = totalFiltered === 0 ? 0 : (currentPage - 1) * pageSize;
  const pageEndIndex = Math.min(pageStartIndex + pageSize, totalFiltered);
  const pagedEmployees = useMemo(
    () => filteredEmployees.slice(pageStartIndex, pageEndIndex),
    [filteredEmployees, pageEndIndex, pageStartIndex]
  );

  useEffect(() => {
    setPage(1);
  }, [query, appliedFilters, pageSize, type]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const updateDraftFilter = <K extends keyof LeadListFilters>(
    key: K,
    value: LeadListFilters[K]
  ) => {
    setDraftFilters((prev) => ({ ...prev, [key]: value }));
  };

  const handleApplyFilters = () => {
    setAppliedFilters({ ...draftFilters });
    setPage(1);
  };

  const handleClearAllFilters = () => {
    setDraftFilters(EMPTY_LEAD_FILTERS);
    setAppliedFilters(EMPTY_LEAD_FILTERS);
    setPage(1);
  };

  const removeAppliedFilter = (chipKey: keyof LeadListFilters | "dateRange") => {
    const next = { ...appliedFilters };

    if (chipKey === "dateRange") {
      next.dateFrom = "";
      next.dateTo = "";
    } else {
      next[chipKey] = "";
    }

    setAppliedFilters(next);
    setDraftFilters(next);
    setPage(1);
  };

  const entityLabel =
    type === "prospect" ? "prospects" : type === "account" ? "customers" : "leads";
  const visibleEntityLabel = showArchived ? `archived ${entityLabel}` : entityLabel;

  const outreachKpis = useMemo(
    () => [
      {
        key: "sent",
        label: "LinkedIn Requests Sent",
        value: analytics.totalLinkedInRequestsSent,
        iconBg: "#dbeafe",
        iconColor: "#1d4ed8",
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        ),
        tooltip:
          "Count of contacts where LinkedIn request has been marked as sent.",
      },
      {
        key: "accepted",
        label: "LinkedIn Requests Accepted",
        value: analytics.totalLinkedInRequestsAccepted,
        iconBg: "#dcfce7",
        iconColor: "#15803d",
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/>
          </svg>
        ),
        tooltip:
          "Count of contacts where LinkedIn request has been marked as accepted.",
      },
      {
        key: "email",
        label: "Emails Sent",
        value: analytics.totalEmailsSent,
        iconBg: "#ffedd5",
        iconColor: "#c2410c",
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="22,4 12,13 2,4"/>
          </svg>
        ),
        tooltip:
          "Count of contacts where outreach email has been marked as sent.",
      },
      {
        key: "rate",
        label: "LinkedIn Acceptance Rate",
        value: `${analytics.acceptanceRate}%`,
        iconBg: "#ede9fe",
        iconColor: "#6d28d9",
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>
          </svg>
        ),
        tooltip:
          "Acceptance rate = LinkedIn Requests Accepted / LinkedIn Requests Sent.",
      },
    ],
    [analytics]
  );


  const renderCompactContactsCell = (emp: Employee) => {
    return emp.Contacts && emp.Contacts.length > 0 ? (
      <>
        {emp.Contacts.slice(0, 2).map((c, index) => (
          <div
            key={getContactSelectionKey(emp, c, index)}
            style={{
              padding: "2px 0",
              borderBottom:
                index !== Math.min(emp.Contacts.length, 2) - 1
                  ? "0.5px solid #e0e0e0"
                  : "none",
              width: "100%",
              margin: 0,
              display: "block",
            }}
          >
            <div
              title="Click to open details"
              style={{
                fontWeight: 700,
                color: "#212529",
                fontSize: "inherit",
                lineHeight: "inherit",
                marginBottom: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {c.ContactName || "-"}
              {c.ContactRoleName && (
                <span
                  style={{
                    color: "#6c7293",
                    marginLeft: 6,
                    fontWeight: 600,
                  }}
                >
                  ({c.ContactRoleName})
                </span>
              )}
            </div>

            {c.ContactTitle && c.ContactTitle.trim() !== "" && (
              <div
                style={{
                  marginBottom: 0,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  display: "block",
                  fontWeight: 600,
                  color: "#6c7293",
                  fontSize: "inherit",
                  lineHeight: "inherit",
                }}
                title={c.ContactTitle}
              >
                {c.ContactTitle}
              </div>
            )}

            {c.ContactEmail && (
              <div
                style={{
                  fontSize: "inherit",
                  color: "#6c7293",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  whiteSpace: "nowrap",
                  fontWeight: 400,
                  lineHeight: "inherit",
                  minWidth: 0,
                }}
              >
                <Image src="/email.png" alt="email" width={11} height={11} />

                <a
                  href={`mailto:${c.ContactEmail}`}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    color: "#6c7293",
                    textDecoration: "none",
                    fontSize: "inherit",
                    lineHeight: "inherit",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {c.ContactEmail}
                </a>
              </div>
            )}

            {c.ContactPhone && (
              <div
                style={{
                  fontSize: "inherit",
                  color: "#6c7293",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  lineHeight: "inherit",
                }}
              >
                <span>
                  <Image src="/call.png" alt="call" width={10} height={10} />
                </span>
                <a
                  href={`tel:${c.ContactPhone}`}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    color: "inherit",
                    textDecoration: "none",
                    fontSize: "inherit",
                    lineHeight: "inherit",
                  }}
                >
                  {c.ContactPhone}
                </a>
              </div>
            )}
          </div>
        ))}

        {emp.Contacts.length > 2 && (
          <div
            style={{
              marginTop: 4,
              fontSize: "inherit",
              color: "#3a77e3",
              fontWeight: 600,
              cursor: "pointer",
            }}
            title="Click the row to view all contacts"
          >
            +{emp.Contacts.length - 2} more
          </div>
        )}
      </>
    ) : (
      <span>-</span>
    );
  };

  if (!showArchived && error)  if (!showArchived && error) return <div style={{ color: "red" }}>Error: {error}</div>;

  const baseFontStyles: React.CSSProperties = {
    fontFamily: "Open Sans, sans-serif",
    fontSize: "10px",
    lineHeight: 1.35,
    letterSpacing: "0.2px",
    WebkitFontSmoothing: "antialiased",
    MozOsxFontSmoothing: "grayscale",
  };

  const searchPlaceholder =
    type === "lead"
      ? "Search leads, prospects, customers by company, contact, email, source, status, owner..."
      : type === "prospect"
        ? "Search prospects and customers by company, contact, email, source, status, owner..."
        : "Search customers by company, contact, email, source, status, owner...";

  return (
    <div
      style={{
        background: "#ffffff",
        borderRadius: 12,
        boxShadow: "0 12px 28px rgba(15, 23, 42, 0.08)",
        border: "1px solid #e9eef7",
        overflow: "hidden",
        height: fillHeight ? "100%" : "auto",
        minHeight: fillHeight ? 0 : undefined,
        display: "flex",
        flexDirection: "column",
        ...baseFontStyles,
      }}
    >
      {showAnalyticsCards && (
        <div
          style={{
            padding: "14px 18px 10px",
            background: "#ffffff",
            borderBottom: "1px solid #e9eef7",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 10,
            }}
          >
            {outreachKpis.map((kpi) => (
              <div
                key={kpi.key}
                title={kpi.tooltip}
                style={{
                  border: "1px solid #e7ecf4",
                  borderRadius: 10,
                  padding: "9px 10px",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  minHeight: 58,
                  background: "linear-gradient(180deg, #ffffff 0%, #f9fbff 100%)",
                }}
              >
                <span
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: kpi.iconBg,
                    color: kpi.iconColor,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {kpi.icon}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 10,
                      lineHeight: 1.2,
                      color: "#64748b",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {kpi.label}
                  </div>
                  <div
                    style={{
                      marginTop: 3,
                      fontSize: 18,
                      fontWeight: 700,
                      color: "#0f172a",
                      letterSpacing: "0.2px",
                    }}
                  >
                    {analyticsLoading ? "..." : kpi.value}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showToolbar && (
        <>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              marginBottom: 12,
              padding: "16px 16px 0",
              flexShrink: 0,
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", gap: "10px" }}>
              <button
                onClick={onAddLead}
                style={{
                  background: "#F26522",
                  color: "white",
                  padding: "7px 12px",
                  border: "none",
                  borderRadius: 6,
                  fontSize: "10.05px",
                  cursor: "pointer",
                  fontWeight: 700,
                  fontFamily: "inherit",
                }}
              >
                {addButtonLabel}
              </button>

              <button
                type="button"
                onClick={() => setShowArchived((prev) => !prev)}
                style={{
                  background: showArchived ? "#0f172a" : "#ffffff",
                  color: showArchived ? "#ffffff" : "#0f172a",
                  padding: "7px 12px",
                  border: "1px solid #cbd5e1",
                  borderRadius: 6,
                  fontSize: "10.05px",
                  cursor: "pointer",
                  fontWeight: 700,
                  fontFamily: "inherit",
                }}
              >
                {showArchived ? "View Active" : "View Archived"}
              </button>

              {type === "account" && onAddLead2 && !showArchived && (
                <button
                  onClick={() => onAddLead2()}
                  style={{
                    background: "#F26522",
                    color: "white",
                    padding: "7px 12px",
                    border: "none",
                    borderRadius: 6,
                    fontSize: "10.05px",
                    cursor: "pointer",
                    fontWeight: 700,
                    fontFamily: "inherit",
                  }}
                >
                  {secondaryAddButtonLabelOverride || "Add Lead"}
                </button>
              )}
            </div>

            <div style={{ position: "relative", display: "inline-block", marginLeft: "auto" }}>
              <Image
                src="/search.png"
                alt="search"
                width={18}
                height={18}
                style={{
                  position: "absolute",
                  left: 12,
                  top: "50%",
                  transform: "translateY(-50%)",
                  pointerEvents: "none",
                }}
              />

              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onFocus={() => setIsSearchFocused(true)}
                onBlur={() => setIsSearchFocused(false)}
                placeholder={searchPlaceholder}
                style={{
                  width: "min(420px, 70vw)",
                  padding: "12px 40px",
                  paddingLeft: "45px",
                  borderRadius: 10,
                  border: isSearchFocused
                    ? "1.5px solid #4a90e2"
                    : "1px solid #d8e1ef",
                  boxShadow: isSearchFocused
                    ? "0 0 8px rgba(8, 40, 218, 0.12)"
                    : "none",
                  fontSize: "10.05px",
                  outline: "none",
                  transition: "box-shadow 0.15s ease, border 0.15s ease",
                  fontFamily: "inherit",
                  lineHeight: 1.35,
                  WebkitFontSmoothing: "antialiased",
                }}
              />
            </div>
          </div>

          <div
            style={{
              margin: "0 16px 12px",
              padding: "14px 14px 12px",
              border: "1.5px solid #c4b5fd",
              borderRadius: 14,
              background: "linear-gradient(180deg, #ffffff 0%, #fbfaff 100%)",
              boxShadow: "0 8px 20px rgba(109, 40, 217, 0.06)",
              flexShrink: 0,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 12,
              }}
            >
              <Filter size={14} color="#7c3aed" aria-hidden="true" />
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#312e81",
                  fontFamily: "inherit",
                }}
              >
                Filters
              </span>
              {activeFilterCount > 0 ? (
                <span
                  style={{
                    minWidth: 20,
                    height: 20,
                    borderRadius: 999,
                    background: "#ede9fe",
                    color: "#6d28d9",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "0 6px",
                  }}
                >
                  {activeFilterCount}
                </span>
              ) : null}
            </div>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 12,
                alignItems: "flex-end",
              }}
            >
              <div style={{ ...filterFieldWrapStyle, flex: "1 1 280px", maxWidth: "100%" }}>
                <label style={filterLabelStyle}>Date of Entry</label>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)",
                    gap: 6,
                    alignItems: "center",
                    width: "100%",
                  }}
                >
                  <input
                    type="date"
                    value={draftFilters.dateFrom}
                    onChange={(e) => updateDraftFilter("dateFrom", e.target.value)}
                    style={filterDateControlStyle}
                    title="From date"
                  />
                  <span style={{ color: "#94a3b8", fontSize: 11, flexShrink: 0 }}>to</span>
                  <input
                    type="date"
                    value={draftFilters.dateTo}
                    onChange={(e) => updateDraftFilter("dateTo", e.target.value)}
                    style={filterDateControlStyle}
                    title="To date"
                  />
                </div>
              </div>

              <div style={{ ...filterFieldWrapStyle, flex: "1 1 160px", maxWidth: "100%" }}>
                <label style={filterLabelStyle} htmlFor="filter-owner">
                  Owner
                </label>
                <select
                  id="filter-owner"
                  value={draftFilters.owner}
                  onChange={(e) => updateDraftFilter("owner", e.target.value)}
                  style={filterControlStyle}
                >
                  <option value="">All Owners</option>
                  {filterOptions.owners.map((owner) => (
                    <option key={owner} value={owner}>
                      {owner}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ ...filterFieldWrapStyle, flex: "1 1 160px", maxWidth: "100%" }}>
                <label style={filterLabelStyle} htmlFor="filter-company">
                  Company
                </label>
                <input
                  id="filter-company"
                  type="text"
                  list="filter-company-options"
                  value={draftFilters.company}
                  onChange={(e) => updateDraftFilter("company", e.target.value)}
                  placeholder="All Companies"
                  style={filterControlStyle}
                />
                <datalist id="filter-company-options">
                  {filterOptions.companies.map((company) => (
                    <option key={company} value={company} />
                  ))}
                </datalist>
              </div>

              <div style={{ ...filterFieldWrapStyle, flex: "1 1 150px", maxWidth: "100%" }}>
                <label style={filterLabelStyle} htmlFor="filter-source">
                  Source
                </label>
                <select
                  id="filter-source"
                  value={draftFilters.source}
                  onChange={(e) => updateDraftFilter("source", e.target.value)}
                  style={filterControlStyle}
                >
                  <option value="">All Sources</option>
                  {filterOptions.sources.map((source) => (
                    <option key={source} value={source}>
                      {source}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ ...filterFieldWrapStyle, flex: "1 1 150px", maxWidth: "100%" }}>
                <label style={filterLabelStyle} htmlFor="filter-status">
                  Status
                </label>
                <select
                  id="filter-status"
                  value={draftFilters.status}
                  onChange={(e) => updateDraftFilter("status", e.target.value)}
                  style={filterControlStyle}
                >
                  <option value="">All Status</option>
                  {filterOptions.statuses.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  alignItems: "center",
                  gap: 10,
                  minHeight: 36,
                  flex: "1 1 180px",
                  flexWrap: "wrap",
                }}
              >
                <button
                  type="button"
                  onClick={handleClearAllFilters}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "#f97316",
                    fontWeight: 700,
                    fontSize: 12,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    padding: "6px 4px",
                  }}
                >
                  Clear All
                </button>
                <button
                  type="button"
                  onClick={handleApplyFilters}
                  style={{
                    border: "none",
                    background: "#0f172a",
                    color: "#ffffff",
                    fontWeight: 700,
                    fontSize: 12,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    borderRadius: 8,
                    padding: "9px 14px",
                    boxShadow: "0 6px 14px rgba(15, 23, 42, 0.18)",
                  }}
                >
                  Apply Filters
                </button>
              </div>
            </div>

            {activeFilterChips.length > 0 ? (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  marginTop: 12,
                }}
              >
                {activeFilterChips.map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    onClick={() => removeAppliedFilter(chip.key)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      border: "1px solid #ddd6fe",
                      background: "#f5f3ff",
                      color: "#5b21b6",
                      borderRadius: 999,
                      padding: "5px 10px",
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                    title={`Remove ${chip.label}`}
                  >
                    <span>{chip.label}</span>
                    <X size={12} aria-hidden="true" />
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {belowFiltersContent ? (
            <div
              style={{
                margin: "0 16px 12px",
                flexShrink: 0,
              }}
            >
              {belowFiltersContent}
            </div>
          ) : null}
        </>
      )}

      {!showToolbar && belowFiltersContent ? (
        <div
          style={{
            margin: "12px 16px",
            flexShrink: 0,
          }}
        >
          {belowFiltersContent}
        </div>
      ) : null}

      <div
        style={{
          flex: fillHeight ? 1 : undefined,
          minHeight: fillHeight ? 0 : undefined,
          overflowY: "auto",
          overflowX: "auto",
          maxHeight: !fillHeight && tableMaxHeight ? tableMaxHeight : undefined,
          borderTop: "1px solid #edf2fa",
        }}
      >
        <table
          style={{
            width: "100%",
            tableLayout: "fixed",
            borderCollapse:
              "collapse" as unknown as React.CSSProperties["borderCollapse"],
            borderSpacing: 0,
            minWidth: 1040,
            fontFamily: "inherit",
            fontSize: "inherit",
            lineHeight: 1.35,
            letterSpacing: "0.2px",
            borderStyle: "solid",
            borderWidth: 0,
          }}
        >
          <colgroup>
            <col style={{ width: "12%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "18%" }} />
            <col style={{ width: "24%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "10%" }} />
          </colgroup>

          <thead>
            <tr>
              <th style={thStyle}>Owner</th>
              <th style={thStyle}>Company</th>
              <th style={thStyle}>Contacts</th>
              <th style={thStyle}>Source</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Score</th>
              <th style={thStyle}>Date of Entry</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>

          <tbody>
            {pagedEmployees.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  style={{
                    ...tdStyle,
                    textAlign: "center",
                    padding: "28px 12px",
                    color: "#64748b",
                    fontWeight: 600,
                  }}
                >
                  {listLoading
                    ? "Loading..."
                    : listError
                      ? listError
                      : `No ${visibleEntityLabel} match the current filters.`}
                </td>
              </tr>
            ) : null}
            {pagedEmployees.map((emp, idx) => {
              const rowStyle: React.CSSProperties = {
                ...trStyle,
                backgroundColor: idx % 2 === 0 ? "#ffffff" : "#f8fbff",
              };
              const statusText = emp.StatusName?.trim() || "";
              const latestActivityNote = emp.LatestActivityNotes?.trim() || "";
              const recordType = getRecordType(emp);
              const convertOrigin = getDetailsOrigin(recordType.type);
              const companyName = emp.CompanyName?.trim() || "-";
              const rowKey = String(emp.LeadId);
              const leadScore = Number(emp.LeadScore ?? 0);
              const leadScoreRating = String(emp.LeadScoreRating || "COLD").toUpperCase();

              return (
                <React.Fragment key={emp.LeadId}>
                  <tr
                    onClick={() =>
                      onOpenLeadDetails?.(emp.LeadId, convertOrigin)
                    }
                    style={{
                      ...rowStyle,
                      cursor: "pointer",
                    }}
                  >
                    <td style={{ ...tdStyle, verticalAlign: "middle" }}>
                      <div
                        style={{
                          fontSize: "inherit",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={emp.OwnerName || ""}
                      >
                        {emp.OwnerName || "-"}
                      </div>
                    </td>

                    <td
                      style={{
                        ...tdStyle,
                        ...getCompanyCellStyle(recordType.type),
                        verticalAlign: "middle",
                      }}
                    >
                      <div
                        style={{
                          fontWeight: 700,
                          fontSize: "inherit",
                          lineHeight: "inherit",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                        }}
                        title={`${companyName} - ${recordType.label}`}
                      >
                        {companyName}
                      </div>

                      {emp.CompanyLocation && (
                        <div
                          style={{
                            color: "#6c7293",
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            fontSize: "inherit",
                          }}
                        >
                          <span>
                            <Image
                              src="/location.png"
                              alt="location"
                              width={10}
                              height={10}
                            />
                          </span>
                          <span>{emp.CompanyLocation}</span>
                        </div>
                      )}
                    </td>

                    <td style={tdStyle}>
                      {renderCompactContactsCell(emp)}
                    </td>

                    <td style={{ ...tdStyle, verticalAlign: "middle" }}>
                      <div
                        style={{
                          color: "#212529",
                          fontSize: "9.88px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={emp.LeadSource || ""}
                      >
                        {emp.LeadSource || "-"}
                      </div>
                    </td>

                    <td style={{ ...tdStyle, verticalAlign: "middle" }}>
                      {statusText ? (
                        <>
                          <span
                            style={{
                              display: "inline-block",
                              maxWidth: "100%",
                              padding: "4px 10px",
                              borderRadius: 12,
                              border: "1px solid #dbe7ff",
                              background: "#edf4ff",
                              color: "#1e40af",
                              fontSize: "inherit",
                              fontWeight: 700,
                              textTransform: "uppercase",
                              lineHeight: "inherit",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              verticalAlign: "middle",
                            }}
                            title={statusText}
                          >
                            {statusText}
                          </span>

                          {latestActivityNote && (
                            <div
                              title={latestActivityNote}
                              style={{
                                marginTop: 3,
                                color: "#6c7293",
                                fontSize: "inherit",
                                fontWeight: 600,
                                lineHeight: "inherit",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {latestActivityNote}
                            </div>
                          )}
                        </>
                      ) : (
                        "-"
                      )}
                    </td>

                    <td style={{ ...tdStyle, verticalAlign: "middle" }}>
                      <div style={{ display: "grid", gap: 4 }}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "3px 8px",
                            borderRadius: 12,
                            fontWeight: 700,
                            fontSize: "10px",
                            width: "fit-content",
                            background:
                              leadScoreRating === "HOT"
                                ? "#fff1f2"
                                : leadScoreRating === "WARM"
                                  ? "#fff7ed"
                                  : "#eff6ff",
                            color:
                              leadScoreRating === "HOT"
                                ? "#b91c1c"
                                : leadScoreRating === "WARM"
                                  ? "#c2410c"
                                  : "#1d4ed8",
                            border:
                              leadScoreRating === "HOT"
                                ? "1px solid #fecdd3"
                                : leadScoreRating === "WARM"
                                  ? "1px solid #fed7aa"
                                  : "1px solid #bfdbfe",
                          }}
                          title={`Lead score rating: ${leadScoreRating}`}
                        >
                          {leadScoreRating === "HOT"
                            ? "HOT 🔥"
                            : leadScoreRating === "WARM"
                              ? "WARM 🟠"
                              : "COLD 🔵"}
                        </span>
                        <span style={{ fontWeight: 700, color: "#0f172a", fontSize: "11px" }}>
                          {Number.isFinite(leadScore) ? leadScore : 0}/100
                        </span>
                      </div>
                    </td>

                    <td style={{ ...tdStyle, verticalAlign: "middle" }}>
                      <div style={{ fontSize: "inherit" }}>
                        {formatDate(emp.CreatedOn ?? emp.LeadDate)}
                      </div>
                    </td>

                    <td
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        ...tdStyle,
                        textAlign: "center",
                        verticalAlign: "middle",
                        position: "relative",
                      }}
                    >
                      <div style={{ display: "grid", gap: 6 }}>
                        {recordType.type === "lead" ? (
                          <div
                            data-convert-menu-root="true"
                            style={convertMenuRootStyle}
                          >
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenConvertMenuLeadId((prev) =>
                                  prev === emp.LeadId ? null : emp.LeadId
                                );
                              }}
                              style={getConvertActionButtonStyle(
                                openConvertMenuLeadId === emp.LeadId
                              )}
                              title="Convert"
                            >
                              <span>Convert</span>
                              <span style={{ fontSize: 8 }}>v</span>
                            </button>

                            {openConvertMenuLeadId === emp.LeadId && (
                              <div
                                onClick={(e) => e.stopPropagation()}
                                style={convertMenuStyle}
                              >
                                <button
                                  onClick={async () => {
                                    setOpenConvertMenuLeadId(null);
                                    await convertLeadWithExistingFlow({
                                      leadId: emp.LeadId,
                                      origin: convertOrigin,
                                      router,
                                    });
                                  }}
                                  onMouseEnter={() =>
                                    setHoveredConvertMenuItem(
                                      `${String(emp.LeadId)}-prospect`
                                    )
                                  }
                                  onMouseLeave={() =>
                                    setHoveredConvertMenuItem(null)
                                  }
                                  style={getConvertMenuItemStyle(
                                    hoveredConvertMenuItem ===
                                      `${String(emp.LeadId)}-prospect`
                                  )}
                                >
                                  <span style={convertMenuItemLabelStyle}>
                                    Convert to Prospect
                                  </span>
                                </button>

                                <button
                                  onClick={async () => {
                                    setOpenConvertMenuLeadId(null);
                                    await convertLeadDirectToAccountWithExistingFlow({
                                      leadId: emp.LeadId,
                                      router,
                                    });
                                  }}
                                  onMouseEnter={() =>
                                    setHoveredConvertMenuItem(
                                      `${String(emp.LeadId)}-account`
                                    )
                                  }
                                  onMouseLeave={() =>
                                    setHoveredConvertMenuItem(null)
                                  }
                                  style={getConvertMenuItemStyle(
                                    hoveredConvertMenuItem ===
                                      `${String(emp.LeadId)}-account`
                                  )}
                                >
                                  <span style={convertMenuItemLabelStyle}>
                                    Convert to Customer
                                  </span>
                                </button>
                              </div>
                            )}
                          </div>
                        ) : recordType.type === "prospect" ? (
                          <div
                            data-convert-menu-root="true"
                            style={convertMenuRootStyle}
                          >
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenConvertMenuLeadId((prev) =>
                                  prev === emp.LeadId ? null : emp.LeadId
                                );
                              }}
                              style={getConvertActionButtonStyle(
                                openConvertMenuLeadId === emp.LeadId
                              )}
                              title="Convert"
                            >
                              <span>Convert</span>
                              <span style={{ fontSize: 8 }}>v</span>
                            </button>

                            {openConvertMenuLeadId === emp.LeadId && (
                              <div
                                onClick={(e) => e.stopPropagation()}
                                style={convertMenuStyle}
                              >
                                <button
                                  onClick={async () => {
                                    setOpenConvertMenuLeadId(null);
                                    await convertLeadWithExistingFlow({
                                      leadId: emp.LeadId,
                                      origin: convertOrigin,
                                      router,
                                      target: "Lead",
                                    });
                                  }}
                                  onMouseEnter={() =>
                                    setHoveredConvertMenuItem(
                                      `${String(emp.LeadId)}-move-lead`
                                    )
                                  }
                                  onMouseLeave={() =>
                                    setHoveredConvertMenuItem(null)
                                  }
                                  style={getConvertMenuItemStyle(
                                    hoveredConvertMenuItem ===
                                      `${String(emp.LeadId)}-move-lead`
                                  )}
                                >
                                  <span style={convertMenuItemLabelStyle}>
                                    Move to Lead
                                  </span>
                                </button>

                                <button
                                  onClick={async () => {
                                    setOpenConvertMenuLeadId(null);
                                    await convertLeadWithExistingFlow({
                                      leadId: emp.LeadId,
                                      origin: convertOrigin,
                                      router,
                                      target: "Account",
                                    });
                                  }}
                                  onMouseEnter={() =>
                                    setHoveredConvertMenuItem(
                                      `${String(emp.LeadId)}-account`
                                    )
                                  }
                                  onMouseLeave={() =>
                                    setHoveredConvertMenuItem(null)
                                  }
                                  style={getConvertMenuItemStyle(
                                    hoveredConvertMenuItem ===
                                      `${String(emp.LeadId)}-account`
                                  )}
                                >
                                  <span style={convertMenuItemLabelStyle}>
                                    Convert to Customer
                                  </span>
                                </button>
                              </div>
                            )}
                          </div>
                        ) : (
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              await convertLeadWithExistingFlow({
                                leadId: emp.LeadId,
                                origin: convertOrigin,
                                router,
                              });
                            }}
                            style={getConvertActionButtonStyle(false)}
                            title="Convert"
                          >
                            Convert
                          </button>
                        )}

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            requestArchiveLeadRecord(emp);
                          }}
                          style={getDeleteActionButtonStyle(deletingLeadId === emp.LeadId)}
                          title={showArchived ? "Restore" : "Archive"}
                          disabled={deletingLeadId === emp.LeadId}
                        >
                          {deletingLeadId === emp.LeadId
                            ? showArchived
                              ? "Restoring..."
                              : "Archiving..."
                            : showArchived
                              ? "Restore"
                              : "Archive"}
                        </button>
                      </div>
                    </td>
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          padding: "12px 16px 16px",
          borderTop: "1px solid #edf2fa",
          background: "#ffffff",
          flexShrink: 0,
        }}
      >
        <div style={{ color: "#64748b", fontSize: 12, fontWeight: 600 }}>
          {totalFiltered === 0
            ? `Showing 0 ${visibleEntityLabel}`
            : `Showing ${pageStartIndex + 1} to ${pageEndIndex} of ${totalFiltered} ${visibleEntityLabel}`}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              color: "#64748b",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Rows per page:
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value) || 10);
                setPage(1);
              }}
              style={{
                border: "1px solid #d8e1ef",
                borderRadius: 8,
                padding: "6px 8px",
                fontSize: 12,
                color: "#0f172a",
                background: "#ffffff",
                fontFamily: "inherit",
              }}
            >
              {[10, 20, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>

          <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <button
              type="button"
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              disabled={currentPage <= 1}
              style={paginationButtonStyle(currentPage <= 1, false)}
              aria-label="Previous page"
            >
              ‹
            </button>

            {buildPageItems(currentPage, totalPages).map((item, index) =>
              item === "..." ? (
                <span
                  key={`ellipsis-${index}`}
                  style={{
                    minWidth: 28,
                    textAlign: "center",
                    color: "#94a3b8",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  ...
                </span>
              ) : (
                <button
                  key={item}
                  type="button"
                  onClick={() => setPage(item)}
                  style={paginationButtonStyle(false, item === currentPage)}
                >
                  {item}
                </button>
              )
            )}

            <button
              type="button"
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={currentPage >= totalPages}
              style={paginationButtonStyle(currentPage >= totalPages, false)}
              aria-label="Next page"
            >
              ›
            </button>
          </div>
        </div>
      </div>

      {pendingDeleteLead &&
        typeof window !== "undefined" &&
        createPortal(
          <div
            style={deleteConfirmOverlayStyle}
            onClick={closeDeleteConfirmModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-confirm-title"
          >
            <div style={deleteConfirmModalStyle} onClick={(e) => e.stopPropagation()}>
              <div style={deleteConfirmHeaderStyle}>
                <h3 id="delete-confirm-title" style={deleteConfirmTitleStyle}>
                  {showArchived ? "Restore" : "Archive"}{" "}
                  {type === "prospect" ? "Prospect" : type === "account" ? "Customer" : "Lead"}
                </h3>
                <button
                  type="button"
                  onClick={closeDeleteConfirmModal}
                  style={deleteConfirmCloseStyle}
                  aria-label="Close"
                  disabled={deletingLeadId != null}
                >
                  ×
                </button>
              </div>

              <div style={deleteConfirmBodyStyle}>
                <p style={{ margin: 0, color: "#0F1F3D", fontSize: 15, lineHeight: 1.5 }}>
                  {showArchived ? "Restore" : "Archive"}{" "}
                  <strong>{String(pendingDeleteLead.CompanyName || "this record").trim()}</strong>?
                </p>
                <p style={{ margin: 0, color: "#64748b", fontSize: 13, lineHeight: 1.5 }}>
                  {showArchived
                    ? "This record will return to the active list."
                    : "It will be hidden from the active list and can be viewed from Archived."}
                </p>
              </div>

              <div style={deleteConfirmFooterStyle}>
                <button
                  type="button"
                  onClick={closeDeleteConfirmModal}
                  style={deleteConfirmCancelButtonStyle}
                  disabled={deletingLeadId != null}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmArchiveLeadRecord}
                  style={deleteConfirmDeleteButtonStyle}
                  disabled={deletingLeadId != null}
                >
                  {deletingLeadId != null
                    ? showArchived
                      ? "Restoring..."
                      : "Archiving..."
                    : showArchived
                      ? "Restore"
                      : "Archive"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}


function getContactSelectionKey(
  emp: Employee,
  contact: Contact,
  index: number
) {
  if (contact.LeadContactID !== null && contact.LeadContactID !== undefined) {
    return `contact-${String(contact.LeadContactID)}`;
  }

  return [
    "lead",
    String(emp.LeadId),
    "contact",
    String(index),
    contact.ContactEmail || "",
    contact.ContactName || "",
  ].join("-");
}

const bulkActionBarStyle: React.CSSProperties = {
  margin: "0 16px 12px",
  padding: "10px 12px",
  border: "1px solid #fed7aa",
  borderRadius: 8,
  background: "#fff7ed",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
  flexShrink: 0,
};

const bulkSelectionSummaryStyle: React.CSSProperties = {
  color: "#9a3412",
  fontSize: "11px",
  fontWeight: 800,
  whiteSpace: "nowrap",
};

const bulkActionButtonGroupStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
};

const baseBulkButtonStyle: React.CSSProperties = {
  minHeight: 32,
  padding: "7px 10px",
  borderRadius: 7,
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "10.5px",
  fontWeight: 800,
  lineHeight: 1.2,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  whiteSpace: "nowrap",
};

const primaryBulkButtonStyle: React.CSSProperties = {
  ...baseBulkButtonStyle,
  border: "1px solid #F26522",
  background: "#F26522",
  color: "#ffffff",
};

const secondaryBulkButtonStyle: React.CSSProperties = {
  ...baseBulkButtonStyle,
  border: "1px solid #1F3A68",
  background: "#ffffff",
  color: "#1F3A68",
};

const clearBulkButtonStyle: React.CSSProperties = {
  ...baseBulkButtonStyle,
  border: "1px solid #cbd5e1",
  background: "#ffffff",
  color: "#475569",
};

const sequenceOverlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  zIndex: 1300,
};

const sequenceModalStyle: React.CSSProperties = {
  width: "min(520px, 100%)",
  background: "#ffffff",
  borderRadius: 12,
  border: "1px solid #dbe4f2",
  boxShadow: "0 20px 48px rgba(15, 23, 42, 0.24)",
  overflow: "hidden",
};

const sequenceModalHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "12px 14px",
  borderBottom: "1px solid #e8eef7",
};

const sequenceModalTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 16,
  color: "#102a56",
};

const sequenceModalCloseStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "#475569",
  cursor: "pointer",
  fontSize: 22,
  lineHeight: 1,
  padding: "0 4px",
};

const sequenceModalBodyStyle: React.CSSProperties = {
  padding: "12px 14px",
  display: "grid",
  gap: 10,
};

const sequenceSelectStyle: React.CSSProperties = {
  width: "100%",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 12,
  color: "#0f172a",
  background: "#ffffff",
};

const sequenceNoticeStyle: React.CSSProperties = {
  border: "1px solid #fcd34d",
  background: "#fffbeb",
  color: "#92400e",
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 12,
};

const sequenceModalFooterStyle: React.CSSProperties = {
  borderTop: "1px solid #e8eef7",
  padding: "10px 14px",
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
};

const sequenceCancelButtonStyle: React.CSSProperties = {
  border: "1px solid #cbd5e1",
  background: "#ffffff",
  color: "#475569",
  borderRadius: 8,
  padding: "7px 11px",
  fontWeight: 700,
  cursor: "pointer",
};

const sequencePrimaryButtonStyle: React.CSSProperties = {
  border: "1px solid #1F3A68",
  background: "#1F3A68",
  color: "#ffffff",
  borderRadius: 8,
  padding: "7px 11px",
  fontWeight: 700,
  cursor: "pointer",
};

const deleteConfirmOverlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 1400,
  background: "rgba(15, 31, 61, 0.42)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
};

const deleteConfirmModalStyle: React.CSSProperties = {
  width: "min(460px, 92vw)",
  background: "#ffffff",
  borderRadius: 12,
  boxShadow: "0 24px 48px rgba(15, 31, 61, 0.28)",
  border: "1px solid rgba(31, 58, 104, 0.16)",
  overflow: "hidden",
};

const deleteConfirmHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "14px 18px",
  borderBottom: "1px solid rgba(31, 58, 104, 0.16)",
};

const deleteConfirmTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 20,
  fontWeight: 700,
  color: "#1F3A68",
  letterSpacing: "-0.02em",
};

const deleteConfirmCloseStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "#475569",
  cursor: "pointer",
  fontSize: 24,
  lineHeight: 1,
  padding: "0 4px",
};

const deleteConfirmBodyStyle: React.CSSProperties = {
  padding: "18px",
  display: "grid",
  gap: 8,
};

const deleteConfirmFooterStyle: React.CSSProperties = {
  padding: "0 18px 16px",
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
};

const deleteConfirmCancelButtonStyle: React.CSSProperties = {
  border: "1px solid #cbd5e1",
  background: "#ffffff",
  color: "#475569",
  borderRadius: 8,
  padding: "8px 18px",
  fontWeight: 700,
  fontSize: 14,
  cursor: "pointer",
};

const deleteConfirmDeleteButtonStyle: React.CSSProperties = {
  border: "none",
  background: "#dc2626",
  color: "#ffffff",
  borderRadius: 8,
  padding: "8px 18px",
  fontWeight: 700,
  fontSize: 14,
  cursor: "pointer",
};

const contactCellWrapStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  width: "100%",
  minWidth: 0,
};

const contactToggleButtonStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 30,
  padding: "5px 7px",
  border: "1px solid #dbe4f2",
  borderRadius: 7,
  background: "#ffffff",
  color: "#1F3A68",
  display: "flex",
  alignItems: "center",
  gap: 5,
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "10.5px",
  fontWeight: 800,
  lineHeight: 1.2,
};

const contactToggleTextStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const contactGridScrollStyle: React.CSSProperties = {
  overflowX: "auto",
  paddingBottom: 2,
};

const contactGridBaseStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns:
    "28px minmax(110px, 1.1fr) minmax(90px, 1fr) minmax(92px, 0.9fr) minmax(150px, 1.3fr)",
  alignItems: "center",
  columnGap: 8,
  minWidth: 540,
};

const contactGridHeaderStyle: React.CSSProperties = {
  ...contactGridBaseStyle,
  padding: "0 7px 5px",
  color: "#64748b",
  fontSize: "9.5px",
  fontWeight: 800,
  textTransform: "uppercase",
};

const contactGridRowStyle: React.CSSProperties = {
  ...contactGridBaseStyle,
  marginTop: 4,
  padding: "6px 7px",
  border: "1px solid #e8eef7",
  borderRadius: 7,
  color: "#334155",
  fontSize: "10px",
  lineHeight: 1.25,
};

const contactGridCellTextStyle: React.CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const expandedContactsPanelStyle: React.CSSProperties = {
  border: "1px solid #dbe7ff",
  borderRadius: 10,
  background: "#ffffff",
  overflow: "hidden",
};

const expandedContactsPanelHeaderStyle: React.CSSProperties = {
  padding: "9px 12px",
  borderBottom: "1px solid #e5edf9",
  background: "#f8fbff",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
};

const expandedContactsPanelTitleStyle: React.CSSProperties = {
  fontSize: "11px",
  fontWeight: 800,
  color: "#1f3a68",
};

const expandedContactsPanelMetaStyle: React.CSSProperties = {
  fontSize: "10px",
  color: "#64748b",
  fontWeight: 700,
};

const expandedContactsTableWrapStyle: React.CSSProperties = {
  overflowX: "auto",
};

const expandedContactsTableStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 720,
  borderCollapse: "collapse",
};

const expandedContactsThStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  fontSize: "10px",
  fontWeight: 800,
  color: "#64748b",
  background: "#fdfefe",
  borderBottom: "1px solid #e8eef7",
  textTransform: "uppercase",
  letterSpacing: "0.3px",
};

const expandedContactsTrStyle: React.CSSProperties = {
  borderBottom: "1px solid #eef2f8",
};

const expandedContactsTdStyle: React.CSSProperties = {
  padding: "9px 10px",
  fontSize: "10.3px",
  color: "#1e293b",
  verticalAlign: "middle",
};

const expandedContactIdentityStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  minWidth: 0,
};

const expandedContactAvatarStyle: React.CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: "50%",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#dcfce7",
  color: "#166534",
  fontSize: "10px",
  fontWeight: 800,
  flexShrink: 0,
};

const expandedContactNameStyle: React.CSSProperties = {
  fontWeight: 700,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const expandedContactTitleStyle: React.CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  maxWidth: 240,
};

const expandedRoleBadgeStyle: React.CSSProperties = {
  display: "inline-block",
  marginTop: 4,
  padding: "2px 8px",
  borderRadius: 999,
  border: "1px solid #dbeafe",
  background: "#eff6ff",
  color: "#1d4ed8",
  fontSize: "9px",
  fontWeight: 700,
  maxWidth: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const expandedContactPhoneLinkStyle: React.CSSProperties = {
  color: "#334155",
  textDecoration: "none",
};

const contactCheckboxStyle: React.CSSProperties = {
  width: 15,
  height: 15,
  margin: 0,
  padding: 0,
  accentColor: "#F26522",
};

const contactEmailLinkStyle: React.CSSProperties = {
  color: "#1d4ed8",
  textDecoration: "none",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

function getRecordType(emp: Employee): {
  type: EntityType;
  label: "Lead" | "Prospect" | "Customer";
} {
  const accountTypeId = Number(emp.AccountTypeId);
  const typeName = String(emp.AccountTypeName ?? emp.Name ?? "").toLowerCase();

  if (accountTypeId >= 30 || typeName === "account") {
    return { type: "account", label: "Customer" };
  }

  if (accountTypeId >= 20 || typeName === "prospect") {
    return { type: "prospect", label: "Prospect" };
  }

  return { type: "lead", label: "Lead" };
}

function getDetailsOrigin(type: EntityType): DetailsOrigin {
  if (type === "account") return "Account";
  if (type === "prospect") return "Prospect";
  return "leads";
}

function getCompanyCellStyle(type: EntityType): React.CSSProperties {
  const palette: Record<EntityType, React.CSSProperties> = {
    lead: {
      background: "#ffffff",
      color: "#334155",
    },
    prospect: {
      background: "#fef3c7",
      color: "#92400e",
    },
    account: {
      background: "#dcfce7",
      color: "#166534",
    },
  };

  return {
    ...palette[type],
  };
}

function formatDate(value: string | number | Date | null | undefined) {
  return formatLocaleDate(value, undefined, "-");
}

function toLocalDateKey(value: string | number | Date | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDisplayDate(value: string): string {
  if (!value) return "";
  const parts = value.split("-");
  if (parts.length === 3) {
    const [year, month, day] = parts;
    return `${day}/${month}/${year}`;
  }
  return formatLocaleDate(value, undefined, value);
}

function buildPageItems(currentPage: number, totalPages: number): Array<number | "..."> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages = new Set<number>([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);
  const sorted = Array.from(pages)
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((a, b) => a - b);

  const items: Array<number | "..."> = [];
  sorted.forEach((page, index) => {
    if (index > 0 && page - sorted[index - 1] > 1) {
      items.push("...");
    }
    items.push(page);
  });

  return items;
}

function paginationButtonStyle(disabled: boolean, active: boolean): React.CSSProperties {
  return {
    minWidth: 30,
    height: 30,
    borderRadius: 8,
    border: active ? "1px solid #F26522" : "1px solid #d8e1ef",
    background: active ? "#fff7ed" : "#ffffff",
    color: disabled ? "#cbd5e1" : active ? "#c2410c" : "#334155",
    fontWeight: 700,
    fontSize: 12,
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "inherit",
  };
}

const filterFieldWrapStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  minWidth: 0,
};

const filterLabelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "#64748b",
  fontFamily: "inherit",
};

const filterControlStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  maxWidth: "100%",
  border: "1px solid #d8e1ef",
  borderRadius: 10,
  padding: "8px 10px",
  fontSize: 12,
  color: "#0f172a",
  background: "#ffffff",
  outline: "none",
  fontFamily: "inherit",
  boxSizing: "border-box",
};

const filterDateControlStyle: React.CSSProperties = {
  ...filterControlStyle,
  minWidth: 0,
  maxWidth: "100%",
};

function getContactInitials(name: string | null | undefined): string {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (parts.length === 0) return "--";
  return parts
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "11px 12px",
  border: "0.5px solid #1e2b42",
  fontWeight: 700,
  fontSize: "13px",
  backgroundColor: "#202939",
  color: "#ffffff",
  position: "sticky",
  top: 0,
  zIndex: 3,
  fontFamily: "inherit",
  lineHeight: 1.35,
  letterSpacing: "0.2px",
};

const tdStyle: React.CSSProperties = {
  padding: "7px 10px",
  border: "0.5px solid #e6ebf2",
  verticalAlign: "top",
  fontSize: "10.05px",
  fontFamily: "inherit",
  lineHeight: 1.35,
  letterSpacing: "0.2px",
};

const trStyle: React.CSSProperties = {
  transition: "background-color 0.15s ease, box-shadow 0.15s ease",
};

const convertMenuRootStyle: React.CSSProperties = {
  position: "relative",
  display: "inline-flex",
  justifyContent: "center",
  width: "100%",
};

const convertActionButtonStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  padding: "6px 10px",
  borderRadius: 8,
  border: "1px solid #F26522",
  background: "#ffffff",
  color: "#F26522",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "11px",
  fontWeight: 700,
  lineHeight: 1.2,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  whiteSpace: "nowrap",
  boxShadow: "0 1px 2px rgba(37, 89, 211, 0.08)",
  transition:
    "background-color 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease",
};

function getConvertActionButtonStyle(isOpen: boolean): React.CSSProperties {
  return {
    ...convertActionButtonStyle,
    background: "#ffffff",
    color: "#F26522",
    borderColor: "#F26522",
    boxShadow: isOpen
      ? "0 8px 18px rgba(37, 89, 211, 0.2)"
      : "0 1px 2px rgba(37, 89, 211, 0.08)",
  };
}

const convertMenuStyle: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 8px)",
  right: 0,
  minWidth: 190,
  background: "#ffffff",
  border: "1px solid #dbe4f2",
  borderRadius: 12,
  boxShadow: "0 18px 40px rgba(15, 23, 42, 0.16)",
  padding: 8,
  display: "flex",
  flexDirection: "column",
  gap: 6,
  zIndex: 30,
};

const convertMenuItemStyle: React.CSSProperties = {
  border: "none",
  background: "#ffffff",
  color: "#1f2937",
  borderRadius: 9,
  padding: "10px 12px",
  textAlign: "left",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "11px",
  fontWeight: 600,
  whiteSpace: "nowrap",
  transition: "background-color 0.15s ease, color 0.15s ease",
};

function getConvertMenuItemStyle(isHovered: boolean): React.CSSProperties {
  return {
    ...convertMenuItemStyle,
    background: isHovered ? "#eef4ff" : "#ffffff",
    color: isHovered ? "#1d4ed8" : "#1f2937",
  };
}

const deleteActionButtonStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  padding: "6px 10px",
  borderRadius: 8,
  border: "1px solid #ef4444",
  background: "#ffffff",
  color: "#b91c1c",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "11px",
  fontWeight: 700,
  lineHeight: 1.2,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  whiteSpace: "nowrap",
  boxShadow: "0 1px 2px rgba(185, 28, 28, 0.08)",
  transition:
    "background-color 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease, opacity 0.15s ease",
};

function getDeleteActionButtonStyle(isBusy: boolean): React.CSSProperties {
  return {
    ...deleteActionButtonStyle,
    opacity: isBusy ? 0.75 : 1,
    cursor: isBusy ? "not-allowed" : "pointer",
    boxShadow: isBusy
      ? "0 1px 2px rgba(185, 28, 28, 0.08)"
      : "0 4px 10px rgba(185, 28, 28, 0.12)",
  };
}

const convertMenuItemLabelStyle: React.CSSProperties = {
  display: "block",
};
