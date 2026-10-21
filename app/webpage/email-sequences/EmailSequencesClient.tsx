"use client";

import React, { useEffect, useMemo, useState } from "react";
import { formatLocaleDateTime } from "@/app/utils/dateTime";
import MicrosoftMailboxStatus from "@/app/webpage/components/MicrosoftMailboxStatus";

type SequenceStep = {
  StepId?: number;
  StepOrder: number;
  TemplateId: number;
  TemplateName?: string | null;
  DelayMinutes: number;
};

type SequenceItem = {
  SequenceId: number;
  SequenceName: string;
  Description: string | null;
  Status: string;
  StepCount?: number;
  TotalContacts?: number;
  ActiveContacts?: number;
  CompletedContacts?: number;
  steps?: SequenceStep[];
};

type TemplateItem = {
  TemplateId: number;
  TemplateName: string;
  Subject: string;
};

type ContactItem = {
  LeadContactID: number;
  LeadId: number;
  ContactName: string | null;
  ContactEmail: string | null;
  CompanyName: string | null;
  OwnerName: string | null;
};

type SequenceContactProgress = {
  SequenceContactId: number;
  LeadContactID: number;
  ContactName: string | null;
  ContactEmail: string | null;
  CompanyName: string | null;
  CurrentStep: number;
  Status: string;
  LastEmailStatus: string | null;
  LastEmailSentAt: string | null;
  NextActionAt: string | null;
  NextTemplateName: string | null;
};

type DraftStep = {
  stepOrder: number;
  templateId: string;
  delayValue: string;
  delayUnit: "minutes" | "hours" | "days";
};

function toDelayMinutes(step: DraftStep): number {
  const value = Math.max(0, Math.floor(Number(step.delayValue || 0)));
  if (step.delayUnit === "days") return value * 1440;
  if (step.delayUnit === "hours") return value * 60;
  return value;
}

