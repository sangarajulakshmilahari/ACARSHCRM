import {
  ACARSH_FIELDS,
  FIELD_LABELS,
  REQUIRED_FIELDS,
  type AcarshField,
} from "@/app/api/ai/assistant/lead-import/mapping";
import {
  COMBINED_CONTACT_TRANSFORMS,
  isCombinedContactMapping,
} from "@/app/api/lib/combined-contacts";
import {
  isColumnCombineSpec,
  isCombineableField,
} from "@/app/api/lib/column-combine";
import type {
  CustomFieldPublic,
  CustomMappingSpec,
  DuplicatePolicy,
  ImportJob,
  ImportJobStatus,
  ImportMappingValue,
  InvalidRowResolution,
  LeadImportDefaults,
  LeadImportPreviewRow,
} from "./leadImportApi";
import { isMissingCompanyContactRow } from "@/app/api/lib/import-row-resolutions";

export type WizardStep = "upload" | "sheet" | "map" | "preview" | "resolve" | "confirm" | "result";
export type ResolveFilter = "all" | "unresolved" | "resolved" | "skipped";
export type ResolveBulkAction = "assign_existing" | "create_company" | "skip";

export const IMPORT_ACCEPT = ".xlsx,.xls,.csv";
export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 2000;

export function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isAllowedImportFile(file: File) {
  return /\.(xlsx|xls|csv)$/i.test(file.name);
}

export function clientFileError(file: File | null) {
  if (!file) return "Choose an Excel or CSV file to continue.";
  if (!isAllowedImportFile(file)) return `${file.name} has an unsupported format. Only XLS, XLSX, and CSV are allowed.`;
  if (file.size <= 0) return `${file.name} is empty or unreadable.`;
  if (file.size > IMPORT_MAX_BYTES) return `${file.name} exceeds the 10 MB file size limit.`;
  return null;
}

export function stepFromJob(job: ImportJob | null, preferred?: WizardStep): WizardStep {
  if (!job) return "upload";
  if (job.status === "completed" || job.status === "failed") return "result";
  if (job.status === "confirming") return "confirm";
  if (preferred === "sheet") return "sheet";
  if (preferred === "map" && (job.status === "uploaded" || job.status === "previewed")) return "map";
  if (preferred === "preview" && job.status === "previewed") return "preview";
  if (preferred === "resolve" && job.status === "previewed") return "resolve";
  if (preferred === "confirm" && job.status === "previewed" && job.canConfirm) return "confirm";
  if (job.status === "previewed") return "preview";
  return "map";
}

export function isStandardMapping(value: ImportMappingValue | undefined | ""): value is AcarshField {
  return typeof value === "string" && (ACARSH_FIELDS as readonly string[]).includes(value);
}

export function isCustomMapping(value: ImportMappingValue | undefined | ""): value is CustomMappingSpec {
  return Boolean(value && typeof value === "object" && (value.kind === "custom" || value.kind === "new"));
}

export function usedMappingFields(mapping: Record<string, ImportMappingValue>) {
  return new Set(Object.values(mapping).filter(isStandardMapping));
}

function occupiedFields(value: ImportMappingValue): AcarshField[] {
  if (isStandardMapping(value)) return [value];
  if (isColumnCombineSpec(value)) return [value.field];
  if (isCombinedContactMapping(value)) {
    if (value.transform === "extract_contact_name") return ["contactName"];
    if (value.transform === "extract_email") return ["contactEmail"];
    return ["contactName", "contactEmail"];
  }
  return [];
}

function isIntentionalColumnCombine(mapping: Record<string, ImportMappingValue>, field: AcarshField, columns: string[]) {
  if (!isCombineableField(field)) return false;
  return columns.every((column) => {
    const value = mapping[column];
    return value === field || (isColumnCombineSpec(value) && value.field === field);
  });
}

