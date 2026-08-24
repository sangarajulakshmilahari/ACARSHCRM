"use client";

import React, { useState, useEffect } from "react";
import Select from "react-select";
import CreatableSelect from "react-select/creatable";

type EntityType = "lead" | "prospect" | "account";

type AddLeadPageProps = {
  onBack?: () => void;
  type?: EntityType;
};

export default function AddLeadPage({
  onBack,
  type = "lead",
}: AddLeadPageProps) {
  const [companies, setCompanies] = useState<any[]>([]);
  const [leadSources, setLeadSources] = useState<any[]>([]);
  const [ownerNames, setOwnerNames] = useState<any[]>([]);
  const [contactRoles, setContactRoles] = useState<any[]>([]);

  // 🔹 Texts based on type
  const entityLabel: string =
    type === "prospect" ? "Prospect" : type === "account" ? "Customer" : "Lead";

  const entityLabelLower = entityLabel.toLowerCase();

 const companyOptions = companies
  .filter((c) => c.CompanyName)
  .map((c) => ({
    label: c.CompanyName,
    value: c.CompanyName,
  }));

  const getAccountType = (type: EntityType) => {
    if (type === "lead") return 10;
    if (type === "prospect") return 20;
    if (type === "account") return 30;
    return 10;
  };

  

  const handleChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >,
  ) => {
    const { name, value, type } = e.target;
    const checked = (e.target as HTMLInputElement).checked;
    setForm((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const getTodayDate = () => {
    const today = new Date();
    return today.toISOString().split("T")[0]; // YYYY-MM-DD
  };

  const getCurrentDateTimeLocal = () => {
    const now = new Date();
    const offset = now.getTimezoneOffset();
    const local = new Date(now.getTime() - offset * 60000);
    return local.toISOString().slice(0, 16); // yyyy-MM-ddTHH:mm
  };
  const [form, setForm] = useState({
    CompanyName: "",
    CompanyLocation: "",
    LeadSource: "",
    IndustryFocus: "",
    LeadDate: getTodayDate(),
    StatusName: "",
    OwnerName: "",
    AccountType: getAccountType(type),

    // Lead / Prospect / Customer Details
    ExpansionAreas: "",
    Tags: "",
    Notes: "",

    // Contact
    ContactName: "",
    ContactEmail: "",
    ContactPhone: "",
    ContactTitle: "",
    ContactRoleName: "",
    ContactLocation: "",
    ContactNotes: "",
    LinkedInURL: "",

    // Quick Actions
    AddReminder: false,
    ReminderDateTime: getCurrentDateTimeLocal(),
    ReminderNote: "",
  });

  useEffect(() => {
    fetch("/api/masters/others")
      .then((res) => res.json())
      .then((data) => {
        if (data.companies) {
          setCompanies(data.companies);
        }
        if (data.leadSources) {
          setLeadSources(data.leadSources);
        }
        if (data.ownername) {
          setOwnerNames(data.ownername);
        }
        if (data.Role) {
          setContactRoles(data.Role);
        }
        if (Array.isArray(data.leadStatuses)) {
          setForm((prev) => ({
            ...prev,
            StatusName:
              prev.StatusName || data.leadStatuses[0]?.StatusName || "",
          }));
        }
      });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.CompanyName.trim()) {
      alert("Please enter Company Name");
      return;
    }

    if (!form.CompanyLocation.trim()) {
      alert("Please enter Company Location");
      return;
    }

    if (!form.ContactTitle.trim()) {
      alert("Please enter Contact Title");
      return;
    }

    if (!form.ContactPhone.trim()) {
      alert("Please enter Contact Phone");
      return;
    }

    if (!form.ContactRoleName) {
      alert("Please select Contact Role");
      return;
    }

    console.log("Submitting lead data:", form);

    // Determine the API endpoint based on type
    let endpoint = "/api/employees/leads";
    if (type === "prospect") endpoint = "/api/employees/prospects";
    else if (type === "account") endpoint = "/api/employees/account";

    const res = await fetch(endpoint, {
      method: "POST",
      body: JSON.stringify(form),
      headers: { "Content-Type": "application/json" },
    });

    if (!res.ok) {
      alert(`Failed to save ${entityLabelLower}`);
      return;
    }

    alert(`${entityLabel} added successfully!`);
  };

const customSelectStyles = {
  control: (base: any) => ({
    ...base,
    minHeight: "38px",
    height: "38px",
    borderRadius: "8px",
    borderColor: "rgba(31, 58, 104, 0.2)",
    fontSize: "13px",
    boxShadow: "none",
    "&:hover": {
      borderColor: "#F26522",
    },
  }),
  valueContainer: (base: any) => ({
    ...base,
    padding: "0 10px",   // match input padding
  }),
  input: (base: any) => ({
    ...base,
    margin: 0,
    padding: 0,
  }),
  indicatorsContainer: (base: any) => ({
    ...base,
    height: "34px",
  }),
};

  return (
    <div
      style={{
        padding: 22,
        fontFamily: "var(--font-body)",
        width: "100%",
        overflowY: "auto",
        boxSizing: "border-box",
      }}
    >
      {/* PAGE HEADING */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
          // marginTop:70
        }}
      >
        <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
          {/* 🔹 Dynamic heading */}
          Add New {entityLabel}
        </h2>

        {/* BACK BUTTON */}
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

      <form onSubmit={handleSubmit}>
        {/* ---------------------------- COMPANY INFORMATION ---------------------------- */}
        <section style={boxWrapper}>
          <div style={boxHeader}>Company Information</div>

          <div style={sectionBody}>
            <div style={grid3}>
              <div>
                <label style={labelStyle}>
                  Company Name <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <div style={{ marginTop: 4 }}>
                <CreatableSelect
                 styles={customSelectStyles}
                  options={companyOptions}
                  value={
                    form.CompanyName
                      ? { label: form.CompanyName, value: form.CompanyName }
                      : null
                  }
                  onChange={(selected: any) => {
                    setForm((prev) => ({
                      ...prev,
                      CompanyName: selected ? selected.value : "",
                    }));
                  }}
                  onCreateOption={(inputValue) => {
                    setForm((prev) => ({
                      ...prev,
                      CompanyName: inputValue,
                    }));
                  }}
                  
                  placeholder="Select or type company..."
                  formatCreateLabel={(inputValue) => `Add "${inputValue}"`}
                  isClearable
                />
                </div>

                <p style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
  Type to search or press Enter to add new company
</p>
              </div>

              <div>
                <label style={labelStyle}>
                  Company Location <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  type="text"
                  name="CompanyLocation"
                  placeholder="City, State"
                  style={inputStyle}
                  value={form.CompanyLocation}
                  onChange={handleChange}
                  required
                />
              </div>

              <div>
                <label style={labelStyle}>Industry Focus</label>
                <input
                  type="text"
                  name="IndustryFocus"
                  placeholder="e.g., Healthcare, Fintech"
                  style={inputStyle}
                  value={form.IndustryFocus}
                  onChange={handleChange}
                />
              </div>

              <div>
                <label style={labelStyle}>Lead Source</label>
                <select
                  name="LeadSource"
                  value={form.LeadSource}
                  onChange={handleChange}
                  style={inputStyle}
                >
                  <option value="">Select Source</option>

                  {Array.isArray(leadSources) &&
                    leadSources.map((ls, index) => (
                      <option key={index} value={ls.LeadSource}>
                        {ls.LeadSource}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label style={labelStyle}>Lead Date</label>
                <input
                  type="date"
                  name="LeadDate"
                  style={inputStyle}
                  value={form.LeadDate}
                  onChange={handleChange}
                />
              </div>

              <div>
                <label style={labelStyle}>Lead Status</label>
                <input
                  type="text"
                  name="StatusName"
                  value={form.StatusName}
                  readOnly
                  style={{
                    ...inputStyle,
                    background: "#e5e7eb",
                    cursor: "not-allowed",
                  }}
                />
              </div>

              <div>
                <label style={labelStyle}>Customer Type</label>
                <input
                  type="text"
                  name="AccountType"
                  value={form.AccountType}
                  readOnly
                  style={{
                    ...inputStyle,
                    background: "#e5e7eb",
                    cursor: "not-allowed",
                  }}
                />
              </div>

              <div>
                <label style={labelStyle}>
                  Lead Owner <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <select
                  name="OwnerName"
                  value={form.OwnerName}
                  onChange={handleChange}
                  style={inputStyle}
                >
                  <option value="">Select Owner</option>

                  {Array.isArray(ownerNames) &&
                    ownerNames.map((on, index) => (
                      <option key={index} value={on.UserName}>
                        {on.UserName}
                      </option>
                    ))}
                </select>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------------------- LEAD / PROSPECT / ACCOUNT DETAILS ---------------------------- */}
        <section style={boxWrapper}>
          {/* 🔹 Dynamic section title */}
          <div style={boxHeader}>{entityLabel} Details</div>

          <div style={sectionBody}>
            <div style={grid3}>
              <div>
                <label style={labelStyle}>Expansion Areas</label>
                <textarea
                  name="ExpansionAreas"
                  placeholder="Areas of interest or expansion (e.g., Cloud Migration, Digital Transformation)"
                  style={textareaStyle}
                  value={form.ExpansionAreas}
                  onChange={handleChange}
                />
              </div>

              <div>
                <label style={labelStyle}>Tags</label>
                <input
                  type="text"
                  name="Tags"
                  placeholder="Enter tags separated by commas"
                  style={inputStyle}
                  value={form.Tags}
                  onChange={handleChange}
                />
                <p
                  style={{
                    fontSize: 12,
                    color: "#6b7280",
                    marginTop: 4,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <i className="fas fa-info-circle"></i>
                  Separate multiple tags with commas
                </p>
              </div>

              <div>
                <label style={labelStyle}>Notes</label>
                <textarea
                  name="Notes"
                  placeholder={`Additional notes about this ${entityLabelLower}...`}
                  style={textareaStyle}
                  value={form.Notes}
                  onChange={handleChange}
                />
              </div>
            </div>
          </div>
        </section>

        {/* ---------------------------- CONTACT ---------------------------- */}
        <section style={boxWrapper}>
          <div style={boxHeader}>Contact</div>

          <div style={sectionBody}>
            <div style={grid3}>
              <div>
                <label style={labelStyle}>
                  Contact Name <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  type="text"
                  name="ContactName"
                  placeholder="Full name"
                  style={inputStyle}
                  value={form.ContactName}
                  onChange={handleChange}
                />
              </div>

              <div>
                <label style={labelStyle}>
                  Contact Title <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  type="text"
                  name="ContactTitle"
                  placeholder="Job title (e.g., CEO, IT Manager)"
                  style={inputStyle}
                  value={form.ContactTitle}
                  onChange={handleChange}
                  required
                />
              </div>

              <div>
                <label style={labelStyle}>
                  Role <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <select
                  name="ContactRoleName"
                  value={form.ContactRoleName}
                  onChange={handleChange}
                  style={inputStyle}
                >
                  <option value="">Select Role</option>

                  {Array.isArray(contactRoles) &&
                    contactRoles.map((role, index) => (
                      <option key={index} value={role.Role}>
                        {role.Role}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label style={labelStyle}>
                  Email <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  type="email"
                  name="ContactEmail"
                  placeholder="email@company.com"
                  style={inputStyle}
                  value={form.ContactEmail}
                  onChange={handleChange}
                />
              </div>

              <div>
                <label style={labelStyle}>
                  Phone <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  type="text"
                  name="ContactPhone"
                  placeholder="+91 98765 43210"
                  style={inputStyle}
                  value={form.ContactPhone}
                  onChange={handleChange}
                  required
                />
              </div>

              <div>
                <label style={labelStyle}>Contact Location</label>
                <input
                  type="text"
                  name="ContactLocation"
                  placeholder="City, State"
                  style={inputStyle}
                  value={form.ContactLocation}
                  onChange={handleChange}
                />
              </div>

              <div>
                <label style={labelStyle}>LinkedIn URL</label>
                <input
                  type="text"
                  name="LinkedInURL"
                  placeholder="https://linkedin.com/in/..."
                  style={inputStyle}
                  value={form.LinkedInURL}
                  onChange={handleChange}
                />
              </div>

              <div style={{ gridColumn: "1 / span 3" }}>
                <label style={labelStyle}>Contact Notes</label>
                <textarea
                  name="ContactNotes"
                  placeholder="Additional notes about this contact..."
                  style={{ ...textareaStyle, height: 90 }}
                  value={form.ContactNotes}
                  onChange={handleChange}
                />
              </div>
            </div>
          </div>
        </section>

        {/* ---------------------------- QUICK ACTIONS ---------------------------- */}
        

        {/* ---------------------------- BUTTONS ---------------------------- */}
        <div
          style={{
            marginTop: 24,
            display: "flex",
            justifyContent: "flex-end",
            gap: 12,
          }}
        >
          <button type="button" style={btnSecondary} onClick={onBack}>
            Cancel
          </button>

          {/* 🔹 Dynamic submit text */}
          <button type="submit" style={btnPrimary}>
            Create {entityLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ---------------------------- STYLES ---------------------------- */

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "#1F3A68",
};

const sectionBody: React.CSSProperties = {
  padding: 22,
  overflowY: "auto",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid rgba(31, 58, 104, 0.2)",
  marginTop: 4,
  fontSize: 13,
  boxSizing: "border-box",
  color: "#0F1F3D",
};

const textareaStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid rgba(31, 58, 104, 0.2)",
  marginTop: 4,
  height: 80,
  fontSize: 13,
  resize: "none",
  boxSizing: "border-box",
  color: "#0F1F3D",
};

const grid3: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 20,
};

const boxWrapper: React.CSSProperties = {
  marginTop: 20,
  background: "#ffffff",
  borderRadius: 12,
  boxShadow: "0 12px 28px rgba(15, 31, 61, 0.08)",
  padding: 0,
  border: "1px solid rgba(31, 58, 104, 0.14)",
};

const boxHeader: React.CSSProperties = {
  background: "linear-gradient(90deg, #1F3A68 0%, #0F1F3D 100%)",
  color: "#fff",
  padding: "11px 16px",
  fontWeight: 600,
  borderTopLeftRadius: 10,
  borderTopRightRadius: 10,
  fontSize: 14,
};

const btnPrimary: React.CSSProperties = {
  background: "#F26522",
  color: "white",
  padding: "10px 20px",
  fontSize: 14,
  borderRadius: 8,
  border: "none",
  cursor: "pointer",
  fontWeight: 600,
  boxShadow: "0 8px 20px rgba(242, 101, 34, 0.24)",
};

const btnSecondary: React.CSSProperties = {
  background: "#ffffff",
  color: "#1F3A68",
  padding: "10px 18px",
  fontSize: 14,
  borderRadius: 8,
  border: "1px solid rgba(31, 58, 104, 0.18)",
  cursor: "pointer",
  fontWeight: 600,
};
