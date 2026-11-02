import { getPool } from "@/config/db";
import { calculateAndStoreLeadScore } from "@/app/api/lib/lead-scoring";
import {
  CompanyMismatchError,
  companyPredicate,
  requireCompanyId,
} from "@/app/api/lib/company-tenancy";
import {
  FIELD_LABELS,
  REQUIRED_FIELDS,
  type AcarshField,
} from "@/app/api/ai/assistant/lead-import/mapping";
import {
  applyCombinedContactTransform,
  type CombinedContactMappingSpec,
} from "@/app/api/lib/combined-contacts";
import { combineColumnValues, type ColumnCombineSpec } from "@/app/api/lib/column-combine";

export type LeadImportActor = {
  userId: number;
  companyId: number;
};

export class LeadImportAccessError extends Error {
  constructor(message = "Lead import is not available for this user.") {
    super(message);
    this.name = "LeadImportAccessError";
  }
}

export class LeadImportStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeadImportStateError";
  }
}

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

export type ExtractedImportContact = {
  name: string;
  email: string;
  status: LeadImportRowStatus;
  reasons: string[];
};

export type LeadImportPreviewRow = {
  rowNumber: number;
  companyName: string;
  contactName: string;
  contactTitle: string;
  linkedInUrl: string;
  contactEmail?: string;
  suggestedCompanyName?: string | null;
  resolutionAction?: "assign_existing" | "create_company" | "skip";
  status: LeadImportRowStatus;
  reasons: string[];
  existingLeadId?: number;
  extractedContacts?: ExtractedImportContact[];
  customValues?: Array<{
    column: string;
    fieldName: string;
    entityType: "lead" | "contact";
    fieldType: "text" | "number" | "date" | "boolean";
    rawValue: string;
    normalizedValue: string | null;
    valid: boolean;
    message?: string;
  }>;
};

export type ExistingImportRecord = {
  leadId: number;
  companyName: string;
  contactName: string;
  email: string;
  linkedIn: string;
};

export type LeadImportPreviewInput = {
  rows: Array<Record<string, string>>;
  mapping: Record<string, AcarshField>;
  defaults: LeadImportDefaults;
  combined?: Array<{ column: string; spec: CombinedContactMappingSpec }>;
  combine?: Array<{ column: string; spec: ColumnCombineSpec }>;
};

export type DuplicatePolicy = "skip" | "create_new";

let testPoolFactory: (() => Promise<any>) | null = null;

export function __setLeadImportPoolFactoryForTests(factory: (() => Promise<any>) | null) {
  testPoolFactory = factory;
}

export async function getLeadImportPool() {
  if (testPoolFactory) return testPoolFactory();
  return getPool();
}

