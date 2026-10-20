type ApolloSearchInput = {
  companyName?: string;
  contactName?: string;
  contactTitle?: string;
  linkedinUrl?: string;
  page?: number;
  perPage?: number;
};

type ApolloPeopleMatchInput = {
  apolloPersonId?: string;
  apolloOrganizationId?: string;
  linkedinUrl?: string;
  contactName?: string;
  companyName?: string;
  companyDomain?: string;
  revealPhoneNumber?: boolean;
  revealPersonalEmails?: boolean;
};

export type ApolloPersonCandidate = {
  apolloPersonId: string;
  apolloOrganizationId: string | null;
  name: string;
  title: string | null;
  workEmail: string | null;
  phone: string | null;
  location: string | null;
  linkedinUrl: string | null;
  organizationName: string | null;
};

export type ApolloEnrichedPerson = ApolloPersonCandidate & {
  emailStatus: string | null;
  requestId: string | null;
  phoneStatus: "found" | "unavailable" | "timeout" | "not_requested";
};

export class ApolloServiceError extends Error {
  statusCode: number;
  userMessage: string;
  meta?: Record<string, unknown>;
  constructor(statusCode: number, userMessage: string, meta?: Record<string, unknown>) {
    super(userMessage);
    this.statusCode = statusCode;
    this.userMessage = userMessage;
    this.meta = meta;
    this.name = "ApolloServiceError";
  }
}

const APOLLO_BASE_URL = String(process.env.APOLLO_BASE_URL || "https://api.apollo.io").trim();

function requireApiKey() {
  const key = String(process.env.APOLLO_API_KEY || "").trim();
  if (!key) {
    throw new ApolloServiceError(500, "Apollo integration is not configured.");
  }
  return key;
}

function compactObject<T extends Record<string, unknown>>(obj: T) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => {
      if (v === null || v === undefined) return false;
      if (typeof v === "string") return v.trim().length > 0;
      if (Array.isArray(v)) return v.length > 0;
      return true;
    }),
  ) as Partial<T>;
}

function stringOrNull(value: unknown) {
  if (value === undefined || value === null) return null;
  const v = String(value).trim();
  return v || null;
}

function joinLocation(...parts: unknown[]) {
  const v = parts.map(stringOrNull).filter((x): x is string => Boolean(x));
  return v.length ? v.join(", ") : null;
}

function mapPerson(raw: any): ApolloPersonCandidate | null {
  const apolloPersonId = stringOrNull(raw?.person_id || raw?.id);
  if (!apolloPersonId) return null;

  const org = raw?.organization || raw?.account || null;
  const apolloOrganizationId =
    stringOrNull(raw?.organization_id) || stringOrNull(org?.id) || null;

  const firstName = stringOrNull(raw?.first_name);
  const lastName = stringOrNull(raw?.last_name);
  const fallbackName = [firstName, lastName].filter(Boolean).join(" ");

  return {
    apolloPersonId,
    apolloOrganizationId,
    name: stringOrNull(raw?.name) || fallbackName || "Unknown Contact",
    title: stringOrNull(raw?.title),
    workEmail:
      stringOrNull(raw?.email) ||
      stringOrNull(raw?.work_email) ||
      stringOrNull(raw?.primary_email),
    phone:
      stringOrNull(raw?.phone) ||
      stringOrNull(raw?.sanitized_phone) ||
      (Array.isArray(raw?.phone_numbers) && raw.phone_numbers.length
        ? stringOrNull(raw.phone_numbers[0])
        : null),
    location: joinLocation(raw?.city, raw?.state, raw?.country),
    linkedinUrl: stringOrNull(raw?.linkedin_url),
    organizationName:
      stringOrNull(org?.name) ||
      stringOrNull(raw?.organization_name) ||
      stringOrNull(raw?.company_name),
  };
}

function extractPhone(raw: any): string | null {
  if (!raw || typeof raw !== "object") return null;
  if (stringOrNull(raw?.phone)) return stringOrNull(raw?.phone);
  if (stringOrNull(raw?.sanitized_phone)) return stringOrNull(raw?.sanitized_phone);
  if (stringOrNull(raw?.phone_number)) return stringOrNull(raw?.phone_number);
  if (Array.isArray(raw?.phone_numbers) && raw.phone_numbers.length) {
    const first = raw.phone_numbers[0];
    if (typeof first === "string") return stringOrNull(first);
    if (first && typeof first === "object") {
      return (
        stringOrNull(first?.number) ||
        stringOrNull(first?.sanitized_number) ||
        stringOrNull(first?.raw_number)
      );
    }
  }
  return null;
}

