import { getPool } from "@/config/db";
import { calculateAndStoreLeadScore } from "@/app/api/lib/lead-scoring";
import { enrichApolloPerson } from "@/app/api/lib/apollo";
import { parseSpreadsheetTable } from "../document-parser/excel-parser";
import {
  ACARSH_FIELDS,
  FIELD_LABELS,
  REQUIRED_FIELDS,
  detectColumnMapping,
  fieldFromLabel,
  type AcarshField,
} from "./mapping";

export type LeadImportDefaults = {
  companyLocation: string;
  contactTitle: string;
  contactRole: string;
  leadSource: string;
  leadStatus: string;
  ownerName: string;
  leadDate: string;
};

export type LeadImportRowStatus =
  | "new"
  | "existing_company_new_contact"
  | "duplicate"
  | "needs_attention"
  | "invalid";

export type LeadImportPreviewRow = {
  rowNumber: number;
  companyName: string;
  contactName: string;
  contactTitle: string;
  linkedInUrl: string;
  status: LeadImportRowStatus;
  reasons: string[];
  existingLeadId?: number;
};

export type LeadImportCard = {
  fileName: string;
  sheetName: string;
  recordCount: number;
  columns: string[];
  mapping: Record<string, AcarshField>;
  unmapped: string[];
  unmappedToNotes: string[];
  suggestions: Array<{ field: AcarshField; value: string; reason: string }>;
  missingRequired: Array<{ field: AcarshField; label: string }>;
  defaults: LeadImportDefaults;
  lookups: {
    leadSources: string[];
    leadStatuses: string[];
    owners: string[];
    contactRoles: string[];
  };
  summary: {
    valid: number;
    needsAttention: number;
    invalid: number;
    existing: number;
    duplicate: number;
    createCount: number;
  };
  previewRows: LeadImportPreviewRow[];
  canConfirm: boolean;
  skipInvalid: boolean;
  result?: {
    createdLeads: number;
    createdContacts: number;
    existingSkipped: number;
    duplicatesSkipped: number;
    invalidSkipped: number;
    failed: Array<{ rowNumber: number; companyName: string; reason: string }>;
    apolloEnriched: number;
    apolloFailed: number;
    scored: number;
  };
};

type PendingLeadImport = {
  fileName: string;
  sheetName: string;
  columns: string[];
  rows: Array<Record<string, string>>;
  mapping: Record<string, AcarshField>;
  unmapped: string[];
  unmappedToNotes: string[];
  suggestions: Array<{ field: AcarshField; value: string; reason: string }>;
  defaults: LeadImportDefaults;
  skipInvalid: boolean;
};

const importGlobal = globalThis as typeof globalThis & {
  __acarshLeadImports?: Map<string, PendingLeadImport>;
};
const pendingImports = importGlobal.__acarshLeadImports || new Map<string, PendingLeadImport>();
importGlobal.__acarshLeadImports = pendingImports;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function norm(value: string) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normKey(value: string) {
  return norm(value).toLowerCase();
}

function linkedInKey(value: string) {
  return norm(value)
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
}

export function isLeadImportIntent(message: string) {
  const text = String(message || "").toLowerCase();
  return (
    /\b(import|create|add|upload)\b/.test(text) &&
    /\b(lead|leads|contact|contacts|prospect|prospects)\b/.test(text)
  ) || /\b(show me what will be imported|import only the valid|skip the invalid)\b/.test(text);
}

export function getPendingLeadImport(conversationId: string) {
  return pendingImports.get(conversationId) || null;
}

export function clearPendingLeadImport(conversationId: string) {
  pendingImports.delete(conversationId);
}