export function mappingConflicts(mapping: Record<string, ImportMappingValue>) {
  const seen = new Map<AcarshField, string[]>();
  for (const [column, field] of Object.entries(mapping)) {
    for (const occupied of occupiedFields(field)) {
      const list = seen.get(occupied) || [];
      list.push(column);
      seen.set(occupied, list);
    }
  }
  return Array.from(seen.entries())
    .filter(([field, columns]) => columns.length > 1 && !isIntentionalColumnCombine(mapping, field, columns))
    .map(([field, columns]) => ({ field, columns, label: FIELD_LABELS[field] }));
}

export function customMappingConflicts(mapping: Record<string, ImportMappingValue>) {
  const seen = new Map<string, { label: string; columns: string[] }>();
  for (const [column, field] of Object.entries(mapping)) {
    if (!isCustomMapping(field)) continue;
    const key = field.kind === "custom"
      ? `id:${field.customFieldId}`
      : `new:${field.entityType}:${String(field.name || "").trim().toLowerCase()}`;
    const label = field.kind === "custom" ? `Custom field #${field.customFieldId}` : field.name || "New custom field";
    const current = seen.get(key) || { label, columns: [] };
    current.columns.push(column);
    seen.set(key, current);
  }
  return Array.from(seen.values()).filter((item) => item.columns.length > 1);
}

export function mappingSelectValue(value: ImportMappingValue | undefined): string {
  if (!value) return "";
  if (isStandardMapping(value)) return value;
  if (isColumnCombineSpec(value)) return value.field;
  if (isCombinedContactMapping(value)) return `combined:${value.transform}`;
  if (value.kind === "custom") return `custom:${value.customFieldId}`;
  return "new";
}

export function mappingFromSelectValue(
  value: string,
  column: string,
  customFields: CustomFieldPublic[],
  current?: ImportMappingValue,
): ImportMappingValue | "" {
  if (!value) return "";
  if (value === "new") {
    if (isCustomMapping(current) && current.kind === "new") return current;
    return {
      kind: "new",
      name: column,
      entityType: /\b(contact|person|email|phone|title|designation)\b/i.test(column) ? "contact" : "lead",
      fieldType: "text",
      required: false,
    };
  }
  if (value.startsWith("combined:")) {
    const transform = value.slice("combined:".length);
    if ((COMBINED_CONTACT_TRANSFORMS as readonly string[]).includes(transform)) {
      return { kind: "combined_contact", transform: transform as (typeof COMBINED_CONTACT_TRANSFORMS)[number] };
    }
    return "";
  }
  if (value.startsWith("custom:")) {
    const customFieldId = Number(value.slice("custom:".length));
    const found = customFields.find((field) => field.customFieldId === customFieldId);
    if (!found) return "";
    return { kind: "custom", customFieldId: found.customFieldId };
  }
  if (isStandardMapping(value as ImportMappingValue)) return value as AcarshField;
  return "";
}

export function missingPreviewRequirements(
  job: ImportJob | null,
  mapping: Record<string, ImportMappingValue>,
  defaults: LeadImportDefaults,
): string[] {
  if (!job) return ["Upload a spreadsheet before previewing."];
  if (job.status === "completed" || job.status === "confirming") {
    return ["This import can no longer change mappings."];
  }
  const missing: string[] = [];
  if (mappingConflicts(mapping).length > 0) {
    missing.push("Each ACARSH field can be assigned to only one column.");
  }
  if (customMappingConflicts(mapping).length > 0) {
    missing.push("Each custom field can be assigned to only one column.");
  }
  if (Object.values(mapping).some((value) => isCustomMapping(value) && value.kind === "new" && !String(value.name || "").trim())) {
    missing.push("Give every new custom field a name.");
  }
  for (const field of REQUIRED_FIELDS) {
    if (Object.values(mapping).some((value) => occupiedFields(value).includes(field))) continue;
    missing.push(`Map ${FIELD_LABELS[field]}.`);
  }
  const createsContacts = Object.values(mapping).some((value) => occupiedFields(value).includes("contactName"));
  if (createsContacts) {
    const hasRole =
      Object.values(mapping).some((value) => occupiedFields(value).includes("contactRole")) ||
      Boolean(String(defaults.contactRole || "").trim());
    if (!hasRole) missing.push("Map Contact Role, or fill in the default Contact Role.");
  }
  return missing;
}

