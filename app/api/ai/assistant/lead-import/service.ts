import { enrichApolloPerson } from "@/app/api/lib/apollo";
import { CompanyRequiredError } from "@/app/api/lib/company-tenancy";
import {
  CompanyMismatchError,
  LeadImportAccessError,
  __setLeadImportPoolFactoryForTests,
  buildPreview,
  commitImportPreviewRow,
  getLeadImportPool,
  loadExistingRecords,
  loadLookups,
  mappedValue,
  pickLookup,
  requireLeadImportActor,
  summarize,
  todayIso,
  type LeadImportActor,
  type LeadImportDefaults,
  type LeadImportPreviewRow,
  type LeadImportRowStatus,
} from "@/app/api/lib/lead-import-core";
import { parseSpreadsheetTable } from "../document-parser/excel-parser";
import {
  ACARSH_FIELDS,
  FIELD_LABELS,
  detectColumnMapping,
  fieldFromLabel,
  type AcarshField,
} from "./mapping";

export type { LeadImportActor, LeadImportDefaults, LeadImportPreviewRow, LeadImportRowStatus };
export { LeadImportAccessError, __setLeadImportPoolFactoryForTests, requireLeadImportActor };

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
  ownerUserId: number;
  companyId: number;
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

let testEnricher: ((input: {
  linkedinUrl?: string;
  contactName: string;
  companyName: string;
}) => Promise<{ workEmail?: string | null; phone?: string | null } | null>) | null = null;

export function __setLeadImportEnricherForTests(
  enricher: ((input: {
    linkedinUrl?: string;
    contactName: string;
    companyName: string;
  }) => Promise<{ workEmail?: string | null; phone?: string | null } | null>) | null,
) {
  testEnricher = enricher;
}

export function __resetPendingLeadImportsForTests() {
  pendingImports.clear();
}

export function __seedPendingLeadImportForTests(options: {
  conversationId: string;
  ownerUserId: number;
  companyId: number;
  fileName?: string;
  sheetName?: string;
  columns: string[];
  rows: Array<Record<string, string>>;
  mapping: Record<string, AcarshField>;
  unmapped?: string[];
  unmappedToNotes?: string[];
  defaults?: Partial<LeadImportDefaults>;
  skipInvalid?: boolean;
}) {
  const actor = requireLeadImportActor({ userId: options.ownerUserId, companyId: options.companyId });
  pendingImports.set(options.conversationId, {
    ownerUserId: actor.userId,
    companyId: actor.companyId,
    fileName: options.fileName || "leads.csv",
    sheetName: options.sheetName || "Sheet1",
    columns: options.columns,
    rows: options.rows,
    mapping: options.mapping,
    unmapped: options.unmapped || options.columns.filter((column) => !options.mapping[column]),
    unmappedToNotes: options.unmappedToNotes || [],
    suggestions: [],
    defaults: {
      companyLocation: "New York",
      contactTitle: "CEO",
      contactRole: "Decision Maker",
      leadSource: "Excel Import",
      leadStatus: "New",
      ownerName: "alice",
      leadDate: todayIso(),
      ...options.defaults,
    },
    skipInvalid: options.skipInvalid ?? true,
  });
}

async function enrichImportedPerson(input: {
  linkedinUrl?: string;
  contactName: string;
  companyName: string;
}) {
  if (testEnricher) return testEnricher(input);
  return enrichApolloPerson(input);
}

function assertPendingImportAccess(pending: PendingLeadImport, actor: LeadImportActor) {
  const verified = requireLeadImportActor(actor);
  if (pending.ownerUserId !== verified.userId) {
    throw new LeadImportAccessError();
  }
  if (pending.companyId !== verified.companyId) {
    throw new CompanyMismatchError();
  }
}

function requirePendingLeadImport(conversationId: string, actor: LeadImportActor) {
  const pending = pendingImports.get(conversationId);
  if (!pending) return null;
  assertPendingImportAccess(pending, actor);
  return pending;
}

export function isLeadImportIntent(message: string) {
  const text = String(message || "").toLowerCase();
  return (
    /\b(import|create|add|upload)\b/.test(text) &&
    /\b(lead|leads|contact|contacts|prospect|prospects)\b/.test(text)
  ) || /\b(show me what will be imported|import only the valid|skip the invalid)\b/.test(text);
}

