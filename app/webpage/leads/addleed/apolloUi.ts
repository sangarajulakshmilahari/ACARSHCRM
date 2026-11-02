export type ApolloPhoneStatus =
  | "found"
  | "unavailable"
  | "pending"
  | "not_requested"
  | "failed"
  | "timeout";

export type ApolloContactFields = {
  name?: string | null;
  title?: string | null;
  workEmail?: string | null;
  phone?: string | null;
  location?: string | null;
  linkedinUrl?: string | null;
  organizationName?: string | null;
};

export type LeadContactFormSlice = {
  CompanyName: string;
  ContactName: string;
  ContactTitle: string;
  ContactEmail: string;
  ContactPhone: string;
  ContactLocation: string;
  LinkedInURL: string;
};

export const SAMPLE_PHONE_PLACEHOLDERS = [
  "+91 98765 43210",
  "+91 9876543210",
  "+919876543210",
];

export const SAMPLE_EMAIL_PLACEHOLDERS = ["email@company.com"];

function normalize(value: unknown) {
  return String(value ?? "").trim();
}

export function isSamplePlaceholder(value: unknown, kind: "phone" | "email") {
  const v = normalize(value).toLowerCase();
  if (!v) return false;
  const list = kind === "phone" ? SAMPLE_PHONE_PLACEHOLDERS : SAMPLE_EMAIL_PLACEHOLDERS;
  return list.some((item) => item.toLowerCase() === v);
}

function existingValue(value: unknown, kind: "phone" | "email" | "text") {
  const v = normalize(value);
  if (!v) return "";
  if (kind === "phone" && isSamplePlaceholder(v, "phone")) return "";
  if (kind === "email" && isSamplePlaceholder(v, "email")) return "";
  return v;
}

export function mergeEnrichedContactIntoForm<T extends LeadContactFormSlice>(
  prev: T,
  contact: ApolloContactFields | null | undefined,
): T {
  const incomingEmail = existingValue(contact?.workEmail, "email");
  const incomingPhone = existingValue(contact?.phone, "phone");
  return {
    ...prev,
    CompanyName: existingValue(prev.CompanyName, "text") || normalize(contact?.organizationName),
    ContactName: normalize(contact?.name) || existingValue(prev.ContactName, "text"),
    ContactTitle: normalize(contact?.title) || existingValue(prev.ContactTitle, "text"),
    ContactEmail: incomingEmail || existingValue(prev.ContactEmail, "email"),
    ContactPhone: incomingPhone || existingValue(prev.ContactPhone, "phone"),
    ContactLocation: normalize(contact?.location) || existingValue(prev.ContactLocation, "text"),
    LinkedInURL: normalize(contact?.linkedinUrl) || existingValue(prev.LinkedInURL, "text"),
  };
}

export function buildApolloEnrichmentMessages(input: {
  hasName?: boolean;
  hasEmail: boolean;
  hasPhone: boolean;
  phoneStatus: ApolloPhoneStatus | string;
}) {
  const phoneStatus = String(input.phoneStatus || "not_requested") as ApolloPhoneStatus;
  const appliedSomething = Boolean(input.hasName || input.hasEmail || input.hasPhone);
  let statusMessage = "";
  let errorMessage = "";

  if (input.hasEmail && input.hasPhone) {
    statusMessage = "Work email and phone number applied from Apollo.";
  } else if (input.hasEmail && phoneStatus === "pending") {
    statusMessage = "Work email applied. Phone lookup pending.";
  } else if (input.hasEmail && phoneStatus === "unavailable") {
    statusMessage = "Work email applied. No phone number available.";
  } else if (input.hasEmail && phoneStatus === "timeout") {
    statusMessage = "Work email applied. Retrieving phone number from Apollo timed out.";
  } else if (input.hasEmail && phoneStatus === "not_requested") {
    statusMessage = "Work email applied from Apollo. Phone reveal disabled.";
  } else if (input.hasEmail) {
    statusMessage = "Work email applied from Apollo.";
  } else if (input.hasPhone) {
    statusMessage = "Phone number applied from Apollo. Work email was not returned.";
  } else if (phoneStatus === "pending") {
    statusMessage = "Phone number is pending from Apollo.";
  } else if (appliedSomething) {
    statusMessage = "Contact details applied from Apollo. Email and phone were not returned.";
  } else {
    errorMessage = "Apollo did not return contact details to apply.";
  }

  if (!input.hasEmail && appliedSomething && !errorMessage) {
    errorMessage =
      "Work email is unavailable in Apollo. You can continue and enter email manually.";
  }

  return { statusMessage, errorMessage };
}
