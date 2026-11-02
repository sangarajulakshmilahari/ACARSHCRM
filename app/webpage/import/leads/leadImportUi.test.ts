import assert from "node:assert/strict";
import { test } from "node:test";

import { messageForImportHttpStatus } from "./leadImportApi";
import {
  applyBulkRowResolutions,
  canContinueFromResolve,
  canContinueToPreview,
  canOpenConfirm,
  canRetryConfirm,
  clientFileError,
  confirmButtonDisabled,
  customMappingConflicts,
  filterPreviewRows,
  filterResolvableRows,
  mappingConflicts,
  mappingFromSelectValue,
  mappingIsAcceptable,
  mappingSelectValue,
  missingPreviewRequirements,
  paginate,
  readyToImportCount,
  resolvableInvalidRows,
  resolutionStatusLabel,
  rowResolutionStatus,
  setPageRowSelection,
  stepFromJob,
  toggleSelectedRowNumbers,
  unresolvedResolvableCount,
} from "./leadImportUi";
import type { ImportJob } from "./leadImportApi";

function job(overrides: Partial<ImportJob> = {}): ImportJob {
  return {
    importId: 41,
    status: "uploaded",
    fileName: "leads.csv",
    fileSha256: "abc",
    fileSizeBytes: 120,
    sheetName: "Sheet1",
    columns: ["Company Name", "Contact Name"],
    mapping: { "Company Name": "companyName", "Contact Name": "contactName" },
    unmapped: [],
    unmappedToNotes: [],
    suggestions: [],
    defaults: {
      companyLocation: "New York",
      contactTitle: "CEO",
      contactRole: "Decision Maker",
      leadSource: "Excel Import",
      leadStatus: "New",
      ownerName: "alice",
      leadDate: "2026-10-27",
    },
    duplicatePolicy: "skip",
    skipInvalid: true,
    rowCount: 1,
    summary: { valid: 1, needsAttention: 0, invalid: 0, existing: 0, duplicate: 0, createCount: 1 },
    previewRows: [],
    missingRequired: [],
    canConfirm: false,
    result: null,
    errorMessage: null,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

test("upload UI rejects unsupported empty and oversized files", () => {
  const asFile = (name: string, size: number) => ({ name, size } as File);
  assert.match(clientFileError(asFile("notes.txt", 12)) || "", /unsupported format/i);
  assert.match(clientFileError(asFile("leads.csv", 0)) || "", /empty or unreadable/i);
  assert.match(clientFileError(asFile("leads.csv", 11 * 1024 * 1024)) || "", /10 MB/i);
  assert.equal(clientFileError(asFile("leads.csv", 12)), null);
});

test("mapping changes require unique fields and required coverage before preview", () => {
  const current = job();
  assert.equal(mappingIsAcceptable(current, current.mapping, current.defaults), true);
  assert.equal(canContinueToPreview(current, current.mapping, current.defaults), true);
  const conflicts = mappingConflicts({
    Email: "contactEmail",
    Mail: "contactEmail",
  });
  assert.equal(conflicts.length, 1);
  assert.equal(
    mappingConflicts({
      "First Name": "contactName",
      "Second Name": "contactName",
    }).length,
    0,
  );
  assert.equal(
    mappingIsAcceptable(current, { "Company Name": "companyName" }, { ...current.defaults, contactTitle: "", contactRole: "", companyLocation: "" }),
    true,
  );
  const blockers = missingPreviewRequirements(
    current,
    { "Company Name": "companyName" },
    { ...current.defaults, contactTitle: "", contactRole: "", companyLocation: "" },
  );
  assert.equal(blockers.some((item) => /Contact Name/i.test(item)), false);
  assert.equal(blockers.some((item) => /Company Location/i.test(item)), false);
  const contactWithoutRole = missingPreviewRequirements(
    current,
    { "Company Name": "companyName", "Contact Name": "contactName" },
    { ...current.defaults, contactRole: "" },
  );
  assert.equal(contactWithoutRole.some((item) => /Contact Role/i.test(item)), true);
  const customConflicts = customMappingConflicts({
    Address: { kind: "new", name: "Address", entityType: "lead", fieldType: "text" },
    Location: { kind: "new", name: "Address", entityType: "lead", fieldType: "text" },
  });
  assert.equal(customConflicts.length, 1);
  assert.equal(mappingSelectValue({ kind: "custom", customFieldId: 9 }), "custom:9");
  assert.equal(mappingSelectValue({ kind: "combined_contact", transform: "split_contacts" }), "combined:split_contacts");
  const splitMapped = mappingFromSelectValue("combined:extract_email", "People", []);
  assert.equal(typeof splitMapped === "object" && splitMapped.kind === "combined_contact", true);
  const covered = missingPreviewRequirements(
    current,
    { "Company Name": "companyName", People: { kind: "combined_contact", transform: "split_contacts" } },
    current.defaults,
  );
  assert.equal(covered.some((item) => /Contact Name/i.test(item)), false);
  const created = mappingFromSelectValue("new", "Other Information", []);
  assert.equal(typeof created === "object" && created.kind === "new", true);
});

test("preview refresh stays on preview for a previewed job and confirm stays disabled until acknowledged", () => {
  const previewed = job({ status: "previewed", canConfirm: true });
  assert.equal(stepFromJob(previewed, "sheet"), "sheet");
  assert.equal(stepFromJob(previewed), "preview");
  assert.equal(canOpenConfirm(previewed), true);
  assert.equal(confirmButtonDisabled({ job: previewed, confirmInFlight: false, acknowledged: false }), true);
  assert.equal(confirmButtonDisabled({ job: previewed, confirmInFlight: true, acknowledged: true }), true);
  assert.equal(confirmButtonDisabled({ job: previewed, confirmInFlight: false, acknowledged: true }), false);
});

test("completed jobs show stored summary state and do not enable unsafe retry", () => {
  const completed = job({
    status: "completed",
    canConfirm: false,
    result: {
      createdLeads: 1,
      createdContacts: 1,
      duplicatesSkipped: 0,
      invalidSkipped: 0,
      failed: [{ rowNumber: 3, companyName: "Globex", reason: "Invalid Contact Role" }],
      scored: 1,
    },
  });
  assert.equal(stepFromJob(completed), "result");
  assert.equal(canRetryConfirm(completed), false);
  assert.equal(confirmButtonDisabled({ job: completed, confirmInFlight: false, acknowledged: true }), true);
});

test("confirming jobs can resume and unauthorized messages stay generic", () => {
  const confirming = job({ status: "confirming", canConfirm: false });
  assert.equal(stepFromJob(confirming), "confirm");
  assert.equal(canRetryConfirm(confirming), true);
  assert.equal(confirmButtonDisabled({ job: confirming, confirmInFlight: false, acknowledged: true }), false);
  assert.match(messageForImportHttpStatus(401), /session expired/i);
  assert.match(messageForImportHttpStatus(404), /not found or you do not have access/i);
});

test("preview search and pagination work for empty and filtered states", () => {
  const rows = [
    { rowNumber: 2, companyName: "Acme", contactName: "Jane", contactTitle: "CEO", linkedInUrl: "", status: "new" as const, reasons: [] },
    { rowNumber: 3, companyName: "Globex", contactName: "Sam", contactTitle: "CTO", linkedInUrl: "", status: "duplicate" as const, reasons: ["duplicate"] },
  ];
  assert.equal(filterPreviewRows(rows, "globex").length, 1);
  assert.equal(filterPreviewRows(rows, "missing").length, 0);
  const page = paginate(rows, 1, 1);
  assert.equal(page.items.length, 1);
  assert.equal(page.totalPages, 2);
});

test("resolvable invalid rows are contacts missing a company name", () => {
  const rows = [
    {
      rowNumber: 2,
      companyName: "",
      contactName: "Jane",
      contactTitle: "",
      linkedInUrl: "",
      contactEmail: "jane@acme.com",
      status: "invalid" as const,
      reasons: ["Company Name missing"],
    },
    {
      rowNumber: 3,
      companyName: "Acme",
      contactName: "John",
      contactTitle: "",
      linkedInUrl: "",
      status: "new" as const,
      reasons: [],
    },
  ];
  assert.equal(resolvableInvalidRows(rows).length, 1);
  assert.equal(resolvableInvalidRows(rows)[0]?.rowNumber, 2);
});

test("resolve table filters, search, bulk actions, pagination, and continue counts", () => {
  const rows = [
    {
      rowNumber: 2,
      companyName: "",
      contactName: "Jane",
      contactTitle: "CEO",
      linkedInUrl: "",
      contactEmail: "jane@acme.com",
      suggestedCompanyName: "acme.com",
      status: "invalid" as const,
      reasons: ["Company Name missing"],
    },
    {
      rowNumber: 3,
      companyName: "",
      contactName: "Sam",
      contactTitle: "CTO",
      linkedInUrl: "",
      contactEmail: "sam@globex.com",
      suggestedCompanyName: "globex.com",
      status: "invalid" as const,
      reasons: ["Company Name missing"],
    },
    {
      rowNumber: 4,
      companyName: "Ready Co",
      contactName: "Pat",
      contactTitle: "",
      linkedInUrl: "",
      status: "new" as const,
      reasons: [],
    },
  ];
  const current = job({
    status: "previewed",
    previewRows: rows,
    canConfirm: false,
    summary: { valid: 1, needsAttention: 0, invalid: 2, existing: 0, duplicate: 0, createCount: 1 },
  });

  assert.equal(rowResolutionStatus(undefined), "unresolved");
  assert.equal(rowResolutionStatus({ action: "skip" }), "skipped");
  assert.equal(rowResolutionStatus({ action: "create_company", companyName: "Acme" }), "resolved");
  assert.equal(rowResolutionStatus({ action: "assign_existing", companyName: "  " }), "unresolved");
  assert.equal(resolutionStatusLabel("unresolved"), "Unresolved");
  assert.equal(resolutionStatusLabel("resolved"), "Resolved");
  assert.equal(resolutionStatusLabel("skipped"), "Skipped");

  const resolutions = {
    "2": { action: "create_company" as const, companyName: "Acme" },
    "3": { action: "skip" as const },
  };
  assert.equal(filterResolvableRows({ rows, resolutions, query: "", filter: "all" }).length, 2);
  assert.equal(filterResolvableRows({ rows, resolutions, query: "", filter: "resolved" })[0]?.rowNumber, 2);
  assert.equal(filterResolvableRows({ rows, resolutions, query: "", filter: "skipped" })[0]?.rowNumber, 3);
  assert.equal(filterResolvableRows({ rows, resolutions, query: "", filter: "unresolved" }).length, 0);
  assert.equal(filterResolvableRows({ rows, resolutions: {}, query: "jane", filter: "all" }).length, 1);
  assert.equal(filterResolvableRows({ rows, resolutions: {}, query: "globex.com", filter: "all" }).length, 1);
  assert.equal(filterResolvableRows({ rows, resolutions, query: "acme", filter: "resolved" }).length, 1);
  assert.equal(unresolvedResolvableCount(rows, {}), 2);

  const bulk = applyBulkRowResolutions({
    current: {},
    rowNumbers: [2, 3],
    action: "assign_existing",
    companyName: "Globex",
  });
  assert.equal(bulk["2"]?.action, "assign_existing");
  assert.equal(bulk["3"]?.companyName, "Globex");
  const skippedBulk = applyBulkRowResolutions({ current: bulk, rowNumbers: [3], action: "skip" });
  assert.equal(skippedBulk["3"]?.action, "skip");
  const noCompany = applyBulkRowResolutions({ current: {}, rowNumbers: [2], action: "create_company", companyName: "  " });
  assert.equal(noCompany["2"], undefined);

  const selected = toggleSelectedRowNumbers([2], 3, true);
  assert.deepEqual(selected, [2, 3]);
  assert.deepEqual(toggleSelectedRowNumbers(selected, 2, false), [3]);
  assert.deepEqual(setPageRowSelection([2], [2, 3], true), [2, 3]);
  assert.deepEqual(setPageRowSelection([2, 3], [3], false), [2]);

  const page = paginate(filterResolvableRows({ rows, resolutions: {}, query: "", filter: "all" }), 2, 1);
  assert.equal(page.currentPage, 2);
  assert.equal(page.totalPages, 2);
  assert.equal(page.items[0]?.rowNumber, 3);

  assert.equal(readyToImportCount(current, resolutions), 2);
  assert.equal(canContinueFromResolve(current, resolutions), true);
  assert.equal(canContinueFromResolve(current, {}), false);
  assert.equal(canContinueFromResolve(current, { "2": { action: "skip" }, "3": { action: "skip" } }), true);
  assert.equal(stepFromJob(current, "resolve"), "resolve");
  assert.equal(stepFromJob(current), "preview");
});
