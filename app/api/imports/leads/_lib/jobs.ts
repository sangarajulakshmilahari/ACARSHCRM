import { createHash } from "crypto";

import {
  MAX_ROWS_PER_SHEET,
  listWorkbookSheets,
  parseSpreadsheetTable,
  type WorkbookSheetInfo,
} from "@/app/api/ai/assistant/document-parser/excel-parser";
import {
  detectColumnMapping,
  type AcarshField,
} from "@/app/api/ai/assistant/lead-import/mapping";
import {
  applyCustomFieldPreview,
  isAcarshMappingField,
  listCustomFieldDefinitions,
  parseImportMapping,
  publicCustomField,
  resolveImportCustomMappings,
  splitImportMapping,
  validateImportCustomMappings,
  writeCustomFieldValues,
  type CustomFieldPublic,
  type ImportMappingValue,
} from "@/app/api/lib/custom-fields";
import {
  CompanyMismatchError,
  LeadImportAccessError,
  LeadImportStateError,
  buildPreview,
  commitImportPreviewRow,
  getLeadImportPool,
  loadExistingRecords,
  loadLookups,
  pickLookup,
  requireLeadImportActor,
  summarize,
  todayIso,
  type DuplicatePolicy,
  type LeadImportActor,
  type LeadImportDefaults,
  type LeadImportPreviewRow,
} from "@/app/api/lib/lead-import-core";
import {
  applyRowResolutions,
  defaultsWithoutResolutions,
  extractStoredResolutions,
  mergeDefaultsWithResolutions,
  parseRowResolutions,
  type InvalidRowResolutionMap,
} from "@/app/api/lib/import-row-resolutions";

export const IMPORT_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const IMPORT_ALLOWED_EXTENSIONS = [".xlsx", ".xls", ".csv"] as const;

export type LeadImportstatus = "uploaded" | "previewed" | "confirming" | "completed" | "failed";
export type ImportRowCommitStatus = "pending" | "created" | "skipped" | "duplicate" | "failed";

export type ImportJobPublic = {
  importId: number;
  status: LeadImportstatus;
  fileName: string;
  fileSha256: string;
  fileSizeBytes: number;
  sheetName: string;
  columns: string[];
  mapping: Record<string, ImportMappingValue>;
  customFields: CustomFieldPublic[];
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
  rowResolutions: InvalidRowResolutionMap;
  missingRequired: Array<{ field: AcarshField; label: string }>;
  canConfirm: boolean;
  result: ImportJobResult | null;
  errorMessage: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  columnSamples: Record<string, string[]>;
};

export type ImportJobResult = {
  createdLeads: number;
  createdContacts: number;
  createdCompanies: number;
  reusedExistingCompanies: number;
  skippedRows: number;
  unresolvedRows: number;
  duplicatesSkipped: number;
  invalidSkipped: number;
  failed: Array<{ rowNumber: number; companyName: string; reason: string }>;
  scored: number;
};

type StoredJob = {
  ImportId: number;
  CompanyId: number;
  CreatedByUserId: number;
  SourceFileName: string;
  SourceFileSha256: string;
  SourceFileType: string;
  SourceFileSizeBytes: number;
  SheetName: string;
  Status: LeadImportstatus;
  ColumnsJson: string;
  MappingJson: string;
  UnmappedJson: string;
  UnmappedToNotesJson: string;
  SuggestionsJson: string;
  DefaultsJson: string;
  DuplicatePolicy: DuplicatePolicy;
  SkipInvalid: number;
  PreviewSummaryJson: string | null;
  ResultSummaryJson: string | null;
  ErrorMessage: string | null;
  RowCount: number;
  CreatedAt?: string;
  UpdatedAt?: string;
};

type StoredRow = {
  ImportRowId: number;
  ImportId: number;
  CompanyId: number;
  RowNumber: number;
  RowHash: string;
  SourceJson: string;
  PreviewStatus: string;
  PreviewReasonsJson: string;
  ExistingLeadId: number | null;
  DuplicateAction: string;
  CommitStatus: ImportRowCommitStatus;
  ErrorReason: string | null;
  CreatedLeadId: number | null;
  CreatedLeadContactId: number | null;
};

function fileExtension(name: string) {
  const value = String(name || "").trim().toLowerCase();
  const index = value.lastIndexOf(".");
  if (index < 0) return "";
  return value.slice(index);
}

function sha256Hex(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function rowHash(row: Record<string, string>) {
  return createHash("sha256").update(JSON.stringify(row)).digest("hex");
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (raw == null || raw === "") return fallback;
  if (typeof raw === "object") return raw as T;
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return fallback;
  }
}

function isAcarshField(value: string): value is AcarshField {
  return isAcarshMappingField(value);
}

