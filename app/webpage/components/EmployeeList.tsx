"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { formatLocaleDate } from "@/app/utils/dateTime";
import {
  convertLeadDirectToAccountWithExistingFlow,
  convertLeadWithExistingFlow,
} from "../leads/convert-actions";

export type Contact = {
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
  Name?: string | null;
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
  onOpenLeadDetails?: (
    leadId: number | string,
    origin?: DetailsOrigin
  ) => void;
  type: EntityType;
};

type OutreachAnalytics = {
  totalLinkedInRequestsSent: number;
  totalLinkedInRequestsAccepted: number;
  totalEmailsSent: number;
  acceptanceRate: number;
};

export default function EmployeeList({
  employees,
  loading,
  error,
  onAddLead,
  onAddLead2,
  onOpenLeadDetails,
  type,
}: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [openConvertMenuLeadId, setOpenConvertMenuLeadId] = useState<
    number | string | null
  >(null);
  const [hoveredConvertMenuItem, setHoveredConvertMenuItem] = useState<
    string | null
  >(null);
  const showActionsColumn = type !== "account";
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [analytics, setAnalytics] = useState<OutreachAnalytics>({
    totalLinkedInRequestsSent: 0,
    totalLinkedInRequestsAccepted: 0,
    totalEmailsSent: 0,
    acceptanceRate: 0,
  });

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

  const addButtonLabel = useMemo(() => {
    switch (type) {
      case "prospect":
        return "Add Prospect";
      case "account":
        return "Add Customer";
      case "lead":
      default:
        return "Add Lead";
    }
  }, [type]);

  const employeesList: Employee[] = Array.isArray(employees)
    ? employees
    : employees &&
      (employees as any).data &&
      Array.isArray((employees as any).data)
      ? (employees as any).data
      : [];

  const filteredEmployees = useMemo(() => {
    const q = (query || "").toLowerCase();
    const scopedEmployees = employeesList.filter((emp) => {
      const recordType = getRecordType(emp).type;

      if (q && type === "lead") return true;
      if (q && type === "prospect") return recordType !== "lead";

      return recordType === type;
    });

    const filtered = !q
      ? scopedEmployees
      : scopedEmployees.filter((emp) => {
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

    return [...filtered].sort((a, b) => {
      const bTime = getEntryTime(b);
      const aTime = getEntryTime(a);
      const bId = Number(b.LeadId);
      const aId = Number(a.LeadId);

      if (bTime !== aTime) return bTime - aTime;

      if (Number.isFinite(bId) && Number.isFinite(aId)) return bId - aId;

      return String(b.LeadId).localeCompare(String(a.LeadId));
    });
  }, [employeesList, query, type]);

  const outreachKpis = useMemo(
    () => [
      {
        key: "sent",
        label: "LinkedIn Requests Sent",
        value: analytics.totalLinkedInRequestsSent,
        iconBg: "rgba(18, 183, 201, 0.12)",
        iconColor: "#12B7C9",
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
        iconBg: "rgba(31, 58, 104, 0.1)",
        iconColor: "#1F3A68",
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
        iconBg: "rgba(242, 101, 34, 0.14)",
        iconColor: "#F26522",
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
        iconBg: "rgba(15, 31, 61, 0.1)",
        iconColor: "#0F1F3D",
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

  if (error) return <div style={{ color: "red" }}>Error: {error}</div>;

  const baseFontStyles: React.CSSProperties = {
    fontFamily: "var(--font-body)",
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
        boxShadow: "0 12px 28px rgba(15, 31, 61, 0.08)",
        border: "1px solid rgba(31, 58, 104, 0.14)",
        overflow: "hidden",
        height: "100%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        ...baseFontStyles,
      }}
    >
      <div
        style={{
          padding: "14px 18px 10px",
          background: "#ffffff",
          borderBottom: "1px solid rgba(31, 58, 104, 0.14)",
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
                border: "1px solid rgba(31, 58, 104, 0.12)",
                borderRadius: 10,
                padding: "9px 10px",
                display: "flex",
                alignItems: "center",
                gap: 8,
                minHeight: 58,
                background: "linear-gradient(180deg, #ffffff 0%, #fbf8f4 100%)",
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
                    color: "#0F1F3D",
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

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
          padding: "16px",
          flexShrink: 0,
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

          {type === "account" && onAddLead2 && (
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
              Add Lead
            </button>
          )}
        </div>

        <div style={{ position: "relative", display: "inline-block" }}>
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
              width: "350px",
              marginRight: "300px",
              padding: "12px 40px",
              paddingLeft: "45px",
              borderRadius: 10,
              border: isSearchFocused
                ? "1.5px solid #F26522"
                : "1px solid rgba(31, 58, 104, 0.2)",
              boxShadow: isSearchFocused
                ? "0 0 0 3px rgba(242, 101, 34, 0.14)"
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
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overflowX: "auto",
          borderTop: "1px solid rgba(31, 58, 104, 0.12)",
        }}
      >
        <table
          style={{
            width: "100%",
            tableLayout: "fixed",
            borderCollapse:
              "collapse" as unknown as React.CSSProperties["borderCollapse"],
            borderSpacing: 0,
            minWidth: showActionsColumn ? 1040 : 930,
            fontFamily: "inherit",
            fontSize: "inherit",
            lineHeight: 1.35,
            letterSpacing: "0.2px",
            borderStyle: "solid",
            borderWidth: 0,
          }}
        >
          <colgroup>
            <col style={{ width: "13%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "18%" }} />
            <col style={{ width: "29%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "11%" }} />
            {showActionsColumn && <col style={{ width: "11%" }} />}
          </colgroup>

          <thead>
            <tr>
              <th style={thStyle}>Owner</th>
              <th style={thStyle}>Company</th>
              <th style={thStyle}>Contacts</th>
              <th style={thStyle}>Source</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Date of Entry</th>
              {showActionsColumn && <th style={thStyle}>Actions</th>}
            </tr>
          </thead>

          <tbody>
            {filteredEmployees.map((emp, idx) => {
              const rowStyle: React.CSSProperties = {
                ...trStyle,
                backgroundColor: idx % 2 === 0 ? "#ffffff" : "#fbf8f4",
              };
              const statusText = emp.StatusName?.trim() || "";
              const latestActivityNote = emp.LatestActivityNotes?.trim() || "";
              const recordType = getRecordType(emp);
              const convertOrigin = getDetailsOrigin(recordType.type);
              const companyName = emp.CompanyName?.trim() || "-";

              return (
                <tr
                  key={emp.LeadId}
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
                    {emp.Contacts && emp.Contacts.length > 0 ? (
                      <>
                        {emp.Contacts.slice(0, 2).map((c, index) => (
                          <div
                            key={index}
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
                                <Image
                                  src="/email.png"
                                  alt="email"
                                  width={11}
                                  height={11}
                                />

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
                                  <Image
                                    src="/call.png"
                                    alt="call"
                                    width={10}
                                    height={10}
                                  />
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
                              color: "#F26522",
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
                    )}
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
                            border: "1px solid rgba(31, 58, 104, 0.18)",
                            background: "rgba(31, 58, 104, 0.08)",
                            color: "#1F3A68",
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
                    <div style={{ fontSize: "inherit" }}>
                      {formatDate(emp.CreatedOn ?? emp.LeadDate)}
                    </div>
                  </td>

                  {showActionsColumn && (
                    <td
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        ...tdStyle,
                        textAlign: "center",
                        verticalAlign: "middle",
                        position: "relative",
                      }}
                    >
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
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

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

function getEntryTime(emp: Employee): number {
  const value = emp.CreatedOn ?? emp.LeadDate;
  if (value == null || value === "") return 0;

  const time =
    value instanceof Date
      ? value.getTime()
      : typeof value === "number"
        ? new Date(value).getTime()
        : Date.parse(String(value));

  return Number.isFinite(time) ? time : 0;
}

function getCompanyCellStyle(type: EntityType): React.CSSProperties {
  const palette: Record<EntityType, React.CSSProperties> = {
    lead: {
      background: "#ffffff",
      color: "#1F3A68",
    },
    prospect: {
      background: "rgba(242, 101, 34, 0.12)",
      color: "#9B3F14",
    },
    account: {
      background: "rgba(18, 183, 201, 0.12)",
      color: "#0A6570",
    },
  };

  return {
    ...palette[type],
  };
}

function formatDate(value: string | number | Date | null | undefined) {
  return formatLocaleDate(value, undefined, "-");
}

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "11px 12px",
  border: "0.5px solid rgba(248, 244, 239, 0.12)",
  fontWeight: 700,
  fontSize: "13px",
  backgroundColor: "#0F1F3D",
  color: "#ffffff",
  position: "sticky",
  top: 0,
  zIndex: 1,
  fontFamily: "inherit",
  lineHeight: 1.35,
  letterSpacing: "0.2px",
};

const tdStyle: React.CSSProperties = {
  padding: "7px 10px",
  border: "0.5px solid rgba(31, 58, 104, 0.12)",
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
  border: "1px solid rgba(242, 101, 34, 0.24)",
  background: "rgba(242, 101, 34, 0.08)",
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
  boxShadow: "0 1px 2px rgba(242, 101, 34, 0.08)",
  transition:
    "background-color 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease",
};

function getConvertActionButtonStyle(isOpen: boolean): React.CSSProperties {
  return {
    ...convertActionButtonStyle,
    background: isOpen ? "#F26522" : "rgba(242, 101, 34, 0.08)",
    color: isOpen ? "#ffffff" : "#F26522",
    borderColor: isOpen ? "#F26522" : "rgba(242, 101, 34, 0.24)",
    boxShadow: isOpen
      ? "0 8px 18px rgba(242, 101, 34, 0.22)"
      : "0 1px 2px rgba(242, 101, 34, 0.08)",
  };
}

const convertMenuStyle: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 8px)",
  right: 0,
  minWidth: 190,
  background: "#ffffff",
  border: "1px solid rgba(31, 58, 104, 0.16)",
  borderRadius: 12,
  boxShadow: "0 18px 40px rgba(15, 31, 61, 0.16)",
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
    background: isHovered ? "rgba(242, 101, 34, 0.09)" : "#ffffff",
    color: isHovered ? "#F26522" : "#1f2937",
  };
}

const convertMenuItemLabelStyle: React.CSSProperties = {
  display: "block",
};