async function loadLookups() {
  const pool = await getPool();
  const [sources]: any = await pool.query(
    `SELECT DISTINCT LeadSource FROM Leads WHERE LeadSource IS NOT NULL AND TRIM(LeadSource) <> '' ORDER BY LeadSource`,
  );
  const [statuses]: any = await pool.query(
    `SELECT StatusName FROM LeadStatuses ORDER BY SortOrder, StatusId`,
  );
  const [owners]: any = await pool.query(
    `SELECT DISTINCT UserName FROM Users WHERE UserName IS NOT NULL ORDER BY UserName`,
  );
  const [roles]: any = await pool.query(
    `SELECT DISTINCT Role FROM ContactRoles WHERE Role IS NOT NULL ORDER BY Role`,
  );
  return {
    leadSources: (sources || []).map((row: any) => String(row.LeadSource || "")).filter(Boolean),
    leadStatuses: (statuses || []).map((row: any) => String(row.StatusName || "")).filter(Boolean),
    owners: (owners || []).map((row: any) => String(row.UserName || "")).filter(Boolean),
    contactRoles: (roles || []).map((row: any) => String(row.Role || "")).filter(Boolean),
  };
}

function pickLookup(options: string[], preferred: string[], fallback = "") {
  for (const item of preferred) {
    const found = options.find((option) => option.toLowerCase() === item.toLowerCase());
    if (found) return found;
  }
  for (const item of preferred) {
    const found = options.find((option) => option.toLowerCase().includes(item.toLowerCase()));
    if (found) return found;
  }
  return options[0] || fallback;
}

function mappedValue(row: Record<string, string>, mapping: Record<string, AcarshField>, field: AcarshField) {
  const column = Object.entries(mapping).find(([, value]) => value === field)?.[0];
  return column ? norm(row[column] || "") : "";
}

function notesFromUnmapped(row: Record<string, string>, columns: string[], mapping: Record<string, AcarshField>, extra: string[]) {
  const parts: string[] = [];
  for (const column of extra) {
    const value = norm(row[column] || "");
    if (value) parts.push(`${column}: ${value}`);
  }
  return parts.join("\n");
}

async function loadExistingRecords() {
  const pool = await getPool();
  const [rows]: any = await pool.query(
    `SELECT l.LeadId, l.CompanyName, lc.ContactName, lc.ContactEmail, lc.LinkedInProfile
     FROM Leads l
     LEFT JOIN LeadContacts lc ON lc.LeadId = l.LeadId
     WHERE COALESCE(l.IsArchived, 0) = 0`,
  );
  return (rows || []).map((row: any) => ({
    leadId: Number(row.LeadId || 0),
    companyName: normKey(row.CompanyName || ""),
    contactName: normKey(row.ContactName || ""),
    email: normKey(row.ContactEmail || ""),
    linkedIn: linkedInKey(row.LinkedInProfile || ""),
  })) as Array<{
    leadId: number;
    companyName: string;
    contactName: string;
    email: string;
    linkedIn: string;
  }>;
}