function normalizeDuplicatePolicy(value: unknown): DuplicatePolicy {
  return value === "create_new" ? "create_new" : "skip";
}

export function validateImportSpreadsheet(options: { fileName: string; fileSize: number; fileBuffer: Buffer }) {
  const fileName = String(options.fileName || "").trim();
  if (!fileName) throw new LeadImportStateError("Attachment file name is required.");
  const extension = fileExtension(fileName);
  if (!IMPORT_ALLOWED_EXTENSIONS.includes(extension as (typeof IMPORT_ALLOWED_EXTENSIONS)[number])) {
    throw new LeadImportStateError(`${fileName} has an unsupported format. Only XLS, XLSX, and CSV are allowed.`);
  }
  if (!Number.isFinite(options.fileSize) || options.fileSize <= 0 || !options.fileBuffer.length) {
    throw new LeadImportStateError(`${fileName} is empty or unreadable.`);
  }
  if (options.fileSize > IMPORT_FILE_MAX_BYTES || options.fileBuffer.length > IMPORT_FILE_MAX_BYTES) {
    throw new LeadImportStateError(`${fileName} exceeds the 10 MB file size limit.`);
  }
}

async function loadOwnedJob(actor: LeadImportActor, importId: number): Promise<StoredJob> {
  const verified = requireLeadImportActor(actor);
  const jobId = Number(importId);
  if (!Number.isInteger(jobId) || jobId <= 0) {
    throw new LeadImportAccessError("Import job was not found.");
  }
  const pool = await getLeadImportPool();
  const [rows]: any = await pool.query(
    `SELECT *
     FROM LeadImports
     WHERE ImportId = ?
       AND CompanyId = ?
       AND CreatedByUserId = ?
     LIMIT 1`,
    [jobId, verified.companyId, verified.userId],
  );
  if (!Array.isArray(rows) || !rows.length) {
    throw new LeadImportAccessError("Import job was not found.");
  }
  return rows[0] as StoredJob;
}

async function loadOwnedRows(actor: LeadImportActor, importId: number): Promise<StoredRow[]> {
  const verified = requireLeadImportActor(actor);
  const pool = await getLeadImportPool();
  const [rows]: any = await pool.query(
    `SELECT *
     FROM LeadImportRows
     WHERE ImportId = ?
       AND CompanyId = ?
     ORDER BY RowNumber ASC`,
    [importId, verified.companyId],
  );
  return Array.isArray(rows) ? (rows as StoredRow[]) : [];
}

function columnSamplesFromRows(rows: StoredRow[], columns: string[]): Record<string, string[]> {
  const samples: Record<string, string[]> = {};
  for (const column of columns) samples[column] = [];
  for (const row of rows.slice(0, 3)) {
    const source = parseJson<Record<string, string>>(row.SourceJson, {});
    for (const column of columns) {
      const value = String(source[column] || "").trim();
      if (value && samples[column].length < 3) samples[column].push(value);
    }
  }
  return samples;
}

function jobToPublic(
  job: StoredJob,
  previewRows: LeadImportPreviewRow[] = [],
  storedRows: StoredRow[] = [],
  customFields: CustomFieldPublic[] = [],
): ImportJobPublic {
  const mapping = parseImportMapping(parseJson<Record<string, ImportMappingValue>>(job.MappingJson, {}));
  const splitMapping = splitImportMapping(mapping);
  const storedDefaults = parseJson<LeadImportDefaults & { _rowResolutions?: unknown }>(job.DefaultsJson, {
    companyLocation: "",
    contactTitle: "",
    contactRole: "",
    leadSource: "",
    leadStatus: "",
    ownerName: "",
    leadDate: todayIso(),
  });
  const defaults = defaultsWithoutResolutions(storedDefaults) as LeadImportDefaults;
  const rowResolutions = extractStoredResolutions(storedDefaults);
  const summary = parseJson<ImportJobPublic["summary"]>(job.PreviewSummaryJson, null);
  const storedPreview = parseJson<{ canConfirm?: boolean }>(job.PreviewSummaryJson, {});
  const computedMissing = buildPreview({
    pending: { rows: [], mapping: splitMapping.standard, defaults, combined: splitMapping.combined, combine: splitMapping.combine },
    existing: [],
  }).missingRequired;
  return {
    importId: Number(job.ImportId),
    status: job.Status,
    fileName: job.SourceFileName,
    fileSha256: job.SourceFileSha256,
    fileSizeBytes: Number(job.SourceFileSizeBytes),
    sheetName: job.SheetName,
    columns: parseJson<string[]>(job.ColumnsJson, []),
    mapping,
    customFields,
    unmapped: parseJson<string[]>(job.UnmappedJson, []),
    unmappedToNotes: parseJson<string[]>(job.UnmappedToNotesJson, []),
    suggestions: parseJson<ImportJobPublic["suggestions"]>(job.SuggestionsJson, []),
    defaults,
    rowResolutions,
    duplicatePolicy: normalizeDuplicatePolicy(job.DuplicatePolicy),
    skipInvalid: Number(job.SkipInvalid) === 1,
    rowCount: Number(job.RowCount || 0),
    summary,
    previewRows,
    missingRequired: computedMissing,
    canConfirm: job.Status === "previewed" && Boolean(storedPreview.canConfirm),
    result: parseJson<ImportJobResult | null>(job.ResultSummaryJson, null),
    errorMessage: job.ErrorMessage,
    createdAt: job.CreatedAt ? String(job.CreatedAt) : null,
    updatedAt: job.UpdatedAt ? String(job.UpdatedAt) : null,
    columnSamples: columnSamplesFromRows(storedRows, parseJson<string[]>(job.ColumnsJson, [])),
  };
}

