"use client";
import React, { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

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
  LeadNotes: string | null;
  StatusName: string | null;
  OwnerName: string | null;
  Contacts: Contact[];
};

type EntityType = "lead" | "prospect" | "account";

type Props = {
  employees: Employee[] | null | undefined;
  loading?: boolean;
  error?: string | null;
  onDelete?: (leadId: number | string) => void;
  onAddLead: () => void;
  onAddLead2?: () => void;
  onOpenLeadDetails?: (leadId: number | string) => void;
  type: EntityType;

};

export default function EmployeeList({
  employees,
  loading,
  error,
  onDelete,
  onAddLead,
  onAddLead2,
  onOpenLeadDetails,
  type,
}: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [isSearchFocused, setIsSearchFocused] = useState(false);

  const addButtonLabel = useMemo(() => {
    switch (type) {
      case "prospect":
        return "Add Prospect";
      case "account":
        return "Add Account";
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
    if (!q) return employeesList;
    return employeesList.filter((emp) => {
      const haystack = [
        emp.CompanyName,
        emp.CompanyLocation,
        emp.LeadSource,
        emp.StatusName,
        emp.OwnerName,
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
  }, [employeesList, query]);

  if (error) return <div style={{ color: "red" }}>Error: {error}</div>;
  // if (employeesList.length === 0) return <div>No leads found.</div>;

  const baseFontStyles: React.CSSProperties = {
    fontFamily: "Open Sans, sans-serif",
    fontSize: "9.px",
    lineHeight: 1.35,
    letterSpacing: "0.2px",
    WebkitFontSmoothing: "antialiased",
    MozOsxFontSmoothing: "grayscale",
  };

  return (
    <div
      style={{
        // marginTop: 40,
        background: "#ffffff",
        borderRadius: 4,
        boxShadow: "0 0 4px rgba(0,0,0,0.08)",
        overflow: "hidden",
        ...baseFontStyles,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
          padding: "16px",
        }}
      >
        <div style={{ display: "flex", gap: "10px" }}>
          {/* Primary Add button (based on type) */}
          <button
            onClick={onAddLead}
            style={{
              background: "#3a77e3",
              color: "white",
              padding: "7px 12px",
              border: "none",
              borderRadius: 6,
              fontSize: "10.05px",
              cursor: "pointer",
              fontWeight: "700",
              fontFamily: "inherit",
            }}
          >
            {addButtonLabel}
          </button>

          {/* EXTRA Add Lead button ONLY for Accounts */}
          {type === "account" && onAddLead2 && (
            <button
              onClick={() => onAddLead2()}
              style={{
                background: "#3a77e3",
                color: "white",
                padding: "7px 12px",
                border: "none",
                borderRadius: 6,
                fontSize: "10.05px",
                cursor: "pointer",
                fontWeight: "700",
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
            placeholder="Search leads by company, contact, email, source, status, owner..."
            style={{
              width: "350px",
              marginRight: "300px",
              padding: "13px 40px",
              paddingLeft: "45px",
              borderRadius: 6,
              border: isSearchFocused
                ? "1.5px solid #4a90e2"
                : "1px solid #d1d5db",
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

      <div style={{ maxHeight: 420, overflowY: "auto", overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
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
          <thead>
            <tr>
              <th style={{ ...thStyle, width: 90 }}>Company</th>
              <th style={{ ...thStyle, width: 200 }}>Contacts</th>
              <th style={{ ...thStyle, width: 380 }}>Source</th>
              <th style={thStyle}>Status</th>
              <th style={{ ...thStyle, width: 20 }}>Info</th>
              <th style={{ ...thStyle, width: 150 }}>Owner</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>

          <tbody>
            {filteredEmployees.map((emp, idx) => {
              const rowStyle: React.CSSProperties = {
                ...trStyle,
                backgroundColor: idx % 2 === 0 ? "#ffffff" : "#f7f8fb",
              };

              return (
                <tr
                  key={emp.LeadId}
                  onDoubleClick={() => onOpenLeadDetails?.(emp.LeadId)}
                  style={{
                    cursor: "pointer",
                  }}
                >
                  <td style={{ ...tdStyle, verticalAlign: "middle" }}>
                    {emp.CompanyName && emp.CompanyName.trim() !== "" && (
                      <div
                        style={{
                          fontWeight: 700,
                          fontSize: "inherit",
                          lineHeight: "inherit",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          maxWidth: "90px",
                        }}
                        title={emp.CompanyName}
                      >
                        {emp.CompanyName}
                      </div>
                    )}

                    {emp.CompanyLocation && (
                      <div
                        style={{
                          color: "#6c7293",
                          // marginTop: 6,
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
                      emp.Contacts.map((c, index) => (
                        <div
                          key={index}
                          style={{
                            padding: "2px 0",
                            borderBottom:
                              index !== emp.Contacts.length - 1
                                ? "0.5px solid #e0e0e0"
                                : "none",
                            width: "100%",
                            margin: 0,
                            display: "block",
                          }}
                        >
                          <div
                            title="Double click to open details"
                            style={{
                              fontWeight: 700,
                              color: "#212529",
                              fontSize: "inherit",
                              lineHeight: "inherit",
                              marginBottom: 0,
                            }}
                          >
                            {c.ContactName || "—"}
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

                          {/* Title */}
                          {c.ContactTitle && c.ContactTitle.trim() !== "" && (
                            <div
                              style={{
                                marginBottom: 0,
                                maxWidth: "150px",
                                /* truncation: single-line ellipsis, no column width change */
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                display: "block",
                                fontWeight: 600,
                                color: "#6c7293",
                                // marginTop: 2,
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
                                style={{
                                  color: "#6c7293",
                                  textDecoration: "none",
                                  fontSize: "inherit",
                                  lineHeight: "inherit",
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
                      ))
                    ) : (
                      <span>—</span>
                    )}
                  </td>

                  <td style={{ ...tdStyle, verticalAlign: "middle" }}>
                    <div style={{ color: "#212529", fontSize: "9.88px" }}>
                      {emp.LeadSource || "—"}
                    </div>
                  </td>

                  <td style={{ ...tdStyle, verticalAlign: "middle" }}>
                    {emp.StatusName ? (
                      <span
                        style={{
                          display: "inline-block",
                          padding: "4px 10px",
                          borderRadius: 12,
                          color: "#212529",
                          fontSize: "inherit",
                          fontWeight: 700,
                          textTransform: "uppercase",
                          lineHeight: "inherit",
                        }}
                      >
                        {emp.StatusName}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>

                  <td style={{ ...tdStyle, verticalAlign: "middle" }}>
                    {/* Date */}
                    <div style={{ fontSize: "inherit", marginBottom: 4 }}>
                      <span style={{ fontWeight: 700 }}>Date: </span>
                      {formatDate(emp.LeadDate)}
                    </div>

                    {/* Notes with partial text + ellipsis + hover full text */}
                    {emp.LeadNotes && emp.LeadNotes.trim() !== "" && (
                      <div
                        style={{
                          fontSize: "inherit",
                          maxWidth: "150px",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                        title={emp.LeadNotes}
                      >
                        <span style={{ fontWeight: 700 }}>Notes: </span>
                        {emp.LeadNotes}
                      </div>
                    )}
                  </td>

                  <td style={{ ...tdStyle, verticalAlign: "middle" }}>
                    <div style={{ fontSize: "inherit" }}>
                      {emp.OwnerName || "—"}
                    </div>
                  </td>

                  <td
                    onDoubleClick={(e) => e.stopPropagation()}
                    style={{
                      ...tdStyle,
                      textAlign: "center",
                      verticalAlign: "middle",
                      width: 30,
                    }}
                  >
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete && onDelete(emp.LeadId);
                      }}
                      style={{
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        padding: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: "100%",
                        height: "100%",
                        fontFamily: "inherit",
                        fontSize: "inherit",
                      }}
                    >
                      <Image
                        src="/delete.png"
                        alt="delete"
                        width={18}
                        height={18}
                      />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatDate(value: string | number | Date) {
  if (!value && value !== 0) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString();
}

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 12px",
  border: "0.5px solid #d0d0d0",
  fontWeight: "bold",
  fontSize: "13px",
  backgroundColor: "#252b36",
  color: "#ffffff",
  position: "sticky",
  top: 0,
  zIndex: 1,
  fontFamily: "inherit",
  lineHeight: 1.35,
  letterSpacing: "0.2px",
};

const tdStyle: React.CSSProperties = {
  padding: "2px 8px",
  border: "0.5px solid #dcdcdc",
  verticalAlign: "top",
  fontSize: "10.05px",
  fontFamily: "inherit",
  lineHeight: 1.35,
  letterSpacing: "0.2px",
};

const trStyle: React.CSSProperties = {
  transition: "background-color 0.15s ease",
};