function buildPreview(options: {
  pending: PendingLeadImport;
  existing: Awaited<ReturnType<typeof loadExistingRecords>>;
}): { rows: LeadImportPreviewRow[]; missingRequired: Array<{ field: AcarshField; label: string }> } {
  const missingRequired = REQUIRED_FIELDS.filter((field) => {
    const mapped = Object.values(options.pending.mapping).includes(field);
    const defaulted = Boolean(
      (field === "companyLocation" && options.pending.defaults.companyLocation) ||
      (field === "contactTitle" && options.pending.defaults.contactTitle) ||
      (field === "contactRole" && options.pending.defaults.contactRole),
    );
    return !mapped && !defaulted;
  }).map((field) => ({ field, label: FIELD_LABELS[field] }));

  const rows = options.pending.rows.map((row, index) => {
    const companyName = mappedValue(row, options.pending.mapping, "companyName");
    const contactName = mappedValue(row, options.pending.mapping, "contactName");
    const contactTitle =
      mappedValue(row, options.pending.mapping, "contactTitle") || options.pending.defaults.contactTitle;
    const linkedInUrl = mappedValue(row, options.pending.mapping, "linkedInUrl");
    const email = mappedValue(row, options.pending.mapping, "contactEmail");
    const companyLocation =
      mappedValue(row, options.pending.mapping, "companyLocation") || options.pending.defaults.companyLocation;
    const reasons: string[] = [];
    if (!companyName) reasons.push("Company Name missing");
    if (!contactName) reasons.push("Contact Name missing");
    if (!contactTitle) reasons.push("Contact Title missing");
    if (!companyLocation) reasons.push("Company Location missing");
    if (!options.pending.defaults.contactRole) reasons.push("Contact Role missing");

    const companyMatch = options.existing.filter((item) => item.companyName && item.companyName === normKey(companyName));
    const duplicate = options.existing.find((item) => {
      if (linkedInUrl && item.linkedIn && item.linkedIn === linkedInKey(linkedInUrl)) return true;
      if (email && item.email && item.email === normKey(email)) return true;
      return Boolean(
        companyName &&
          contactName &&
          item.companyName === normKey(companyName) &&
          item.contactName === normKey(contactName),
      );
    });

    let status: LeadImportRowStatus = "new";
    if (reasons.length && (!companyName || !contactName)) status = "invalid";
    else if (reasons.length) status = "needs_attention";
    else if (duplicate) {
      status = "duplicate";
      reasons.push("Company already exists with this contact");
    } else if (companyMatch.length) {
      status = "existing_company_new_contact";
    }

    return {
      rowNumber: index + 2,
      companyName,
      contactName,
      contactTitle,
      linkedInUrl,
      status,
      reasons,
      existingLeadId: companyMatch[0]?.leadId,
    };
  });

  return { rows, missingRequired };
}

function summarize(rows: LeadImportPreviewRow[], missingRequired: Array<{ field: AcarshField; label: string }>) {
  const valid = rows.filter((row) => row.status === "new" || row.status === "existing_company_new_contact").length;
  const needsAttention = rows.filter((row) => row.status === "needs_attention").length;
  const invalid = rows.filter((row) => row.status === "invalid").length;
  const existing = rows.filter((row) => row.status === "existing_company_new_contact").length;
  const duplicate = rows.filter((row) => row.status === "duplicate").length;
  return {
    valid,
    needsAttention,
    invalid,
    existing,
    duplicate,
    createCount: valid,
    canConfirm: missingRequired.length === 0 && valid > 0,
  };
}

async function toCard(pending: PendingLeadImport): Promise<LeadImportCard> {
  const [lookups, existing] = await Promise.all([loadLookups(), loadExistingRecords()]);
  const { rows, missingRequired } = buildPreview({ pending, existing });
  const summary = summarize(rows, missingRequired);
  return {
    fileName: pending.fileName,
    sheetName: pending.sheetName,
    recordCount: pending.rows.length,
    columns: pending.columns,
    mapping: pending.mapping,
    unmapped: pending.unmapped,
    unmappedToNotes: pending.unmappedToNotes,
    suggestions: pending.suggestions,
    missingRequired,
    defaults: pending.defaults,
    lookups,
    summary: {
      valid: summary.valid,
      needsAttention: summary.needsAttention,
      invalid: summary.invalid,
      existing: summary.existing,
      duplicate: summary.duplicate,
      createCount: summary.createCount,
    },
    previewRows: rows,
    canConfirm: summary.canConfirm,
    skipInvalid: pending.skipInvalid,
  };
}

