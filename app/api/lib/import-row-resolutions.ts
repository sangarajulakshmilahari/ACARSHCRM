import type { ExistingImportRecord, LeadImportPreviewRow } from "@/app/api/lib/lead-import-core";

export type InvalidRowResolutionAction = "assign_existing" | "create_company" | "skip";

export type InvalidRowResolution = {
  action: InvalidRowResolutionAction;
  companyName?: string;
};

export type InvalidRowResolutionMap = Record<string, InvalidRowResolution>;

const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "mail.com",
  "zohomail.com",
]);

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function normKey(value: unknown) {
  return cleanText(value).toLowerCase();
}

export function isPublicEmailDomain(domain: string) {
  return PUBLIC_EMAIL_DOMAINS.has(normKey(domain));
}

export function suggestCompanyFromEmail(email: unknown): string | null {
  const value = cleanText(email).toLowerCase();
  const at = value.lastIndexOf("@");
  if (at < 1 || at === value.length - 1) return null;
  const domain = value.slice(at + 1).replace(/^www\./, "");
  if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(domain)) return null;
  if (isPublicEmailDomain(domain)) return null;
  return domain;
}

export function isMissingCompanyContactRow(row: Pick<LeadImportPreviewRow, "status" | "reasons" | "contactName" | "companyName"> & {
  contactEmail?: string | null;
  linkedInUrl?: string | null;
  extractedContacts?: Array<{ name?: string; email?: string }>;
}) {
  const hasContact =
    Boolean(cleanText(row.contactName)) ||
    Boolean(cleanText(row.contactEmail)) ||
    Boolean(cleanText(row.linkedInUrl)) ||
    Boolean((row.extractedContacts || []).some((item) => cleanText(item.name) || cleanText(item.email)));
  const missingCompany =
    !cleanText(row.companyName) ||
    (row.reasons || []).some((reason) => /company name missing/i.test(reason));
  return row.status === "invalid" && missingCompany && hasContact;
}

export function parseRowResolutions(raw: unknown): InvalidRowResolutionMap {
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const out: InvalidRowResolutionMap = {};
  for (const [key, value] of Object.entries(source)) {
    const rowNumber = Number(key);
    if (!Number.isInteger(rowNumber) || rowNumber < 2) continue;
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const action = String((value as any).action || "").trim();
    if (action !== "assign_existing" && action !== "create_company" && action !== "skip") continue;
    const companyName = cleanText((value as any).companyName) || undefined;
    if ((action === "assign_existing" || action === "create_company") && !companyName) continue;
    out[String(rowNumber)] = { action, companyName };
  }
  return out;
}

export function extractStoredResolutions(defaults: Record<string, unknown> | null | undefined): InvalidRowResolutionMap {
  if (!defaults || typeof defaults !== "object") return {};
  return parseRowResolutions((defaults as any)._rowResolutions);
}

export function defaultsWithoutResolutions<T extends Record<string, unknown>>(defaults: T): Omit<T, "_rowResolutions"> {
  const { _rowResolutions: _ignored, ...rest } = defaults as T & { _rowResolutions?: unknown };
  return rest;
}

export function mergeDefaultsWithResolutions(
  defaults: Record<string, unknown>,
  resolutions: InvalidRowResolutionMap,
) {
  return {
    ...defaultsWithoutResolutions(defaults),
    _rowResolutions: resolutions,
  };
}

export function findExistingCompanyLead(
  existing: ExistingImportRecord[],
  companyName: string,
): ExistingImportRecord | null {
  const key = normKey(companyName);
  if (!key) return null;
  return existing.find((item) => item.companyName === key) || null;
}

export function applyRowResolutions(options: {
  rows: LeadImportPreviewRow[];
  resolutions: InvalidRowResolutionMap;
  existing: ExistingImportRecord[];
}): LeadImportPreviewRow[] {
  return options.rows.map((row) => {
    const suggestion = suggestCompanyFromEmail(
      row.contactEmail || (row.extractedContacts || []).map((item) => item.email).find(Boolean) || "",
    );
    const annotated: LeadImportPreviewRow = {
      ...row,
      suggestedCompanyName: suggestion,
    };
    if (!isMissingCompanyContactRow(annotated)) return annotated;

    const resolution = options.resolutions[String(row.rowNumber)];
    if (!resolution) {
      return {
        ...annotated,
        reasons: Array.from(new Set([
          ...annotated.reasons,
          "Assign this contact to an existing company, create a company name, or skip the row.",
          suggestion ? `Suggested company from email domain: ${suggestion}` : "",
        ].filter(Boolean))),
      };
    }
    if (resolution.action === "skip") {
      return {
        ...annotated,
        status: "invalid",
        reasons: ["Skipped by user"],
        resolutionAction: "skip",
      };
    }
    const companyName = cleanText(resolution.companyName);
    if (!companyName) {
      return {
        ...annotated,
        reasons: Array.from(new Set([...annotated.reasons, "Company name is required for this resolution."])),
        resolutionAction: resolution.action,
      };
    }
    const existingMatch = findExistingCompanyLead(options.existing, companyName);
    if (resolution.action === "assign_existing") {
      if (!existingMatch) {
        return {
          ...annotated,
          companyName,
          status: "invalid",
          reasons: [`No company named "${companyName}" exists in this tenant.`],
          resolutionAction: "assign_existing",
        };
      }
      return {
        ...annotated,
        companyName,
        status: "existing_company_new_contact",
        reasons: [`Assigned to existing company ${companyName}`],
        existingLeadId: existingMatch.leadId,
        resolutionAction: "assign_existing",
      };
    }
    if (existingMatch) {
      return {
        ...annotated,
        companyName,
        status: "existing_company_new_contact",
        reasons: [`Company ${companyName} already exists and will be reused`],
        existingLeadId: existingMatch.leadId,
        resolutionAction: "create_company",
      };
    }
    return {
      ...annotated,
      companyName,
      status: "new",
      reasons: [`New company will be created: ${companyName}`],
      existingLeadId: undefined,
      resolutionAction: "create_company",
    };
  });
}
