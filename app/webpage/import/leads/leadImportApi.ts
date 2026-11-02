export type ImportJobStatus = "uploaded" | "previewed" | "confirming" | "completed" | "failed";
export type DuplicatePolicy = "skip" | "create_new";
export type AcarshField =
  | "companyName"
  | "companyLocation"
  | "industryFocus"
  | "leadSource"
  | "leadDate"
  | "leadStatus"
  | "leadNotes"
  | "contactName"
  | "contactTitle"
  | "contactRole"
  | "contactEmail"
  | "contactPhone"
  | "contactLocation"
  | "linkedInUrl"
  | "contactNotes";

export type CustomFieldEntityType = "lead" | "contact";
export type CustomFieldType = "text" | "number" | "date" | "boolean";

export type CombinedContactTransform = "extract_contact_name" | "extract_email" | "split_contacts";

export type CustomMappingSpec =
  | { kind: "custom"; customFieldId: number }
  | { kind: "new"; name: string; entityType: CustomFieldEntityType; fieldType: CustomFieldType; required?: boolean };

export type CombinedContactMappingSpec = {
  kind: "combined_contact";
  transform: CombinedContactTransform;
};

export type ColumnCombineSpec = {
  kind: "combine";
  field: AcarshField;
  order: number;
};

export type ImportMappingValue = AcarshField | CustomMappingSpec | CombinedContactMappingSpec | ColumnCombineSpec;

export type CustomFieldPublic = {
  customFieldId: number;
  entityType: CustomFieldEntityType;
  fieldName: string;
  fieldType: CustomFieldType;
  isRequired: boolean;
};

export type LeadImportDefaults = {
  companyLocation: string;
  contactTitle: string;
  contactRole: string;
  leadSource: string;
  leadStatus: string;
  ownerName: string;
  leadDate: string;
};

export type InvalidRowResolutionAction = "assign_existing" | "create_company" | "skip";

export type InvalidRowResolution = {
  action: InvalidRowResolutionAction;
  companyName?: string;
};

export type LeadImportPreviewRow = {
  rowNumber: number;
  companyName: string;
  contactName: string;
  contactTitle: string;
  linkedInUrl: string;
  contactEmail?: string;
  suggestedCompanyName?: string | null;
  resolutionAction?: InvalidRowResolutionAction;
  status: "new" | "existing_company_new_contact" | "duplicate" | "needs_attention" | "invalid";
  reasons: string[];
  existingLeadId?: number;
  extractedContacts?: Array<{
    name: string;
    email: string;
    status: "new" | "existing_company_new_contact" | "duplicate" | "needs_attention" | "invalid";
    reasons: string[];
  }>;
  customValues?: Array<{
    column: string;
    fieldName: string;
    entityType: CustomFieldEntityType;
    fieldType: CustomFieldType;
    rawValue: string;
    normalizedValue: string | null;
    valid: boolean;
    message?: string;
  }>;
};

export type ImportJobResult = {
  createdLeads: number;
  createdContacts: number;
  createdCompanies?: number;
  reusedExistingCompanies?: number;
  skippedRows?: number;
  unresolvedRows?: number;
  duplicatesSkipped: number;
  invalidSkipped: number;
  failed: Array<{ rowNumber: number; companyName: string; reason: string }>;
  scored: number;
};

export type ImportJob = {
  importId: number;
  status: ImportJobStatus;
  fileName: string;
  fileSha256: string;
  fileSizeBytes: number;
  sheetName: string;
  columns: string[];
  mapping: Record<string, ImportMappingValue>;
  customFields?: CustomFieldPublic[];
  unmapped: string[];
  unmappedToNotes: string[];
  suggestions: Array<{ field: AcarshField; value: string; reason: string }>;
  defaults: LeadImportDefaults;
  duplicatePolicy: DuplicatePolicy;
  skipInvalid: boolean;
  rowCount: number;
  summary: {
    valid: number;
    needsAttention: number;
    invalid: number;
    existing: number;
    duplicate: number;
    createCount: number;
  } | null;
  previewRows: LeadImportPreviewRow[];
  rowResolutions?: Record<string, InvalidRowResolution>;
  missingRequired: Array<{ field: AcarshField; label: string }>;
  canConfirm: boolean;
  result: ImportJobResult | null;
  errorMessage: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  columnSamples?: Record<string, string[]>;
};

export class LeadImportApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "LeadImportApiError";
    this.status = status;
  }
}

export function sessionExpiredImportMessage(jobId?: number | null) {
  if (jobId && Number.isInteger(jobId) && jobId > 0) {
    return `Your session expired. Sign in again, then reopen import #${jobId}. Mapping and invalid-row resolutions are already saved.`;
  }
  return "Your session expired. Please sign in again.";
}