async function loadPublicCustomFields(companyId: number): Promise<CustomFieldPublic[]> {
  const pool = await getLeadImportPool();
  const definitions = await listCustomFieldDefinitions(pool, companyId);
  return definitions.map(publicCustomField);
}

function applyDuplicatePolicy(rows: LeadImportPreviewRow[], policy: DuplicatePolicy): LeadImportPreviewRow[] {
  if (policy !== "create_new") return rows;
  return rows.map((row) => {
    const extractedContacts = (row.extractedContacts || []).map((contact) => {
      if (contact.status !== "duplicate") return contact;
      return {
        ...contact,
        status: "new" as const,
        reasons: contact.reasons.filter((reason) => reason !== "Company already exists with this contact"),
      };
    });
    if (row.status !== "duplicate") return extractedContacts.length ? { ...row, extractedContacts } : row;
    return {
      ...row,
      status: "new",
      reasons: row.reasons.filter((reason) => reason !== "Company already exists with this contact"),
      existingLeadId: undefined,
      extractedContacts: extractedContacts.length ? extractedContacts : row.extractedContacts,
    };
  });
}

export type CreateLeadImportResult =
  | { kind: "ready"; job: ImportJobPublic }
  | { kind: "needs_sheet"; fileName: string; fileSizeBytes: number; sheets: WorkbookSheetInfo[] };

function isExcelWorkbook(fileName: string) {
  return /\.xlsx?$/i.test(fileName);
}

function parseSelectedTable(options: { fileName: string; fileBuffer: Buffer; sheetName?: string }) {
  try {
    const table = parseSpreadsheetTable({
      fileName: options.fileName,
      fileBuffer: options.fileBuffer,
      sheetName: options.sheetName,
    });
    if (table.rows.length > MAX_ROWS_PER_SHEET) {
      throw new LeadImportStateError(`Spreadsheets are limited to ${MAX_ROWS_PER_SHEET} rows.`);
    }
    return table;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to read this spreadsheet.";
    throw new LeadImportStateError(message);
  }
}

async function insertImportRows(
  pool: any,
  importId: number,
  companyId: number,
  rows: Array<Record<string, string>>,
) {
  if (!rows.length) return;
  const values: any[] = [];
  const placeholders: string[] = [];
  rows.forEach((row, index) => {
    placeholders.push("(?, ?, ?, ?, ?, 'pending', '[]', NULL, 'skip', 'pending')");
    values.push(importId, companyId, index + 2, rowHash(row), JSON.stringify(row));
  });
  await pool.query(
    `INSERT INTO LeadImportRows
      (ImportId, CompanyId, RowNumber, RowHash, SourceJson, PreviewStatus, PreviewReasonsJson,
       ExistingLeadId, DuplicateAction, CommitStatus)
     VALUES ${placeholders.join(",")}`,
    values,
  );
}