export function mappingIsAcceptable(job: ImportJob, mapping: Record<string, ImportMappingValue>, defaults: LeadImportDefaults) {
  return missingPreviewRequirements(job, mapping, defaults).length === 0;
}

export function canContinueToPreview(job: ImportJob | null, mapping: Record<string, ImportMappingValue>, defaults: LeadImportDefaults) {
  if (!job) return false;
  if (job.status === "completed" || job.status === "confirming") return false;
  return mappingIsAcceptable(job, mapping, defaults);
}

export function canOpenConfirm(job: ImportJob | null) {
  return Boolean(job && job.status === "previewed" && job.canConfirm);
}

export function confirmButtonDisabled(options: {
  job: ImportJob | null;
  confirmInFlight: boolean;
  acknowledged: boolean;
}) {
  if (options.confirmInFlight) return true;
  if (!options.acknowledged) return true;
  if (!options.job) return true;
  if (options.job.status === "completed") return true;
  if (options.job.status === "confirming") return false;
  return !(options.job.status === "previewed" && options.job.canConfirm);
}

export function canRetryConfirm(job: ImportJob | null) {
  if (!job) return false;
  return job.status === "confirming" || (job.status === "completed" && (job.result?.failed.length || 0) > 0 && false);
}

export function duplicatePolicyLabel(policy: DuplicatePolicy) {
  return policy === "create_new" ? "Create new records for duplicates" : "Skip duplicate rows";
}

export function statusTone(status: ImportJobStatus | LeadImportPreviewRow["status"]) {
  switch (status) {
    case "new":
    case "existing_company_new_contact":
    case "completed":
      return { bg: "#ecfdf3", color: "#166534", border: "#bbf7d0" };
    case "duplicate":
    case "confirming":
      return { bg: "#fff7ed", color: "#9a3412", border: "#fed7aa" };
    case "needs_attention":
    case "uploaded":
      return { bg: "#eff6ff", color: "#1e40af", border: "#bfdbfe" };
    case "invalid":
    case "failed":
      return { bg: "#fef2f2", color: "#991b1b", border: "#fecaca" };
    default:
      return { bg: "#f8fafc", color: "#334155", border: "#e2e8f0" };
  }
}

export function previewRowLabel(status: LeadImportPreviewRow["status"]) {
  switch (status) {
    case "new":
      return "Ready";
    case "existing_company_new_contact":
      return "Existing company, new contact";
    case "duplicate":
      return "Duplicate";
    case "needs_attention":
      return "Needs attention";
    case "invalid":
      return "Invalid";
    default:
      return status;
  }
}

export function filterPreviewRows(rows: ImportJob["previewRows"], query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) =>
    [
      row.companyName,
      row.contactName,
      row.contactTitle,
      row.status,
      ...(row.reasons || []),
      ...(row.customValues || []).flatMap((item) => [item.fieldName, item.rawValue, item.normalizedValue || ""]),
      ...(row.extractedContacts || []).flatMap((item) => [item.name, item.email, ...(item.reasons || [])]),
    ]
      .join(" ")
      .toLowerCase()
      .includes(q),
  );
}

export function resolvableInvalidRows(rows: LeadImportPreviewRow[]) {
  return rows.filter((row) => isMissingCompanyContactRow(row));
}

export function rowResolutionStatus(resolution: InvalidRowResolution | undefined): "unresolved" | "resolved" | "skipped" {
  if (!resolution?.action) return "unresolved";
  if (resolution.action === "skip") return "skipped";
  if (String(resolution.companyName || "").trim()) return "resolved";
  return "unresolved";
}