export function messageForImportHttpStatus(status: number, serverMessage?: string, jobId?: number | null) {
  if (status === 401) return sessionExpiredImportMessage(jobId);
  if (status === 403) return "Company membership required to import leads.";
  if (status === 404) return "This import was not found or you do not have access.";
  if (status === 409) return serverMessage || "This import cannot continue from its current state.";
  if (status === 503) {
    return serverMessage || "Smart Lead & Contact Import is unavailable because required database tables are not installed.";
  }
  return serverMessage || `Request failed (${status}).`;
}

async function parseError(res: Response): Promise<LeadImportApiError> {
  const data = await res.json().catch(() => null);
  const serverMessage = String(data?.error || data?.detail || "").trim();
  return new LeadImportApiError(messageForImportHttpStatus(res.status, serverMessage), res.status);
}

async function parseJob(res: Response): Promise<ImportJob> {
  if (!res.ok) throw await parseError(res);
  const data = await res.json().catch(() => null);
  const job = data?.job ?? data;
  if (!job || typeof job !== "object" || !Number(job.importId)) {
    throw new LeadImportApiError("The server returned an unexpected import response.", res.status);
  }
  return job as ImportJob;
}

export type WorkbookSheetInfo = {
  name: string;
  rowCount: number;
  columnCount: number;
  importable: boolean;
  reason?: string;
  likelyReferenceSheet: boolean;
};

export type CreateImportResponse =
  | { kind: "job"; job: ImportJob }
  | { kind: "needs_sheet"; fileName: string; fileSizeBytes: number; sheets: WorkbookSheetInfo[] };

export async function createImportJob(file: File, sheetName?: string): Promise<CreateImportResponse> {
  const form = new FormData();
  form.append("file", file);
  if (sheetName) form.append("sheetName", sheetName);
  const res = await fetch("/api/imports/leads", {
    method: "POST",
    body: form,
    credentials: "include",
  });
  if (!res.ok) throw await parseError(res);
  const data = await res.json().catch(() => null);
  if (data?.needsSheetSelection) {
    return {
      kind: "needs_sheet",
      fileName: String(data.fileName || file.name),
      fileSizeBytes: Number(data.fileSizeBytes || file.size),
      sheets: Array.isArray(data.sheets) ? data.sheets : [],
    };
  }
  const job = data?.job ?? data;
  if (!job || typeof job !== "object" || !Number(job.importId)) {
    throw new LeadImportApiError("The server returned an unexpected import response.", res.status);
  }
  return { kind: "job", job: job as ImportJob };
}

export async function selectImportSheet(importId: number, file: File, sheetName: string): Promise<ImportJob> {
  const form = new FormData();
  form.append("file", file);
  form.append("sheetName", sheetName);
  const res = await fetch(`/api/imports/leads/${importId}`, {
    method: "PATCH",
    body: form,
    credentials: "include",
  });
  return parseJob(res);
}

export async function ensureImportSession(): Promise<void> {
  const res = await fetch("/api/auth/session", {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    throw new LeadImportApiError(sessionExpiredImportMessage(), 401);
  }
}

export async function getImportJob(jobId: number): Promise<ImportJob> {
  const res = await fetch(`/api/imports/leads/${jobId}`, { credentials: "include" });
  return parseJob(res);
}

export async function updateImportJob(
  jobId: number,
  update: {
    mapping?: Record<string, ImportMappingValue | "">;
    defaults?: Partial<LeadImportDefaults>;
    unmappedToNotes?: string[];
    skipInvalid?: boolean;
    duplicatePolicy?: DuplicatePolicy;
    rowResolutions?: Record<string, InvalidRowResolution>;
  },
): Promise<ImportJob> {
  const res = await fetch(`/api/imports/leads/${jobId}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  });
  return parseJob(res);
}

export async function previewImportJob(jobId: number): Promise<ImportJob> {
  const res = await fetch(`/api/imports/leads/${jobId}/preview`, {
    method: "POST",
    credentials: "include",
  });
  return parseJob(res);
}

export async function getImportPreview(jobId: number): Promise<ImportJob> {
  const res = await fetch(`/api/imports/leads/${jobId}/preview`, { credentials: "include" });
  return parseJob(res);
}

export async function confirmImportJob(jobId: number): Promise<ImportJob> {
  const res = await fetch(`/api/imports/leads/${jobId}/confirm`, {
    method: "POST",
    credentials: "include",
  });
  return parseJob(res);
}

export async function getImportStatus(jobId: number): Promise<{
  importId: number;
  status: ImportJobStatus;
  summary: ImportJob["summary"];
  result: ImportJobResult | null;
  canConfirm: boolean;
  errorMessage: string | null;
}> {
  const res = await fetch(`/api/imports/leads/${jobId}/status`, { credentials: "include" });
  if (!res.ok) throw await parseError(res);
  const data = await res.json().catch(() => null);
  if (!data || !Number(data.importId)) {
    throw new LeadImportApiError("The server returned an unexpected status response.", res.status);
  }
  return data;
}