export async function createLeadImport(options: {
  actor: LeadImportActor;
  ownerName: string;
  fileName: string;
  fileBuffer: Buffer;
  sheetName?: string;
}): Promise<CreateLeadImportResult> {
  const actor = requireLeadImportActor(options.actor);
  validateImportSpreadsheet({
    fileName: options.fileName,
    fileSize: options.fileBuffer.length,
    fileBuffer: options.fileBuffer,
  });
  const requestedSheet = String(options.sheetName || "").trim();
  if (isExcelWorkbook(options.fileName) && !requestedSheet) {
    const sheets = listWorkbookSheets({
      fileName: options.fileName,
      fileBuffer: options.fileBuffer,
    });
    if (sheets.length > 1) {
      return {
        kind: "needs_sheet",
        fileName: options.fileName,
        fileSizeBytes: options.fileBuffer.length,
        sheets,
      };
    }
  }
  const table = parseSelectedTable({
    fileName: options.fileName,
    fileBuffer: options.fileBuffer,
    sheetName: requestedSheet || undefined,
  });
  const detected = detectColumnMapping(table.columns);
  const lookups = await loadLookups(actor.companyId);
  const titleSuggestion = detected.suggestions.find((item) => item.field === "contactTitle");
  const defaults: LeadImportDefaults = {
    companyLocation: "",
    contactTitle: titleSuggestion?.value || "",
    contactRole: pickLookup(lookups.contactRoles, ["Decision Maker", "Primary", "Champion", "Influencer"]),
    leadSource: pickLookup(lookups.leadSources, ["Excel Import", "LinkedIn", "Import", "Other"]),
    leadStatus: pickLookup(lookups.leadStatuses, ["New"]),
    ownerName: options.ownerName,
    leadDate: todayIso(),
  };
  const hash = sha256Hex(options.fileBuffer);
  const pool = await getLeadImportPool();
  const [insertResult]: any = await pool.query(
    `INSERT INTO LeadImports
      (CompanyId, CreatedByUserId, SourceFileName, SourceFileSha256, SourceFileType, SourceFileSizeBytes,
       SheetName, Status, ColumnsJson, MappingJson, UnmappedJson, UnmappedToNotesJson, SuggestionsJson,
       DefaultsJson, DuplicatePolicy, SkipInvalid, RowCount)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'uploaded', ?, ?, ?, '[]', ?, ?, 'skip', 1, ?)`,
    [
      actor.companyId,
      actor.userId,
      options.fileName,
      hash,
      fileExtension(options.fileName).slice(1),
      options.fileBuffer.length,
      table.sheetName,
      JSON.stringify(table.columns),
      JSON.stringify(detected.mapping),
      JSON.stringify(detected.unmapped),
      JSON.stringify(detected.suggestions),
      JSON.stringify(defaults),
      table.rows.length,
    ],
  );
  const importId = Number(insertResult.insertId);
  await insertImportRows(pool, importId, actor.companyId, table.rows);
  const job = await loadOwnedJob(actor, importId);
  const storedRows = await loadOwnedRows(actor, importId);
  return { kind: "ready", job: jobToPublic(job, [], storedRows, await loadPublicCustomFields(actor.companyId)) };
}

export async function selectLeadImportSheet(options: {
  actor: LeadImportActor;
  importId: number;
  ownerName: string;
  fileName: string;
  fileBuffer: Buffer;
  sheetName: string;
}): Promise<ImportJobPublic> {
  const actor = requireLeadImportActor(options.actor);
  const job = await loadOwnedJob(actor, options.importId);
  if (job.Status === "completed" || job.Status === "confirming") {
    throw new LeadImportStateError("The worksheet cannot be changed after confirmation has started.");
  }
  validateImportSpreadsheet({
    fileName: options.fileName,
    fileSize: options.fileBuffer.length,
    fileBuffer: options.fileBuffer,
  });
  const hash = sha256Hex(options.fileBuffer);
  if (hash !== String(job.SourceFileSha256 || "")) {
    throw new LeadImportStateError("Upload the original workbook to change worksheets.");
  }
  const requestedSheet = String(options.sheetName || "").trim();
  if (!requestedSheet) {
    throw new LeadImportStateError("Select a worksheet to import.");
  }
  const table = parseSelectedTable({
    fileName: options.fileName,
    fileBuffer: options.fileBuffer,
    sheetName: requestedSheet,
  });
  const detected = detectColumnMapping(table.columns);
  const lookups = await loadLookups(actor.companyId);
  const titleSuggestion = detected.suggestions.find((item) => item.field === "contactTitle");
  const defaults: LeadImportDefaults = {
    companyLocation: "",
    contactTitle: titleSuggestion?.value || "",
    contactRole: pickLookup(lookups.contactRoles, ["Decision Maker", "Primary", "Champion", "Influencer"]),
    leadSource: pickLookup(lookups.leadSources, ["Excel Import", "LinkedIn", "Import", "Other"]),
    leadStatus: pickLookup(lookups.leadStatuses, ["New"]),
    ownerName: options.ownerName,
    leadDate: todayIso(),
  };
  const pool = await getLeadImportPool();
  await pool.query(
    `DELETE FROM LeadImportRows WHERE ImportId = ? AND CompanyId = ?`,
    [job.ImportId, actor.companyId],
  );
  const [updated]: any = await pool.query(
    `UPDATE LeadImports
     SET SheetName = ?, ColumnsJson = ?, MappingJson = ?, UnmappedJson = ?, UnmappedToNotesJson = '[]',
         SuggestionsJson = ?, DefaultsJson = ?, Status = 'uploaded', PreviewSummaryJson = NULL,
         ResultSummaryJson = NULL, ErrorMessage = NULL, RowCount = ?
     WHERE ImportId = ? AND CompanyId = ? AND CreatedByUserId = ? AND Status IN ('uploaded', 'previewed')`,
    [
      table.sheetName,
      JSON.stringify(table.columns),
      JSON.stringify(detected.mapping),
      JSON.stringify(detected.unmapped),
      JSON.stringify(detected.suggestions),
      JSON.stringify(defaults),
      table.rows.length,
      job.ImportId,
      actor.companyId,
      actor.userId,
    ],
  );
  if (!updated || Number(updated.affectedRows || 0) < 1) {
    throw new LeadImportStateError("The worksheet cannot be changed from the current import state.");
  }
  await insertImportRows(pool, job.ImportId, actor.companyId, table.rows);
  return getLeadImport(actor, job.ImportId);
}