function formatDelay(delayMinutes: number): string {
  const m = Math.max(0, Math.floor(Number(delayMinutes || 0)));
  if (m % 1440 === 0) {
    const d = m / 1440;
    return `${d} day${d === 1 ? "" : "s"}`;
  }
  if (m % 60 === 0) {
    const h = m / 60;
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  return `${m} minute${m === 1 ? "" : "s"}`;
}

export default function EmailSequencesClient(): JSX.Element {
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [sequences, setSequences] = useState<SequenceItem[]>([]);
  const [selectedSequenceId, setSelectedSequenceId] = useState<number | null>(null);
  const [progressRows, setProgressRows] = useState<SequenceContactProgress[]>([]);
  const [contactSearch, setContactSearch] = useState("");
  const [contactRows, setContactRows] = useState<ContactItem[]>([]);
  const [selectedContactIds, setSelectedContactIds] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<number | null>(null);

  const [sequenceName, setSequenceName] = useState("");
  const [description, setDescription] = useState("");
  const [sequenceStatus, setSequenceStatus] = useState<"DRAFT" | "ACTIVE" | "INACTIVE">("DRAFT");
  const [steps, setSteps] = useState<DraftStep[]>([
    { stepOrder: 1, templateId: "", delayValue: "0", delayUnit: "hours" },
  ]);

  const selectedSequence = useMemo(
    () => sequences.find((s) => Number(s.SequenceId) === Number(selectedSequenceId)) || null,
    [sequences, selectedSequenceId]
  );

  const selectedContactIdList = useMemo(
    () => Object.keys(selectedContactIds).map((k) => Number(k)).filter((id) => id > 0 && selectedContactIds[id]),
    [selectedContactIds]
  );

  async function loadTemplates() {
    const res = await fetch("/api/employees/email-templates", { credentials: "include" });
    if (!res.ok) throw new Error("Failed to load templates");
    const data = await res.json();
    setTemplates(Array.isArray(data) ? data : []);
  }

  async function loadSequences() {
    const res = await fetch("/api/email/sequences", { credentials: "include" });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error || "Failed to load sequences");
    }
    const data = await res.json();
    const items = Array.isArray(data) ? data : [];
    setSequences(items);
    if (!selectedSequenceId && items[0]?.SequenceId) {
      setSelectedSequenceId(Number(items[0].SequenceId));
    }
  }

  async function loadProgress(sequenceId: number) {
    const res = await fetch(`/api/email/sequences/${sequenceId}/contacts`, {
      credentials: "include",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error || "Failed to load sequence progress");
    }
    const data = await res.json();
    setProgressRows(Array.isArray(data) ? data : []);
  }

  async function loadContacts(searchValue = "") {
    const params = new URLSearchParams();
    if (searchValue.trim()) params.set("search", searchValue.trim());
    params.set("limit", "200");
    const res = await fetch(`/api/email/sequences/contacts?${params.toString()}`, {
      credentials: "include",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error || "Failed to load contacts");
    }
    const data = await res.json();
    setContactRows(Array.isArray(data) ? data : []);
  }

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        await Promise.all([loadTemplates(), loadSequences(), loadContacts("")]);
      } catch (e: any) {
        if (mounted) setError(e?.message || "Failed to load email sequences");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedSequenceId) {
      setProgressRows([]);
      return;
    }
    loadProgress(selectedSequenceId).catch((e: any) => setError(e?.message || "Failed to load progress"));
  }, [selectedSequenceId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadContacts(contactSearch).catch((e: any) => setError(e?.message || "Failed to search contacts"));
    }, 300);
    return () => clearTimeout(timer);
  }, [contactSearch]);

  function addStep() {
    setSteps((prev) => [
      ...prev,
      {
        stepOrder: prev.length + 1,
        templateId: "",
        delayValue: "1",
        delayUnit: "hours",
      },
    ]);
  }

  function removeStep(index: number) {
    setSteps((prev) => prev.filter((_s, i) => i !== index).map((s, i) => ({ ...s, stepOrder: i + 1 })));
  }

  async function createSequence() {
    setError(null);
    setSuccess(null);
    const normalizedName = sequenceName.trim();
    if (!normalizedName) {
      setError("Sequence name is required");
      return;
    }

    if (!steps.length) {
      setError("At least one step is required");
      return;
    }

    const payloadSteps = steps.map((step, index) => ({
      stepOrder: index + 1,
      templateId: Number(step.templateId || 0),
      delayMinutes: toDelayMinutes(step),
    }));

    if (payloadSteps.some((s) => !s.templateId || s.templateId <= 0)) {
      setError("Each step requires a valid template");
      return;
    }

    const res = await fetch("/api/email/sequences", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sequenceName: normalizedName,
        description: description.trim() || null,
        status: sequenceStatus,
        steps: payloadSteps,
      }),
    });

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error || "Failed to create sequence");
      return;
    }

    setSuccess("Sequence created successfully");
    setSequenceName("");
    setDescription("");
    setSequenceStatus("DRAFT");
    setSteps([{ stepOrder: 1, templateId: "", delayValue: "0", delayUnit: "hours" }]);
    await loadSequences();
  }

  async function updateSequenceStatus(sequenceId: number, status: "ACTIVE" | "INACTIVE" | "DRAFT") {
    setError(null);
    setSuccess(null);
    const res = await fetch(`/api/email/sequences/${sequenceId}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error || "Failed to update sequence status");
      return;
    }
    setSuccess(`Sequence marked ${status}`);
    await loadSequences();
    if (selectedSequenceId === sequenceId) {
      await loadProgress(sequenceId);
    }
  }

  async function updateEnrollmentAction(
    sequenceContactId: number,
    action: "pause" | "resume" | "remove"
  ) {
    if (!selectedSequenceId) {
      setError("Select a sequence first");
      return;
    }

    if (action === "remove") {
      const confirmed = window.confirm(
        "Remove this contact from the sequence? Queued emails will not send. Email history will be kept."
      );
      if (!confirmed) return;
    }

    setError(null);
    setSuccess(null);
    setActionLoadingId(sequenceContactId);

    try {
      const res = await fetch(
        `/api/email/sequences/${selectedSequenceId}/contacts/${sequenceContactId}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || "Failed to update enrollment");
        return;
      }

      const warning = String(data?.warning || "").trim();
      setSuccess(warning ? `${data?.message || "Enrollment updated"}. ${warning}` : data?.message || "Enrollment updated");
      await loadSequences();
      await loadProgress(selectedSequenceId);
    } catch (e: any) {
      setError(e?.message || "Failed to update enrollment");
    } finally {
      setActionLoadingId(null);
    }
  }

  async function enrollSelectedContacts(reEnroll = false) {
    if (!selectedSequenceId) {
      setError("Select a sequence first");
      return;
    }
    if (!selectedContactIdList.length) {
      setError("Select at least one contact to enroll");
      return;
    }
    if (String(selectedSequence?.Status || "").toUpperCase() !== "ACTIVE") {
      setError("Sequence must be ACTIVE to enroll contacts");
      return;
    }

    setError(null);
    setSuccess(null);

    const res = await fetch(`/api/email/sequences/${selectedSequenceId}/enroll`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadContactIds: selectedContactIdList, reEnroll }),
    });

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error || "Failed to enroll contacts");
      return;
    }

    const skipped = Array.isArray(data?.skipped) ? data.skipped : [];
    const reenrollRequired = skipped.filter((row: any) => String(row?.reason || "") === "REENROLL_REQUIRED");
    if (!reEnroll && reenrollRequired.length > 0) {
      const confirmed = window.confirm(
        `${reenrollRequired.length} selected contact(s) were removed or completed. Re-enroll them from step 1?`
      );
      if (confirmed) {
        await enrollSelectedContacts(true);
        return;
      }
    }

    const suppressedCount = skipped.filter(
      (row: any) => String(row?.reason || "") === "CONTACT_SUPPRESSED"
    ).length;
    setSuccess(
      `Enrollment done. Enrolled: ${Number(data?.enrolledCount || 0)}, Skipped: ${Number(data?.skippedCount || 0)}` +
        (suppressedCount ? ` (${suppressedCount} unsubscribed)` : "")
    );
    setSelectedContactIds({});
    await loadSequences();
    await loadProgress(selectedSequenceId);
  }

  function handleSequenceSelection(sequenceId: number) {
    setSelectedSequenceId((prev) =>
      Number(prev) === Number(sequenceId) ? null : Number(sequenceId)
    );
  }

  return (
    <section
      style={{
        background: "#fff",
        border: "1px solid rgba(31, 58, 104, 0.14)",
        borderRadius: 14,
        boxShadow: "0 10px 24px rgba(15, 31, 61, 0.08)",
        padding: 16,
      }}
    >
      <h2 style={{ margin: "0 0 14px", color: "#1F3A68" }}>Email Sequences</h2>
      <div style={{ marginBottom: 14 }}>
        <MicrosoftMailboxStatus tab="emailSequences" />
      </div>

      {error && <div style={{ marginBottom: 10, color: "#991b1b" }}>{error}</div>}
      {success && <div style={{ marginBottom: 10, color: "#166534" }}>{success}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 14 }}>
        <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 12 }}>
          <h3 style={{ margin: "0 0 8px", fontSize: 16, color: "#0f172a" }}>Create Sequence</h3>
          <input
            value={sequenceName}
            onChange={(e) => setSequenceName(e.target.value)}
            placeholder="Sequence name"
            style={inputStyle}
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            style={{ ...inputStyle, minHeight: 72, resize: "vertical" }}
          />
          <select
            value={sequenceStatus}
            onChange={(e) => setSequenceStatus(e.target.value as any)}
            style={inputStyle}
          >
            <option value="DRAFT">DRAFT</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="INACTIVE">INACTIVE</option>
          </select>

          <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
            {steps.map((step, index) => (
              <div
                key={`draft-step-${index}`}
                style={{ border: "1px solid #dbe4f2", borderRadius: 8, padding: 8, background: "#f8fbff" }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, color: "#1F3A68", marginBottom: 6 }}>
                  Step {index + 1}
                </div>
                <select
                  value={step.templateId}
                  onChange={(e) =>
                    setSteps((prev) =>
                      prev.map((s, i) => (i === index ? { ...s, templateId: e.target.value } : s))
                    )
                  }
                  style={inputStyle}
                >
                  <option value="">Select template</option>
                  {templates.map((template) => (
                    <option key={template.TemplateId} value={template.TemplateId}>
                      {template.TemplateName}
                    </option>
                  ))}
                </select>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8 }}>
                  <input
                    type="number"
                    min={0}
                    value={step.delayValue}
                    onChange={(e) =>
                      setSteps((prev) =>
                        prev.map((s, i) => (i === index ? { ...s, delayValue: e.target.value } : s))
                      )
                    }
                    style={inputStyle}
                  />
                  <select
                    value={step.delayUnit}
                    onChange={(e) =>
                      setSteps((prev) =>
                        prev.map((s, i) =>
                          i === index
                            ? { ...s, delayUnit: e.target.value as "minutes" | "hours" | "days" }
                            : s
                        )
                      )
                    }
                    style={inputStyle}
                  >
                    <option value="minutes">Minutes</option>
                    <option value="hours">Hours</option>
                    <option value="days">Days</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => removeStep(index)}
                    disabled={steps.length <= 1}
                    style={smallBtnStyle(steps.length <= 1)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
            <button type="button" onClick={addStep} style={actionBtnStyle("secondary")}>+ Add Step</button>
            <button type="button" onClick={createSequence} style={actionBtnStyle("primary")}>Create Sequence</button>
          </div>
        </div>

        <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 12 }}>
          <h3 style={{ margin: "0 0 8px", fontSize: 16, color: "#0f172a" }}>Sequences</h3>
          {loading ? (
            <div style={{ color: "#64748b" }}>Loading...</div>
          ) : sequences.length === 0 ? (
            <div style={{ color: "#64748b" }}>No sequences found.</div>
          ) : (
            <div style={{ display: "grid", gap: 8, maxHeight: 330, overflow: "auto" }}>
              {sequences.map((sequence) => {
                const active = Number(sequence.SequenceId) === Number(selectedSequenceId);
                return (
                  <div
                    key={sequence.SequenceId}
                    style={{
                      border: active ? "1px solid #F26522" : "1px solid #dbe4f2",
                      borderRadius: 8,
                      padding: 8,
                      background: active ? "#fff7ed" : "#ffffff",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => handleSequenceSelection(Number(sequence.SequenceId))}
                      style={{
                        border: "none",
                        background: "transparent",
                        width: "100%",
                        textAlign: "left",
                        cursor: "pointer",
                        padding: 0,
                      }}
                    >
                      <div style={{ fontWeight: 700, color: "#1F3A68" }}>{sequence.SequenceName}</div>
                      <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>
                        Status: {sequence.Status} • Steps: {sequence.StepCount ?? sequence.steps?.length ?? 0} • Contacts: {sequence.TotalContacts || 0}
                      </div>
                    </button>
                    <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
                      <button
                        type="button"
                        onClick={() => updateSequenceStatus(sequence.SequenceId, "ACTIVE")}
                        style={smallActionBtnStyle}
                      >
                        Activate
                      </button>
                      <button
                        type="button"
                        onClick={() => updateSequenceStatus(sequence.SequenceId, "INACTIVE")}
                        style={smallActionBtnStyle}
                      >
                        Deactivate
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div style={{ marginTop: 14, border: "1px solid #e2e8f0", borderRadius: 10, padding: 12 }}>
        <h3 style={{ margin: "0 0 8px", fontSize: 16, color: "#0f172a" }}>
          Enroll Contacts {selectedSequence ? `• ${selectedSequence.SequenceName}` : ""}
        </h3>

        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <input
            value={contactSearch}
            onChange={(e) => setContactSearch(e.target.value)}
            placeholder="Search contacts by name/company/email"
            style={{ ...inputStyle, margin: 0 }}
          />
          <button type="button" onClick={() => enrollSelectedContacts(false)} style={actionBtnStyle("primary")}>
            Enroll Selected ({selectedContactIdList.length})
          </button>
        </div>

        <div style={{ border: "1px solid #dbe4f2", borderRadius: 8, overflow: "auto", maxHeight: 240 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead style={{ background: "#0f1f3d" }}>
              <tr>
                {"Select,Contact,Company,Email,Owner".split(",").map((head) => (
                  <th key={head} style={{ color: "#fff", textAlign: "left", padding: "8px 10px", fontSize: 12 }}>{head}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {contactRows.map((contact) => (
                <tr key={contact.LeadContactID}>
                  <td style={tdStyle}>
                    <input
                      type="checkbox"
                      checked={Boolean(selectedContactIds[contact.LeadContactID])}
                      onChange={(e) =>
                        setSelectedContactIds((prev) => ({
                          ...prev,
                          [contact.LeadContactID]: e.target.checked,
                        }))
                      }
                    />
                  </td>
                  <td style={tdStyle}>{contact.ContactName || "—"}</td>
                  <td style={tdStyle}>{contact.CompanyName || "—"}</td>
                  <td style={tdStyle}>{contact.ContactEmail || "—"}</td>
                  <td style={tdStyle}>{contact.OwnerName || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ marginTop: 14, border: "1px solid #e2e8f0", borderRadius: 10, padding: 12 }}>
        <h3 style={{ margin: "0 0 8px", fontSize: 16, color: "#0f172a" }}>
          Sequence Progress {selectedSequence ? `• ${selectedSequence.SequenceName}` : ""}
        </h3>
        <div style={{ border: "1px solid #dbe4f2", borderRadius: 8, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
            <thead style={{ background: "#0f1f3d" }}>
              <tr>
                {"Contact,Email,Company,Current Step,Last Sent,Last Status,Next Template,Next Scheduled,Status,Actions".split(",").map((head) => (
                  <th key={head} style={{ color: "#fff", textAlign: "left", padding: "8px 10px", fontSize: 12 }}>{head}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {progressRows.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ padding: 12, color: "#64748b", textAlign: "center" }}>
                    No sequence contacts enrolled.
                  </td>
                </tr>
              ) : (
                progressRows.map((row) => {
                  const status = String(row.Status || "").toUpperCase();
                  const sequenceActive = String(selectedSequence?.Status || "").toUpperCase() === "ACTIVE";
                  const busy = Number(actionLoadingId) === Number(row.SequenceContactId);
                  return (
                  <tr key={row.SequenceContactId}>
                    <td style={tdStyle}>{row.ContactName || "—"}</td>
                    <td style={tdStyle}>{row.ContactEmail || "—"}</td>
                    <td style={tdStyle}>{row.CompanyName || "—"}</td>
                    <td style={tdStyle}>{row.CurrentStep || "—"}</td>
                    <td style={tdStyle}>{formatLocaleDateTime(row.LastEmailSentAt, undefined, "—")}</td>
                    <td style={tdStyle}>{row.LastEmailStatus || "—"}</td>
                    <td style={tdStyle}>{row.NextTemplateName || "—"}</td>
                    <td style={tdStyle}>{formatLocaleDateTime(row.NextActionAt, undefined, "—")}</td>
                    <td style={tdStyle}>{row.Status || "—"}</td>
                    <td style={tdStyle}>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {status === "ACTIVE" ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => updateEnrollmentAction(row.SequenceContactId, "pause")}
                            style={smallActionBtnStyle}
                          >
                            {busy ? "Working..." : "Pause"}
                          </button>
                        ) : null}
                        {status === "PAUSED" ? (
                          <button
                            type="button"
                            disabled={busy || !sequenceActive}
                            onClick={() => updateEnrollmentAction(row.SequenceContactId, "resume")}
                            style={smallBtnStyle(busy || !sequenceActive)}
                            title={sequenceActive ? "Resume this contact" : "Sequence must be ACTIVE to resume"}
                          >
                            {busy ? "Working..." : "Resume"}
                          </button>
                        ) : null}
                        {status !== "REMOVED" ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => updateEnrollmentAction(row.SequenceContactId, "remove")}
                            style={smallActionBtnStyle}
                          >
                            {busy ? "Working..." : "Remove"}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedSequence?.steps?.length ? (
        <div style={{ marginTop: 14, border: "1px solid #e2e8f0", borderRadius: 10, padding: 12 }}>
          <h3 style={{ margin: "0 0 8px", fontSize: 16, color: "#0f172a" }}>Selected Sequence Steps</h3>
          <div style={{ display: "grid", gap: 6 }}>
            {selectedSequence.steps.map((step) => (
              <div key={step.StepId || step.StepOrder} style={{ fontSize: 13, color: "#334155" }}>
                Step {step.StepOrder}: {step.TemplateName || `Template #${step.TemplateId}`} • Delay: {formatDelay(step.DelayMinutes)}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  marginBottom: 8,
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 13,
  color: "#0f172a",
  background: "#fff",
};

const tdStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#0f172a",
  padding: "8px 10px",
  borderBottom: "1px solid #e2e8f0",
  verticalAlign: "top",
};

function actionBtnStyle(variant: "primary" | "secondary"): React.CSSProperties {
  return {
    border: variant === "primary" ? "1px solid #F26522" : "1px solid #1F3A68",
    borderRadius: 8,
    background: variant === "primary" ? "#F26522" : "#fff",
    color: variant === "primary" ? "#fff" : "#1F3A68",
    fontWeight: 700,
    fontSize: 12,
    padding: "8px 10px",
    cursor: "pointer",
  };
}

const smallActionBtnStyle: React.CSSProperties = {
  border: "1px solid #1F3A68",
  borderRadius: 7,
  background: "#fff",
  color: "#1F3A68",
  fontSize: 11,
  fontWeight: 700,
  padding: "5px 8px",
  cursor: "pointer",
};

function smallBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    background: disabled ? "#f1f5f9" : "#fff",
    color: disabled ? "#94a3b8" : "#334155",
    fontSize: 12,
    padding: "8px 10px",
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

