"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  plainTextToEmailHtmlWithOptions,
  renderTemplateVariables,
  renderEmailTemplateWithVariables,
} from "@/app/utils/email-content";

export type SendEmailRecipient = {
  key: string;
  leadContactId: number | null;
  leadId: number | string;
  companyName: string;
  contactName: string;
  contactTitle: string;
  contactRoleName: string;
  contactEmail: string;
};

type EmailTemplateItem = {
  TemplateId: number;
  TemplateName: string;
  Subject: string;
  Body: string;
  UpdatedAt: string | null;
};

export type DeferredEmailActionPayload = {
  action: "send_now" | "schedule";
  templateId: number | null;
  subject: string;
  body: string;
  scheduleAt: string | null;
  attachments: Array<{
    localId: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    contentBase64: string;
    isInline: boolean;
    contentId: string | null;
  }>;
  recipientCount: number;
  recipients: Array<{
    key: string;
    leadContactId: number;
    leadId: number | string;
    companyName: string;
    contactName: string;
    firstName: string;
    email: string;
    renderedSubject: string;
    renderedBody: string;
  }>;
};

export type SendNowResult = {
  success: boolean;
  message: string;
  sentCount?: number;
  failedCount?: number;
};

type Props = {
  contacts: SendEmailRecipient[];
  onClose: () => void;
  onSendNow: (payload: DeferredEmailActionPayload) => Promise<SendNowResult>;
  onSchedule: (payload: DeferredEmailActionPayload) => void;
};

const PERSONALIZATION_VARIABLES = [
  "{{firstName}}",
  "{{companyName}}",
  "{{contactName}}",
  "{{senderName}}",
];

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

const ATTACHMENT_ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/png",
  "image/jpeg",
]);

const INLINE_IMAGE_ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg"]);

const ATTACHMENT_LIMITS = {
  maxFiles: 10,
  maxFileSizeBytes: 5 * 1024 * 1024,
  maxTotalSizeBytes: 20 * 1024 * 1024,
};

type LocalEmailAttachment = {
  localId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  contentBase64: string;
  isInline: boolean;
  contentId: string | null;
};

function isValidEmail(value: string): boolean {
  return emailRegex.test(String(value || "").trim());
}

function extractFirstName(contactName: string): string {
  const normalized = String(contactName || "").trim();
  if (!normalized) return "";
  return normalized.split(/\s+/)[0] || "";
}

function getInitials(name: string): string {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (parts.length === 0) return "--";
  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

function toReadableSize(bytes: number): string {
  const n = Number(bytes || 0);
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.onload = () => {
      const result = String(reader.result || "");
      const parts = result.split(",");
      resolve(parts.length > 1 ? parts[1] : result);
    };
    reader.readAsDataURL(file);
  });
}

function normalizedMimeType(file: File): string {
  const t = String(file.type || "").trim().toLowerCase();
  if (t === "image/jpg") return "image/jpeg";
  return t;
}