export async function getLeadImport(actor: LeadImportActor, importId: number): Promise<ImportJobPublic> {
  const job = await loadOwnedJob(actor, importId);
  const storedRows = await loadOwnedRows(actor, importId);
  if (job.Status === "previewed" || job.Status === "confirming" || job.Status === "completed") {
    return refreshPreviewRows(actor, job, storedRows, false);
  }
  return jobToPublic(job, [], storedRows, await loadPublicCustomFields(actor.companyId));
}

async function refreshPreviewRows(
  actor: LeadImportActor,
  job: StoredJob,
  storedRows: StoredRow[],
  persist: boolean,
): Promise<ImportJobPublic> {
  const verified = requireLeadImportActor(actor);
  if (job.CompanyId !== verified.companyId) throw new CompanyMismatchError();
  const mixedMapping = parseImportMapping(parseJson<Record<string, ImportMappingValue>>(job.MappingJson, {}));
  const splitMapping = splitImportMapping(mixedMapping);
  const mapping = splitMapping.standard;
  const defaults = parseJson<LeadImportDefaults>(job.DefaultsJson, {
    companyLocation: "",
    contactTitle: "",
    contactRole: "",
    leadSource: "",
    leadStatus: "",
    ownerName: "",
    leadDate: todayIso(),
  });
  const sourceRows = storedRows.map((row) => parseJson<Record<string, string>>(row.SourceJson, {}));
  const existing = await loadExistingRecords(verified.companyId);
  const built = buildPreview({
    pending: { rows: sourceRows, mapping, defaults, combined: splitMapping.combined, combine: splitMapping.combine },
    existing,
  });
  const poolForCustom = await getLeadImportPool();
  const customMappings = await validateImportCustomMappings({
    pool: poolForCustom,
    companyId: verified.companyId,
    mapping: mixedMapping,
  });
  const resolutions = extractStoredResolutions(parseJson(job.DefaultsJson, {}));
  const previewRows = applyRowResolutions({
    rows: applyCustomFieldPreview(
      applyDuplicatePolicy(built.rows, normalizeDuplicatePolicy(job.DuplicatePolicy)),
      sourceRows,
      customMappings,
    ),
    resolutions,
    existing,
  });
  const summary = summarize(previewRows, built.missingRequired);
  if (persist) {
    const pool = await getLeadImportPool();
    for (const preview of previewRows) {
      const stored = storedRows.find((row) => Number(row.RowNumber) === preview.rowNumber);
      if (!stored) continue;
      await pool.query(
        `UPDATE LeadImportRows
         SET PreviewStatus = ?, PreviewReasonsJson = ?, ExistingLeadId = ?, DuplicateAction = ?, CompanyId = ?
         WHERE ImportRowId = ? AND ImportId = ? AND CompanyId = ?`,
        [
          preview.status,
          JSON.stringify(preview.reasons),
          preview.existingLeadId || null,
          job.DuplicatePolicy,
          verified.companyId,
          stored.ImportRowId,
          job.ImportId,
          verified.companyId,
        ],
      );
    }
    await pool.query(
      `UPDATE LeadImports
       SET Status = 'previewed', PreviewSummaryJson = ?, ErrorMessage = NULL
       WHERE ImportId = ? AND CompanyId = ? AND CreatedByUserId = ? AND Status IN ('uploaded', 'previewed')`,
      [
        JSON.stringify({ ...summary, canConfirm: summary.canConfirm }),
        job.ImportId,
        verified.companyId,
        verified.userId,
      ],
    );
  }
  const publicJob = jobToPublic(
    persist ? { ...job, Status: "previewed", PreviewSummaryJson: JSON.stringify({ ...summary, canConfirm: summary.canConfirm }) } : job,
    previewRows,
    storedRows,
    await loadPublicCustomFields(verified.companyId),
  );
  publicJob.missingRequired = built.missingRequired;
  publicJob.summary = {
    valid: summary.valid,
    needsAttention: summary.needsAttention,
    invalid: summary.invalid,
    existing: summary.existing,
    duplicate: summary.duplicate,
    createCount: summary.createCount,
  };
  publicJob.canConfirm = summary.canConfirm && (persist || job.Status === "previewed");
  return publicJob;
}

