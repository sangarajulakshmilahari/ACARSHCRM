"use client";

import React, { useEffect, useMemo, useState } from "react";
import { formatLocaleDateTime } from "@/app/utils/dateTime";
import MicrosoftMailboxStatus from "@/app/webpage/components/MicrosoftMailboxStatus";

type EmailTemplate = {
  TemplateId: number;
  TemplateName: string;
  Subject: string;
  Body: string;
  CreatedBy: number | null;
  CreatedByName?: string;
  CreatedAt: string | null;
  UpdatedAt: string | null;
};

type TemplateForm = {
  templateName: string;
  subject: string;
  body: string;
};

const PERSONALIZATION_VARIABLES = [
  "{{firstName}}",
  "{{companyName}}",
  "{{contactName}}",
];

const emptyForm: TemplateForm = {
  templateName: "",
  subject: "",
  body: "",
};

function formatDateTime(value: string | null | undefined): string {
  return formatLocaleDateTime(
    value,
    {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    },
    "-"
  );
}

export default function EmailTemplatesClient(): JSX.Element {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [editingTemplateId, setEditingTemplateId] = useState<number | null>(null);
  const [form, setForm] = useState<TemplateForm>(emptyForm);

  const isEditing = editingTemplateId !== null;

  const editorTitle = useMemo(
    () => (isEditing ? "Edit Template" : "Create Template"),
    [isEditing]
  );

  useEffect(() => {
    void loadTemplates();
  }, []);

  async function loadTemplates(): Promise<void> {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/employees/email-templates", {
        credentials: "include",
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Failed to fetch templates (${res.status})`);
      }

      const data = (await res.json()) as EmailTemplate[];
      setTemplates(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err?.message ?? "Failed to fetch templates");
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  }

  function startCreateTemplate(): void {
    setEditingTemplateId(null);
    setForm(emptyForm);
    setError(null);
  }

  function startEditTemplate(template: EmailTemplate): void {
    setEditingTemplateId(Number(template.TemplateId));
    setForm({
      templateName: String(template.TemplateName ?? ""),
      subject: String(template.Subject ?? ""),
      body: String(template.Body ?? ""),
    });
    setError(null);
  }

  function insertVariable(variable: string, field: "subject" | "body"): void {
    setForm((prev) => ({
      ...prev,
      [field]: `${prev[field]}${prev[field] ? " " : ""}${variable}`,
    }));
  }

  async function submitTemplate(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);

    const payload = {
      templateName: form.templateName.trim(),
      subject: form.subject.trim(),
      body: form.body.trim(),
    };

    if (!payload.templateName || !payload.subject || !payload.body) {
      setError("Template Name, Subject and Email Body are required");
      return;
    }

    setSaving(true);

    try {
      const endpoint = isEditing
        ? `/api/employees/email-templates/${editingTemplateId}`
        : "/api/employees/email-templates";
      const method = isEditing ? "PUT" : "POST";

      const res = await fetch(endpoint, {
        method,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Failed to save template (${res.status})`);
      }

      await loadTemplates();
      setEditingTemplateId(null);
      setForm(emptyForm);
    } catch (err: any) {
      setError(err?.message ?? "Failed to save template");
    } finally {
      setSaving(false);
    }
  }

  async function deleteTemplate(templateId: number): Promise<void> {
    const confirmed = window.confirm("Delete this template?");
    if (!confirmed) return;

    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/employees/email-templates/${templateId}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Failed to delete template (${res.status})`);
      }

      if (editingTemplateId === templateId) {
        setEditingTemplateId(null);
        setForm(emptyForm);
      }

      await loadTemplates();
    } catch (err: any) {
      setError(err?.message ?? "Failed to delete template");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      style={{
        background: "#fff",
        border: "1px solid rgba(31, 58, 104, 0.14)",
        borderRadius: 14,
        boxShadow: "0 10px 24px rgba(15, 31, 61, 0.08)",
        padding: 16,
        display: "grid",
        gap: 14,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 20, color: "#1F3A68" }}>Email Templates</h2>
        <button
          type="button"
          onClick={startCreateTemplate}
          style={{
            border: "1px solid #F26522",
            background: "#F26522",
            color: "#fff",
            borderRadius: 8,
            padding: "8px 12px",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Create Template
        </button>
      </div>

      <MicrosoftMailboxStatus tab="emailTemplates" />

      {error && (
        <div
          style={{
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

      <div
        style={{
          border: "1px solid #e2e8f0",
          borderRadius: 10,
          padding: 12,
          background: "#fcfdff",
        }}
      >
        <h3 style={{ margin: 0, marginBottom: 10, color: "#0F1F3D", fontSize: 15 }}>
          {editorTitle}
        </h3>

        <form onSubmit={submitTemplate} style={{ display: "grid", gap: 10 }}>
          <label style={{ display: "grid", gap: 6, fontSize: 12, color: "#475569" }}>
            Template Name
            <input
              type="text"
              value={form.templateName}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, templateName: e.target.value }))
              }
              placeholder="e.g. Intro Outreach"
              disabled={saving}
              style={inputStyle}
            />
          </label>

          <label style={{ display: "grid", gap: 6, fontSize: 12, color: "#475569" }}>
            Subject
            <input
              type="text"
              value={form.subject}
              onChange={(e) => setForm((prev) => ({ ...prev, subject: e.target.value }))}
              placeholder="Email subject"
              disabled={saving}
              style={inputStyle}
            />
          </label>

          <div
            style={{
              border: "1px dashed rgba(31, 58, 104, 0.25)",
              borderRadius: 8,
              padding: 10,
              background: "#f8fbff",
              display: "grid",
              gap: 8,
            }}
          >
            <div style={{ fontSize: 12, color: "#1F3A68", fontWeight: 700 }}>
              Available Variables
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {PERSONALIZATION_VARIABLES.map((variable) => (
                <button
                  key={variable}
                  type="button"
                  onClick={() => insertVariable(variable, "body")}
                  disabled={saving}
                  style={variableChipStyle}
                  title="Click to add into email body"
                >
                  {variable}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: "#64748b" }}>
              Tip: click a variable to insert it into Email Body. Use the same variables in
              Subject as needed.
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {PERSONALIZATION_VARIABLES.map((variable) => (
                <button
                  key={`${variable}-subject`}
                  type="button"
                  onClick={() => insertVariable(variable, "subject")}
                  disabled={saving}
                  style={secondaryVariableChipStyle}
                  title="Insert into subject"
                >
                  + Subject {variable}
                </button>
              ))}
            </div>
          </div>

          <label style={{ display: "grid", gap: 6, fontSize: 12, color: "#475569" }}>
            Email Body
            <textarea
              value={form.body}
              onChange={(e) => setForm((prev) => ({ ...prev, body: e.target.value }))}
              placeholder="Write your email body..."
              disabled={saving}
              rows={8}
              style={{ ...inputStyle, resize: "vertical", minHeight: 160 }}
            />
          </label>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="submit" disabled={saving} style={primaryButtonStyle}>
              {saving ? "Saving..." : isEditing ? "Update Template" : "Save Template"}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={startCreateTemplate}
              style={secondaryButtonStyle}
            >
              Clear
            </button>
          </div>
        </form>
      </div>

      <div style={{ overflowX: "auto", border: "1px solid #e6ebf2", borderRadius: 10 }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            minWidth: 760,
          }}
        >
          <thead>
            <tr>
              <th style={thStyle}>Template Name</th>
              <th style={thStyle}>Subject</th>
              <th style={thStyle}>Updated</th>
              <th style={thStyle}>Created By</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} style={loadingCellStyle}>
                  Loading templates...
                </td>
              </tr>
            ) : templates.length === 0 ? (
              <tr>
                <td colSpan={5} style={loadingCellStyle}>
                  No templates found
                </td>
              </tr>
            ) : (
              templates.map((template, index) => (
                <tr
                  key={template.TemplateId}
                  style={{
                    background: index % 2 === 0 ? "#ffffff" : "#f8fbff",
                  }}
                >
                  <td style={tdStyle} title={template.TemplateName}>
                    <div style={ellipsisStyle}>{template.TemplateName || "-"}</div>
                  </td>
                  <td style={tdStyle} title={template.Subject}>
                    <div style={ellipsisStyle}>{template.Subject || "-"}</div>
                  </td>
                  <td style={tdStyle}>{formatDateTime(template.UpdatedAt ?? template.CreatedAt)}</td>
                  <td style={tdStyle}>{template.CreatedByName || "-"}</td>
                  <td style={tdStyle}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => startEditTemplate(template)}
                        style={secondaryButtonStyle}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => deleteTemplate(Number(template.TemplateId))}
                        style={dangerButtonStyle}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  marginTop: 0,
  padding: "9px 10px",
  borderRadius: 8,
  border: "1px solid rgba(31, 58, 104, 0.2)",
  background: "#fff",
  color: "#0F1F3D",
  fontFamily: "inherit",
};

const variableChipStyle: React.CSSProperties = {
  border: "1px solid rgba(31, 58, 104, 0.25)",
  background: "#ffffff",
  color: "#1F3A68",
  borderRadius: 999,
  padding: "6px 10px",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
};

const secondaryVariableChipStyle: React.CSSProperties = {
  ...variableChipStyle,
  background: "rgba(31, 58, 104, 0.06)",
};

const primaryButtonStyle: React.CSSProperties = {
  border: "1px solid #F26522",
  background: "#F26522",
  color: "#fff",
  borderRadius: 8,
  padding: "8px 12px",
  fontWeight: 700,
  cursor: "pointer",
};

const secondaryButtonStyle: React.CSSProperties = {
  border: "1px solid rgba(31, 58, 104, 0.2)",
  background: "#fff",
  color: "#1F3A68",
  borderRadius: 8,
  padding: "8px 12px",
  fontWeight: 700,
  cursor: "pointer",
};

const dangerButtonStyle: React.CSSProperties = {
  border: "1px solid #ef4444",
  background: "#fff",
  color: "#b91c1c",
  borderRadius: 8,
  padding: "8px 12px",
  fontWeight: 700,
  cursor: "pointer",
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "11px 10px",
  borderBottom: "1px solid #dbe4f2",
  background: "#202939",
  color: "#ffffff",
  fontWeight: 700,
  fontSize: 12,
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "10px",
  borderBottom: "1px solid #eef2f7",
  color: "#1e293b",
  fontSize: 12,
  verticalAlign: "middle",
};

const loadingCellStyle: React.CSSProperties = {
  ...tdStyle,
  textAlign: "center",
  color: "#64748b",
};

const ellipsisStyle: React.CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  maxWidth: 260,
};