export async function startLeadImport(options: {
  conversationId: string;
  fileName: string;
  fileBuffer: Buffer;
  ownerName: string;
}) {
  const table = parseSpreadsheetTable({
    fileName: options.fileName,
    fileBuffer: options.fileBuffer,
  });
  const detected = detectColumnMapping(table.columns);
  const lookups = await loadLookups();
  const titleSuggestion = detected.suggestions.find((item) => item.field === "contactTitle");
  const pending: PendingLeadImport = {
    fileName: options.fileName,
    sheetName: table.sheetName,
    columns: table.columns,
    rows: table.rows,
    mapping: detected.mapping,
    unmapped: detected.unmapped,
    unmappedToNotes: [],
    suggestions: detected.suggestions,
    defaults: {
      companyLocation: "",
      contactTitle: titleSuggestion?.value || "",
      contactRole: pickLookup(lookups.contactRoles, ["Decision Maker", "Primary", "Champion", "Influencer"]),
      leadSource: pickLookup(lookups.leadSources, ["Excel Import", "LinkedIn", "Import", "Other"]),
      leadStatus: pickLookup(lookups.leadStatuses, ["New"]),
      ownerName: options.ownerName,
      leadDate: todayIso(),
    },
    skipInvalid: true,
  };
  pendingImports.set(options.conversationId, pending);
  return toCard(pending);
}

export function applyLeadImportUpdate(
  conversationId: string,
  update: {
    mapping?: Record<string, AcarshField>;
    defaults?: Partial<LeadImportDefaults>;
    unmappedToNotes?: string[];
    skipInvalid?: boolean;
  },
) {
  const pending = pendingImports.get(conversationId);
  if (!pending) return null;
  if (update.mapping) {
    pending.mapping = { ...pending.mapping };
    for (const [column, field] of Object.entries(update.mapping)) {
      if (!field) delete pending.mapping[column];
      else pending.mapping[column] = field;
    }
  }
  if (update.defaults) pending.defaults = { ...pending.defaults, ...update.defaults };
  if (update.unmappedToNotes) pending.unmappedToNotes = update.unmappedToNotes;
  if (typeof update.skipInvalid === "boolean") pending.skipInvalid = update.skipInvalid;
  pending.unmapped = pending.columns.filter((column) => !pending.mapping[column]);
  pendingImports.set(conversationId, pending);
  return pending;
}

export async function previewPendingLeadImport(conversationId: string) {
  const pending = pendingImports.get(conversationId);
  if (!pending) return null;
  return toCard(pending);
}

export function applyImportMessage(conversationId: string, message: string) {
  const pending = pendingImports.get(conversationId);
  if (!pending) return false;
  const text = String(message || "").trim();
  const mapMatch = text.match(/\bmap\s+(.+?)\s+to\s+(.+)$/i);
  if (mapMatch) {
    const source = pending.columns.find(
      (column) => column.toLowerCase() === mapMatch[1].trim().toLowerCase(),
    );
    const field = fieldFromLabel(mapMatch[2].trim());
    if (source && field) {
      pending.mapping[source] = field;
      pending.unmapped = pending.columns.filter((column) => !pending.mapping[column]);
    }
  }
  const titleMatch = text.match(/\buse\s+["']?([^"']+)["']?\s+as\s+(?:the\s+)?(?:designation|title|contact title)\b/i);
  if (titleMatch) pending.defaults.contactTitle = titleMatch[1].trim();
  if (/skip the invalid|import only the valid/i.test(text)) pending.skipInvalid = true;
  const notesMatch = text.match(/\bmap\s+(.+?)\s+to\s+notes\b/i);
  if (notesMatch) {
    const source = pending.columns.find(
      (column) => column.toLowerCase() === notesMatch[1].trim().toLowerCase(),
    );
    if (source && !pending.unmappedToNotes.includes(source)) pending.unmappedToNotes.push(source);
  }
  pendingImports.set(conversationId, pending);
  return true;
}