export function requireLeadImportActor(user: {
  userId?: number | null;
  companyId?: number | null;
}): LeadImportActor {
  const companyId = requireCompanyId(user);
  const userId = Number(user.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new LeadImportAccessError("Authenticated user is required for lead import.");
  }
  return { userId, companyId };
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function norm(value: string) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function normKey(value: string) {
  return norm(value).toLowerCase();
}

export function linkedInKey(value: string) {
  return norm(value)
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
}

export function pickLookup(options: string[], preferred: string[], fallback = "") {
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

export function mappedValue(
  row: Record<string, string>,
  mapping: Record<string, AcarshField>,
  field: AcarshField,
  combine?: Array<{ column: string; spec: ColumnCombineSpec }>,
) {
  const parts = (combine || [])
    .filter((item) => item.spec.field === field)
    .sort((a, b) => a.spec.order - b.spec.order || a.column.localeCompare(b.column));
  if (parts.length) {
    return combineColumnValues(parts.map((item) => row[item.column]));
  }
  const column = Object.entries(mapping).find(([, value]) => value === field)?.[0];
  return column ? norm(row[column] || "") : "";
}

export function notesFromUnmapped(
  row: Record<string, string>,
  extra: string[],
) {
  const parts: string[] = [];
  for (const column of extra) {
    const value = norm(row[column] || "");
    if (value) parts.push(`${column}: ${value}`);
  }
  return parts.join("\n");
}

export async function loadLookups(companyId: number) {
  const tenant = companyPredicate("l", companyId);
  const pool = await getLeadImportPool();
  const [sources]: any = await pool.query(
    `SELECT DISTINCT l.LeadSource
     FROM Leads l
     WHERE l.LeadSource IS NOT NULL AND TRIM(l.LeadSource) <> '' AND ${tenant.clause}
     ORDER BY l.LeadSource`,
    tenant.params,
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

export async function loadExistingRecords(companyId: number): Promise<ExistingImportRecord[]> {
  const tenant = companyPredicate("l", companyId);
  const pool = await getLeadImportPool();
  const [rows]: any = await pool.query(
    `SELECT l.LeadId, l.CompanyName, lc.ContactName, lc.ContactEmail, lc.LinkedInProfile
     FROM Leads l
     LEFT JOIN LeadContacts lc
       ON lc.LeadId = l.LeadId
      AND lc.CompanyId = l.CompanyId
     WHERE COALESCE(l.IsArchived, 0) = 0
       AND ${tenant.clause}`,
    tenant.params,
  );
  return (rows || []).map((row: any) => ({
    leadId: Number(row.LeadId || 0),
    companyName: normKey(row.CompanyName || ""),
    contactName: normKey(row.ContactName || ""),
    email: normKey(row.ContactEmail || ""),
    linkedIn: linkedInKey(row.LinkedInProfile || ""),
  }));
}

function looksLikeEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function looksLikePhone(value: string) {
  return /[0-9]/.test(value);
}

function combinedCovers(combined: LeadImportPreviewInput["combined"], field: AcarshField) {
  return (combined || []).some((item) => {
    if (field === "contactName") return item.spec.transform === "extract_contact_name" || item.spec.transform === "split_contacts";
    if (field === "contactEmail") return item.spec.transform === "extract_email" || item.spec.transform === "split_contacts";
    return false;
  });
}

function contactDuplicate(
  existing: ExistingImportRecord[],
  companyName: string,
  contactName: string,
  email: string,
  linkedInUrl: string,
) {
  return existing.find((item) => {
    if (linkedInUrl && item.linkedIn && item.linkedIn === linkedInKey(linkedInUrl)) return true;
    if (email && item.email && item.email === normKey(email)) return true;
    return Boolean(
      companyName &&
        contactName &&
        item.companyName === normKey(companyName) &&
        item.contactName === normKey(contactName),
    );
  });
}

export function buildPreview(options: {
  pending: LeadImportPreviewInput;
  existing: ExistingImportRecord[];
}): { rows: LeadImportPreviewRow[]; missingRequired: Array<{ field: AcarshField; label: string }> } {
  const missingRequired = REQUIRED_FIELDS.filter((field) => {
    return !(
      Object.values(options.pending.mapping).includes(field) ||
      combinedCovers(options.pending.combined, field) ||
      (options.pending.combine || []).some((item) => item.spec.field === field)
    );
  }).map((field) => ({ field, label: FIELD_LABELS[field] }));

  const rows = options.pending.rows.map((row, index) => {
    const valueOf = (field: AcarshField) => mappedValue(row, options.pending.mapping, field, options.pending.combine);
    const companyName = valueOf("companyName");
    let contactName = valueOf("contactName");
    const contactTitle = valueOf("contactTitle") || options.pending.defaults.contactTitle;
    const linkedInUrl = valueOf("linkedInUrl");
    let email = valueOf("contactEmail");
    const phone = valueOf("contactPhone");
    const companyLocation = valueOf("companyLocation") || options.pending.defaults.companyLocation;
    const contactRole = String(options.pending.defaults.contactRole || "").trim();
    const reasons: string[] = [];
    let extractedContacts: ExtractedImportContact[] | undefined;
    let splitMode = false;

    for (const item of options.pending.combined || []) {
      const transformed = applyCombinedContactTransform(row[item.column] || "", item.spec.transform);
      reasons.push(...transformed.issues);
      if (item.spec.transform === "extract_contact_name" && transformed.contactName) contactName = contactName || transformed.contactName;
      if (item.spec.transform === "extract_email" && transformed.contactEmail) email = email || transformed.contactEmail;
      if (item.spec.transform === "split_contacts") {
        splitMode = true;
        if (transformed.contactName) contactName = contactName || transformed.contactName;
        if (transformed.contactEmail) email = email || transformed.contactEmail;
        extractedContacts = [
          ...(extractedContacts || []),
          ...transformed.contacts.map((contact) => {
            const contactReasons = [...contact.issues];
            let status: LeadImportRowStatus = "new";
            if (contact.ambiguous || contactReasons.length) status = contact.name ? "needs_attention" : "invalid";
            else if (contactDuplicate(options.existing, companyName, contact.name, contact.email, "")) {
              status = "duplicate";
              contactReasons.push("Company already exists with this contact");
            }
            return { name: contact.name, email: contact.email, status, reasons: contactReasons };
          }),
        ];
      }
    }

    const extractedNames = (extractedContacts || []).some((item) => item.name);
    const hasContactName = Boolean(contactName) || extractedNames;
    const hasContactDetails = Boolean(email || phone || linkedInUrl || (extractedContacts || []).length);
    const creatingContact = hasContactName || (splitMode && extractedNames);

    if (!companyName && !hasContactName && !hasContactDetails) {
      reasons.push("Row has no company or contact identity");
    } else if (!companyName) {
      reasons.push("Company Name missing");
      if (hasContactName || hasContactDetails) reasons.push("Contact cannot be created without a parent company");
    }
    if (hasContactDetails && !hasContactName) reasons.push("Contact Name missing");
    if (creatingContact && !contactRole) reasons.push("Contact Role missing");
    if (email && !looksLikeEmail(email)) reasons.push("Email is not valid");
    if (phone && !looksLikePhone(phone)) reasons.push("Phone is not valid");

    const companyMatch = options.existing.filter((item) => item.companyName && item.companyName === normKey(companyName));
    const duplicate = contactDuplicate(options.existing, companyName, contactName, email, linkedInUrl);

    let status: LeadImportRowStatus = "new";
    if (splitMode && extractedContacts) {
      const creatable = extractedContacts.filter((item) => item.status === "new");
      const hasInvalid = extractedContacts.some((item) => item.status === "invalid" || item.status === "needs_attention");
      if (!companyName || (!creatable.length && extractedContacts.every((item) => item.status === "invalid"))) status = "invalid";
      else if (hasInvalid || reasons.length) status = "needs_attention";
      else if (!creatable.length) {
        status = "duplicate";
        reasons.push("Company already exists with this contact");
      } else if (companyMatch.length) status = "existing_company_new_contact";
    } else if (!companyName || (hasContactDetails && !hasContactName)) status = "invalid";
    else if (reasons.length) status = "needs_attention";
    else if (duplicate || (companyMatch.length && !creatingContact)) {
      status = "duplicate";
      reasons.push(creatingContact ? "Company already exists with this contact" : "Company already exists");
    } else if (companyMatch.length) {
      status = "existing_company_new_contact";
    }

    return {
      rowNumber: index + 2,
      companyName,
      contactName,
      contactTitle,
      linkedInUrl,
      contactEmail: email,
      status,
      reasons,
      existingLeadId: companyMatch[0]?.leadId,
      extractedContacts,
    };
  });

  return { rows, missingRequired };
}

export function summarize(
  rows: LeadImportPreviewRow[],
  missingRequired: Array<{ field: AcarshField; label: string }>,
) {
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

export async function createLeadRecord(conn: any, payload: {
  CompanyName: string;
  CompanyLocation: string;
  LeadSource: string;
  LeadDate: string;
  Notes: string;
  OwnerName: string;
  IndustryFocus?: string;
  CompanyId: number;
}) {
  const companyId = requireCompanyId({ companyId: payload.CompanyId });
  const [ownerRows]: any = await conn.query(`SELECT UserId FROM Users WHERE UserName = ?`, [payload.OwnerName]);
  const OwnerId = ownerRows[0]?.UserId ?? null;
  const [leadInsert]: any = await conn.query(
    `INSERT INTO Leads (CompanyName, CompanyLocation, LeadSource, LeadDate, LeadNotes, OwnerId, CompanyId)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [payload.CompanyName, payload.CompanyLocation, payload.LeadSource, payload.LeadDate, payload.Notes, OwnerId, companyId],
  );
  const leadId = Number(leadInsert.insertId);
  if (payload.IndustryFocus) {
    try {
      await conn.query(`UPDATE Leads SET IndustryFocus = ? WHERE LeadId = ? AND CompanyId = ?`, [
        payload.IndustryFocus,
        leadId,
        companyId,
      ]);
    } catch {
      // IndustryFocus is optional depending on schema.
    }
  }
  return leadId;
}

export async function createContactRecord(conn: any, payload: {
  LeadId: number;
  CompanyId: number;
  ContactName: string;
  ContactEmail: string;
  ContactPhone: string;
  ContactTitle: string;
  ContactNotes: string;
  ContactRoleName: string;
  LinkedInProfile: string;
}): Promise<number> {
  const companyId = requireCompanyId({ companyId: payload.CompanyId });
  const roleName = String(payload.ContactRoleName || "").trim();
  if (!roleName) throw new Error("Invalid Contact Role");
  const [roleRows]: any = await conn.query(`SELECT RoleId FROM ContactRoles WHERE Role = ?`, [roleName]);
  if (!roleRows?.length) throw new Error("Invalid Contact Role");
  const ContactRoleId = roleRows[0].RoleId;
  const linkedIn = payload.LinkedInProfile.replace(/^https?:\/\//i, "").replace(/\/$/, "") || null;
  const [insertResult]: any = await conn.query(
    `INSERT INTO LeadContacts
      (LeadId, CompanyId, ContactName, ContactEmail, ContactPhone, ContactTitle, ContactNotes, ContactRoleId, LinkedInProfile, LinkedInRequestSent, LinkedInRequestAccepted, EmailSent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.LeadId,
      companyId,
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
  return Number(insertResult?.insertId || 0);
}

export async function loadOwnedLeadId(conn: any, leadId: number, companyId: number): Promise<number | null> {
  const scopedLeadId = Number(leadId);
  if (!Number.isInteger(scopedLeadId) || scopedLeadId <= 0) return null;
  const tenant = companyPredicate("l", companyId);
  const [rows]: any = await conn.query(
    `SELECT l.LeadId
     FROM Leads l
     WHERE l.LeadId = ?
       AND COALESCE(l.IsArchived, 0) = 0
       AND ${tenant.clause}
     LIMIT 1`,
    [scopedLeadId, ...tenant.params],
  );
  const ownedLeadId = Number(rows?.[0]?.LeadId);
  return Number.isInteger(ownedLeadId) && ownedLeadId > 0 ? ownedLeadId : null;
}

export async function commitImportPreviewRow(options: {
  conn: any;
  companyId: number;
  source: Record<string, string>;
  mapping: Record<string, AcarshField>;
  defaults: LeadImportDefaults;
  unmappedToNotes: string[];
  preview: LeadImportPreviewRow;
  combine?: Array<{ column: string; spec: ColumnCombineSpec }>;
}): Promise<{ leadId: number; contactId: number; contactIds: number[]; createdLead: boolean; createdContacts: number }> {
  const companyId = requireCompanyId({ companyId: options.companyId });
  const valueOf = (field: AcarshField) => mappedValue(options.source, options.mapping, field, options.combine);
  const companyName = String(options.preview.companyName || valueOf("companyName") || "").trim();
  if (!companyName) throw new Error("Company Name missing");
  const mappedContactName = valueOf("contactName");
  const contactTitle = valueOf("contactTitle") || options.defaults.contactTitle;
  const companyLocation = valueOf("companyLocation") || options.defaults.companyLocation;
  const industryFocus = valueOf("industryFocus");
  const mappedEmail = valueOf("contactEmail");
  const phone = valueOf("contactPhone");
  const linkedInUrl = valueOf("linkedInUrl");
  const extraNotes = notesFromUnmapped(options.source, options.unmappedToNotes);
  const contactNotes = [valueOf("contactNotes"), extraNotes].filter(Boolean).join("\n");
  const leadNotes = [valueOf("leadNotes"), industryFocus ? `Industry: ${industryFocus}` : ""].filter(Boolean).join("\n");

  const ownedExistingLeadId = options.preview.existingLeadId
    ? await loadOwnedLeadId(options.conn, options.preview.existingLeadId, companyId)
    : null;
  let leadId = ownedExistingLeadId || 0;
  let createdLead = false;
  if (!leadId) {
    leadId = await createLeadRecord(options.conn, {
      CompanyName: companyName,
      CompanyLocation: companyLocation,
      LeadSource: options.defaults.leadSource,
      LeadDate: options.defaults.leadDate,
      Notes: leadNotes,
      OwnerName: options.defaults.ownerName,
      IndustryFocus: industryFocus,
      CompanyId: companyId,
    });
    createdLead = true;
  }
  const contactsToCreate = (options.preview.extractedContacts || [])
    .filter((contact) => contact.status === "new")
    .map((contact) => ({ name: contact.name, email: contact.email }));
  if (!contactsToCreate.length && (options.preview.contactName || mappedContactName)) {
    contactsToCreate.push({
      name: options.preview.contactName || mappedContactName,
      email: mappedEmail,
    });
  }
  const contactIds: number[] = [];
  for (const contact of contactsToCreate) {
    if (!String(contact.name || "").trim()) continue;
    const contactId = await createContactRecord(options.conn, {
      LeadId: leadId,
      CompanyId: companyId,
      ContactName: contact.name,
      ContactEmail: contact.email,
      ContactPhone: phone,
      ContactTitle: contactTitle,
      ContactNotes: contactNotes,
      ContactRoleName: options.defaults.contactRole,
      LinkedInProfile: linkedInUrl,
    });
    if (contactId) contactIds.push(contactId);
  }
  await calculateAndStoreLeadScore(options.conn, leadId);
  return {
    leadId,
    contactId: contactIds[0] || 0,
    contactIds,
    createdLead,
    createdContacts: contactIds.length,
  };
}

export { CompanyMismatchError };
