"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ACARSH_FIELDS,
  FIELD_LABELS,
  REQUIRED_FIELDS,
  type AcarshField,
} from "@/app/api/ai/assistant/lead-import/mapping";
import {
  confirmImportJob,
  createImportJob,
  ensureImportSession,
  getImportJob,
  getImportStatus,
  LeadImportApiError,
  previewImportJob,
  selectImportSheet,
  sessionExpiredImportMessage,
  updateImportJob,
  type WorkbookSheetInfo,
  type DuplicatePolicy,
  type ImportJob,
  type ImportMappingValue,
  type InvalidRowResolution,
  type LeadImportDefaults,
} from "./leadImportApi";
import {
  CUSTOM_FIELD_ENTITY_LABELS,
  CUSTOM_FIELD_ENTITY_TYPES,
  CUSTOM_FIELD_TYPE_LABELS,
  CUSTOM_FIELD_TYPES,
} from "@/app/api/lib/custom-field-types";
import {
  COMBINED_CONTACT_TRANSFORMS,
  COMBINED_CONTACT_TRANSFORM_LABELS,
  applyCombinedContactTransform,
  isCombinedContactMapping,
} from "@/app/api/lib/combined-contacts";
import {
  COMBINEABLE_FIELDS,
  assignCombineMapping,
  combineColumnValues,
  combinePartsForField,
  isCombineableField,
  isColumnCombineSpec,
  normalizeCombineMapping,
  removeCombineColumn,
  reorderCombineField,
} from "@/app/api/lib/column-combine";
import {
  IMPORT_ACCEPT,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  canContinueToPreview,
  applyBulkRowResolutions,
  canContinueFromResolve,
  canOpenConfirm,
  canRetryConfirm,
  clientFileError,
  confirmButtonDisabled,
  customMappingConflicts,
  filterPreviewRows,
  filterResolvableRows,
  formatFileSize,
  isCustomMapping,
  isStandardMapping,
  mappingConflicts,
  mappingFromSelectValue,
  mappingSelectValue,
  missingPreviewRequirements,
  paginate,
  previewRowLabel,
  readyToImportCount,
  resolvableInvalidRows,
  resolutionStatusLabel,
  resolutionStatusTone,
  rowResolutionStatus,
  setPageRowSelection,
  statusTone,
  stepFromJob,
  toggleSelectedRowNumbers,
  unresolvedResolvableCount,
  type ResolveBulkAction,
  type ResolveFilter,
  type WizardStep,
} from "./leadImportUi";

type Props = {
  embedded?: boolean;
  onBack?: () => void;
  onOpenLead?: (leadId: number) => void;
};

const IMPORT_JOB_STORAGE_KEY = "acarsh.leadImport.jobId";

const STEPS: Array<{ id: WizardStep; label: string }> = [
  { id: "upload", label: "Upload" },
  { id: "sheet", label: "Select worksheet" },
  { id: "map", label: "Map columns" },
  { id: "preview", label: "Preview" },
  { id: "resolve", label: "Resolve" },
  { id: "confirm", label: "Confirm" },
  { id: "result", label: "Results" },
];

function emptyDefaults(): LeadImportDefaults {
  return {
    companyLocation: "",
    contactTitle: "",
    contactRole: "",
    leadSource: "",
    leadStatus: "",
    ownerName: "",
    leadDate: "",
  };
}