export function getPendingLeadImport(conversationId: string, actor?: LeadImportActor | null) {
  const pending = pendingImports.get(conversationId) || null;
  if (!pending) return null;
  if (!actor) return pending;
  try {
    assertPendingImportAccess(pending, actor);
    return pending;
  } catch {
    return null;
  }
}

export function clearPendingLeadImport(conversationId: string, actor?: LeadImportActor | null) {
  const pending = pendingImports.get(conversationId);
  if (!pending) return;
  if (actor) assertPendingImportAccess(pending, actor);
  pendingImports.delete(conversationId);
}

async function toCard(pending: PendingLeadImport): Promise<LeadImportCard> {
  const [lookups, existing] = await Promise.all([
    loadLookups(pending.companyId),
    loadExistingRecords(pending.companyId),
  ]);
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
  userId: number;
  companyId: number;
}) {
  const actor = requireLeadImportActor(options);
  const existingPending = pendingImports.get(options.conversationId);
  if (existingPending) {
    assertPendingImportAccess(existingPending, actor);
  }
  const table = parseSpreadsheetTable({
    fileName: options.fileName,
    fileBuffer: options.fileBuffer,
  });
  const detected = detectColumnMapping(table.columns);
  const lookups = await loadLookups(actor.companyId);
  const titleSuggestion = detected.suggestions.find((item) => item.field === "contactTitle");
  const pending: PendingLeadImport = {
    ownerUserId: actor.userId,
    companyId: actor.companyId,
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
  actor: LeadImportActor,
  update: {
    mapping?: Record<string, AcarshField>;
    defaults?: Partial<LeadImportDefaults>;
    unmappedToNotes?: string[];
    skipInvalid?: boolean;
  },
) {
  const pending = requirePendingLeadImport(conversationId, actor);
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

export async function previewPendingLeadImport(conversationId: string, actor: LeadImportActor) {
  const pending = requirePendingLeadImport(conversationId, actor);
  if (!pending) return null;
  return toCard(pending);
}

export function applyImportMessage(conversationId: string, actor: LeadImportActor, message: string) {
  const pending = requirePendingLeadImport(conversationId, actor);
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

export async function confirmLeadImport(conversationId: string, actor: LeadImportActor) {
  const verifiedActor = requireLeadImportActor(actor);
  const pending = requirePendingLeadImport(conversationId, verifiedActor);
  if (!pending) throw new Error("There is no lead import waiting for confirmation.");
  const companyId = pending.companyId;
  const card = await toCard(pending);
  if (!card.canConfirm) throw new Error("Resolve required fields before creating leads.");

  const existing = await loadExistingRecords(companyId);
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

  const pool = await getLeadImportPool();
  for (const preview of toCreate) {
    const source = pending.rows[preview.rowNumber - 2] || {};
    const companyName = mappedValue(source, pending.mapping, "companyName");
    const contactName = mappedValue(source, pending.mapping, "contactName");
    const linkedInUrl = mappedValue(source, pending.mapping, "linkedInUrl");
    const email = mappedValue(source, pending.mapping, "contactEmail");
    const phone = mappedValue(source, pending.mapping, "contactPhone");
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const committed = await commitImportPreviewRow({
        conn,
        companyId,
        source,
        mapping: pending.mapping,
        defaults: pending.defaults,
        unmappedToNotes: pending.unmappedToNotes,
        preview,
      });
      if (committed.createdLead) result.createdLeads += 1;
      result.createdContacts += committed.createdContacts;
      result.scored += 1;
      await conn.commit();

      try {
        const enriched = await enrichImportedPerson({
          linkedinUrl: linkedInUrl || undefined,
          contactName,
          companyName,
        });
        if (enriched?.workEmail || enriched?.phone) {
          await pool.query(
            `UPDATE LeadContacts
             SET ContactEmail = COALESCE(NULLIF(ContactEmail, ''), ?),
                 ContactPhone = COALESCE(NULLIF(ContactPhone, ''), ?)
             WHERE LeadId = ? AND ContactName = ? AND CompanyId = ?`,
            [enriched.workEmail || email || null, enriched.phone || phone || null, committed.leadId, contactName, companyId],
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

export { ACARSH_FIELDS, FIELD_LABELS, CompanyRequiredError, CompanyMismatchError };