export function resolutionStatusLabel(status: "unresolved" | "resolved" | "skipped") {
  if (status === "resolved") return "Resolved";
  if (status === "skipped") return "Skipped";
  return "Unresolved";
}

export function resolutionStatusTone(status: "unresolved" | "resolved" | "skipped") {
  if (status === "resolved") return { bg: "#ecfdf3", color: "#166534", border: "#bbf7d0" };
  if (status === "skipped") return { bg: "#f8fafc", color: "#475569", border: "#e2e8f0" };
  return { bg: "#fff7ed", color: "#9a3412", border: "#fed7aa" };
}

export function toggleSelectedRowNumbers(current: number[], rowNumber: number, checked: boolean) {
  const selected = new Set(current);
  if (checked) selected.add(rowNumber);
  else selected.delete(rowNumber);
  return Array.from(selected);
}

export function setPageRowSelection(current: number[], pageRowNumbers: number[], checked: boolean) {
  const selected = new Set(current);
  for (const rowNumber of pageRowNumbers) {
    if (checked) selected.add(rowNumber);
    else selected.delete(rowNumber);
  }
  return Array.from(selected);
}

export function unresolvedResolvableCount(rows: LeadImportPreviewRow[], resolutions: Record<string, InvalidRowResolution> | undefined) {
  return resolvableInvalidRows(rows).filter((row) => rowResolutionStatus(resolutions?.[String(row.rowNumber)]) === "unresolved").length;
}

export function filterResolvableRows(options: {
  rows: LeadImportPreviewRow[];
  resolutions: Record<string, InvalidRowResolution> | undefined;
  query: string;
  filter: ResolveFilter;
}) {
  const q = options.query.trim().toLowerCase();
  return resolvableInvalidRows(options.rows).filter((row) => {
    const resolution = options.resolutions?.[String(row.rowNumber)];
    const status = rowResolutionStatus(resolution);
    if (options.filter !== "all" && status !== options.filter) return false;
    if (!q) return true;
    return [
      row.contactName,
      row.contactEmail,
      row.contactTitle,
      row.suggestedCompanyName,
      resolution?.companyName,
      String(row.rowNumber),
    ]
      .join(" ")
      .toLowerCase()
      .includes(q);
  });
}

export function applyBulkRowResolutions(options: {
  current: Record<string, InvalidRowResolution>;
  rowNumbers: number[];
  action: ResolveBulkAction;
  companyName?: string;
}): Record<string, InvalidRowResolution> {
  const next = { ...options.current };
  const companyName = String(options.companyName || "").trim();
  for (const rowNumber of options.rowNumbers) {
    if (options.action === "skip") {
      next[String(rowNumber)] = { action: "skip" };
      continue;
    }
    if (!companyName) continue;
    next[String(rowNumber)] = { action: options.action, companyName };
  }
  return next;
}

export function readyToImportCount(job: ImportJob | null, resolutions: Record<string, InvalidRowResolution> | undefined) {
  if (!job) return 0;
  const unresolved = unresolvedResolvableCount(job.previewRows, resolutions);
  return Math.max(0, (job.summary?.createCount || 0) + resolvableInvalidRows(job.previewRows).length - unresolved - resolvableInvalidRows(job.previewRows).filter((row) => rowResolutionStatus(resolutions?.[String(row.rowNumber)]) === "skipped").length);
}

export function canContinueFromResolve(job: ImportJob | null, resolutions: Record<string, InvalidRowResolution> | undefined) {
  if (!job) return false;
  if (job.status !== "previewed" && job.status !== "uploaded") return false;
  return unresolvedResolvableCount(job.previewRows, resolutions) === 0 && readyToImportCount(job, resolutions) > 0;
}

export function paginate<T>(items: T[], page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * pageSize;
  return {
    currentPage,
    totalPages,
    items: items.slice(start, start + pageSize),
  };
}