async function parseJson(response: Response) {
  const text = await response.text().catch(() => "");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function mapApolloFailure(status: number, responseBody?: any, path?: string) {
  const apolloMessage =
    stringOrNull(responseBody?.error) ||
    stringOrNull(responseBody?.message) ||
    stringOrNull(responseBody?.detail) ||
    stringOrNull(responseBody?.errors?.[0]?.message);

  if (process.env.NODE_ENV !== "production") {
    console.warn("[apollo] request failed", {
      path,
      status,
      apolloMessage,
      responseKeys: responseBody && typeof responseBody === "object" ? Object.keys(responseBody) : [],
    });
  }

  if (status === 401) return new ApolloServiceError(401, "Invalid Apollo API key.");
  if (status === 403) return new ApolloServiceError(403, "Apollo permission denied.");
  if (status === 429) return new ApolloServiceError(429, "Apollo rate limit reached.");
  return new ApolloServiceError(
    status >= 400 ? status : 502,
    apolloMessage ? `Apollo request failed: ${apolloMessage}` : "Apollo request failed.",
    {
      path,
      status,
      apolloMessage,
    }
  );
}

async function apolloRequest(
  path: string,
  init: RequestInit,
  query?: Record<string, string | null | undefined>,
) {
  const url = new URL(path, APOLLO_BASE_URL);
  Object.entries(query || {}).forEach(([k, v]) => {
    if (v && v.trim()) url.searchParams.set(k, v.trim());
  });

  const response = await fetch(url.toString(), {
    ...init,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": requireApiKey(),
      ...(init.headers || {}),
    },
  });

  const payload = await parseJson(response);
  if (!response.ok) throw mapApolloFailure(response.status, payload, path);
  return payload;
}

export async function searchApolloPeople(input: ApolloSearchInput): Promise<ApolloPersonCandidate[]> {
  const payload = compactObject({
    q_organization_name: input.companyName,
    q_person_name: input.contactName,
    person_titles: input.contactTitle ? [input.contactTitle] : undefined,
    person_linkedin_url: input.linkedinUrl,
    q_keywords: [input.contactName, input.companyName].filter(Boolean).join(" ") || undefined,
    page: input.page || 1,
    per_page: input.perPage || 10,
  });

  const response = await apolloRequest("/api/v1/mixed_people/api_search", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  const people = Array.isArray(response?.people)
    ? response.people
    : Array.isArray(response?.contacts)
      ? response.contacts
      : Array.isArray(response?.results)
        ? response.results
        : [];

  return people
    .map((person: any) => mapPerson(person))
    .filter((v: ApolloPersonCandidate | null): v is ApolloPersonCandidate => Boolean(v));
}

export async function enrichApolloPerson(input: ApolloPeopleMatchInput): Promise<ApolloEnrichedPerson | null> {
  const revealPhoneNumber = input.revealPhoneNumber ?? false;
  const revealPersonalEmails = input.revealPersonalEmails ?? false;

  const payload = compactObject({
    id: input.apolloPersonId,
    person_id: input.apolloPersonId,
    organization_id: input.apolloOrganizationId,
    linkedin_url: input.linkedinUrl,
    name: input.contactName,
    organization_name: input.companyName,
    domain: input.companyDomain,
    reveal_personal_emails: revealPersonalEmails,
    reveal_phone_number: revealPhoneNumber,
  });

  const response = await apolloRequest("/api/v1/people/match", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  const person = response?.person || response?.matched_person || response;
  const mapped = mapPerson(person);
  if (!mapped) return null;

  const requestId =
    stringOrNull(response?.request_id) ||
    stringOrNull(response?.requestId) ||
    stringOrNull(person?.request_id);

  let phone = mapped.phone;
  const phoneStatus: ApolloEnrichedPerson["phoneStatus"] = phone
    ? "found"
    : revealPhoneNumber
      ? "unavailable"
      : "not_requested";

  return {
    ...mapped,
    phone,
    emailStatus:
      stringOrNull(person?.email_status) ||
      stringOrNull(person?.work_email_status) ||
      stringOrNull(response?.email_status),
    requestId,
    phoneStatus,
  };
}

export function toApolloErrorResponse(error: unknown) {
  if (error instanceof ApolloServiceError) {
    return { status: error.statusCode, message: error.userMessage, meta: error.meta };
  }
  return { status: 502, message: "Unable to fetch Apollo data right now." };
}

