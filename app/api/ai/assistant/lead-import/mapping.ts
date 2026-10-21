export const ACARSH_FIELDS = [
  "companyName",
  "companyLocation",
  "industryFocus",
  "leadSource",
  "leadDate",
  "leadStatus",
  "leadNotes",
  "contactName",
  "contactTitle",
  "contactRole",
  "contactEmail",
  "contactPhone",
  "contactLocation",
  "linkedInUrl",
  "contactNotes",
] as const;

export type AcarshField = (typeof ACARSH_FIELDS)[number];

export const FIELD_LABELS: Record<AcarshField, string> = {
  companyName: "Company Name",
  companyLocation: "Company Location",
  industryFocus: "Industry Focus",
  leadSource: "Lead Source",
  leadDate: "Lead Date",
  leadStatus: "Lead Status",
  leadNotes: "Lead Notes",
  contactName: "Contact Name",
  contactTitle: "Contact Title",
  contactRole: "Contact Role",
  contactEmail: "Email",
  contactPhone: "Phone",
  contactLocation: "Contact Location",
  linkedInUrl: "LinkedIn URL",
  contactNotes: "Contact Notes",
};

export const REQUIRED_FIELDS: AcarshField[] = [
  "companyName",
  "companyLocation",
  "contactName",
  "contactTitle",
  "contactRole",
];

const FIELD_ALIASES: Record<AcarshField, string[]> = {
  companyName: ["company", "company name", "organization", "organisation", "account", "client", "firm"],
  companyLocation: ["headquarters", "head quarter", "headquarters location", "location", "company location", "hq", "head office", "city", "office location"],
  industryFocus: ["industry", "industry focus", "sector", "vertical"],
  leadSource: ["lead source", "source"],
  leadDate: ["lead date", "date"],
  leadStatus: ["lead status", "status"],
  leadNotes: ["lead notes", "company notes"],
  contactName: ["person", "name", "contact name", "full name", "executive", "cxo", "ceo", "cto", "cfo", "coo", "founder", "president"],
  contactTitle: ["designation", "title", "job title", "contact title", "role", "position", "job role"],
  contactRole: ["contact role", "crm role"],
  contactEmail: ["email", "e mail", "e-mail", "mail", "work email"],
  contactPhone: ["phone", "mobile", "telephone", "phone number"],
  contactLocation: ["contact location", "person location"],
  linkedInUrl: ["linkedin", "linkedin profile", "linkedin url", "linked in", "profile url", "linkedinprofile"],
  contactNotes: ["remarks", "notes", "comments", "description", "comment"],
};

export function normalizeHeader(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[_./\\-]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function suggestTitleFromColumn(column: string) {
  const normalized = normalizeHeader(column);
  const roles = ["ceo", "cto", "cfo", "coo", "cpo", "cmo", "founder", "president", "director"];
  return roles.find((role) => normalized === role || normalized.endsWith(` ${role}`))?.toUpperCase() || "";
}

export function detectColumnMapping(columns: string[]) {
  const mapping: Record<string, AcarshField> = {};
  const used = new Set<AcarshField>();
  const suggestions: Array<{ field: AcarshField; value: string; reason: string }> = [];

  for (const column of columns) {
    const normalized = normalizeHeader(column);
    let matched: AcarshField | null = null;
    for (const field of ACARSH_FIELDS) {
      if (used.has(field)) continue;
      if (FIELD_ALIASES[field].some((alias) => normalized === alias || normalized.includes(alias))) {
        matched = field;
        break;
      }
    }
    if (matched) {
      mapping[column] = matched;
      used.add(matched);
      const titleGuess = suggestTitleFromColumn(column);
      if (matched === "contactName" && titleGuess && !used.has("contactTitle")) {
        suggestions.push({
          field: "contactTitle",
          value: titleGuess,
          reason: `The uploaded column "${column}" represents ${titleGuess} contacts.`,
        });
      }
    }
  }

  const unmapped = columns.filter((column) => !mapping[column]);
  return { mapping, unmapped, suggestions };
}

export function fieldFromLabel(label: string): AcarshField | null {
  const normalized = normalizeHeader(label);
  const byLabel = (Object.entries(FIELD_LABELS) as Array<[AcarshField, string]>).find(
    ([, name]) => normalizeHeader(name) === normalized,
  );
  if (byLabel) return byLabel[0];
  for (const field of ACARSH_FIELDS) {
    if (FIELD_ALIASES[field].includes(normalized)) return field;
  }
  return null;
}