function sanitizeContentId(rawName: string): string {
  const seed = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const base = String(rawName || "")
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "image"}-${seed}`;
}

function renderBodyWithVariables(template: string, recipient: SendEmailRecipient, senderName: string): string {
  return renderEmailTemplateWithVariables(template, {
    contactName: recipient.contactName || "",
    companyName: recipient.companyName || "",
    senderName,
  });
}

function renderSubjectWithVariables(
  template: string,
  recipient: SendEmailRecipient,
  senderName: string
): string {
  return renderTemplateVariables(template, {
    contactName: recipient.contactName || "",
    companyName: recipient.companyName || "",
    senderName,
  });
}

export default function SendEmailModal({
  contacts,
  onClose,
  onSendNow,
  onSchedule,
}: Props): JSX.Element {
  const [mounted, setMounted] = useState(false);
  const [templates, setTemplates] = useState<EmailTemplateItem[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [sendingNow, setSendingNow] = useState(false);
  const [senderName, setSenderName] = useState("");
  const [attachments, setAttachments] = useState<LocalEmailAttachment[]>([]);
  const [dragActive, setDragActive] = useState(false);

  const inlineContentIds = useMemo(
    () =>
      attachments
        .filter((item) => item.isInline && item.contentId)
        .map((item) => String(item.contentId || "")),
    [attachments]
  );

  const invalidRecipients = useMemo(
    () => contacts.filter((c) => !isValidEmail(c.contactEmail)),
    [contacts]
  );

  const validRecipients = useMemo(
    () =>
      contacts.filter(
        (c) => isValidEmail(c.contactEmail) && Number(c.leadContactId || 0) > 0
      ),
    [contacts]
  );

  const missingContactIdRecipients = useMemo(
    () => contacts.filter((c) => Number(c.leadContactId || 0) <= 0),
    [contacts]
  );

  const previewRows = useMemo(() => {
    return validRecipients.slice(0, 5).map((recipient) => ({
      recipient,
      renderedSubject: renderSubjectWithVariables(subject, recipient, senderName),
      renderedBody: renderBodyWithVariables(body, recipient, senderName),
    }));
  }, [validRecipients, subject, body, senderName]);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    const originalOverflow = document.body.style.overflow;
    const originalPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.paddingRight = originalPaddingRight;
    };
  }, [mounted]);

  useEffect(() => {
    let mounted = true;

    async function loadTemplates() {
      setLoadingTemplates(true);
      setError(null);

      try {
        const res = await fetch("/api/employees/email-templates", {
          credentials: "include",
        });

        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(
            data?.error ?? `Failed to fetch templates (${res.status})`
          );
        }

        const data = (await res.json()) as EmailTemplateItem[];
        if (!mounted) return;
        setTemplates(Array.isArray(data) ? data : []);
      } catch (err: any) {
        if (!mounted) return;
        setTemplates([]);
        setError(err?.message ?? "Failed to load templates");
      } finally {
        if (mounted) setLoadingTemplates(false);
      }
    }

    loadTemplates();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadCurrentUserName() {
      try {
        const res = await fetch("/api/auth/me", {
          credentials: "include",
        });
        const data = await res.json().catch(() => null);
        if (!mounted) return;
        setSenderName(String(data?.name || "").trim());
      } catch {
        if (!mounted) return;
        setSenderName("");
      }
    }

    loadCurrentUserName();

    return () => {
      mounted = false;
    };
  }, []);

  function handleTemplateSelect(nextTemplateId: string) {
    setSelectedTemplateId(nextTemplateId);

    if (!nextTemplateId) return;
    const found = templates.find(
      (template) => String(template.TemplateId) === nextTemplateId
    );

    if (!found) return;

    setSubject(String(found.Subject || ""));
    setBody(String(found.Body || ""));
  }

  function insertVariable(variable: string, field: "subject" | "body") {
    if (field === "subject") {
      setSubject((prev) => `${prev}${prev ? " " : ""}${variable}`);
      return;
    }

    setBody((prev) => `${prev}${prev ? " " : ""}${variable}`);
  }

  function buildDeferredPayload(
    action: "send_now" | "schedule"
  ): DeferredEmailActionPayload {
    const scheduleAt =
      action === "schedule" && scheduleDate && scheduleTime
        ? new Date(`${scheduleDate}T${scheduleTime}:00`).toISOString()
        : null;

    return {
      action,
      templateId: selectedTemplateId ? Number(selectedTemplateId) : null,
      subject: String(subject || "").trim(),
      body: String(body || "").trim(),
      scheduleAt,
      attachments,
      recipientCount: validRecipients.length,
      recipients: validRecipients.map((recipient) => ({
        key: recipient.key,
        leadContactId: Number(recipient.leadContactId),
        leadId: recipient.leadId,
        companyName: recipient.companyName,
        contactName: recipient.contactName,
        firstName: extractFirstName(recipient.contactName),
        email: recipient.contactEmail,
        renderedSubject: renderSubjectWithVariables(subject, recipient, senderName),
        renderedBody: renderBodyWithVariables(body, recipient, senderName),
      })),
    };
  }

  function validateBeforeAction(action: "send_now" | "schedule"): boolean {
    setError(null);
    setSuccessMessage(null);

    if (!subject.trim()) {
      setError("Subject is required");
      return false;
    }

    if (!body.trim()) {
      setError("Email body is required");
      return false;
    }

    if (invalidRecipients.length > 0) {
      setError("Remove or fix contacts without a valid email before sending.");
      return false;
    }

    if (validRecipients.length === 0) {
      setError("At least one valid recipient is required.");
      return false;
    }

    if (missingContactIdRecipients.length > 0) {
      setError("One or more recipients are missing contact identity. Please reselect contacts.");
      return false;
    }

    if (attachments.length > ATTACHMENT_LIMITS.maxFiles) {
      setError(`A maximum of ${ATTACHMENT_LIMITS.maxFiles} attachments is allowed.`);
      return false;
    }

    const totalSize = attachments.reduce((sum, item) => sum + Number(item.sizeBytes || 0), 0);
    if (totalSize > ATTACHMENT_LIMITS.maxTotalSizeBytes) {
      setError("Total attachment size exceeds 20MB.");
      return false;
    }

    if (action === "schedule" && (!scheduleDate || !scheduleTime)) {
      setError("Schedule date and time are required.");
      return false;
    }

    if (action === "schedule") {
      const scheduledAt = new Date(`${scheduleDate}T${scheduleTime}:00`);
      if (Number.isNaN(scheduledAt.getTime())) {
        setError("Schedule date/time is invalid.");
        return false;
      }

      if (scheduledAt.getTime() <= Date.now()) {
        setError("Scheduled time must be in the future.");
        return false;
      }
    }

    return true;
  }

  async function handleSendNow() {
    if (!validateBeforeAction("send_now")) return;

    setSendingNow(true);
    const payload = buildDeferredPayload("send_now");
    try {
      const result = await onSendNow(payload);
      if (result.success) {
        setSuccessMessage(result.message || "Email sent successfully.");
        setError(null);
      } else {
        setError(result.message || "Failed to send email.");
      }
    } catch (err: any) {
      setError(err?.message || "Failed to send email.");
    } finally {
      setSendingNow(false);
    }
  }

  async function handleAddFiles(fileList: FileList | File[], asInline: boolean): Promise<void> {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    const availableSlots = ATTACHMENT_LIMITS.maxFiles - attachments.length;
    if (availableSlots <= 0) {
      setError(`A maximum of ${ATTACHMENT_LIMITS.maxFiles} attachments is allowed.`);
      return;
    }

    const takeFiles = files.slice(0, availableSlots);
    const next: LocalEmailAttachment[] = [];
    const currentTotal = attachments.reduce((sum, item) => sum + Number(item.sizeBytes || 0), 0);
    let runningTotal = currentTotal;

    for (const file of takeFiles) {
      const contentType = normalizedMimeType(file);
      if (!ATTACHMENT_ALLOWED_MIME_TYPES.has(contentType)) {
        setError(`${file.name} is not an allowed file type.`);
        continue;
      }

      if (file.size > ATTACHMENT_LIMITS.maxFileSizeBytes) {
        setError(`${file.name} exceeds 5MB size limit.`);
        continue;
      }

      if (asInline && !INLINE_IMAGE_ALLOWED_MIME_TYPES.has(contentType)) {
        setError(`${file.name} cannot be inserted inline. Use PNG or JPEG.`);
        continue;
      }

      runningTotal += file.size;
      if (runningTotal > ATTACHMENT_LIMITS.maxTotalSizeBytes) {
        setError("Total attachment size exceeds 20MB.");
        break;
      }

      try {
        const contentBase64 = await toBase64(file);
        const contentId = asInline ? sanitizeContentId(file.name) : null;
        next.push({
          localId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          fileName: String(file.name || "attachment"),
          contentType,
          sizeBytes: Number(file.size || 0),
          contentBase64,
          isInline: asInline,
          contentId,
        });

        if (asInline && contentId) {
          setBody((prev) => {
            const token = `{{inlineImage:${contentId}}}`;
            return `${prev}${prev ? "\n" : ""}${token}`;
          });
        }
      } catch (err: any) {
        setError(err?.message || `Failed to process ${file.name}`);
      }
    }

    if (next.length > 0) {
      setAttachments((prev) => [...prev, ...next]);
    }
  }

  function removeAttachment(localId: string): void {
    setAttachments((prev) => prev.filter((item) => item.localId !== localId));
  }

  function handleSchedule() {
    if (!validateBeforeAction("schedule")) return;
    const payload = buildDeferredPayload("schedule");
    onSchedule(payload);
  }

  if (!mounted) {
    return <></>;
  }

  return createPortal(
    <div style={overlayStyle} onClick={onClose} role="dialog" aria-modal="true">
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerShellStyle}>
          <div style={headerLeftStyle}>
            <div style={headerIconStyle} aria-hidden="true">
              ✈
            </div>
            <div>
              <h3 style={headerTitleStyle}>Send Email</h3>
              <div style={headerSubtitleStyle}>
                Send a personalized email to your selected contacts
              </div>
            </div>
          </div>
          <button type="button" onClick={onClose} style={iconCloseButtonStyle} aria-label="Close">
            ×
          </button>
        </div>

        {error && <div style={errorStyle}>{error}</div>}
        {successMessage && <div style={successStyle}>{successMessage}</div>}

        {invalidRecipients.length > 0 && (
          <div style={warningStyle}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>
              Some selected contacts have invalid email and cannot be sent:
            </div>
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              {invalidRecipients.map((recipient) => (
                <li key={recipient.key}>
                  {recipient.contactName || "-"} ({recipient.companyName || "-"}) —{" "}
                  {recipient.contactEmail || "missing"}
                </li>
              ))}
            </ul>
          </div>
        )}

        {missingContactIdRecipients.length > 0 && (
          <div style={warningStyle}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>
              Some selected rows cannot be sent because contact identity is missing:
            </div>
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              {missingContactIdRecipients.map((recipient) => (
                <li key={`missing-id-${recipient.key}`}>
                  {recipient.contactName || "-"} ({recipient.companyName || "-"})
                </li>
              ))}
            </ul>
          </div>
        )}

        <div style={sectionLabelStyle}>
          Selected Recipients ({contacts.length})
        </div>
        <div style={recipientListWrapStyle}>
          <table style={recipientTableStyle}>
            <thead>
              <tr>
                <th style={recipientThStyle} />
                <th style={recipientThStyle}>Contact</th>
                <th style={recipientThStyle}>Company</th>
                <th style={recipientThStyle}>Email</th>
                <th style={recipientThStyle}>Status</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((recipient, index) => {
                const valid = isValidEmail(recipient.contactEmail);
                return (
                  <tr
                    key={recipient.key}
                    style={{ background: index % 2 === 0 ? "#fff" : "#f8fbff" }}
                  >
                    <td style={recipientTdStyle}>
                      <span style={recipientAvatarStyle}>
                        {getInitials(recipient.contactName)}
                      </span>
                    </td>
                    <td style={recipientTdStyle}>{recipient.contactName || "-"}</td>
                    <td style={recipientTdStyle}>{recipient.companyName || "-"}</td>
                    <td style={recipientTdStyle}>{recipient.contactEmail || "-"}</td>
                    <td style={recipientTdStyle}>
                      <span
                        style={{
                          ...statusPillStyle,
                          background: valid ? "#dcfce7" : "#fee2e2",
                          color: valid ? "#166534" : "#991b1b",
                        }}
                      >
                        {valid ? "Valid" : "Invalid"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={editorGridStyle}>
          <label style={labelStyle}>
            <span style={requiredLabelStyle}>Email Template *</span>
            <div style={templateRowStyle}>
              <select
                value={selectedTemplateId}
                onChange={(e) => handleTemplateSelect(e.target.value)}
                style={inputStyle}
                disabled={loadingTemplates}
              >
                <option value="">Select a template</option>
                {templates.map((template) => (
                  <option key={template.TemplateId} value={String(template.TemplateId)}>
                    {template.TemplateName}
                  </option>
                ))}
              </select>
            </div>
          </label>

          <div style={variablesRowStyle}>
            <div style={variableWrapStyle}>
              <div style={{ fontSize: 12, color: "#1F3A68", fontWeight: 700 }}>
                Available Variables
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                {PERSONALIZATION_VARIABLES.map((variable) => (
                  <button
                    key={variable}
                    type="button"
                    onClick={() => insertVariable(variable, "body")}
                    style={chipStyle}
                  >
                    {variable}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                {PERSONALIZATION_VARIABLES.map((variable) => (
                  <button
                    key={`${variable}-subject`}
                    type="button"
                    onClick={() => insertVariable(variable, "subject")}
                    style={secondaryChipStyle}
                  >
                    + Subject: {variable}
                  </button>
                ))}
              </div>
            </div>

            <div style={infoCardStyle}>
              <div style={infoCardIconStyle} aria-hidden="true">
                i
              </div>
              <div>
                Variables will be automatically replaced with actual contact data when email is
                sent.
              </div>
            </div>
          </div>

          <label style={labelStyle}>
            <span style={requiredLabelStyle}>Subject *</span>
            <div style={subjectInputWrapStyle}>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                style={{ ...inputStyle, border: "none", padding: "8px 10px" }}
                placeholder="Write subject"
              />
              {/* <span style={subjectEmojiStyle} aria-hidden="true">
                ☺
              </span> */}
            </div>
          </label>

          <label style={labelStyle}>
            <span style={requiredLabelStyle}>Email Body *</span>
            <div style={editorShellStyle}>
              {/* <div style={editorToolbarStyle}>
                <span style={toolbarBadgeStyle}>Inter</span>
                <span style={toolbarBadgeStyle}>14</span>
                <span style={toolbarBtnStyle}>B</span>
                <span style={{ ...toolbarBtnStyle, fontStyle: "italic" }}>I</span>
                <span style={{ ...toolbarBtnStyle, textDecoration: "underline" }}>U</span>
                <span style={toolbarBtnStyle}>•</span>
                <span style={toolbarBtnStyle}>1.</span>
                <span style={toolbarDividerStyle} />
                <span style={toolbarBtnStyle}>↔</span>
                <span style={toolbarBtnStyle}>🔗</span>
                <span style={toolbarBtnStyle}>🖼</span>
                <span style={{ ...toolbarBtnStyle, marginLeft: "auto" }}>Variables ▾</span>
              </div> */}
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={10}
                style={bodyTextareaStyle}
                placeholder="Write email body"
              />
              <div style={wordCounterStyle}>Words: {String(body || "").trim().split(/\s+/).filter(Boolean).length}</div>
            </div>
          </label>

          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={requiredLabelStyle}>Attachments</span>
              <label style={secondaryActionStyle}>
                Add Files
                <input
                  type="file"
                  multiple
                  accept=".pdf,.docx,.xlsx,.png,.jpg,.jpeg,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/png,image/jpeg"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    if (e.target.files) {
                      void handleAddFiles(e.target.files, false);
                    }
                    e.currentTarget.value = "";
                  }}
                />
              </label>

              <label style={secondaryActionStyle}>
                Insert Image
                <input
                  type="file"
                  multiple
                  accept=".png,.jpg,.jpeg,image/png,image/jpeg"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    if (e.target.files) {
                      void handleAddFiles(e.target.files, true);
                    }
                    e.currentTarget.value = "";
                  }}
                />
              </label>

              <span style={{ color: "#64748b", fontSize: 12 }}>
                PDF, DOCX, XLSX, PNG, JPG/JPEG • max 5MB each • total 20MB
              </span>
            </div>

            <div
              onDragEnter={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragActive(true);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragActive(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragActive(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragActive(false);
                if (e.dataTransfer?.files?.length) {
                  void handleAddFiles(e.dataTransfer.files, false);
                }
              }}
              style={{
                border: `1px dashed ${dragActive ? "#2563eb" : "#cbd5e1"}`,
                background: dragActive ? "#eff6ff" : "#f8fafc",
                borderRadius: 10,
                padding: "12px 14px",
                color: "#334155",
                fontSize: 12,
              }}
            >
              Drag and drop files here
            </div>

            {attachments.length > 0 && (
              <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
                {attachments.map((file) => (
                  <div
                    key={file.localId}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      padding: "8px 10px",
                      borderBottom: "1px solid #eef2f7",
                      background: "#fff",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {file.fileName}
                      </div>
                      <div style={{ fontSize: 11, color: "#64748b" }}>
                        {toReadableSize(file.sizeBytes)}
                        {file.isInline ? ` • Inline (${file.contentId})` : ""}
                      </div>
                    </div>
                    <button
                      type="button"
                      style={{ ...cancelActionStyle, padding: "4px 8px", fontSize: 11 }}
                      onClick={() => removeAttachment(file.localId)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={actionWrapStyle}>
          <button
            type="button"
            onClick={() => setPreviewOpen((prev) => !prev)}
            style={secondaryActionStyle}
          >
            {previewOpen ? "Hide Preview" : "Preview Email"}
          </button>

          <div style={actionsRightStyle}>
            <label style={scheduleLabelStyle}>
              <span>Schedule Date</span>
              <input
                type="date"
                value={scheduleDate}
                onChange={(e) => setScheduleDate(e.target.value)}
                style={scheduleInputStyle}
              />
            </label>

            <label style={scheduleLabelStyle}>
              <span>Schedule Time</span>
              <input
                type="time"
                value={scheduleTime}
                onChange={(e) => setScheduleTime(e.target.value)}
                style={scheduleInputStyle}
              />
            </label>

            <button type="button" onClick={handleSchedule} style={secondaryActionStyle}>
              Schedule Email
            </button>
            <button
              type="button"
              onClick={handleSendNow}
              style={primaryActionStyle}
              disabled={sendingNow}
            >
              {sendingNow ? "Sending..." : "Send Now"}
            </button>
            <button type="button" onClick={onClose} style={cancelActionStyle}>
              Cancel
            </button>
          </div>
        </div>

        {previewOpen && (
          <div style={previewWrapStyle}>
            <div style={{ fontWeight: 700, color: "#1F3A68", marginBottom: 8 }}>
              Personalized Preview (showing up to 5 recipients)
            </div>
            {previewRows.length === 0 ? (
              <div style={{ color: "#64748b", fontSize: 12 }}>No valid recipients to preview.</div>
            ) : (
              previewRows.map(({ recipient, renderedSubject, renderedBody }) => (
                <div key={`preview-${recipient.key}`} style={previewCardStyle}>
                  <div style={{ fontSize: 12, color: "#475569", marginBottom: 6 }}>
                    To: {recipient.contactName || "-"} ({recipient.contactEmail || "-"})
                  </div>
                  <div style={{ fontSize: 12, color: "#0F1F3D", fontWeight: 700 }}>
                    Subject: {renderedSubject || "-"}
                  </div>
                  <div
                    style={{
                      marginTop: 6,
                      fontSize: 12,
                      color: "#1e293b",
                      lineHeight: 1.45,
                    }}
                    dangerouslySetInnerHTML={{
                      __html:
                        plainTextToEmailHtmlWithOptions(renderedBody || "", {
                          inlineContentIds,
                        }) || "-",
                    }}
                  />
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

const LAYER = {
  page: 1,
  shell: 100,
  backdrop: 1200,
  modal: 1210,
} as const;

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  width: "100vw",
  height: "100vh",
  background: "rgba(15, 31, 61, 0.5)",
  zIndex: LAYER.backdrop,
  display: "flex",
  justifyContent: "center",
  alignItems: "flex-start",
  overflowY: "auto",
  padding: 20,
};

const modalStyle: React.CSSProperties = {
  width: "min(1080px, 100%)",
  maxHeight: "90vh",
  overflowY: "auto",
  background: "#ffffff",
  borderRadius: 12,
  border: "1px solid #e3eaf7",
  boxShadow: "0 20px 52px rgba(15, 23, 42, 0.28)",
  margin: "auto 0",
  position: "relative",
  zIndex: LAYER.modal,
  padding: 0,
  display: "grid",
  gap: 0,
};

const headerShellStyle: React.CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 1,
  padding: "16px 22px",
  borderBottom: "1px solid #ebf0f8",
  background: "#ffffff",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
};

const headerLeftStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
};

const headerIconStyle: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: "50%",
  background: "#e9f1ff",
  color: "#2563eb",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 18,
  fontWeight: 700,
};

const headerTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 38 / 2,
  color: "#102a56",
  lineHeight: 1.2,
};

const headerSubtitleStyle: React.CSSProperties = {
  marginTop: 4,
  fontSize: 13,
  color: "#4b5f82",
};

const iconCloseButtonStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "#1e3a67",
  fontSize: 30,
  lineHeight: 1,
  cursor: "pointer",
  padding: "2px 6px",
};

const sectionLabelStyle: React.CSSProperties = {
  margin: "14px 22px 8px",
  fontSize: 14,
  color: "#2a4169",
  fontWeight: 700,
};

const errorStyle: React.CSSProperties = {
  border: "1px solid #fecaca",
  background: "#fef2f2",
  color: "#991b1b",
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 12,
  margin: "12px 22px 0",
};

const successStyle: React.CSSProperties = {
  border: "1px solid #bbf7d0",
  background: "#f0fdf4",
  color: "#166534",
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 12,
  margin: "12px 22px 0",
};

const warningStyle: React.CSSProperties = {
  border: "1px solid #fcd34d",
  background: "#fffbeb",
  color: "#92400e",
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 12,
  margin: "12px 22px 0",
};

const recipientListWrapStyle: React.CSSProperties = {
  margin: "0 22px",
  border: "1px solid #e2e8f0",
  borderRadius: 10,
  overflowX: "auto",
};

const recipientTableStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 760,
  borderCollapse: "collapse",
};

const recipientThStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "9px 10px",
  borderBottom: "1px solid #e5ebf6",
  background: "#ffffff",
  color: "#475569",
  fontSize: 12,
  fontWeight: 700,
};

const recipientTdStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "9px 10px",
  borderBottom: "1px solid #eef2f7",
  color: "#1f2937",
  fontSize: 12,
  verticalAlign: "top",
};

const recipientAvatarStyle: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: "50%",
  background: "#ede9fe",
  color: "#5b21b6",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 700,
};

const statusPillStyle: React.CSSProperties = {
  borderRadius: 999,
  padding: "3px 8px",
  fontSize: 11,
  fontWeight: 700,
};

const editorGridStyle: React.CSSProperties = {
  display: "grid",
  gap: 12,
  padding: "12px 22px 14px",
};

const labelStyle: React.CSSProperties = {
  display: "grid",
  gap: 7,
  fontSize: 12,
  color: "#475569",
};

const requiredLabelStyle: React.CSSProperties = {
  fontWeight: 700,
  color: "#334155",
};

const templateRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr auto",
  gap: 10,
  alignItems: "center",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  border: "1px solid rgba(31, 58, 104, 0.2)",
  borderRadius: 8,
  padding: "9px 10px",
  fontFamily: "inherit",
  color: "#0F1F3D",
  background: "#fff",
};

const variablesRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr minmax(220px, 300px)",
  gap: 10,
  alignItems: "start",
};

const variableWrapStyle: React.CSSProperties = {
  border: "1px dashed rgba(31, 58, 104, 0.26)",
  borderRadius: 8,
  background: "#f8fbff",
  padding: 10,
};

const infoCardStyle: React.CSSProperties = {
  border: "1px solid #dbeafe",
  borderRadius: 10,
  background: "#f8fbff",
  color: "#1e3a8a",
  padding: "10px 12px",
  display: "flex",
  gap: 8,
  fontSize: 12,
  lineHeight: 1.35,
};

const infoCardIconStyle: React.CSSProperties = {
  width: 16,
  height: 16,
  borderRadius: "50%",
  background: "#dbeafe",
  color: "#1d4ed8",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 700,
  flexShrink: 0,
};

const chipStyle: React.CSSProperties = {
  border: "1px solid rgba(31, 58, 104, 0.22)",
  background: "#fff",
  color: "#1F3A68",
  borderRadius: 999,
  padding: "5px 10px",
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
};

const secondaryChipStyle: React.CSSProperties = {
  ...chipStyle,
  background: "rgba(31, 58, 104, 0.08)",
};

const subjectInputWrapStyle: React.CSSProperties = {
  width: "100%",
  border: "1px solid rgba(31, 58, 104, 0.2)",
  borderRadius: 10,
  display: "flex",
  alignItems: "center",
  paddingRight: 8,
};

const subjectEmojiStyle: React.CSSProperties = {
  color: "#64748b",
  fontSize: 16,
};

const editorShellStyle: React.CSSProperties = {
  border: "1px solid rgba(31, 58, 104, 0.2)",
  borderRadius: 10,
  overflow: "hidden",
};

const editorToolbarStyle: React.CSSProperties = {
  borderBottom: "1px solid #e5ebf6",
  padding: "8px 10px",
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
  background: "#fff",
};

const toolbarBadgeStyle: React.CSSProperties = {
  border: "1px solid #d6deed",
  borderRadius: 6,
  padding: "3px 8px",
  fontSize: 12,
  color: "#334155",
};

const toolbarBtnStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#334155",
  lineHeight: 1,
};

const toolbarDividerStyle: React.CSSProperties = {
  width: 1,
  height: 16,
  background: "#d6deed",
};

const bodyTextareaStyle: React.CSSProperties = {
  width: "100%",
  border: "none",
  padding: "12px 12px 8px",
  resize: "vertical",
  minHeight: 190,
  fontFamily: "inherit",
  color: "#0F1F3D",
  outline: "none",
};

const wordCounterStyle: React.CSSProperties = {
  borderTop: "1px solid #e5ebf6",
  padding: "7px 10px",
  textAlign: "right",
  color: "#64748b",
  fontSize: 12,
};

const actionWrapStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  flexWrap: "wrap",
  padding: "0 22px 18px",
};

const actionsRightStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
};

const scheduleLabelStyle: React.CSSProperties = {
  display: "grid",
  gap: 4,
  fontSize: 11,
  color: "#475569",
};

const scheduleInputStyle: React.CSSProperties = {
  border: "1px solid rgba(31, 58, 104, 0.2)",
  borderRadius: 8,
  padding: "8px 10px",
  fontFamily: "inherit",
};

const primaryActionStyle: React.CSSProperties = {
  border: "1px solid #F26522",
  background: "#F26522",
  color: "#fff",
  borderRadius: 8,
  padding: "8px 12px",
  fontWeight: 700,
  cursor: "pointer",
};

const secondaryActionStyle: React.CSSProperties = {
  border: "1px solid #1F3A68",
  background: "#fff",
  color: "#1F3A68",
  borderRadius: 8,
  padding: "8px 12px",
  fontWeight: 700,
  cursor: "pointer",
};

const cancelActionStyle: React.CSSProperties = {
  border: "1px solid #cbd5e1",
  background: "#fff",
  color: "#475569",
  borderRadius: 8,
  padding: "8px 12px",
  fontWeight: 700,
  cursor: "pointer",
};

const previewWrapStyle: React.CSSProperties = {
  margin: "0 22px 22px",
  border: "1px solid #dbe4f2",
  borderRadius: 10,
  background: "#f8fbff",
  padding: 10,
};


const previewCardStyle: React.CSSProperties = {
  border: "1px solid #e5eaf4",
  borderRadius: 8,
  background: "#ffffff",
  padding: 10,
  marginBottom: 8,
};

