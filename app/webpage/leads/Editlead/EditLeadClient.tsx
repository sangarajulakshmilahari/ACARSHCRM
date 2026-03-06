"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Contact = {
  ContactName?: string;
  ContactEmail?: string;
  ContactTitle?: string;
  ContactRoleName?: string;
  ContactPhone?: string;
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
    StatusName: "New",
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
      LeadSource: data?.LeadSource ?? data?.Source ?? "",
      LeadDate: data?.LeadDate ?? data?.Date ?? "",
      OwnerName: data?.OwnerName ?? data?.Owner ?? "",
      StatusName: data?.StatusName ?? data?.Status ?? "New",
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
    setLead((prev) => ({
      ...prev,
      Contacts: [
        ...(Array.isArray(prev.Contacts) ? prev.Contacts : []),
        {
          ContactName: "",
          ContactEmail: "",
          ContactTitle: "",
          ContactRoleName: "Decision Maker",
          ContactPhone: "",
        },
      ],
    }));
  };

  const removeContact = (index: number) => {
    setLead((prev) => {
      const contacts = Array.isArray(prev.Contacts) ? [...prev.Contacts] : [];
      contacts.splice(index, 1);
      return { ...prev, Contacts: contacts };
    });
  };

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
    borderRadius: 8,
    marginBottom: 20,
    border: "1px solid #e3e6e8",
    boxShadow: "0 0 0 1px rgba(0,0,0,0.01)",
  };

  const labelStyle: React.CSSProperties = {
    fontWeight: 600,
    marginBottom: 6,
    display: "block",
    color: "#444",
    fontSize: 13,
  };
  const rowStyle: React.CSSProperties = {
    display: "flex",
    gap: 20,
    marginBottom: 14,
    alignItems: "flex-start",
  };
  const inputCommon: React.CSSProperties = {
    width: "100%",
    padding: "12px 14px",
    borderRadius: 6,
    border: "1px solid #d9d9d9",
    boxSizing: "border-box",
    fontSize: 14,
    background: "#fff",
  };
  const selectCommon: React.CSSProperties = {
    ...inputCommon,
    appearance: "none",
  };

  // ----------- render form populated from `lead` -----------
  return (
    <div style={{ padding: 35, maxWidth: 1100, margin: "auto" }}>
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
          background: "#f56c00",
          color: "white",
          padding: "8px 16px",
          borderRadius: 6,
          border: "none",
          cursor: "pointer",
          fontSize: 14,
          fontWeight: 500,
        }}
      >
        ← Back
      </button>
      </div>
      
       <hr style={{ marginBottom: 20, border: "1px solid #3a77e3" }} />
     
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
            <select
              style={selectCommon}
              value={lead.StatusName ?? "New"}
              onChange={(e) => updateField("StatusName", e.target.value)}
            >
              <option>New</option>
              <option>Contacted</option>
              <option>Follow-up</option>
              <option>Qualified</option>
              <option>Unqualified</option>
              <option>Proposal Sent</option>
              <option>Lost</option>
              <option>Converted</option>
            </select>
          </div>
        </div>
      </section>

      {/*  CONTACT INFORMATION */}
      <section style={cardStyle}>
        <h3
          style={{
            fontSize: 18,
            fontWeight: 700,
            marginBottom: 25,
            borderBottom: "1px solid #e6e6e6",
            paddingBottom: 10,
          }}
        >
          Contact Information
        </h3>

        <div style={{ padding: 18 }}>
          {(lead.Contacts || []).map((c, i) => (
            <div
              key={i}
              style={{
                background: "#ffffff",
                border: "1px solid #edeff1",
                borderRadius: 6,
                padding: 16,
                marginBottom: 16,
                position: "relative",
              }}
            >
              {(lead.Contacts || []).length > 0 && (
                <button
                  onClick={() => removeContact(i)}
                  style={{
                    position: "absolute",
                    right: 14,
                    top: 14,
                    background: "#ff1f6b",
                    color: "#fff",
                    border: "none",
                    padding: "6px 12px",
                    borderRadius: 18,
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: 700,
                  }}
                  aria-label={`Remove contact ${i + 1}`}
                >
                  Remove
                </button>
              )}

              <div style={{ marginBottom: 8 }}>
                <strong style={{ fontSize: 14 }}>Contact {i + 1}</strong>
              </div>

              <div style={{ display: "flex", gap: 20, marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ ...labelStyle, fontWeight: 600 }}>Name</label>
                  <input
                    style={inputCommon}
                    value={c?.ContactName ?? ""}
                    onChange={(e) =>
                      updateContact(i, "ContactName", e.target.value)
                    }
                    placeholder="Full name"
                  />
                </div>

                <div style={{ flex: 1 }}>
                  <label style={{ ...labelStyle, fontWeight: 600 }}>
                    Title
                  </label>
                  <input
                    style={inputCommon}
                    value={c?.ContactTitle ?? ""}
                    onChange={(e) =>
                      updateContact(i, "ContactTitle", e.target.value)
                    }
                    placeholder="Job title"
                  />
                </div>
              </div>

              <div style={{ display: "flex", gap: 20, marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ ...labelStyle, fontWeight: 600 }}>
                    Email
                  </label>
                  <input
                    style={inputCommon}
                    value={c?.ContactEmail ?? ""}
                    onChange={(e) =>
                      updateContact(i, "ContactEmail", e.target.value)
                    }
                    placeholder="email@example.com"
                  />
                </div>

                <div style={{ flex: 1 }}>
                  <label style={{ ...labelStyle, fontWeight: 600 }}>
                    Phone
                  </label>
                  <input
                    style={inputCommon}
                    value={c?.ContactPhone ?? ""}
                    onChange={(e) =>
                      updateContact(i, "ContactPhone", e.target.value)
                    }
                    placeholder="Enter phone number"
                  />
                </div>
              </div>

              <div style={{ marginTop: 6 }}>
                <label style={{ ...labelStyle, fontWeight: 600 }}>Role</label>
                <select
                  style={{ ...selectCommon, padding: "12px 14px" }}
                  value={c?.ContactRoleName ?? "Decision Maker"}
                  onChange={(e) =>
                    updateContact(i, "ContactRoleName", e.target.value)
                  }
                >
                  <option>Decision Maker</option>
                  <option>Influencer</option>
                  <option>Technical</option>
                  <option>Finance</option>
                </select>
              </div>
            </div>
          ))}

          <div style={{ marginTop: 6 }}>
            <button
              onClick={addContact}
              style={{
                padding: "8px 12px",
                background: "#007bff",
                border: "none",
                color: "#fff",
                borderRadius: 6,
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              + Add Another Contact
            </button>
          </div>
        </div>
      </section>

      {/* Additional Information */}
      <section
        style={{
          borderRadius: 8,
          marginBottom: 20,
          border: "1px solid #e9ecef",
          overflow: "hidden",
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

      {/* Action buttons */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
        <button
          onClick={() => (onBack ? onBack() : router.back())}
          style={{
            padding: "10px 18px",
            borderRadius: 6,
            border: "none",
            background: "#9aa0a6",
            color: "#fff",
            fontWeight: 600,
            cursor: "pointer",
            minWidth: 98,
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
            background: "#0346c4",
            color: "#fff",
            fontWeight: 700,
            cursor: isDirty && !saving ? "pointer" : "not-allowed",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            boxShadow: "0 2px 8px rgba(3,70,196,0.18)",
            minWidth: 140,
            opacity: isDirty && !saving ? 1 : 0.5,
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
  );
}
