"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Contact = {
  ContactName?: string;
  ContactEmail?: string;
  ContactTitle?: string;
  ContactRoleName?: string;
  ContactPhone?: string;
  LinkedInProfile?: string;
  LinkedInRequestSent?: boolean;
  LinkedInRequestAccepted?: boolean;
  EmailSent?: boolean;
};

type Lead = {
  LeadId?: number | string;
  CompanyName?: string;
  CompanyLocation?: string;
  OwnerName?: string;
  StatusName?: string;
  LeadNotes?: string | null;
  LeadDate?: string | number | Date;
  LeadSource?: string;
  Contacts?: Contact[];
  Activities?: any[];
  Reminders?: any[];
  Opportunities?: any[];
  ExpansionAreas?: string;
  Tags?: string;
   IndustryFocus?: string;
};

export type EditLeadProps = {
  leadId?: string | number | null;
  origin?: "leads" | "Prospect" | "Account" | null;
  onBack?: () => void;
};

export default function EditLeadClient({
  leadId: propLeadId,
  origin,
  onBack,
}: EditLeadProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const leadIdFromQuery =
    typeof searchParams?.get === "function" ? searchParams.get("leadId") : null;
  const effectiveLeadId = propLeadId ?? leadIdFromQuery ?? null;

  const [loading, setLoading] = useState<boolean>(!!effectiveLeadId);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // initial empty state (will be populated by fetch if leadId exists)
  const emptyLead: Lead = {
    CompanyName: "",
    CompanyLocation: "",
    LeadSource: "",
    LeadDate: "",
    OwnerName: "",
    StatusName: "",
    Contacts: [
      {
        ContactName: "",
        ContactEmail: "",
        ContactTitle: "",
        ContactRoleName: "Decision Maker",
        ContactPhone: "",
      },
    ],
    LeadNotes: "",
    ExpansionAreas: "",
    Tags: "",
  };

  const [lead, setLead] = useState<Lead>(emptyLead);
  const [originalLead, setOriginalLead] = useState<Lead | null>(null);
  const [contactSearch, setContactSearch] = useState<string>("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedContactIndex, setSelectedContactIndex] = useState<number>(0);
  const [expandedSections, setExpandedSections] = useState<{
    basic: boolean;
    outreach: boolean;
    role: boolean;
  }>({ basic: true, outreach: true, role: true });

  // Fetch lead details when effectiveLeadId changes
  useEffect(() => {
    let cancelled = false;

    const loadLead = async () => {
      if (!effectiveLeadId) {
        // no id -> keep empty form
        setLoading(false);
        setError(null);
        setLead(emptyLead);
        setOriginalLead(null);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        // Try single-item endpoint first
        const res = await fetch(
          `/api/employees/leads/${encodeURIComponent(String(effectiveLeadId))}`
        );

        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            const normalized = normalizeLead(data);
            setLead(normalized);
            setOriginalLead(JSON.parse(JSON.stringify(normalized)));
          }
        } else {
          // fallback to fetching all and finding by ID
          const allRes = await fetch("/api/employees/leads");
          if (!allRes.ok) throw new Error("Failed to fetch leads");
          const allData = await allRes.json();
          const array = Array.isArray(allData)
            ? allData
            : allData?.data && Array.isArray(allData.data)
            ? allData.data
            : [];
          const found = array.find(
            (x: any) => String(x.LeadId) === String(effectiveLeadId)
          );
          if (!found) throw new Error("Lead not found");
          if (!cancelled) {
            const normalized = normalizeLead(found);
            setLead(normalized);
            setOriginalLead(JSON.parse(JSON.stringify(normalized)));
          }
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "Failed to load lead");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadLead();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveLeadId]);

  // small normalizer to ensure arrays exist
  function normalizeLead(data: any): Lead {
    return {
      LeadId: data?.LeadId ?? data?.leadId ?? null,
      CompanyName: data?.CompanyName ?? data?.Company ?? "",
      CompanyLocation: data?.CompanyLocation ?? data?.Location ?? "",
      IndustryFocus: data?.IndustryFocus ?? "",
      LeadSource: data?.LeadSource ?? data?.Source ?? "",
      LeadDate: data?.LeadDate ?? data?.Date ?? "",
      OwnerName: data?.OwnerName ?? data?.Owner ?? "",
      StatusName: data?.StatusName ?? data?.Status ?? "",
      Contacts: Array.isArray(data?.Contacts)
        ? data.Contacts
        : data?.contacts ?? [],
      LeadNotes: data?.LeadNotes ?? data?.Notes ?? "",
      ExpansionAreas: data?.ExpansionAreas ?? "",
      Tags: data?.Tags ?? "",
      Activities: data?.Activities ?? [],
      Reminders: data?.Reminders ?? [],
      Opportunities: data?.Opportunities ?? [],
    } as Lead;
  }

  // update helpers
  const updateField = (field: keyof Lead, value: any) => {
    setLead((prev) => ({ ...prev, [field]: value }));
  };

  const updateContact = (index: number, field: keyof Contact, value: any) => {
    setLead((prev) => {
      const contacts = Array.isArray(prev.Contacts) ? [...prev.Contacts] : [];
      contacts[index] = { ...(contacts[index] ?? {}), [field]: value };
      return { ...prev, Contacts: contacts };
    });
  };

  const addContact = () => {
    setLead((prev) => {
      const existing = Array.isArray(prev.Contacts) ? prev.Contacts : [];
      const nextContacts = [
        ...existing,
        {
          ContactName: "",
          ContactEmail: "",
          ContactTitle: "",
          ContactRoleName: "Decision Maker",
          ContactPhone: "",
        },
      ];
      setSelectedContactIndex(nextContacts.length - 1);
      return {
        ...prev,
        Contacts: nextContacts,
      };
    });
  };

  const removeContact = (index: number) => {
    setLead((prev) => {
      const contacts = Array.isArray(prev.Contacts) ? [...prev.Contacts] : [];
      contacts.splice(index, 1);
      if (contacts.length === 0) {
        setSelectedContactIndex(-1);
      } else if (selectedContactIndex >= contacts.length) {
        setSelectedContactIndex(contacts.length - 1);
      }
      return { ...prev, Contacts: contacts };
    });
  };

  const contacts = Array.isArray(lead.Contacts) ? lead.Contacts : [];

  const filteredContactIndices = useMemo(() => {
    return contacts
      .map((c, idx) => ({ c, idx }))
      .filter(({ c }) => {
        const haystack = [
          c?.ContactName,
          c?.ContactEmail,
          c?.ContactPhone,
          c?.ContactTitle,
          c?.ContactRoleName,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        const matchesSearch =
          !contactSearch || haystack.includes(contactSearch.toLowerCase());
        const matchesRole =
          roleFilter === "all" ||
          (c?.ContactRoleName ?? "Decision Maker") === roleFilter;

        const statusValue = c?.EmailSent
          ? "email"
          : c?.LinkedInRequestAccepted
          ? "linkedinAccepted"
          : c?.LinkedInRequestSent
          ? "linkedinSent"
          : "notStarted";
        const matchesStatus = statusFilter === "all" || statusValue === statusFilter;

        return matchesSearch && matchesRole && matchesStatus;
      })
      .map(({ idx }) => idx);
  }, [contacts, contactSearch, roleFilter, statusFilter]);

  const selectedContact: Contact | null =
    selectedContactIndex >= 0 && selectedContactIndex < contacts.length
      ? contacts[selectedContactIndex]
      : null;

  useEffect(() => {
    if (contacts.length === 0) {
      setSelectedContactIndex(-1);
      return;
    }

    if (selectedContactIndex < 0 || selectedContactIndex >= contacts.length) {
      setSelectedContactIndex(0);
    }
  }, [contacts.length, selectedContactIndex]);

  // isDirty for save button (simple deep compare)
  const isDirty = useMemo(() => {
    try {
      return JSON.stringify(lead) !== JSON.stringify(originalLead ?? {});
    } catch {
      return true;
    }
  }, [lead, originalLead]);

  // save (PUT if id exists else POST)
  const saveChanges = async () => {
    setSaving(true);
    setError(null);
    try {
      const hasId = !!(effectiveLeadId ?? lead.LeadId);
      const url = hasId
        ? `/api/employees/leads/${encodeURIComponent(
            String(effectiveLeadId ?? lead.LeadId)
          )}`
        : `/api/employees/leads`;
      const method = hasId ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lead),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Save failed: ${res.status} ${text}`);
      }

      const saved = await res.json();
      // update original snapshot and lead (in case API returns normalized object)
      const normalized = normalizeLead(saved ?? lead);
      setLead(normalized);
      setOriginalLead(normalized);
      alert("Saved successfully");
      // navigate back or to list if you want
      if (onBack) onBack();
      else router.push("/webpage?tab=leads");
    } catch (err: any) {
      setError(err?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  // Simple loading / error UI
  if (loading) return <div style={{ padding: 20 }}>Loading lead…</div>;
  if (error)
    return (
      <div style={{ padding: 20 }}>
        <div style={{ marginBottom: 12, color: "red" }}>{error}</div>
        <button onClick={() => (onBack ? onBack() : router.back())}>
          Back
        </button>
      </div>
    );

  // ----------- styles (kept from your UI) -----------

  const cardStyle: React.CSSProperties = {
    background: "#fff",
    padding: 22,
    borderRadius: 12,
    marginBottom: 20,
    border: "1px solid rgba(31, 58, 104, 0.14)",
    boxShadow: "0 10px 24px rgba(15, 31, 61, 0.08)",
  };

  const labelStyle: React.CSSProperties = {
    fontWeight: 600,
    marginBottom: 6,
    display: "block",
    color: "#1F3A68",
    fontSize: 13,
  };
  const rowStyle: React.CSSProperties = {
    display: "flex",
    gap: 20,
    marginBottom: 14,
    alignItems: "flex-start",
    flexWrap: "wrap",
  };
  const inputCommon: React.CSSProperties = {
    width: "100%",
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid rgba(31, 58, 104, 0.2)",
    boxSizing: "border-box",
    fontSize: 14,
    background: "#fff",
  };
  const selectCommon: React.CSSProperties = {
    ...inputCommon,
    appearance: "none",
  };

  const actionDockVisible = isDirty || saving;

  const sectionToggleButton: React.CSSProperties = {
    border: "none",
    background: "transparent",
    cursor: "pointer",
    fontWeight: 700,
    color: "#0f172a",
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: 0,
  };

  // ----------- render form populated from `lead` -----------
  return (
    <div
      style={{
        padding: 28,
        maxWidth: 1100,
        margin: "auto",
        paddingBottom: 28,
      }}
    >
      <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}>
       <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 10 }}>
        Edit Lead - {lead.CompanyName}
       </h2>
        <button
        onClick={onBack}
        style={{
          background: "#F26522",
          color: "white",
          padding: "9px 16px",
          borderRadius: 8,
          border: "none",
          cursor: "pointer",
          fontSize: 14,
          fontWeight: 600,
          boxShadow: "0 6px 14px rgba(242, 101, 34, 0.25)",
        }}
      >
        ← Back
      </button>
      </div>
      
       <hr style={{ marginBottom: 20, border: "1px solid #F26522" }} />
     
      {/* Company Information */}
      <section style={cardStyle}>
        <h3
          style={{
            fontSize: 18,
            fontWeight: 700,
            marginBottom: 10,
            borderBottom: "1px solid #e6e6e6",
            paddingBottom: 10,
          }}
        >
          Company Information
        </h3>

        <div style={rowStyle}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Company Name</label>
            <input
              style={inputCommon}
              value={lead.CompanyName}
              onChange={(e) => updateField("CompanyName", e.target.value)}
            />
          </div>

          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Location</label>
            <input
              style={inputCommon}
              value={lead.CompanyLocation ?? ""}
              onChange={(e) => updateField("CompanyLocation", e.target.value)}
              placeholder="Location"
            />
          </div>
        </div>

        <div style={{ flex: 1 }}>
  <label style={labelStyle}>Industry Focus</label>
  <input
    style={inputCommon}
    value={lead.IndustryFocus ?? ""}
    onChange={(e) => updateField("IndustryFocus", e.target.value)}
    placeholder="e.g., Healthcare, Fintech"
  />
</div>

        <div style={rowStyle}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Lead Source</label>
            <input
              style={inputCommon}
              value={lead.LeadSource ?? ""}
              onChange={(e) => updateField("LeadSource", e.target.value)}
              placeholder="Lead source"
            />
          </div>

          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Lead Date</label>
            <input
              type="date"
              style={inputCommon}
              value={
                lead.LeadDate ? String(lead.LeadDate).substring(0, 10) : ""
              }
              onChange={(e) => updateField("LeadDate", e.target.value)}
            />
          </div>
        </div>

        <div style={rowStyle}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Owner</label>
            <input
              style={inputCommon}
              value={lead.OwnerName ?? ""}
              onChange={(e) => updateField("OwnerName", e.target.value)}
              placeholder="Owner"
            />
          </div>

          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Status</label>
            <input
              style={{ ...inputCommon, background: "#f8fafc", color: "#475569" }}
              value={lead.StatusName ?? ""}
              readOnly
              placeholder="Latest activity status"
            />
          </div>
        </div>
      </section>

      {/*  CONTACT INFORMATION */}
      <section style={cardStyle}>
        <h3
          style={{
            fontSize: 18,
            fontWeight: 700,
            marginBottom: 14,
            borderBottom: "1px solid #e6e6e6",
            paddingBottom: 10,
          }}
        >
          Contact Workspace ({contacts.length})
        </h3>

        <div
          style={{
            background: "#fff",
            padding: 12,
            border: "1px solid #e7edf6",
            borderRadius: 10,
            marginBottom: 14,
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <input
            style={{ ...inputCommon, flex: "1 1 240px", margin: 0 }}
            placeholder="Search contacts by name, email, title, phone"
            value={contactSearch}
            onChange={(e) => setContactSearch(e.target.value)}
            aria-label="Search contacts"
          />

          <select
            style={{ ...selectCommon, flex: "0 0 170px" }}
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            aria-label="Filter contacts by role"
          >
            <option value="all">All roles</option>
            <option value="Decision Maker">Decision Maker</option>
            <option value="Influencer">Influencer</option>
            <option value="Technical">Technical</option>
            <option value="Finance">Finance</option>
          </select>

          <select
            style={{ ...selectCommon, flex: "0 0 190px" }}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter contacts by outreach status"
          >
            <option value="all">All outreach status</option>
            <option value="notStarted">Not started</option>
            <option value="linkedinSent">LinkedIn request sent</option>
            <option value="linkedinAccepted">LinkedIn accepted</option>
            <option value="email">Email sent</option>
          </select>

          <button
            onClick={addContact}
            style={{
              padding: "10px 14px",
              background: "#F26522",
              border: "none",
              color: "#fff",
              borderRadius: 8,
              cursor: "pointer",
              fontWeight: 700,
              boxShadow: "0 6px 14px rgba(242, 101, 34, 0.24)",
            }}
          >
            + Add Contact
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(260px, 34%) minmax(0, 66%)",
            gap: 14,
          }}
        >
          <aside
            style={{
              border: "1px solid #e7edf6",
              borderRadius: 10,
              maxHeight: 540,
              overflowY: "auto",
              background: "#fcfdff",
            }}
            aria-label="Contact list"
          >
            {filteredContactIndices.length === 0 ? (
              <div style={{ padding: 16, color: "#64748b", fontSize: 14 }}>
                No contacts match your search/filter.
              </div>
            ) : (
              filteredContactIndices.map((contactIndex) => {
                const c = contacts[contactIndex];
                const isSelected = contactIndex === selectedContactIndex;
                const title = c?.ContactTitle || "No title";
                const name = c?.ContactName || `Contact ${contactIndex + 1}`;
                return (
                  <button
                    key={contactIndex}
                    onClick={() => setSelectedContactIndex(contactIndex)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      border: "none",
                      cursor: "pointer",
                      borderBottom: "1px solid #edf2fb",
                      background: isSelected ? "rgba(242, 101, 34, 0.08)" : "transparent",
                      padding: "12px 14px",
                    }}
                    aria-current={isSelected ? "true" : undefined}
                  >
                    <div style={{ fontWeight: 700, color: "#0f172a" }}>{name}</div>
                    <div style={{ fontSize: 13, color: "#475569", marginTop: 3 }}>
                      {title}
                    </div>
                    <div style={{ fontSize: 12, color: "#64748b", marginTop: 3 }}>
                      {c?.ContactEmail || "No email"}
                    </div>
                  </button>
                );
              })
            )}
          </aside>

          <div
            style={{
              border: "1px solid #e7edf6",
              borderRadius: 10,
              padding: 16,
              background: "#fff",
              minHeight: 300,
            }}
          >
            {!selectedContact ? (
              <div style={{ color: "#64748b", fontSize: 14 }}>
                Select a contact from the list to edit details.
              </div>
            ) : (
              <>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 12,
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>
                      {selectedContact.ContactName ||
                        `Contact ${selectedContactIndex + 1}`}
                    </div>
                    <div style={{ color: "#64748b", fontSize: 13 }}>
                      Quick edit panel
                    </div>
                  </div>
                  <button
                    onClick={() => removeContact(selectedContactIndex)}
                    style={{
                      background: "#dc2626",
                      color: "#fff",
                      border: "none",
                      padding: "8px 12px",
                      borderRadius: 18,
                      cursor: "pointer",
                      fontSize: 13,
                      fontWeight: 700,
                    }}
                    aria-label={`Remove contact ${selectedContactIndex + 1}`}
                  >
                    Remove
                  </button>
                </div>

                <div style={{ marginBottom: 14 }}>
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedSections((prev) => ({ ...prev, basic: !prev.basic }))
                    }
                    style={sectionToggleButton}
                  >
                    <span>{expandedSections.basic ? "▾" : "▸"}</span> Basic Info
                  </button>
                  {expandedSections.basic && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
                        <div style={{ flex: 1, minWidth: 220 }}>
                          <label style={{ ...labelStyle, fontWeight: 600 }}>Name</label>
                          <input
                            style={inputCommon}
                            value={selectedContact.ContactName ?? ""}
                            onChange={(e) =>
                              updateContact(
                                selectedContactIndex,
                                "ContactName",
                                e.target.value
                              )
                            }
                            placeholder="Full name"
                          />
                        </div>
                        <div style={{ flex: 1, minWidth: 220 }}>
                          <label style={{ ...labelStyle, fontWeight: 600 }}>Title</label>
                          <input
                            style={inputCommon}
                            value={selectedContact.ContactTitle ?? ""}
                            onChange={(e) =>
                              updateContact(
                                selectedContactIndex,
                                "ContactTitle",
                                e.target.value
                              )
                            }
                            placeholder="Job title"
                          />
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
                        <div style={{ flex: 1, minWidth: 220 }}>
                          <label style={{ ...labelStyle, fontWeight: 600 }}>Email</label>
                          <input
                            style={inputCommon}
                            value={selectedContact.ContactEmail ?? ""}
                            onChange={(e) =>
                              updateContact(
                                selectedContactIndex,
                                "ContactEmail",
                                e.target.value
                              )
                            }
                            placeholder="email@example.com"
                          />
                        </div>
                        <div style={{ flex: 1, minWidth: 220 }}>
                          <label style={{ ...labelStyle, fontWeight: 600 }}>Phone</label>
                          <input
                            style={inputCommon}
                            value={selectedContact.ContactPhone ?? ""}
                            onChange={(e) =>
                              updateContact(
                                selectedContactIndex,
                                "ContactPhone",
                                e.target.value
                              )
                            }
                            placeholder="Enter phone number"
                          />
                        </div>
                      </div>

                      <label style={{ ...labelStyle, fontWeight: 600 }}>LinkedIn URL</label>
                      <input
                        style={inputCommon}
                        value={selectedContact.LinkedInProfile ?? ""}
                        onChange={(e) =>
                          updateContact(
                            selectedContactIndex,
                            "LinkedInProfile",
                            e.target.value
                          )
                        }
                        placeholder="https://linkedin.com/in/..."
                      />
                    </div>
                  )}
                </div>

                <div style={{ marginBottom: 14 }}>
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedSections((prev) => ({
                        ...prev,
                        outreach: !prev.outreach,
                      }))
                    }
                    style={sectionToggleButton}
                  >
                    <span>{expandedSections.outreach ? "▾" : "▸"}</span> Outreach
                    Status
                  </button>
                  {expandedSections.outreach && (
                    <div
                      style={{
                        display: "flex",
                        gap: 24,
                        marginTop: 10,
                        flexWrap: "wrap",
                      }}
                    >
                      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={!!selectedContact.LinkedInRequestSent}
                          onChange={(e) =>
                            updateContact(
                              selectedContactIndex,
                              "LinkedInRequestSent",
                              e.target.checked
                            )
                          }
                        />
                        <span>LinkedIn Request Sent</span>
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={!!selectedContact.LinkedInRequestAccepted}
                          onChange={(e) =>
                            updateContact(
                              selectedContactIndex,
                              "LinkedInRequestAccepted",
                              e.target.checked
                            )
                          }
                        />
                        <span>LinkedIn Request Accepted</span>
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={!!selectedContact.EmailSent}
                          onChange={(e) =>
                            updateContact(
                              selectedContactIndex,
                              "EmailSent",
                              e.target.checked
                            )
                          }
                        />
                        <span>Email Sent</span>
                      </label>
                    </div>
                  )}
                </div>

                <div>
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedSections((prev) => ({ ...prev, role: !prev.role }))
                    }
                    style={sectionToggleButton}
                  >
                    <span>{expandedSections.role ? "▾" : "▸"}</span> Contact Role
                  </button>
                  {expandedSections.role && (
                    <div style={{ marginTop: 10 }}>
                      <label style={{ ...labelStyle, fontWeight: 600 }}>Role</label>
                      <select
                        style={{ ...selectCommon, padding: "12px 14px", maxWidth: 260 }}
                        value={selectedContact.ContactRoleName ?? "Decision Maker"}
                        onChange={(e) =>
                          updateContact(
                            selectedContactIndex,
                            "ContactRoleName",
                            e.target.value
                          )
                        }
                      >
                        <option>Decision Maker</option>
                        <option>Influencer</option>
                        <option>Technical</option>
                        <option>Finance</option>
                      </select>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Additional Information */}
      <section
        style={{
          borderRadius: 10,
          marginBottom: 20,
          border: "1px solid #e7edf6",
          overflow: "hidden",
          boxShadow: "0 8px 18px rgba(15, 23, 42, 0.05)",
        }}
      >
        <div
          style={{
            padding: "14px 20px",
            background: "#fafafa",
            borderBottom: "1px solid #ececec",
          }}
        >
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
            Additional Information
          </h3>
        </div>

        <div style={{ padding: 18 }}>
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Notes</label>
            <textarea
              style={{
                width: "100%",
                minHeight: 86,
                padding: "12px 14px",
                borderRadius: 6,
                border: "1px solid #e0e3e6",
                resize: "vertical",
                fontSize: 14,
                boxSizing: "border-box",
                background: "#fff",
              }}
              value={lead.LeadNotes ?? ""}
              onChange={(e) => updateField("LeadNotes", e.target.value)}
              placeholder="Notes"
            />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Expansion Areas</label>
            <input
              style={{
                ...inputCommon,
                border: "1px solid #e0e3e6",
                background: "#fff",
              }}
              value={lead.ExpansionAreas ?? ""}
              onChange={(e) => updateField("ExpansionAreas", e.target.value)}
              placeholder="Enter expansion areas"
            />
          </div>

          <div>
            <label style={labelStyle}>Tags</label>
            <input
              style={{
                ...inputCommon,
                border: "1px solid #e0e3e6",
                background: "#fff",
              }}
              value={lead.Tags ?? ""}
              onChange={(e) => updateField("Tags", e.target.value)}
              placeholder="Enter tags (comma separated)"
            />
          </div>
        </div>
      </section>

      <div
        style={{ height: 1, background: "#ececec", margin: "8px 0 18px 0" }}
      />

      {/* Inline status when there are no pending changes */}
      {!actionDockVisible && (
        <div
          role="status"
          aria-live="polite"
          style={{
            display: "flex",
            justifyContent: "flex-end",
            color: "#64748b",
            fontSize: 13,
            paddingBottom: 8,
          }}
        >
          All changes saved
        </div>
      )}

      {/* Footer action bar: inline, non-sticky, attached to form flow */}
      <div aria-live="polite" style={{ marginTop: 10 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            background: "#ffffff",
            border: "1px solid #d8e1ef",
            borderRadius: 12,
            padding: 12,
            boxShadow: "0 4px 12px rgba(15, 23, 42, 0.04)",
          }}
        >
          <div
            style={{
              fontSize: 13,
              color: "#475569",
              display: "flex",
              alignItems: "center",
              fontWeight: 600,
              minHeight: 40,
            }}
          >
            {saving
              ? "Saving changes…"
              : isDirty
              ? "Unsaved changes"
              : "All changes saved"}
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={() => (onBack ? onBack() : router.back())}
              style={{
                padding: "10px 18px",
                borderRadius: 8,
                border: "1px solid #d7deea",
                background: "#f1f5f9",
                color: "#334155",
                fontWeight: 600,
                cursor: "pointer",
                minWidth: 120,
              }}
            >
              Cancel
            </button>

            <button
              disabled={!isDirty || saving}
              onClick={saveChanges}
              style={{
                padding: "10px 18px",
                borderRadius: 8,
                border: "none",
                background: "#F26522",
                color: "#fff",
                fontWeight: 700,
                cursor: isDirty && !saving ? "pointer" : "not-allowed",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                boxShadow: "0 6px 14px rgba(242, 101, 34, 0.22)",
                minWidth: 170,
                opacity: isDirty && !saving ? 1 : 0.65,
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden
              >
                <path
                  d="M17 3H5C4 3 3 4 3 5v14c0 1 1 2 2 2h14c1 0 2-1 2-2V7l-6-4z"
                  fill="#fff"
                  opacity="0.15"
                ></path>
                <path
                  d="M17 3H5C4 3 3 4 3 5v14c0 1 1 2 2 2h14c1 0 2-1 2-2V7l-6-4z"
                  stroke="#fff"
                  strokeWidth="1.2"
                ></path>
                <rect
                  x="7"
                  y="9"
                  width="10"
                  height="6"
                  rx="1"
                  stroke="#fff"
                  strokeWidth="1.2"
                ></rect>
                <circle cx="12" cy="12" r="0.8" fill="#fff"></circle>
              </svg>
              {saving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