export async function updateLeadImport(
  actor: LeadImportActor,
  importId: number,
  update: {
    mapping?: Record<string, ImportMappingValue | "">;
    defaults?: Partial<LeadImportDefaults>;
    unmappedToNotes?: string[];
    skipInvalid?: boolean;
    duplicatePolicy?: DuplicatePolicy;
    rowResolutions?: InvalidRowResolutionMap;
  },
): Promise<ImportJobPublic> {
  const job = await loadOwnedJob(actor, importId);
  if (job.Status !== "uploaded" && job.Status !== "previewed") {
    throw new LeadImportStateError("Mappings can only be updated before confirmation.");
  }
  const columns = parseJson<string[]>(job.ColumnsJson, []);
  let mapping = parseImportMapping(parseJson<Record<string, ImportMappingValue>>(job.MappingJson, {}));
  if (update.mapping) {
    mapping = { ...mapping };
    for (const [column, field] of Object.entries(update.mapping)) {
      if (!columns.includes(column)) continue;
      if (!field) delete mapping[column];
      else if (isAcarshMappingField(field) || (typeof field === "object" && field.kind)) {
        mapping[column] = field as ImportMappingValue;
      }
    }
    mapping = parseImportMapping(mapping);
    const pool = await getLeadImportPool();
    await validateImportCustomMappings({
      pool,
      companyId: actor.companyId,
      mapping,
    });
  }
  const storedDefaults = parseJson<LeadImportDefaults & { _rowResolutions?: unknown }>(job.DefaultsJson, {
    companyLocation: "",
    contactTitle: "",
    contactRole: "",
    leadSource: "",
    leadStatus: "",
    ownerName: "",
    leadDate: todayIso(),
  });
  const currentResolutions = extractStoredResolutions(storedDefaults);
  const nextResolutions =
    update.rowResolutions !== undefined
      ? parseRowResolutions(update.rowResolutions)
      : currentResolutions;
  const defaults = mergeDefaultsWithResolutions(
    {
      ...defaultsWithoutResolutions(storedDefaults),
      ...(update.defaults || {}),
    },
    nextResolutions,
  );
  const unmappedToNotes = Array.isArray(update.unmappedToNotes)
    ? update.unmappedToNotes.filter((column) => columns.includes(column))
    : parseJson<string[]>(job.UnmappedToNotesJson, []);
  const skipInvalid = typeof update.skipInvalid === "boolean" ? update.skipInvalid : Number(job.SkipInvalid) === 1;
  const duplicatePolicy = update.duplicatePolicy
    ? normalizeDuplicatePolicy(update.duplicatePolicy)
    : normalizeDuplicatePolicy(job.DuplicatePolicy);
  const splitMapping = splitImportMapping(mapping);
  const unmapped = columns.filter(
    (column) =>
      !splitMapping.standard[column] &&
      !splitMapping.custom.some((item) => item.column === column) &&
      !splitMapping.combined.some((item) => item.column === column) &&
      !splitMapping.combine.some((item) => item.column === column),
  );
  const pool = await getLeadImportPool();
  await pool.query(
    `UPDATE LeadImports
     SET MappingJson = ?, UnmappedJson = ?, UnmappedToNotesJson = ?, DefaultsJson = ?,
         DuplicatePolicy = ?, SkipInvalid = ?, Status = 'uploaded', PreviewSummaryJson = NULL
     WHERE ImportId = ? AND CompanyId = ? AND CreatedByUserId = ? AND Status IN ('uploaded', 'previewed')`,
    [
      JSON.stringify(mapping),
      JSON.stringify(unmapped),
      JSON.stringify(unmappedToNotes),
      JSON.stringify(defaults),
      duplicatePolicy,
      skipInvalid ? 1 : 0,
      job.ImportId,
      actor.companyId,
      actor.userId,
    ],
  );
  return getLeadImport(actor, importId);
}

export async function previewLeadImport(actor: LeadImportActor, importId: number): Promise<ImportJobPublic> {
  const job = await loadOwnedJob(actor, importId);
  if (job.Status === "completed" || job.Status === "confirming") {
    throw new LeadImportStateError("Preview cannot be regenerated after confirmation has started.");
  }
  const storedRows = await loadOwnedRows(actor, importId);
  return refreshPreviewRows(actor, job, storedRows, true);
}