async function createLeadRecord(conn: any, payload: {
  CompanyName: string;
  CompanyLocation: string;
  LeadSource: string;
  LeadDate: string;
  Notes: string;
  OwnerName: string;
  IndustryFocus?: string;
  CompanyId: number;
}) {
  const [ownerRows]: any = await conn.query(`SELECT UserId FROM Users WHERE UserName = ?`, [payload.OwnerName]);
  const OwnerId = ownerRows[0]?.UserId ?? null;
  const [leadInsert]: any = await conn.query(
    `INSERT INTO Leads (CompanyName, CompanyLocation, LeadSource, LeadDate, LeadNotes, OwnerId, CompanyId)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [payload.CompanyName, payload.CompanyLocation, payload.LeadSource, payload.LeadDate, payload.Notes, OwnerId, payload.CompanyId],
  );
  const leadId = Number(leadInsert.insertId);
  if (payload.IndustryFocus) {
    try {
      await conn.query(`UPDATE Leads SET IndustryFocus = ? WHERE LeadId = ?`, [payload.IndustryFocus, leadId]);
    } catch {
      // IndustryFocus is optional depending on schema.
    }
  }
  return leadId;
}

async function createContactRecord(conn: any, payload: {
  LeadId: number;
  CompanyId: number;
  ContactName: string;
  ContactEmail: string;
  ContactPhone: string;
  ContactTitle: string;
  ContactNotes: string;
  ContactRoleName: string;
  LinkedInProfile: string;
}) {
  const [roleRows]: any = await conn.query(`SELECT RoleId FROM ContactRoles WHERE Role = ?`, [payload.ContactRoleName]);
  if (!roleRows?.length) throw new Error("Invalid Contact Role");
  const ContactRoleId = roleRows[0].RoleId;
  const linkedIn = payload.LinkedInProfile.replace(/^https?:\/\//i, "").replace(/\/$/, "") || null;
  await conn.query(
    `INSERT INTO LeadContacts
      (LeadId, CompanyId, ContactName, ContactEmail, ContactPhone, ContactTitle, ContactNotes, ContactRoleId, LinkedInProfile, LinkedInRequestSent, LinkedInRequestAccepted, EmailSent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.LeadId,
      payload.CompanyId,
      payload.ContactName,
      payload.ContactEmail || null,
      payload.ContactPhone || null,
      payload.ContactTitle,
      payload.ContactNotes || null,
      ContactRoleId,
      linkedIn,
      0,
      0,
      0,
    ],
  );
}

