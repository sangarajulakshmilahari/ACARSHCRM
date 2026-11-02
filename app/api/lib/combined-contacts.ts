export const COMBINED_CONTACT_TRANSFORMS = ["extract_contact_name", "extract_email", "split_contacts"] as const;
export type CombinedContactTransform = (typeof COMBINED_CONTACT_TRANSFORMS)[number];

export type CombinedContactMappingSpec = {
  kind: "combined_contact";
  transform: CombinedContactTransform;
};

export const COMBINED_CONTACT_TRANSFORM_LABELS: Record<CombinedContactTransform, string> = {
  extract_contact_name: "Extract contact name",
  extract_email: "Extract email address",
  split_contacts: "Split names and emails into contacts",
};

export type ExtractedContact = {
  name: string;
  email: string;
  raw: string;
  valid: boolean;
  ambiguous: boolean;
  issues: string[];
};

const EMAIL_PATTERN = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;

export function isCombinedContactTransform(value: unknown): value is CombinedContactTransform {
  return typeof value === "string" && (COMBINED_CONTACT_TRANSFORMS as readonly string[]).includes(value);
}

export function isCombinedContactMapping(value: unknown): value is CombinedContactMappingSpec {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as CombinedContactMappingSpec).kind === "combined_contact" &&
      isCombinedContactTransform((value as CombinedContactMappingSpec).transform),
  );
}

export function isEmailAddress(value: string) {
  return /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/.test(String(value || "").trim());
}

function emailsIn(value: string) {
  return String(value || "").match(EMAIL_PATTERN) || [];
}

function cleanName(value: string) {
  return String(value || "")
    .replace(/[<>()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function splitCombinedContactSegments(raw: string) {
  return String(raw || "")
    .split(/[;\n\r]+/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export function parseCombinedContactSegment(segment: string): ExtractedContact {
  const raw = String(segment || "").trim();
  const foundEmails = emailsIn(raw);
  if (foundEmails.length > 1) {
    return {
      name: "",
      email: "",
      raw,
      valid: false,
      ambiguous: true,
      issues: ["Multiple emails in one entry; names and emails were not paired."],
    };
  }

  const angle = raw.match(/^(.*?)\s*<\s*([^<>]+?)\s*>\s*$/);
  if (angle) {
    const name = cleanName(angle[1]);
    const email = angle[2].trim();
    if (!isEmailAddress(email)) {
      return { name, email: "", raw, valid: false, ambiguous: false, issues: [`"${email}" is not a valid email address.`] };
    }
    return {
      name,
      email,
      raw,
      valid: Boolean(name),
      ambiguous: false,
      issues: name ? [] : ["Contact name missing"],
    };
  }

  const paren = raw.match(/^(.*?)\s*\(\s*([^()]+?)\s*\)\s*$/);
  if (paren && isEmailAddress(paren[2].trim())) {
    const name = cleanName(paren[1]);
    const email = paren[2].trim();
    return {
      name,
      email,
      raw,
      valid: Boolean(name),
      ambiguous: false,
      issues: name ? [] : ["Contact name missing"],
    };
  }

  if (foundEmails.length === 1 && isEmailAddress(raw)) {
    return {
      name: "",
      email: raw,
      raw,
      valid: false,
      ambiguous: false,
      issues: ["Contact name missing"],
    };
  }

  if (foundEmails.length === 1) {
    const email = foundEmails[0];
    const name = cleanName(raw.replace(email, ""));
    if (!name) {
      return { name: "", email, raw, valid: false, ambiguous: false, issues: ["Contact name missing"] };
    }
    return { name, email, raw, valid: true, ambiguous: false, issues: [] };
  }

  if (!raw) {
    return { name: "", email: "", raw, valid: false, ambiguous: false, issues: ["Contact name missing"] };
  }
  return {
    name: cleanName(raw),
    email: "",
    raw,
    valid: false,
    ambiguous: false,
    issues: ["Email address missing"],
  };
}

export function parseCombinedContactCell(raw: string): ExtractedContact[] {
  const segments = splitCombinedContactSegments(raw);
  if (!segments.length) return [];
  return segments.map(parseCombinedContactSegment);
}

export function applyCombinedContactTransform(
  raw: string,
  transform: CombinedContactTransform,
): {
  contactName: string;
  contactEmail: string;
  contacts: ExtractedContact[];
  issues: string[];
} {
  const contacts = parseCombinedContactCell(raw);
  if (transform === "extract_contact_name") {
    const named = contacts.filter((item) => item.name);
    if (contacts.some((item) => item.ambiguous) || named.length > 1) {
      return {
        contactName: "",
        contactEmail: "",
        contacts,
        issues: ["Multiple contacts found. Choose Split names and emails into contacts."],
      };
    }
    if (!named.length) {
      return { contactName: "", contactEmail: "", contacts, issues: ["Contact name could not be extracted."] };
    }
    return { contactName: named[0].name, contactEmail: "", contacts, issues: [] };
  }
  if (transform === "extract_email") {
    const emailed = contacts.filter((item) => item.email);
    if (contacts.some((item) => item.ambiguous) || emailed.length > 1) {
      return {
        contactName: "",
        contactEmail: "",
        contacts,
        issues: ["Multiple emails found. Choose Split names and emails into contacts."],
      };
    }
    if (!emailed.length) {
      return { contactName: "", contactEmail: "", contacts, issues: ["Email address could not be extracted."] };
    }
    return { contactName: "", contactEmail: emailed[0].email, contacts, issues: [] };
  }

  const issues = contacts.flatMap((item) => item.issues);
  if (!contacts.length) issues.push("No contacts could be extracted.");
  const firstValid = contacts.find((item) => item.valid);
  return {
    contactName: firstValid?.name || contacts.find((item) => item.name)?.name || "",
    contactEmail: firstValid?.email || contacts.find((item) => item.email)?.email || "",
    contacts,
    issues,
  };
}

export function combinedMappingOccupies(spec: CombinedContactMappingSpec): Array<"contactName" | "contactEmail"> {
  if (spec.transform === "extract_contact_name") return ["contactName"];
  if (spec.transform === "extract_email") return ["contactEmail"];
  return ["contactName", "contactEmail"];
}