export async function confirmLeadImport(actor: LeadImportActor, importId: number): Promise<ImportJobPublic> {
  const verified = requireLeadImportActor(actor);
  const job = await loadOwnedJob(verified, importId);
  if (job.Status === "completed") {
    return getLeadImport(verified, importId);
  }
  if (job.Status !== "previewed" && job.Status !== "confirming") {
    throw new LeadImportStateError("Generate a preview before confirming this import.");
  }
  const pool = await getLeadImportPool();
  const [lockResult]: any = await pool.query(
    `UPDATE LeadImports
     SET Status = 'confirming', StartedAt = COALESCE(StartedAt, UTC_TIMESTAMP(6))
     WHERE ImportId = ?
       AND CompanyId = ?
       AND CreatedByUserId = ?
       AND Status IN ('previewed', 'confirming')`,
    [job.ImportId, verified.companyId, verified.userId],
  );
  if (!lockResult || Number(lockResult.affectedRows || 0) < 1) {
    const latest = await loadOwnedJob(verified, importId);
    if (latest.Status === "completed") return getLeadImport(verified, importId);
    throw new LeadImportStateError("Import job is not ready to confirm.");
  }

  const storedRows = await loadOwnedRows(verified, importId);
  const mixedMapping = parseImportMapping(parseJson<Record<string, ImportMappingValue>>(job.MappingJson, {}));
  const splitMapping = splitImportMapping(mixedMapping);
  const mapping = splitMapping.standard;
  const defaults = parseJson<LeadImportDefaults>(job.DefaultsJson, {
    companyLocation: "",
    contactTitle: "",
    contactRole: "",
    leadSource: "",
    leadStatus: "",
    ownerName: "",
    leadDate: todayIso(),
  });
  const unmappedToNotes = parseJson<string[]>(job.UnmappedToNotesJson, []);
  const skipInvalid = Number(job.SkipInvalid) === 1;
  const sourceRows = storedRows.map((row) => parseJson<Record<string, string>>(row.SourceJson, {}));
  const existing = await loadExistingRecords(verified.companyId);
  const built = buildPreview({ pending: { rows: sourceRows, mapping, defaults, combined: splitMapping.combined, combine: splitMapping.combine }, existing });
  if (built.missingRequired.length) {
    await pool.query(
      `UPDATE LeadImports SET Status = 'previewed', ErrorMessage = ?
       WHERE ImportId = ? AND CompanyId = ? AND CreatedByUserId = ?`,
      ["Resolve required fields before creating leads.", job.ImportId, verified.companyId, verified.userId],
    );
    throw new LeadImportStateError("Resolve required fields before creating leads.");
  }
  const customMappings = splitImportMapping(mixedMapping).custom.length
    ? await resolveImportCustomMappings({
        conn: pool,
        companyId: verified.companyId,
        userId: verified.userId,
        mapping: mixedMapping,
      })
    : [];
  const resolutions = extractStoredResolutions(parseJson(job.DefaultsJson, {}));
  const previewRows = applyRowResolutions({
    rows: applyCustomFieldPreview(
      applyDuplicatePolicy(built.rows, normalizeDuplicatePolicy(job.DuplicatePolicy)),
      sourceRows,
      customMappings,
    ),
    resolutions,
    existing,
  });
  const result: ImportJobResult = {
    createdLeads: storedRows.filter((row) => row.CommitStatus === "created" && row.CreatedLeadId).length,
    createdContacts: storedRows.filter((row) => row.CommitStatus === "created").length,
    createdCompanies: 0,
    reusedExistingCompanies: 0,
    skippedRows: 0,
    unresolvedRows: 0,
    duplicatesSkipped: 0,
    invalidSkipped: 0,
    failed: [],
    scored: storedRows.filter((row) => row.CommitStatus === "created").length,
  };
  const createdCompanyLeads = new Map<string, number>();

  for (let index = 0; index < storedRows.length; index += 1) {
    const stored = storedRows[index];
    const preview = previewRows[index];
    if (!preview) continue;
    if (stored.CommitStatus === "created" || stored.CommitStatus === "skipped" || stored.CommitStatus === "duplicate") {
      if (stored.CommitStatus === "duplicate") result.duplicatesSkipped += 1;
      if (stored.CommitStatus === "skipped") {
        result.invalidSkipped += 1;
        result.skippedRows += 1;
      }
      continue;
    }
    const reusedLeadId = createdCompanyLeads.get(String(preview.companyName || "").trim().toLowerCase());
    if (reusedLeadId && !preview.existingLeadId) {
      preview.existingLeadId = reusedLeadId;
      preview.status = preview.status === "invalid" ? "existing_company_new_contact" : preview.status;
    }
    const companyName = preview.companyName;
    if (preview.status === "duplicate") {
      await pool.query(
        `UPDATE LeadImportRows
         SET CommitStatus = 'duplicate', ErrorReason = NULL
         WHERE ImportRowId = ? AND ImportId = ? AND CompanyId = ? AND CommitStatus = 'pending'`,
        [stored.ImportRowId, job.ImportId, verified.companyId],
      );
      result.duplicatesSkipped += 1;
      continue;
    }
    const creatableContacts = (preview.extractedContacts || []).filter((contact) => contact.status === "new");
    if (preview.status === "invalid" || preview.status === "needs_attention") {
      if (!skipInvalid && preview.status === "needs_attention") {
        await pool.query(
          `UPDATE LeadImports SET Status = 'previewed', ErrorMessage = ?
           WHERE ImportId = ? AND CompanyId = ? AND CreatedByUserId = ?`,
          ["Resolve rows that need attention before confirming.", job.ImportId, verified.companyId, verified.userId],
        );
        throw new LeadImportStateError("Resolve rows that need attention before confirming.");
      }
      if (!(skipInvalid && preview.status === "needs_attention" && creatableContacts.length)) {
        await pool.query(
          `UPDATE LeadImportRows
           SET CommitStatus = 'skipped', ErrorReason = ?
           WHERE ImportRowId = ? AND ImportId = ? AND CompanyId = ? AND CommitStatus = 'pending'`,
          [preview.reasons.join("; ") || "skipped", stored.ImportRowId, job.ImportId, verified.companyId],
        );
        result.invalidSkipped += 1;
        result.skippedRows += 1;
        if (preview.resolutionAction !== "skip") result.unresolvedRows += 1;
        continue;
      }
    }
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [claim]: any = await conn.query(
        `UPDATE LeadImportRows
         SET CommitStatus = 'created'
         WHERE ImportRowId = ? AND ImportId = ? AND CompanyId = ? AND CommitStatus = 'pending'`,
        [stored.ImportRowId, job.ImportId, verified.companyId],
      );
      if (!claim || Number(claim.affectedRows || 0) < 1) {
        await conn.rollback();
        continue;
      }
      const committed = await commitImportPreviewRow({
        conn,
        companyId: verified.companyId,
        source: sourceRows[index] || {},
        mapping,
        defaults,
        unmappedToNotes,
        preview,
        combine: splitMapping.combine,
      });
      const createdContactIds = committed.contactIds.length ? committed.contactIds : committed.contactId ? [committed.contactId] : [];
      if (createdContactIds.length) {
        for (let contactIndex = 0; contactIndex < createdContactIds.length; contactIndex += 1) {
          await writeCustomFieldValues({
            conn,
            companyId: verified.companyId,
            leadId: committed.leadId,
            contactId: createdContactIds[contactIndex],
            createdLead: committed.createdLead && contactIndex === 0,
            source: sourceRows[index] || {},
            mappings: customMappings,
          });
        }
      } else {
        await writeCustomFieldValues({
          conn,
          companyId: verified.companyId,
          leadId: committed.leadId,
          contactId: 0,
          createdLead: committed.createdLead,
          source: sourceRows[index] || {},
          mappings: customMappings,
        });
      }
      await conn.query(
        `UPDATE LeadImportRows
         SET CreatedLeadId = ?, CreatedLeadContactId = ?, ErrorReason = NULL, CommitStatus = 'created'
         WHERE ImportRowId = ? AND ImportId = ? AND CompanyId = ?`,
        [committed.leadId, committed.contactId || null, stored.ImportRowId, job.ImportId, verified.companyId],
      );
      await conn.commit();
      if (committed.createdLead) {
        result.createdLeads += 1;
        result.createdCompanies += 1;
        createdCompanyLeads.set(String(preview.companyName || "").trim().toLowerCase(), committed.leadId);
      } else {
        result.reusedExistingCompanies += 1;
        createdCompanyLeads.set(String(preview.companyName || "").trim().toLowerCase(), committed.leadId);
      }
      result.createdContacts += committed.createdContacts;
      result.scored += 1;
    } catch (error) {
      await conn.rollback();
      const reason = error instanceof Error ? error.message : "Failed to create lead";
      await pool.query(
        `UPDATE LeadImportRows
         SET CommitStatus = 'failed', ErrorReason = ?
         WHERE ImportRowId = ? AND ImportId = ? AND CompanyId = ?`,
        [reason.slice(0, 500), stored.ImportRowId, job.ImportId, verified.companyId],
      );
      result.failed.push({ rowNumber: preview.rowNumber, companyName, reason });
    } finally {
      conn.release();
    }
  }

  await pool.query(
    `UPDATE LeadImports
     SET Status = 'completed', ResultSummaryJson = ?, ConfirmedAt = UTC_TIMESTAMP(6), CompletedAt = UTC_TIMESTAMP(6), ErrorMessage = NULL
     WHERE ImportId = ? AND CompanyId = ? AND CreatedByUserId = ?`,
    [JSON.stringify(result), job.ImportId, verified.companyId, verified.userId],
  );
  return getLeadImport(verified, importId);
}