export async function confirmLeadImport(conversationId: string, companyId: number) {
  const pending = pendingImports.get(conversationId);
  if (!pending) throw new Error("There is no lead import waiting for confirmation.");
  const card = await toCard(pending);
  if (!card.canConfirm) throw new Error("Resolve required fields before creating leads.");

  const existing = await loadExistingRecords();
  const { rows } = buildPreview({ pending, existing });
  const toCreate = rows.filter((row) => row.status === "new" || row.status === "existing_company_new_contact");
  const result = {
    createdLeads: 0,
    createdContacts: 0,
    existingSkipped: 0,
    duplicatesSkipped: rows.filter((row) => row.status === "duplicate").length,
    invalidSkipped: rows.filter((row) => row.status === "invalid" || row.status === "needs_attention").length,
    failed: [] as Array<{ rowNumber: number; companyName: string; reason: string }>,
    apolloEnriched: 0,
    apolloFailed: 0,
    scored: 0,
  };

  const pool = await getPool();
  for (const preview of toCreate) {
    const source = pending.rows[preview.rowNumber - 2] || {};
    const companyName = mappedValue(source, pending.mapping, "companyName");
    const contactName = mappedValue(source, pending.mapping, "contactName");
    const contactTitle = mappedValue(source, pending.mapping, "contactTitle") || pending.defaults.contactTitle;
    const companyLocation = mappedValue(source, pending.mapping, "companyLocation") || pending.defaults.companyLocation;
    const industryFocus = mappedValue(source, pending.mapping, "industryFocus");
    const email = mappedValue(source, pending.mapping, "contactEmail");
    const phone = mappedValue(source, pending.mapping, "contactPhone");
    const linkedInUrl = mappedValue(source, pending.mapping, "linkedInUrl");
    const extraNotes = notesFromUnmapped(source, pending.columns, pending.mapping, pending.unmappedToNotes);
    const contactNotes = [mappedValue(source, pending.mapping, "contactNotes"), extraNotes].filter(Boolean).join("\n");
    const leadNotes = [mappedValue(source, pending.mapping, "leadNotes"), industryFocus ? `Industry: ${industryFocus}` : ""].filter(Boolean).join("\n");
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      let leadId = preview.existingLeadId || 0;
      if (!leadId) {
        leadId = await createLeadRecord(conn, {
          CompanyName: companyName,
          CompanyLocation: companyLocation,
          LeadSource: pending.defaults.leadSource,
          LeadDate: pending.defaults.leadDate,
          Notes: leadNotes,
          OwnerName: pending.defaults.ownerName,
          IndustryFocus: industryFocus,
          CompanyId: companyId,
        });
        result.createdLeads += 1;
      }
      await createContactRecord(conn, {
        LeadId: leadId,
        CompanyId: companyId,
        ContactName: contactName,
        ContactEmail: email,
        ContactPhone: phone,
        ContactTitle: contactTitle,
        ContactNotes: contactNotes,
        ContactRoleName: pending.defaults.contactRole,
        LinkedInProfile: linkedInUrl,
      });
      result.createdContacts += 1;
      await calculateAndStoreLeadScore(conn, leadId);
      result.scored += 1;
      await conn.commit();

      try {
        const enriched = await enrichApolloPerson({
          linkedinUrl: linkedInUrl || undefined,
          contactName,
          companyName,
        });
        if (enriched?.workEmail || enriched?.phone) {
          await pool.query(
            `UPDATE LeadContacts
             SET ContactEmail = COALESCE(NULLIF(ContactEmail, ''), ?),
                 ContactPhone = COALESCE(NULLIF(ContactPhone, ''), ?)
             WHERE LeadId = ? AND ContactName = ?`,
            [enriched.workEmail || email || null, enriched.phone || phone || null, leadId, contactName],
          );
          result.apolloEnriched += 1;
        } else {
          result.apolloFailed += 1;
        }
      } catch {
        result.apolloFailed += 1;
      }
    } catch (error) {
      await conn.rollback();
      result.failed.push({
        rowNumber: preview.rowNumber,
        companyName,
        reason: error instanceof Error ? error.message : "Failed to create lead",
      });
    } finally {
      conn.release();
    }
  }

  pendingImports.delete(conversationId);
  return { ...card, result, canConfirm: false };
}

export function importReply(card: LeadImportCard) {
  if (card.result) {
    return (
      `Lead Import Completed\n\n` +
      `✓ ${card.result.createdLeads} leads created\n` +
      `✓ ${card.result.createdContacts} contacts created\n` +
      `⚠ ${card.result.duplicatesSkipped} duplicate skipped\n` +
      `⚠ ${card.result.invalidSkipped} invalid/incomplete skipped\n` +
      (card.result.failed.length ? `✕ ${card.result.failed.length} failed\n` : "") +
      `\nApollo enrichment:\n✓ ${card.result.apolloEnriched} enriched\n⚠ ${card.result.apolloFailed} could not be enriched\n` +
      `\nLead scoring:\n✓ Calculated for imported leads`
    );
  }
  const missing = card.missingRequired.map((item) => item.label).join(", ");
  return (
    `Lead Import preview for ${card.fileName}\n\n` +
    `Records found: ${card.recordCount}\n` +
    `✓ ${card.summary.valid} valid\n` +
    `⚠ ${card.summary.needsAttention} need attention\n` +
    `✕ ${card.summary.invalid} invalid\n` +
    (missing ? `\nRequired fields needing attention: ${missing}` : "\nRequired mappings are complete. Review the preview, then confirm to create leads.")
  );
}

export { ACARSH_FIELDS, FIELD_LABELS };