export default function LeadImportClient({ embedded = false, onBack, onOpenLead }: Props): JSX.Element {
  const searchParams = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [step, setStep] = useState<WizardStep>("upload");
  const [mapping, setMapping] = useState<Record<string, ImportMappingValue>>({});
  const [defaults, setDefaults] = useState<LeadImportDefaults>(emptyDefaults());
  const [duplicatePolicy, setDuplicatePolicy] = useState<DuplicatePolicy>("skip");
  const [skipInvalid, setSkipInvalid] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmInFlight, setConfirmInFlight] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<WorkbookSheetInfo[]>([]);
  const [selectedSheetName, setSelectedSheetName] = useState("");
  const [jobIdInput, setJobIdInput] = useState("");
  const [previewQuery, setPreviewQuery] = useState("");
  const [previewPage, setPreviewPage] = useState(1);
  const [companyNames, setCompanyNames] = useState<string[]>([]);
  const [rowResolutions, setRowResolutions] = useState<Record<string, InvalidRowResolution>>({});
  const [resolveQuery, setResolveQuery] = useState("");
  const [resolveFilter, setResolveFilter] = useState<ResolveFilter>("all");
  const [resolvePage, setResolvePage] = useState(1);
  const [selectedResolveRows, setSelectedResolveRows] = useState<number[]>([]);
  const [bulkAction, setBulkAction] = useState<ResolveBulkAction | "">("");
  const [bulkCompanyName, setBulkCompanyName] = useState("");
  const [sessionExpired, setSessionExpired] = useState(false);
  const jobIdRef = useRef<number | null>(null);
  jobIdRef.current = job?.importId ?? null;

  const applyJob = useCallback((next: ImportJob, preferred?: WizardStep) => {
    setJob(next);
    setMapping(next.mapping || {});
    setDefaults({ ...emptyDefaults(), ...next.defaults });
    setDuplicatePolicy(next.duplicatePolicy || "skip");
    setSkipInvalid(next.skipInvalid !== false);
    setRowResolutions(next.rowResolutions || {});
    setStep(stepFromJob(next, preferred));
    setAcknowledged(false);
  }, []);

  const loadJob = useCallback(async (jobId: number, preferred?: WizardStep) => {
    setBusy(true);
    setError(null);
    try {
      const next = await getImportJob(jobId);
      applyJob(next, preferred);
      setInfo(`Loaded import #${next.importId}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load this import.");
    } finally {
      setBusy(false);
    }
  }, [applyJob]);

  useEffect(() => {
    fetch("/api/masters/others", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const names = Array.isArray(data?.companies)
          ? data.companies.map((item: { CompanyName?: string }) => String(item.CompanyName || "").trim()).filter(Boolean)
          : [];
        setCompanyNames(Array.from(new Set(names)));
      })
      .catch(() => {
        setCompanyNames([]);
      });
  }, []);

  useEffect(() => {
    const raw = searchParams.get("jobId");
    const jobId = Number(raw);
    if (Number.isInteger(jobId) && jobId > 0) {
      setJobIdInput(String(jobId));
      if (jobIdRef.current !== jobId) void loadJob(jobId);
      return;
    }
    try {
      const stored = sessionStorage.getItem(IMPORT_JOB_STORAGE_KEY);
      if (stored) setJobIdInput(stored);
    } catch {
      // ignore storage access errors
    }
  }, [loadJob, searchParams]);

  useEffect(() => {
    if (!job?.importId) return;
    try {
      sessionStorage.setItem(IMPORT_JOB_STORAGE_KEY, String(job.importId));
    } catch {
      // ignore storage access errors
    }
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("jobId") === String(job.importId)) return;
    url.searchParams.set("jobId", String(job.importId));
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [job?.importId]);

  const rememberSessionFailure = useCallback((jobId?: number | null) => {
    setSessionExpired(true);
    setError(sessionExpiredImportMessage(jobId || jobIdRef.current));
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      await ensureImportSession();
      setSessionExpired(false);
      return true;
    } catch {
      rememberSessionFailure(jobIdRef.current);
      return false;
    }
  }, [rememberSessionFailure]);

  useEffect(() => {
    void refreshSession();
    const timer = window.setInterval(() => {
      void refreshSession();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [refreshSession]);

  const conflicts = useMemo(() => mappingConflicts(mapping), [mapping]);
  const customConflicts = useMemo(() => customMappingConflicts(mapping), [mapping]);
  const mappingOk = job ? canContinueToPreview(job, mapping, defaults) : false;
  const mappingBlockers = useMemo(
    () => missingPreviewRequirements(job, mapping, defaults),
    [job, mapping, defaults],
  );
  const filteredPreview = useMemo(
    () => filterPreviewRows(job?.previewRows || [], previewQuery),
    [job?.previewRows, previewQuery],
  );
  const previewPageData = paginate(filteredPreview, previewPage, 25);
  const resolvableRows = useMemo(
    () => resolvableInvalidRows(job?.previewRows || []),
    [job?.previewRows],
  );
  const filteredResolveRows = useMemo(
    () => filterResolvableRows({
      rows: job?.previewRows || [],
      resolutions: rowResolutions,
      query: resolveQuery,
      filter: resolveFilter,
    }),
    [job?.previewRows, rowResolutions, resolveQuery, resolveFilter],
  );
  const resolvePageData = paginate(filteredResolveRows, resolvePage, 25);
  const unresolvedCount = unresolvedResolvableCount(job?.previewRows || [], rowResolutions);
  const resolvedCount = resolvableRows.filter((row) => rowResolutionStatus(rowResolutions[String(row.rowNumber)]) === "resolved").length;
  const skippedCount = resolvableRows.filter((row) => rowResolutionStatus(rowResolutions[String(row.rowNumber)]) === "skipped").length;
  const importReadyCount = readyToImportCount(job, rowResolutions);
  const continueFromResolve = canContinueFromResolve(job, rowResolutions);
  const visibleResolveRowNumbers = resolvePageData.items.map((row) => row.rowNumber);
  const allVisibleResolveSelected = visibleResolveRowNumbers.length > 0
    && visibleResolveRowNumbers.every((rowNumber) => selectedResolveRows.includes(rowNumber));

  async function handleFile(file: File | null) {
    const problem = clientFileError(file);
    setSelectedFile(file);
    setError(problem);
    setInfo(null);
    if (!file || problem) return;
    setBusy(true);
    try {
      const created = await createImportJob(file);
      if (created.kind === "needs_sheet") {
        setSheets(created.sheets);
        setSelectedSheetName("");
        setJob(null);
        setStep("sheet");
        setInfo(`${created.fileName} has multiple worksheets. Select one worksheet to import. Only that sheet will be imported.`);
        return;
      }
      applyJob(created.job, "map");
      setSheets([]);
      setSelectedSheetName(created.job.sheetName);
      setInfo(`${created.job.fileName} parsed. ${created.job.rowCount} rows ready to map.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function continueWithSheet() {
    if (!selectedFile || !selectedSheetName) {
      setError("Select a worksheet to import.");
      return;
    }
    const chosen = sheets.find((sheet) => sheet.name === selectedSheetName);
    if (chosen && !chosen.importable) {
      setError(chosen.reason || "This worksheet cannot be imported.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (job && (job.status === "uploaded" || job.status === "previewed")) {
        const next = await selectImportSheet(job.importId, selectedFile, selectedSheetName);
        applyJob(next, "map");
        setInfo(`Worksheet "${next.sheetName}" loaded. Column mappings were rebuilt for this sheet.`);
        return;
      }
      const created = await createImportJob(selectedFile, selectedSheetName);
      if (created.kind !== "job") {
        setSheets(created.sheets);
        setStep("sheet");
        return;
      }
      applyJob(created.job, "map");
      setInfo(`Worksheet "${created.job.sheetName}" loaded. ${created.job.rowCount} rows ready to map.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load the selected worksheet.");
    } finally {
      setBusy(false);
    }
  }

  async function saveMappingAndPreview() {
    if (!job) return;
    if (!mappingOk) {
      setError(mappingBlockers[0] || "Map the required ACARSH fields before previewing.");
      return;
    }
    if (!(await refreshSession())) return;
    setBusy(true);
    setError(null);
    try {
      const mappingPayload: Record<string, ImportMappingValue | ""> = {};
      for (const column of job.columns) mappingPayload[column] = mapping[column] || "";
      await updateImportJob(job.importId, {
        mapping: mappingPayload,
        defaults,
        duplicatePolicy,
        skipInvalid,
      });
      const previewed = await previewImportJob(job.importId);
      applyJob(previewed, "preview");
      setPreviewPage(1);
      setInfo("Preview refreshed from the current mapping.");
    } catch (err) {
      if (err instanceof LeadImportApiError && err.status === 401) {
        rememberSessionFailure(job.importId);
        return;
      }
      setError(err instanceof Error ? err.message : "Unable to save mapping or refresh preview.");
    } finally {
      setBusy(false);
    }
  }

  function openResolve() {
    setResolveQuery("");
    setResolveFilter("all");
    setResolvePage(1);
    setSelectedResolveRows([]);
    setBulkAction("");
    setBulkCompanyName("");
    setStep("resolve");
  }

  async function persistResolutions(preferred: WizardStep) {
    if (!job) return null;
    if (!(await refreshSession())) return null;
    setBusy(true);
    setError(null);
    try {
      await updateImportJob(job.importId, { rowResolutions });
      const previewed = await previewImportJob(job.importId);
      applyJob(previewed, preferred);
      setSessionExpired(false);
      return previewed;
    } catch (err) {
      if (err instanceof LeadImportApiError && err.status === 401) {
        rememberSessionFailure(job.importId);
        return null;
      }
      setError(err instanceof Error ? err.message : "Unable to save invalid-row resolutions.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function saveResolutionsLater() {
    const previewed = await persistResolutions("resolve");
    if (previewed) {
      setInfo("Resolutions saved. You can finish remaining invalid rows later from this import.");
    }
  }

  async function continueFromResolveStep() {
    if (!job) return;
    if (!canContinueFromResolve(job, rowResolutions)) {
      setError("Resolve or skip every invalid row before continuing.");
      return;
    }
    const previewed = await persistResolutions("confirm");
    if (!previewed) return;
    if (previewed.canConfirm) {
      setInfo(`Ready to import ${previewed.summary?.createCount ?? importReadyCount} rows.`);
      return;
    }
    applyJob(previewed, "resolve");
    setError("Some rows still need attention before import.");
  }

  function applySelectedBulkResolutions() {
    if (!selectedResolveRows.length || !bulkAction) {
      setError("Select at least one row and a bulk action.");
      return;
    }
    if (bulkAction !== "skip" && !bulkCompanyName.trim()) {
      setError(bulkAction === "assign_existing" ? "Enter an existing company name." : "Enter a new company name.");
      return;
    }
    const label = bulkAction === "skip"
      ? "skip"
      : bulkAction === "assign_existing"
        ? `assign to ${bulkCompanyName.trim()}`
        : `create company ${bulkCompanyName.trim()}`;
    if (typeof window !== "undefined" && !window.confirm(`Apply “${label}” to ${selectedResolveRows.length} selected row${selectedResolveRows.length === 1 ? "" : "s"}?`)) {
      return;
    }
    setRowResolutions((prev) => applyBulkRowResolutions({
      current: prev,
      rowNumbers: selectedResolveRows,
      action: bulkAction,
      companyName: bulkCompanyName,
    }));
    setSelectedResolveRows([]);
    setError(null);
    setInfo(`Updated ${selectedResolveRows.length} selected rows.`);
  }

  function setRowResolution(rowNumber: number, action: InvalidRowResolution["action"] | "", companyName?: string) {
    setRowResolutions((prev) => {
      const key = String(rowNumber);
      if (!action) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return {
        ...prev,
        [key]: {
          action,
          companyName: companyName !== undefined ? companyName : prev[key]?.companyName || "",
        },
      };
    });
  }

  async function runConfirm() {
    if (!job || confirmButtonDisabled({ job, confirmInFlight, acknowledged })) return;
    if (!(await refreshSession())) return;
    setConfirmInFlight(true);
    setError(null);
    try {
      const confirmed = await confirmImportJob(job.importId);
      applyJob(confirmed, "result");
      setSessionExpired(false);
      setInfo("Import finished. Review the stored summary below.");
    } catch (err) {
      if (err instanceof LeadImportApiError && err.status === 401) {
        rememberSessionFailure(job.importId);
        return;
      }
      const message = err instanceof Error ? err.message : "Confirm failed.";
      setError(message);
      try {
        const status = await getImportStatus(job.importId);
        const latest = await getImportJob(job.importId);
        applyJob(latest, status.status === "completed" ? "result" : "confirm");
      } catch {
        if (err instanceof LeadImportApiError && err.status === 401) {
          rememberSessionFailure(job.importId);
        }
      }
    } finally {
      setConfirmInFlight(false);
    }
  }

  function resetWizard() {
    setJob(null);
    setStep("upload");
    setMapping({});
    setDefaults(emptyDefaults());
    setSelectedFile(null);
    setSheets([]);
    setSelectedSheetName("");
    setError(null);
    setInfo(null);
    setAcknowledged(false);
    setJobIdInput("");
    setRowResolutions({});
    setResolveQuery("");
    setResolveFilter("all");
    setResolvePage(1);
    setSelectedResolveRows([]);
    setBulkAction("");
    setBulkCompanyName("");
    setSessionExpired(false);
    try {
      sessionStorage.removeItem(IMPORT_JOB_STORAGE_KEY);
    } catch {
      // ignore storage access errors
    }
  }

  function setColumnMapping(column: string, value: string) {
    setMapping((prev) => {
      const mapped = mappingFromSelectValue(value, column, job?.customFields || [], prev[column]);
      if (!mapped) return removeCombineColumn(prev, column) as Record<string, ImportMappingValue>;
      if (isStandardMapping(mapped) && isCombineableField(mapped)) {
        return assignCombineMapping(prev, column, mapped) as Record<string, ImportMappingValue>;
      }
      return normalizeCombineMapping({ ...prev, [column]: mapped }) as Record<string, ImportMappingValue>;
    });
  }

  const header = (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: "1 1 420px" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#F26522", letterSpacing: 0.4, textTransform: "uppercase" }}>
            Leads
          </div>
          <h1 style={{ margin: "4px 0 6px", fontSize: 26, color: "#0F1F3D" }}>Smart Lead & Contact Import</h1>
          <p style={{ margin: 0, color: "#475569", fontSize: 14, maxWidth: 720 }}>
            Import leads and their contacts from Excel or CSV files. Map columns, review validation errors and duplicates, and confirm before creating CRM records.
            Files must be 10 MB or smaller and are capped at {IMPORT_MAX_ROWS.toLocaleString()} rows.
          </p>
        </div>
        {onBack ? (
          <BackToLeadsButton onClick={onBack} />
        ) : (
          <BackToLeadsButton href="/webpage?tab=leads" />
        )}
      </div>
    </div>
  );

  return (
    <div style={{ height: "100%", minHeight: 0, overflow: "auto", background: "#F8F4EF", padding: embedded ? 18 : 24 }}>
      {header}
      <ol style={stepperStyle}>
        {STEPS.map((item, index) => {
          const activeIndex = STEPS.findIndex((stepItem) => stepItem.id === step);
          const done = index < activeIndex;
          const active = item.id === step;
          return (
            <li key={item.id} style={{ ...stepItemStyle, color: active ? "#F26522" : done ? "#1F3A68" : "#64748b" }}>
              <span style={{
                ...stepDotStyle,
                background: active ? "#F26522" : done ? "#1F3A68" : "#cbd5e1",
              }}
              >
                {index + 1}
              </span>
              {item.label}
            </li>
          );
        })}
      </ol>

      {error ? (
        <div role="alert" style={alertStyle("#fef2f2", "#991b1b")}>
          {error}
          {sessionExpired ? (
            <div style={{ marginTop: 8 }}>
              <a href="/api/auth/login" style={{ color: "#991b1b", fontWeight: 800 }}>
                Sign in again
              </a>
              {job?.importId ? ` — then open Smart Import and load import #${job.importId}.` : ""}
            </div>
          ) : null}
        </div>
      ) : null}
      {info ? <div role="status" style={alertStyle("#ecfeff", "#0e7490")}>{info}</div> : null}
      {busy ? <div style={alertStyle("#f8fafc", "#1F3A68")}>Working…</div> : null}

      {step === "sheet" ? (
        <section style={cardStyle}>
          <h2 style={h2Style}>Select a worksheet</h2>
          <p style={{ color: "#475569", fontSize: 13 }}>
            Workbook: <strong>{selectedFile?.name || job?.fileName || "Excel file"}</strong>. Only the worksheet you select will be imported. Sheets are not combined.
          </p>
          <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
            {sheets.map((sheet) => {
              const selected = selectedSheetName === sheet.name;
              return (
                <label
                  key={sheet.name}
                  style={{
                    display: "grid",
                    gap: 4,
                    border: `1.5px solid ${selected ? "#F26522" : "#e2e8f0"}`,
                    borderRadius: 12,
                    padding: 12,
                    background: selected ? "#fff7ed" : "#ffffff",
                    cursor: sheet.importable ? "pointer" : "not-allowed",
                    opacity: sheet.importable ? 1 : 0.7,
                  }}
                >
                  <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      type="radio"
                      name="worksheet"
                      disabled={!sheet.importable}
                      checked={selected}
                      onChange={() => setSelectedSheetName(sheet.name)}
                    />
                    <strong style={{ color: "#0F1F3D" }}>{sheet.name}</strong>
                  </span>
                  <span style={{ fontSize: 12, color: "#475569", paddingLeft: 24 }}>
                    {sheet.importable
                      ? `${sheet.rowCount} rows · ${sheet.columnCount} columns`
                      : sheet.reason}
                    {sheet.likelyReferenceSheet ? " · This looks like a summary or instructions sheet." : ""}
                  </span>
                </label>
              );
            })}
          </div>
          <p style={{ color: "#64748b", fontSize: 12, marginTop: 12 }}>
            To import another worksheet later, you will need this same workbook. After a page refresh, upload the file again.
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button type="button" style={secondaryButtonStyle} onClick={() => setStep("upload")}>
              Back
            </button>
            <button
              type="button"
              style={primaryButtonStyle}
              disabled={busy || !selectedSheetName}
              onClick={() => void continueWithSheet()}
            >
              Continue
            </button>
          </div>
        </section>
      ) : null}

      {step === "upload" ? (
        <section style={cardStyle}>
          <h2 style={h2Style}>Upload spreadsheet</h2>
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(false);
              void handleFile(event.dataTransfer.files?.[0] || null);
            }}
            style={{
              ...dropzoneStyle,
              borderColor: dragOver ? "#F26522" : "#cbd5e1",
              background: dragOver ? "#fff7ed" : "#ffffff",
            }}
          >
            <p style={{ margin: "0 0 10px", color: "#0F1F3D", fontWeight: 700 }}>Drag and drop .xlsx, .xls, or .csv</p>
            <p style={{ margin: "0 0 14px", color: "#475569", fontSize: 13 }}>
              Maximum {formatFileSize(IMPORT_MAX_BYTES)} and {IMPORT_MAX_ROWS.toLocaleString()} rows. The file is parsed on the server and is not sent to external AI services.
            </p>
            <button type="button" onClick={() => fileInputRef.current?.click()} style={primaryButtonStyle} disabled={busy}>
              Choose file
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept={IMPORT_ACCEPT}
              hidden
              onChange={(event) => void handleFile(event.target.files?.[0] || null)}
            />
            {selectedFile ? (
              <p style={{ margin: "12px 0 0", color: "#1F3A68", fontSize: 13 }}>
                {selectedFile.name} · {formatFileSize(selectedFile.size)}
              </p>
            ) : null}
          </div>
          <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              aria-label="Existing import ID"
              value={jobIdInput}
              onChange={(event) => setJobIdInput(event.target.value)}
              placeholder="Reopen Import ID"
              style={inputStyle}
            />
            <button
              type="button"
              style={secondaryButtonStyle}
              disabled={busy || !Number(jobIdInput)}
              onClick={() => void loadJob(Number(jobIdInput))}
            >
              Open Import
            </button>
          </div>
        </section>
      ) : null}

      {job && step === "map" ? (
        <section style={cardStyle}>
          <h2 style={h2Style}>Map columns</h2>
          <p style={{ color: "#475569", fontSize: 13 }}>
            Suggestions come from the server. Company Name is required to create a lead. Company Location and Contact Title are optional.
            Map Contact Name only when importing contacts; Contact Role is required when a contact is created and can be filled with a default.
            To build Contact Name from First Name and Second Name, map both columns to Contact Name.
          </p>
          {conflicts.length > 0 ? (
            <div role="alert" style={alertStyle("#fff7ed", "#9a3412")}>
              Each ACARSH field can be assigned to only one column. Resolve duplicate mappings before continuing.
            </div>
          ) : null}
          {customConflicts.length > 0 ? (
            <div role="alert" style={alertStyle("#fff7ed", "#9a3412")}>
              Each custom field can be assigned to only one column.
            </div>
          ) : null}
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Spreadsheet column</th>
                  <th style={thStyle}>Sample values</th>
                  <th style={thStyle}>ACARSH field</th>
                </tr>
              </thead>
              <tbody>
                {job.columns.map((column) => {
                  const samples = job.columnSamples?.[column] || [];
                  const current = mapping[column];
                  const creating = isCustomMapping(current) && current.kind === "new" ? current : null;
                  return (
                    <tr key={column}>
                      <td style={tdStyle}>
                        <strong>{column}</strong>
                        {!current ? <div style={{ color: "#64748b", fontSize: 12 }}>Unmapped</div> : null}
                        {isCustomMapping(current) ? (
                          <div style={{ color: "#1F3A68", fontSize: 12 }}>
                            Custom · {creating ? CUSTOM_FIELD_ENTITY_LABELS[creating.entityType] : "existing"}
                          </div>
                        ) : null}
                        {isCombinedContactMapping(current) ? (
                          <div style={{ color: "#1F3A68", fontSize: 12 }}>
                            Combined name/email · {COMBINED_CONTACT_TRANSFORM_LABELS[current.transform]}
                          </div>
                        ) : null}
                        {isColumnCombineSpec(current) ? (
                          <div style={{ color: "#1F3A68", fontSize: 12 }}>
                            {FIELD_LABELS[current.field]} part {current.order + 1}
                          </div>
                        ) : null}
                      </td>
                      <td style={{ ...tdStyle, color: "#475569", fontSize: 12 }}>
                        {samples.length ? samples.join(" · ") : "Not available"}
                      </td>
                      <td style={tdStyle}>
                        <select
                          aria-label={`Map ${column}`}
                          value={mappingSelectValue(current)}
                          onChange={(event) => setColumnMapping(column, event.target.value)}
                          style={inputStyle}
                        >
                          <option value="">Skip</option>
                          <optgroup label="ACARSH fields">
                            {ACARSH_FIELDS.map((field) => (
                              <option key={field} value={field}>
                                {FIELD_LABELS[field]}
                                {REQUIRED_FIELDS.includes(field) ? " (required)" : ""}
                              </option>
                            ))}
                          </optgroup>
                          {(job.customFields || []).length > 0 ? (
                            <optgroup label="Custom fields">
                              {(job.customFields || []).map((field) => (
                                <option key={field.customFieldId} value={`custom:${field.customFieldId}`}>
                                  {field.fieldName} ({CUSTOM_FIELD_ENTITY_LABELS[field.entityType]} · {CUSTOM_FIELD_TYPE_LABELS[field.fieldType]})
                                </option>
                              ))}
                            </optgroup>
                          ) : null}
                          <optgroup label="Combined name & email">
                            {COMBINED_CONTACT_TRANSFORMS.map((transform) => (
                              <option key={transform} value={`combined:${transform}`}>
                                {COMBINED_CONTACT_TRANSFORM_LABELS[transform]}
                              </option>
                            ))}
                          </optgroup>
                          <option value="new">Create new custom field…</option>
                        </select>
                        {isCombinedContactMapping(current) ? (
                          <div style={{ marginTop: 8, padding: 8, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12, color: "#334155" }}>
                            {samples.slice(0, 2).map((sample) => {
                              const transformed = applyCombinedContactTransform(sample, current.transform);
                              const previewText = current.transform === "split_contacts"
                                ? transformed.contacts.map((item) => `${item.name || "—"} <${item.email || "—"}>`).join("; ") || "No contacts extracted"
                                : current.transform === "extract_email"
                                  ? transformed.contactEmail || transformed.issues[0] || "No email extracted"
                                  : transformed.contactName || transformed.issues[0] || "No name extracted";
                              return (
                                <div key={sample}>
                                  {previewText}
                                  {transformed.issues.length ? <div style={{ color: "#9a3412" }}>{transformed.issues[0]}</div> : null}
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                        {creating ? (
                          <div style={{ display: "grid", gap: 8, marginTop: 8, padding: 8, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8 }}>
                            <label style={{ display: "grid", gap: 4, fontSize: 12, color: "#334155" }}>
                              Field name
                              <input
                                value={creating.name}
                                onChange={(event) => {
                                  const name = event.target.value;
                                  setMapping((prev) => {
                                    const existing = prev[column];
                                    if (!isCustomMapping(existing) || existing.kind !== "new") return prev;
                                    return { ...prev, [column]: { ...existing, name } };
                                  });
                                }}
                                style={inputStyle}
                              />
                            </label>
                            <label style={{ display: "grid", gap: 4, fontSize: 12, color: "#334155" }}>
                              Applies to
                              <select
                                value={creating.entityType}
                                onChange={(event) => {
                                  const entityType = event.target.value as typeof creating.entityType;
                                  setMapping((prev) => {
                                    const existing = prev[column];
                                    if (!isCustomMapping(existing) || existing.kind !== "new") return prev;
                                    return { ...prev, [column]: { ...existing, entityType } };
                                  });
                                }}
                                style={inputStyle}
                              >
                                {CUSTOM_FIELD_ENTITY_TYPES.map((entityType) => (
                                  <option key={entityType} value={entityType}>
                                    {CUSTOM_FIELD_ENTITY_LABELS[entityType]}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label style={{ display: "grid", gap: 4, fontSize: 12, color: "#334155" }}>
                              Field type
                              <select
                                value={creating.fieldType}
                                onChange={(event) => {
                                  const fieldType = event.target.value as typeof creating.fieldType;
                                  setMapping((prev) => {
                                    const existing = prev[column];
                                    if (!isCustomMapping(existing) || existing.kind !== "new") return prev;
                                    return { ...prev, [column]: { ...existing, fieldType } };
                                  });
                                }}
                                style={inputStyle}
                              >
                                {CUSTOM_FIELD_TYPES.map((fieldType) => (
                                  <option key={fieldType} value={fieldType}>
                                    {CUSTOM_FIELD_TYPE_LABELS[fieldType]}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label style={{ ...radioStyle, marginTop: 0 }}>
                              <input
                                type="checkbox"
                                checked={creating.required === true}
                                onChange={(event) => {
                                  const required = event.target.checked;
                                  setMapping((prev) => {
                                    const existing = prev[column];
                                    if (!isCustomMapping(existing) || existing.kind !== "new") return prev;
                                    return { ...prev, [column]: { ...existing, required } };
                                  });
                                }}
                              />
                              Required
                            </label>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {COMBINEABLE_FIELDS.map((field) => {
            const parts = combinePartsForField(mapping, field);
            if (parts.length < 2) return null;
            const sample = combineColumnValues(parts.map((part) => job.columnSamples?.[part.column]?.[0] || ""));
            return (
              <div key={field} style={{ marginTop: 16, padding: 12, border: "1px solid #e2e8f0", borderRadius: 10, background: "#f8fafc" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#1F3A68", marginBottom: 8 }}>
                  Combined {FIELD_LABELS[field]}
                </div>
                {parts.map((part, index) => (
                  <div key={part.column} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, fontSize: 13 }}>
                    <span style={{ minWidth: 18, color: "#64748b" }}>{index + 1}.</span>
                    <strong style={{ flex: 1 }}>{part.column}</strong>
                    <button type="button" style={secondaryButtonStyle} disabled={index === 0} onClick={() => setMapping((prev) => reorderCombineField(prev, field, index, index - 1) as Record<string, ImportMappingValue>)}>
                      Up
                    </button>
                    <button type="button" style={secondaryButtonStyle} disabled={index === parts.length - 1} onClick={() => setMapping((prev) => reorderCombineField(prev, field, index, index + 1) as Record<string, ImportMappingValue>)}>
                      Down
                    </button>
                    <button type="button" style={secondaryButtonStyle} onClick={() => setMapping((prev) => removeCombineColumn(prev, part.column) as Record<string, ImportMappingValue>)}>
                      Remove
                    </button>
                  </div>
                ))}
                <div style={{ fontSize: 12, color: "#475569" }}>Sample: {sample || "—"}</div>
              </div>
            );
          })}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginTop: 16 }}>
            {(["companyLocation", "contactTitle", "contactRole", "leadSource"] as const).map((field) => (
              <label key={field} style={{ display: "grid", gap: 6, fontSize: 12, color: "#334155" }}>
                Default {FIELD_LABELS[field]}
                <input
                  value={defaults[field]}
                  onChange={(event) => setDefaults((prev) => ({ ...prev, [field]: event.target.value }))}
                  style={inputStyle}
                />
              </label>
            ))}
          </div>
          <fieldset style={{ border: "1px solid #e2e8f0", borderRadius: 10, marginTop: 16, padding: 12 }}>
            <legend style={{ fontSize: 12, fontWeight: 700, color: "#1F3A68" }}>Duplicate rows</legend>
            <label style={radioStyle}>
              <input
                type="radio"
                name="duplicatePolicy"
                checked={duplicatePolicy === "skip"}
                onChange={() => setDuplicatePolicy("skip")}
              />
              Skip duplicates
            </label>
            <label style={radioStyle}>
              <input
                type="radio"
                name="duplicatePolicy"
                checked={duplicatePolicy === "create_new"}
                onChange={() => setDuplicatePolicy("create_new")}
              />
              Create new records for duplicates
            </label>
            {duplicatePolicy === "create_new" ? (
              <p style={{ margin: "8px 0 0", color: "#9a3412", fontSize: 13 }}>
                Create new can insert additional CRM records that match existing companies or contacts.
              </p>
            ) : null}
          </fieldset>
          <label style={{ ...radioStyle, marginTop: 10 }}>
            <input type="checkbox" checked={skipInvalid} onChange={(event) => setSkipInvalid(event.target.checked)} />
            Skip invalid rows during import
          </label>
          {mappingBlockers.length > 0 ? (
            <div role="alert" style={alertStyle("#fff7ed", "#9a3412")}>
              {mappingBlockers[0]}
              {mappingBlockers.length > 1 ? ` (${mappingBlockers.length - 1} more)` : ""}
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button
              type="button"
              style={secondaryButtonStyle}
              onClick={() => setStep(sheets.length > 1 && selectedFile ? "sheet" : "upload")}
            >
              Back
            </button>
            <button
              type="button"
              style={{
                ...primaryButtonStyle,
                opacity: busy || !mappingOk ? 0.65 : 1,
                cursor: busy ? "wait" : "pointer",
              }}
              disabled={busy}
              onClick={() => void saveMappingAndPreview()}
            >
              Continue to preview
            </button>
          </div>
        </section>
      ) : null}

      {job && step === "preview" ? (
        <section style={cardStyle}>
          <h2 style={h2Style}>Preview and validate</h2>
          <p style={{ color: "#475569", fontSize: 13 }}>
            Nothing has been imported yet. Eligible rows are created only after you confirm.
          </p>
          <div style={kpiRowStyle}>
            <Kpi label="Total rows" value={job.rowCount} />
            <Kpi label="Valid / eligible" value={job.summary?.createCount ?? 0} />
            <Kpi label="Duplicates" value={job.summary?.duplicate ?? 0} />
            <Kpi label="Invalid" value={job.summary?.invalid ?? 0} />
            <Kpi label="Needs attention" value={job.summary?.needsAttention ?? 0} />
          </div>
          {duplicatePolicy === "create_new" ? (
            <div role="alert" style={alertStyle("#fff7ed", "#9a3412")}>
              Duplicate policy is Create new. Confirming can create additional records for companies or contacts that already exist.
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 8, margin: "12px 0", flexWrap: "wrap" }}>
            <input
              value={previewQuery}
              onChange={(event) => {
                setPreviewQuery(event.target.value);
                setPreviewPage(1);
              }}
              placeholder="Search preview"
              style={{ ...inputStyle, minWidth: 220 }}
            />
            <button type="button" style={secondaryButtonStyle} onClick={() => { setStep("map"); }}>
              Back to mapping
            </button>
            <button type="button" style={secondaryButtonStyle} disabled={busy} onClick={() => void saveMappingAndPreview()}>
              Refresh preview
            </button>
            <button
              type="button"
              style={primaryButtonStyle}
              disabled={job.status !== "previewed" || (!resolvableRows.length && !canOpenConfirm(job))}
              onClick={() => {
                if (resolvableRows.length) {
                  openResolve();
                  return;
                }
                setStep("confirm");
              }}
            >
              {resolvableRows.length ? "Resolve invalid rows" : "Review confirmation"}
            </button>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Row</th>
                  <th style={thStyle}>Company</th>
                  <th style={thStyle}>Contact</th>
                  <th style={thStyle}>Extracted contacts</th>
                  <th style={thStyle}>Title</th>
                  <th style={thStyle}>Custom fields</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Messages</th>
                </tr>
              </thead>
              <tbody>
                {previewPageData.items.length === 0 ? (
                  <tr>
                    <td style={tdStyle} colSpan={8}>No preview rows match this search.</td>
                  </tr>
                ) : (
                  previewPageData.items.map((row) => {
                    const tone = statusTone(row.status);
                    return (
                      <tr key={row.rowNumber} style={{ background: tone.bg }}>
                        <td style={tdStyle}>{row.rowNumber}</td>
                        <td style={tdStyle}>{row.companyName || "—"}</td>
                        <td style={tdStyle}>{row.contactName || "—"}</td>
                        <td style={{ ...tdStyle, fontSize: 12, color: "#475569" }}>
                          {(row.extractedContacts || []).length
                            ? row.extractedContacts!.map((item) => `${item.name || "—"} <${item.email || "—"}>${item.reasons.length ? ` (${item.reasons[0]})` : ""}`).join("; ")
                            : "—"}
                        </td>
                        <td style={tdStyle}>{row.contactTitle || "—"}</td>
                        <td style={{ ...tdStyle, fontSize: 12, color: "#475569" }}>
                          {(row.customValues || []).length
                            ? row.customValues!.map((item) => `${item.fieldName}: ${item.normalizedValue || item.rawValue || "—"}`).join("; ")
                            : "—"}
                        </td>
                        <td style={tdStyle}>
                          <span style={{ ...badgeStyle, color: tone.color, borderColor: tone.border }}>{previewRowLabel(row.status)}</span>
                        </td>
                        <td style={{ ...tdStyle, fontSize: 12, color: "#475569" }}>{row.reasons.join("; ") || "—"}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {resolvableRows.length ? (
            <div style={{ marginTop: 18, padding: 14, border: "1px solid #fed7aa", borderRadius: 12, background: "#fff7ed", display: "flex", gap: 12, justifyContent: "space-between", flexWrap: "wrap", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 800, color: "#9a3412" }}>
                  {resolvableRows.length} invalid {resolvableRows.length === 1 ? "row needs" : "rows need"} a company
                </div>
                <p style={{ margin: "4px 0 0", fontSize: 13, color: "#9a3412" }}>
                  {unresolvedCount} unresolved. Assign an existing company, create a new one, or skip before import. Email-domain suggestions are for review only.
                </p>
              </div>
              <button type="button" style={primaryButtonStyle} onClick={openResolve}>
                Resolve invalid rows
              </button>
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
            <button type="button" style={secondaryButtonStyle} disabled={previewPageData.currentPage <= 1} onClick={() => setPreviewPage((page) => page - 1)}>
              Previous
            </button>
            <span style={{ fontSize: 12, color: "#475569" }}>
              Page {previewPageData.currentPage} of {previewPageData.totalPages}
            </span>
            <button type="button" style={secondaryButtonStyle} disabled={previewPageData.currentPage >= previewPageData.totalPages} onClick={() => setPreviewPage((page) => page + 1)}>
              Next
            </button>
          </div>
        </section>
      ) : null}

      {job && step === "resolve" ? (
        <section style={cardStyle}>
          <h2 style={h2Style}>Resolve invalid rows</h2>
          <p style={{ color: "#475569", fontSize: 13 }}>
            These contacts have data but no Company Name. Assign an existing tenant company, create a new company, or skip.
            Email-domain suggestions are for review only and are never applied automatically.
          </p>
          <div style={kpiRowStyle}>
            <Kpi label="Invalid rows" value={resolvableRows.length} />
            <Kpi label="Unresolved" value={unresolvedCount} />
            <Kpi label="Resolved" value={resolvedCount} />
            <Kpi label="Skipped" value={skippedCount} />
          </div>
          <div style={{ display: "flex", gap: 8, margin: "12px 0", flexWrap: "wrap", alignItems: "center" }}>
            <input
              value={resolveQuery}
              onChange={(event) => {
                setResolveQuery(event.target.value);
                setResolvePage(1);
              }}
              placeholder="Search name, email, company, or row #"
              style={{ ...inputStyle, minWidth: 240 }}
            />
            {(["all", "unresolved", "resolved", "skipped"] as ResolveFilter[]).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  setResolveFilter(item);
                  setResolvePage(1);
                }}
                style={{
                  ...secondaryButtonStyle,
                  padding: "6px 10px",
                  fontSize: 12,
                  background: resolveFilter === item ? "#F26522" : "#ffffff",
                  color: resolveFilter === item ? "#ffffff" : "#0F1F3D",
                  borderColor: resolveFilter === item ? "#F26522" : "#cbd5e1",
                }}
              >
                {item === "all" ? "All" : item === "unresolved" ? "Unresolved" : item === "resolved" ? "Resolved" : "Skipped"}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
            <select
              value={bulkAction}
              onChange={(event) => setBulkAction(event.target.value as ResolveBulkAction | "")}
              style={inputStyle}
            >
              <option value="">Bulk action</option>
              <option value="assign_existing">Assign existing company</option>
              <option value="create_company">Create new company</option>
              <option value="skip">Skip selected rows</option>
            </select>
            {bulkAction && bulkAction !== "skip" ? (
              <input
                list="resolve-existing-companies"
                value={bulkCompanyName}
                onChange={(event) => setBulkCompanyName(event.target.value)}
                placeholder={bulkAction === "assign_existing" ? "Existing company name" : "New company name"}
                style={{ ...inputStyle, minWidth: 220 }}
              />
            ) : null}
            <button
              type="button"
              style={secondaryButtonStyle}
              disabled={!selectedResolveRows.length || !bulkAction || busy}
              onClick={applySelectedBulkResolutions}
            >
              Apply to {selectedResolveRows.length || 0} selected
            </button>
          </div>
          <datalist id="resolve-existing-companies">
            {companyNames.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <div style={{ overflowX: "auto" }}>
            <table style={{ ...tableStyle, minWidth: 980 }}>
              <thead>
                <tr>
                  <th style={thStyle}>
                    <input
                      type="checkbox"
                      checked={allVisibleResolveSelected}
                      disabled={!visibleResolveRowNumbers.length}
                      onChange={(event) => setSelectedResolveRows((prev) => setPageRowSelection(prev, visibleResolveRowNumbers, event.target.checked))}
                      aria-label="Select all rows on this page"
                    />
                  </th>
                  <th style={thStyle}>Row</th>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Title</th>
                  <th style={thStyle}>Email</th>
                  <th style={thStyle}>Suggested company</th>
                  <th style={thStyle}>Resolution</th>
                  <th style={thStyle}>Company</th>
                  <th style={thStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {resolvePageData.items.length === 0 ? (
                  <tr>
                    <td style={tdStyle} colSpan={9}>
                      {resolvableRows.length ? "No invalid rows match this search or filter." : "No invalid contact rows need a company."}
                    </td>
                  </tr>
                ) : (
                  resolvePageData.items.map((row) => {
                    const current = rowResolutions[String(row.rowNumber)];
                    const status = rowResolutionStatus(current);
                    const tone = resolutionStatusTone(status);
                    const checked = selectedResolveRows.includes(row.rowNumber);
                    return (
                      <tr key={row.rowNumber} style={{ background: status === "unresolved" ? "#fff7ed" : "#ffffff" }}>
                        <td style={tdStyle}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) => setSelectedResolveRows((prev) => toggleSelectedRowNumbers(prev, row.rowNumber, event.target.checked))}
                            aria-label={`Select row ${row.rowNumber}`}
                          />
                        </td>
                        <td style={tdStyle}>{row.rowNumber}</td>
                        <td style={tdStyle}>{row.contactName || "—"}</td>
                        <td style={tdStyle}>{row.contactTitle || "—"}</td>
                        <td style={tdStyle}>{row.contactEmail || "—"}</td>
                        <td style={tdStyle}>
                          {row.suggestedCompanyName ? (
                            <div style={{ display: "grid", gap: 6 }}>
                              <span style={{ color: "#1e40af", fontSize: 12 }}>{row.suggestedCompanyName}</span>
                              <button
                                type="button"
                                style={{ ...secondaryButtonStyle, padding: "4px 8px", fontSize: 11 }}
                                onClick={() => setRowResolution(row.rowNumber, "create_company", row.suggestedCompanyName || "")}
                              >
                                Use suggestion
                              </button>
                            </div>
                          ) : "—"}
                        </td>
                        <td style={tdStyle}>
                          <select
                            value={current?.action || ""}
                            onChange={(event) => setRowResolution(row.rowNumber, event.target.value as InvalidRowResolution["action"] | "")}
                            style={{ ...inputStyle, minWidth: 170 }}
                          >
                            <option value="">Choose resolution</option>
                            <option value="assign_existing">Assign existing</option>
                            <option value="create_company">Create company</option>
                            <option value="skip">Skip row</option>
                          </select>
                        </td>
                        <td style={tdStyle}>
                          {current?.action && current.action !== "skip" ? (
                            <input
                              list="resolve-existing-companies"
                              value={current.companyName || ""}
                              onChange={(event) => setRowResolution(row.rowNumber, current.action, event.target.value)}
                              placeholder={current.action === "assign_existing" ? "Existing company" : "New company name"}
                              style={{ ...inputStyle, minWidth: 180 }}
                            />
                          ) : "—"}
                        </td>
                        <td style={tdStyle}>
                          <span style={{ ...badgeStyle, color: tone.color, borderColor: tone.border, background: tone.bg }}>
                            {resolutionStatusLabel(status)}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
            <button type="button" style={secondaryButtonStyle} disabled={resolvePageData.currentPage <= 1} onClick={() => setResolvePage((page) => page - 1)}>
              Previous
            </button>
            <span style={{ fontSize: 12, color: "#475569" }}>
              Page {resolvePageData.currentPage} of {resolvePageData.totalPages} · {filteredResolveRows.length} shown
            </span>
            <button type="button" style={secondaryButtonStyle} disabled={resolvePageData.currentPage >= resolvePageData.totalPages} onClick={() => setResolvePage((page) => page + 1)}>
              Next
            </button>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
            <button type="button" style={secondaryButtonStyle} onClick={() => setStep("preview")} disabled={busy}>
              Back to Preview
            </button>
            <button type="button" style={secondaryButtonStyle} disabled={busy} onClick={() => void saveResolutionsLater()}>
              Save & Resolve Later
            </button>
            <button
              type="button"
              style={{
                ...primaryButtonStyle,
                opacity: busy || !continueFromResolve ? 0.65 : 1,
              }}
              disabled={busy || !continueFromResolve}
              onClick={() => void continueFromResolveStep()}
            >
              Continue to Import ({importReadyCount})
            </button>
          </div>
        </section>
      ) : null}

      {job && step === "confirm" ? (
        <section style={cardStyle}>
          <h2 style={h2Style}>Confirm import</h2>
          <p style={{ color: "#475569", fontSize: 13 }}>
            Import #{job.importId} is saved. This import commits one row at a time. It is not globally atomic. Some rows may succeed while others fail.
            Created leads are not rolled back automatically.
          </p>
          <div style={kpiRowStyle}>
            <Kpi label="Eligible to create" value={job.summary?.createCount ?? 0} />
            <Kpi label="Duplicates" value={job.summary?.duplicate ?? 0} />
            <Kpi label="Invalid / skipped" value={(job.summary?.invalid ?? 0) + (job.summary?.needsAttention ?? 0)} />
          </div>
          <label style={radioStyle}>
            <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
            I understand rows will be written to this company after I confirm.
          </label>
          <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
            <button type="button" style={secondaryButtonStyle} onClick={() => setStep("preview")} disabled={confirmInFlight}>
              Back to preview
            </button>
            <button
              type="button"
              style={primaryButtonStyle}
              disabled={sessionExpired || confirmButtonDisabled({ job, confirmInFlight, acknowledged })}
              onClick={() => void runConfirm()}
            >
              {confirmInFlight ? "Importing…" : "Confirm import"}
            </button>
            {sessionExpired ? (
              <a href="/api/auth/login" style={{ ...secondaryButtonStyle, textDecoration: "none" }}>
                Sign in to continue import #{job.importId}
              </a>
            ) : null}
          </div>
        </section>
      ) : null}

      {job && step === "result" ? (
        <section style={cardStyle}>
          <h2 style={h2Style}>Import results</h2>
          <p style={{ color: "#475569", fontSize: 13 }}>
            Import #{job.importId} is {job.status}. This summary is stored and can be reopened later.
          </p>
          <div style={kpiRowStyle}>
            <Kpi label="Leads created" value={job.result?.createdLeads ?? 0} />
            <Kpi label="Contacts created" value={job.result?.createdContacts ?? 0} />
            <Kpi label="Companies created" value={job.result?.createdCompanies ?? 0} />
            <Kpi label="Existing companies reused" value={job.result?.reusedExistingCompanies ?? 0} />
            <Kpi label="Skipped rows" value={job.result?.skippedRows ?? job.result?.invalidSkipped ?? 0} />
            <Kpi label="Unresolved rows" value={job.result?.unresolvedRows ?? 0} />
            <Kpi label="Duplicates skipped" value={job.result?.duplicatesSkipped ?? 0} />
            <Kpi label="Failed rows" value={job.result?.failed.length ?? 0} />
          </div>
          {(job.result?.failed.length || 0) > 0 ? (
            <div style={{ overflowX: "auto", marginTop: 12 }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Row</th>
                    <th style={thStyle}>Company</th>
                    <th style={thStyle}>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {job.result?.failed.map((row) => (
                    <tr key={`${row.rowNumber}-${row.reason}`}>
                      <td style={tdStyle}>{row.rowNumber}</td>
                      <td style={tdStyle}>{row.companyName}</td>
                      <td style={tdStyle}>{row.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {job.previewRows.some((row) => row.existingLeadId) && onOpenLead ? (
            <p style={{ fontSize: 13, color: "#1F3A68" }}>
              Existing matched companies stay in Leads. Open a created lead from the Leads list after refresh.
            </p>
          ) : null}
          <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
            {canRetryConfirm(job) ? (
              <button type="button" style={primaryButtonStyle} disabled={confirmInFlight} onClick={() => void runConfirm()}>
                Retry remaining rows
              </button>
            ) : null}
            {selectedFile && /\.xlsx?$/i.test(selectedFile.name) ? (
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={() => {
                  setAcknowledged(false);
                  setStep("sheet");
                  setInfo("Select another worksheet from the same workbook. A new import will be created for that sheet.");
                }}
              >
                Import another worksheet
              </button>
            ) : null}
            <button type="button" style={primaryButtonStyle} onClick={resetWizard}>
              Start another import
            </button>
            {onBack ? (
              <button type="button" style={secondaryButtonStyle} onClick={onBack}>
                Return to Leads
              </button>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function BackToLeadsButton({ onClick, href }: { onClick?: () => void; href?: string }): JSX.Element {
  const [hover, setHover] = useState(false);
  const style: React.CSSProperties = {
    ...backToLeadsButtonStyle,
    background: hover ? "#d9571c" : "#F26522",
  };
  const content = (
    <>
      <span aria-hidden="true">←</span>
      Back to Leads
    </>
  );
  const hoverProps = {
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
  };
  if (onClick) {
    return (
      <button type="button" onClick={onClick} style={style} {...hoverProps}>
        {content}
      </button>
    );
  }
  return (
    <a href={href || "/webpage?tab=leads"} style={style} {...hoverProps}>
      {content}
    </a>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ minWidth: 120, padding: "10px 12px", borderRadius: 10, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
      <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 22, color: "#0F1F3D", fontWeight: 800 }}>{value}</div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: "#ffffff",
  border: "1px solid rgba(31, 58, 104, 0.12)",
  borderRadius: 16,
  padding: 18,
  boxShadow: "0 14px 34px rgba(15, 31, 61, 0.06)",
};
const h2Style: React.CSSProperties = { margin: "0 0 8px", color: "#0F1F3D", fontSize: 18 };
const primaryButtonStyle: React.CSSProperties = {
  background: "#F26522",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "9px 14px",
  fontWeight: 700,
  cursor: "pointer",
};
const backToLeadsButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  alignSelf: "flex-start",
  background: "#F26522",
  color: "#ffffff",
  border: "none",
  borderRadius: 8,
  padding: "7px 12px",
  fontSize: 13,
  fontWeight: 600,
  lineHeight: 1.2,
  cursor: "pointer",
  whiteSpace: "nowrap",
  textDecoration: "none",
  height: "fit-content",
  boxShadow: "none",
};
const secondaryButtonStyle: React.CSSProperties = {
  background: "#ffffff",
  color: "#0F1F3D",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  padding: "9px 14px",
  fontWeight: 700,
  cursor: "pointer",
};
const inputStyle: React.CSSProperties = {
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 13,
  fontFamily: "inherit",
};
const dropzoneStyle: React.CSSProperties = {
  border: "1.5px dashed #cbd5e1",
  borderRadius: 14,
  padding: 28,
  textAlign: "center",
};
const tableStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse", minWidth: 640 };
const thStyle: React.CSSProperties = {
  textAlign: "left",
  fontSize: 11,
  color: "#1F3A68",
  borderBottom: "1px solid #e2e8f0",
  padding: "8px 6px",
};
const tdStyle: React.CSSProperties = { padding: "8px 6px", borderBottom: "1px solid #f1f5f9", fontSize: 13, color: "#0F1F3D", verticalAlign: "top" };
const stepperStyle: React.CSSProperties = { display: "flex", gap: 16, listStyle: "none", padding: 0, margin: "0 0 16px", flexWrap: "wrap" };
const stepItemStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700 };
const stepDotStyle: React.CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: "50%",
  color: "#fff",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 12,
};
const kpiRowStyle: React.CSSProperties = { display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0" };
const radioStyle: React.CSSProperties = { display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "#334155", marginTop: 6 };
const badgeStyle: React.CSSProperties = { display: "inline-block", border: "1px solid", borderRadius: 999, padding: "2px 8px", fontSize: 11, fontWeight: 700 };
function alertStyle(bg: string, color: string): React.CSSProperties {
  return { background: bg, color, borderRadius: 10, padding: "10px 12px", marginBottom: 12, fontSize: 13 };
}
