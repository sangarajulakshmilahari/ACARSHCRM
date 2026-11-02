import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export type ApolloSearchInput = {
  companyName?: string;
  contactName?: string;
  contactTitle?: string;
  linkedinUrl?: string;
  page?: number;
  perPage?: number;
};

export type ApolloPeopleMatchInput = {
  apolloPersonId?: string;
  apolloOrganizationId?: string;
  linkedinUrl?: string;
  contactName?: string;
  companyName?: string;
  companyDomain?: string;
  revealPhoneNumber?: boolean;
  revealPersonalEmails?: boolean;
  actor?: { userId: number; companyId: number | null };
};

export type ApolloPhoneStatus =
  | "found"
  | "unavailable"
  | "pending"
  | "not_requested"
  | "failed"
  | "timeout";

export type ApolloPersonCandidate = {
  apolloPersonId: string;
  apolloOrganizationId: string | null;
  name: string;
  title: string | null;
  workEmail: string | null;
  phone: string | null;
  phoneType: string | null;
  location: string | null;
  linkedinUrl: string | null;
  organizationName: string | null;
  source: "search" | "match";
};

export type ApolloEnrichedPerson = ApolloPersonCandidate & {
  emailStatus: string | null;
  requestId: string | null;
  phoneStatus: ApolloPhoneStatus;
};

export type ApolloPhoneRevealRecord = {
  requestId: string;
  apolloPersonId: string;
  userId: number;
  companyId: number | null;
  phone: string | null;
  phoneType: string | null;
  status: ApolloPhoneStatus;
  updatedAt: number;
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

const APOLLO_BASE_URL = () => String(process.env.APOLLO_BASE_URL || "https://api.apollo.io").trim();
const APOLLO_TIMEOUT_MS = 15_000;
const PHONE_REVEAL_TIMEOUT_MS = 45_000;
const PHONE_REVEAL_TTL_MS = 30 * 60 * 1000;
const PEOPLE_API_SEARCH_PATH = "/api/v1/mixed_people/api_search";
const PEOPLE_MATCH_PATH = "/api/v1/people/match";
const WEBHOOK_RESULT_PATH = "/api/v1/webhook_result";

const PREFERRED_PHONE_TYPES = [
  "mobile",
  "mobile_phone",
  "cell",
  "cellular",
  "direct_dial",
  "direct",
  "work_direct",
  "work",
];

const phoneRevealStore = new Map<string, ApolloPhoneRevealRecord>();
const phoneRevealByPersonId = new Map<string, string>();

function requireApiKey() {
  const key = String(process.env.APOLLO_API_KEY || "").trim();
  if (!key) {
    throw new ApolloServiceError(500, "Apollo integration is not configured.");
  }
  return key;
}

export function compactObject<T extends Record<string, unknown>>(obj: T) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => {
      if (v === null || v === undefined) return false;
      if (typeof v === "string") return v.trim().length > 0;
      if (Array.isArray(v)) return v.length > 0;
      return true;
    }),
  ) as Partial<T>;
}

export function stringOrNull(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value === "object") return null;
  const v = String(value).trim();
  if (!v || v === "[object Object]") return null;
  return v;
}

function joinLocation(...parts: unknown[]) {
  const v = parts.map(stringOrNull).filter((x): x is string => Boolean(x));
  return v.length ? v.join(", ") : null;
}

export function isLikelyDomain(value: unknown): boolean {
  const raw = stringOrNull(value);
  if (!raw) return false;
  const host = raw
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("/")[0]
    .trim()
    .toLowerCase();
  if (!host || host.includes(" ") || host.includes("@")) return false;
  return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(host);
}

export function normalizeDomain(value: unknown): string | undefined {
  if (!isLikelyDomain(value)) return undefined;
  return String(value)
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("/")[0]
    .trim()
    .toLowerCase();
}

export function isPublicHttpsUrl(value: unknown): boolean {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    if (!host) return false;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") {
      return false;
    }
    if (host.endsWith(".local")) return false;
    return true;
  } catch {
    return false;
  }
}

export function isPhoneRevealEnabled() {
  return String(process.env.APOLLO_REVEAL_PHONE_NUMBER || "").trim().toLowerCase() === "true";
}

export function getApolloWebhookSecret() {
  return String(process.env.APOLLO_WEBHOOK_SECRET || "").trim();
}

export function buildApolloWebhookUrl(): string | null {
  const base = String(process.env.APOLLO_WEBHOOK_URL || "").trim();
  const secret = getApolloWebhookSecret();
  if (!isPublicHttpsUrl(base) || !secret) return null;
  const url = new URL(base);
  if (!url.searchParams.get("token") && !url.searchParams.get("webhook_token")) {
    url.searchParams.set("token", secret);
  }
  return url.toString();
}

export function canRevealPhoneNumbers() {
  return isPhoneRevealEnabled();
}

export function canUseApolloPhoneWebhook() {
  return Boolean(buildApolloWebhookUrl());
}

export type ApolloPhoneRevealMode = "off" | "poll" | "webhook";

export function getPhoneRevealMode(): ApolloPhoneRevealMode {
  if (!isPhoneRevealEnabled()) return "off";
  if (canUseApolloPhoneWebhook()) return "webhook";
  return "poll";
}

export function isValidApolloRequestId(value: unknown) {
  if (typeof value === "number") return false;
  const id = stringOrNull(value);
  if (!id) return false;
  return /^-?\d{1,20}$/.test(id) || /^[A-Za-z0-9._-]{4,128}$/.test(id);
}

export function extractApolloRequestIdFromRawJson(rawText: string): string | null {
  const text = String(rawText || "");
  if (!text) return null;
  const quoted = text.match(/"request_id"\s*:\s*"((?:\\.|[^"\\])+)"/);
  if (quoted?.[1]) return quoted[1].replace(/\\"/g, '"');
  const numeric = text.match(/"request_id"\s*:\s*(-?\d+)/);
  if (numeric?.[1]) return numeric[1];
  return null;
}

export function parseApolloJson(rawText: string) {
  let payload: any = {};
  try {
    payload = rawText ? JSON.parse(rawText) : {};
  } catch {
    payload = {};
  }
  if (!payload || typeof payload !== "object") payload = {};
  const exactId = extractApolloRequestIdFromRawJson(rawText);
  if (exactId) {
    payload.request_id = exactId;
  } else if (typeof payload.request_id === "number") {
    delete payload.request_id;
  }
  return payload;
}

export function buildApolloWebhookResultPath(requestId: string) {
  return `${WEBHOOK_RESULT_PATH}/${encodeURIComponent(requestId)}`;
}

const MAX_PHONE_POLL_ATTEMPTS = 6;
const MAX_RETRY_AFTER_SECONDS = 10;
const DEFAULT_RETRY_AFTER_SECONDS = 2;

let sleepFn = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function setApolloSleepForTests(fn: ((ms: number) => Promise<void>) | null) {
  sleepFn = fn || ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
}

function phoneTypeRank(type: string | null) {
  if (!type) return PREFERRED_PHONE_TYPES.length + 1;
  const index = PREFERRED_PHONE_TYPES.indexOf(type.toLowerCase());
  return index === -1 ? PREFERRED_PHONE_TYPES.length : index;
}

function readPhoneFromObject(value: unknown): { phone: string | null; type: string | null } {
  if (typeof value === "string") {
    return { phone: stringOrNull(value), type: null };
  }
  if (!value || typeof value !== "object") {
    return { phone: null, type: null };
  }
  const record = value as Record<string, unknown>;
  const phone =
    stringOrNull(record.sanitized_number) ||
    stringOrNull(record.raw_number) ||
    stringOrNull(record.number) ||
    stringOrNull(record.phone_number) ||
    stringOrNull(record.phone);
  const type = stringOrNull(record.type) || stringOrNull(record.kind) || stringOrNull(record.category);
  return { phone, type };
}

export function extractPhone(raw: any): { phone: string | null; type: string | null } {
  if (!raw || typeof raw !== "object") return { phone: null, type: null };

  const direct =
    stringOrNull(raw.sanitized_phone) ||
    stringOrNull(raw.phone_number) ||
    (typeof raw.phone === "string" ? stringOrNull(raw.phone) : null);
  if (direct && !Array.isArray(raw.phone_numbers)) {
    return { phone: direct, type: null };
  }

  const buckets = [raw.phone_numbers, raw.phone_number, raw.phones, raw.contact_numbers]
    .filter(Array.isArray)
    .flat();

  const parsed = buckets
    .map((item) => readPhoneFromObject(item))
    .filter((item) => Boolean(item.phone));

  if (!parsed.length) {
    if (typeof raw.phone === "object") return readPhoneFromObject(raw.phone);
    return { phone: direct, type: null };
  }

  parsed.sort((a, b) => phoneTypeRank(a.type) - phoneTypeRank(b.type));
  return parsed[0];
}

function isLockedEmail(email: string | null) {
  if (!email) return true;
  return /email_not_unlocked|not_unlocked|unavailable@/i.test(email);
}

export function mapPerson(raw: any, source: "search" | "match" = "search"): ApolloPersonCandidate | null {
  const apolloPersonId = stringOrNull(raw?.person_id) || stringOrNull(raw?.id);
  if (!apolloPersonId) return null;

  const org = raw?.organization || raw?.account || null;
  const apolloOrganizationId =
    stringOrNull(raw?.organization_id) || stringOrNull(org?.id) || null;

  const firstName = stringOrNull(raw?.first_name);
  const lastName = stringOrNull(raw?.last_name);
  const fallbackName = [firstName, lastName].filter(Boolean).join(" ");
  const extractedPhone = extractPhone(raw);
  const workEmail =
    stringOrNull(raw?.email) ||
    stringOrNull(raw?.work_email) ||
    stringOrNull(raw?.primary_email);

  return {
    apolloPersonId,
    apolloOrganizationId,
    name: stringOrNull(raw?.name) || fallbackName || "Unknown Contact",
    title: stringOrNull(raw?.title),
    workEmail: isLockedEmail(workEmail) ? null : workEmail,
    phone: extractedPhone.phone,
    phoneType: extractedPhone.type,
    location: joinLocation(raw?.city, raw?.state, raw?.country),
    linkedinUrl: stringOrNull(raw?.linkedin_url),
    organizationName:
      stringOrNull(org?.name) ||
      stringOrNull(raw?.organization_name) ||
      stringOrNull(raw?.company_name),
    source,
  };
}

export function parseSearchPeople(response: any): ApolloPersonCandidate[] {
  const people = Array.isArray(response?.people)
    ? response.people
    : Array.isArray(response?.contacts)
      ? response.contacts
      : Array.isArray(response?.results)
        ? response.results
        : [];

  return people
    .map((person: any) => mapPerson(person, "search"))
    .filter((v: ApolloPersonCandidate | null): v is ApolloPersonCandidate => Boolean(v));
}

export function buildApolloSearchPayload(input: ApolloSearchInput) {
  const companyName = stringOrNull(input.companyName) || undefined;
  const contactName = stringOrNull(input.contactName) || undefined;
  const contactTitle = stringOrNull(input.contactTitle) || undefined;
  const companyDomain = normalizeDomain(companyName);
  const keywords = [contactName, companyDomain ? undefined : companyName]
    .filter(Boolean)
    .join(" ") || undefined;

  return compactObject({
    q_keywords: keywords,
    person_titles: contactTitle ? [contactTitle] : undefined,
    q_organization_domains: companyDomain ? [companyDomain] : undefined,
    page: Number(input.page || 1) || 1,
    per_page: Math.min(25, Math.max(1, Number(input.perPage || 10) || 10)),
  });
}

export function buildApolloMatchPayload(
  input: ApolloPeopleMatchInput,
  options?: {
    revealPhoneNumber?: boolean;
    pollOnly?: boolean;
    webhookUrl?: string | null;
    requestId?: string;
  },
) {
  const domain = normalizeDomain(input.companyDomain) || normalizeDomain(input.companyName);
  const organizationName = domain ? undefined : stringOrNull(input.companyName) || undefined;
  const revealPhoneNumber = Boolean(options?.revealPhoneNumber);
  const pollOnly = Boolean(options?.pollOnly);
  const webhookUrl = stringOrNull(options?.webhookUrl);
  const requestId = isValidApolloRequestId(options?.requestId) ? String(options?.requestId) : undefined;

  if (revealPhoneNumber && pollOnly && webhookUrl) {
    throw new ApolloServiceError(500, "Apollo phone reveal cannot use webhook and poll_only together.");
  }
  if (revealPhoneNumber && !pollOnly && !webhookUrl && !requestId) {
    throw new ApolloServiceError(
      500,
      "Apollo phone reveal requires poll_only or a public webhook URL.",
    );
  }

  return compactObject({
    id: requestId ? undefined : stringOrNull(input.apolloPersonId) || undefined,
    linkedin_url: requestId ? undefined : stringOrNull(input.linkedinUrl) || undefined,
    name: requestId ? undefined : stringOrNull(input.contactName) || undefined,
    organization_name: requestId ? undefined : organizationName,
    domain: requestId ? undefined : domain,
    request_id: requestId,
    reveal_personal_emails: input.revealPersonalEmails ? true : undefined,
    reveal_phone_number: revealPhoneNumber ? true : undefined,
    poll_only: pollOnly ? true : undefined,
    webhook_url: revealPhoneNumber && !pollOnly ? webhookUrl || undefined : undefined,
  });
}

async function parseJson(response: Response) {
  const text = await response.text().catch(() => "");
  return parseApolloJson(text);
}

function logApolloEvent(
  level: "info" | "warn" | "error",
  message: string,
  meta: Record<string, unknown>,
) {
  const payload = {
    message,
    ...meta,
  };
  if (level === "error") console.error("[apollo]", payload);
  else if (level === "warn") console.warn("[apollo]", payload);
  else if (process.env.NODE_ENV !== "production") console.info("[apollo]", payload);
}

function mapApolloFailure(status: number, responseBody?: any, path?: string) {
  const apolloMessage =
    stringOrNull(responseBody?.error) ||
    stringOrNull(responseBody?.message) ||
    stringOrNull(responseBody?.detail) ||
    stringOrNull(responseBody?.errors?.[0]?.message);

  logApolloEvent("warn", "request failed", {
    path,
    status,
    apolloMessage,
    responseKeys: responseBody && typeof responseBody === "object" ? Object.keys(responseBody) : [],
  });

  if (status === 400) {
    return new ApolloServiceError(400, apolloMessage ? `Apollo request invalid: ${apolloMessage}` : "Apollo rejected the request.", {
      path,
      status,
      apolloMessage,
    });
  }
  if (status === 401) return new ApolloServiceError(401, "Invalid Apollo API key.", { path, status });
  if (status === 403) return new ApolloServiceError(403, "Apollo permission denied.", { path, status });
  if (status === 404) return new ApolloServiceError(404, "No contact found for enrichment.", { path, status });
  if (status === 429) return new ApolloServiceError(429, "Apollo rate limit reached.", { path, status });
  return new ApolloServiceError(
    status >= 500 ? 502 : status >= 400 ? status : 502,
    apolloMessage ? `Apollo request failed: ${apolloMessage}` : "Apollo request failed.",
    { path, status, apolloMessage },
  );
}

async function apolloRequest(path: string, init: RequestInit, options?: { timeoutMs?: number }) {
  const url = new URL(path, APOLLO_BASE_URL());
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options?.timeoutMs || APOLLO_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), {
      ...init,
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "x-api-key": requireApiKey(),
        ...(init.headers || {}),
      },
    });
    const payload = await parseJson(response);
    if (!response.ok) throw mapApolloFailure(response.status, payload, path);
    return payload;
  } catch (error) {
    if (error instanceof ApolloServiceError) throw error;
    const name = String((error as any)?.name || "");
    if (name === "AbortError") {
      throw new ApolloServiceError(504, "Apollo request timed out.", { path });
    }
    throw new ApolloServiceError(502, "Unable to reach Apollo right now.", { path });
  } finally {
    clearTimeout(timeout);
  }
}

function prunePhoneRevealStore(now = Date.now()) {
  for (const [requestId, record] of phoneRevealStore.entries()) {
    if (now - record.updatedAt > PHONE_REVEAL_TTL_MS) {
      phoneRevealStore.delete(requestId);
      if (phoneRevealByPersonId.get(record.apolloPersonId) === requestId) {
        phoneRevealByPersonId.delete(record.apolloPersonId);
      }
    }
  }
}

export function resetApolloPhoneRevealStoreForTests() {
  phoneRevealStore.clear();
  phoneRevealByPersonId.clear();
}

export function rememberApolloPhoneReveal(record: Omit<ApolloPhoneRevealRecord, "updatedAt"> & { updatedAt?: number }) {
  prunePhoneRevealStore();
  const stored: ApolloPhoneRevealRecord = {
    ...record,
    updatedAt: record.updatedAt || Date.now(),
  };
  phoneRevealStore.set(stored.requestId, stored);
  phoneRevealByPersonId.set(stored.apolloPersonId, stored.requestId);
  return stored;
}

export function getApolloPhoneRevealStatus(input: {
  requestId?: string;
  apolloPersonId?: string;
  userId: number;
  companyId: number | null;
}): ApolloPhoneRevealRecord | null {
  prunePhoneRevealStore();
  const requestId =
    stringOrNull(input.requestId) ||
    (stringOrNull(input.apolloPersonId)
      ? phoneRevealByPersonId.get(String(input.apolloPersonId)) || null
      : null);
  if (!requestId) return null;
  const record = phoneRevealStore.get(requestId) || null;
  if (!record) return null;
  if (record.userId !== input.userId) return null;
  if (record.companyId != null && input.companyId != null && record.companyId !== input.companyId) {
    return null;
  }
  return record;
}

export function verifyApolloWebhookToken(req: NextRequest) {
  const expected = getApolloWebhookSecret();
  if (!expected) return false;
  const provided =
    req.nextUrl.searchParams.get("token") ||
    req.nextUrl.searchParams.get("webhook_token") ||
    "";
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(String(provided));
  if (expectedBuffer.length === 0 || expectedBuffer.length !== providedBuffer.length) {
    return false;
  }
  try {
    return timingSafeEqual(expectedBuffer, providedBuffer);
  } catch {
    return false;
  }
}

export function applyApolloPhoneWebhook(payload: any): { ok: boolean; updated: number; error?: string } {
  if (!payload || typeof payload !== "object") {
    return { ok: false, updated: 0, error: "Malformed webhook payload." };
  }

  const people = Array.isArray(payload.people)
    ? payload.people
    : payload.person
      ? [payload.person]
      : [];

  if (!people.length) {
    return { ok: false, updated: 0, error: "Webhook payload did not include a person." };
  }

  prunePhoneRevealStore();
  let updated = 0;
  for (const person of people) {
    const personId = stringOrNull(person?.id) || stringOrNull(person?.person_id);
    const requestId =
      stringOrNull(payload?.request_id) ||
      stringOrNull(person?.request_id) ||
      (personId ? phoneRevealByPersonId.get(personId) : null);
    if (!requestId) continue;
    const existing = phoneRevealStore.get(requestId);
    if (!existing) continue;
    if (personId && existing.apolloPersonId !== personId) continue;

    const extracted = extractPhone(person);
    const nextStatus: ApolloPhoneStatus = extracted.phone
      ? "found"
      : String(person?.status || payload?.status || "").toLowerCase().includes("fail")
        ? "failed"
        : "unavailable";

    rememberApolloPhoneReveal({
      ...existing,
      phone: extracted.phone,
      phoneType: extracted.type,
      status: nextStatus,
    });
    updated += 1;
  }

  return { ok: true, updated };
}

export async function searchApolloPeople(input: ApolloSearchInput): Promise<ApolloPersonCandidate[]> {
  const linkedinUrl = stringOrNull(input.linkedinUrl);
  const hasNameOrCompany = Boolean(stringOrNull(input.contactName) || stringOrNull(input.companyName));

  if (linkedinUrl && !hasNameOrCompany) {
    const person = await enrichApolloPerson({
      linkedinUrl,
      revealPhoneNumber: false,
      revealPersonalEmails: false,
    });
    return person ? [{ ...person, source: "match" }] : [];
  }

  const payload = buildApolloSearchPayload(input);
  if (!payload.q_keywords && !payload.q_organization_domains) {
    throw new ApolloServiceError(
      400,
      "Enter at least Company Name, Contact Name, or LinkedIn URL to search Apollo contacts.",
    );
  }

  const response = await apolloRequest(PEOPLE_API_SEARCH_PATH, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return parseSearchPeople(response);
}

function readMatchStatus(response: any): string {
  return String(
    response?.status ||
      response?.phone_status ||
      response?.person?.status ||
      "",
  )
    .trim()
    .toLowerCase();
}

function readRetryAfterSeconds(response: any) {
  const raw = Number(response?.retry_after_seconds);
  if (!Number.isFinite(raw) || raw < 0) return DEFAULT_RETRY_AFTER_SECONDS;
  return Math.min(MAX_RETRY_AFTER_SECONDS, raw);
}

function extractWebhookResultPerson(payload: any) {
  const result = payload?.webhook_result || payload?.result || payload;
  if (!result || typeof result !== "object") return null;
  if (result.person) return result.person;
  if (Array.isArray(result.people) && result.people.length) return result.people[0];
  if (result.id || result.person_id || result.phone_numbers || result.phone) return result;
  return null;
}

function webhookResultErrorCode(payload: any) {
  return (
    stringOrNull(payload?.error) ||
    stringOrNull(payload?.error_code) ||
    stringOrNull(payload?.status) ||
    ""
  ).toLowerCase();
}

async function fetchApolloWebhookResult(requestId: string) {
  const path = buildApolloWebhookResultPath(requestId);
  const url = new URL(path, APOLLO_BASE_URL());
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PHONE_REVEAL_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "Cache-Control": "no-cache",
        "x-api-key": requireApiKey(),
      },
    });
    const payload = await parseJson(response);
    const errorCode = webhookResultErrorCode(payload);
    const pending =
      errorCode === "result_pending" ||
      errorCode === "pending" ||
      payload?.status === "pending" ||
      (response.status === 404 && errorCode === "result_pending");

    if (pending) {
      return { pending: true as const, payload, retryAfter: readRetryAfterSeconds(payload) };
    }
    if (errorCode === "invalid_request_id") {
      throw new ApolloServiceError(400, "Invalid Apollo request ID.", {
        path,
        status: response.status,
        apolloMessage: errorCode,
      });
    }
    if (errorCode === "request_id_unknown") {
      throw new ApolloServiceError(404, "Apollo request ID is unknown.", {
        path,
        status: response.status,
        apolloMessage: errorCode,
      });
    }
    if (errorCode === "request_id_expired") {
      throw new ApolloServiceError(404, "Apollo phone lookup expired.", {
        path,
        status: response.status,
        apolloMessage: errorCode,
      });
    }
    if (!response.ok) throw mapApolloFailure(response.status, payload, path);
    return { pending: false as const, payload, retryAfter: 0 };
  } catch (error) {
    if (error instanceof ApolloServiceError) throw error;
    const name = String((error as any)?.name || "");
    if (name === "AbortError") {
      throw new ApolloServiceError(504, "Apollo request timed out.", { path });
    }
    throw new ApolloServiceError(502, "Unable to reach Apollo right now.", { path });
  } finally {
    clearTimeout(timeout);
  }
}

async function pollApolloWebhookResult(requestId: string) {
  if (!isValidApolloRequestId(requestId)) {
    throw new ApolloServiceError(400, "Invalid Apollo request ID.");
  }

  let lastPayload: any = null;
  for (let attempt = 0; attempt < MAX_PHONE_POLL_ATTEMPTS; attempt += 1) {
    const polled = await fetchApolloWebhookResult(requestId);
    lastPayload = polled.payload;
    if (polled.pending) {
      const waitMs = (polled.retryAfter || DEFAULT_RETRY_AFTER_SECONDS) * 1000;
      if (attempt < MAX_PHONE_POLL_ATTEMPTS - 1 && waitMs > 0) {
        await sleepFn(waitMs);
      }
      continue;
    }
    const person = extractWebhookResultPerson(polled.payload);
    const phone = extractPhone(person);
    if (phone.phone) {
      return { response: polled.payload, person, timedOut: false, status: "found" as const };
    }
    return { response: polled.payload, person, timedOut: false, status: "unavailable" as const };
  }
  return {
    response: lastPayload,
    person: extractWebhookResultPerson(lastPayload),
    timedOut: true,
    status: "timeout" as const,
  };
}

export async function enrichApolloPerson(input: ApolloPeopleMatchInput): Promise<ApolloEnrichedPerson | null> {
  const revealRequested = Boolean(input.revealPhoneNumber);
  const revealMode = revealRequested ? getPhoneRevealMode() : "off";
  const revealPhoneNumber = revealMode !== "off";
  const webhookUrl = revealMode === "webhook" ? buildApolloWebhookUrl() : null;
  const payload = buildApolloMatchPayload(input, {
    revealPhoneNumber,
    pollOnly: revealMode === "poll",
    webhookUrl,
  });

  if (!payload.id && !payload.linkedin_url && !(payload.name && (payload.organization_name || payload.domain))) {
    throw new ApolloServiceError(
      400,
      "Apollo enrichment needs a valid Apollo contact id, LinkedIn URL, or contact name with company details.",
    );
  }

  let response = await apolloRequest(
    PEOPLE_MATCH_PATH,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    { timeoutMs: revealPhoneNumber ? PHONE_REVEAL_TIMEOUT_MS : APOLLO_TIMEOUT_MS },
  );

  let person = response?.person || response?.matched_person || null;
  let extractedPhone = extractPhone(person);
  let requestId = isValidApolloRequestId(response?.request_id)
    ? String(response.request_id)
    : null;
  if (!requestId && isValidApolloRequestId(response?.requestId)) {
    requestId = String(response.requestId);
  }

  let phoneStatus: ApolloPhoneStatus = "not_requested";
  if (extractedPhone.phone) {
    phoneStatus = "found";
  } else if (revealMode === "poll" && requestId) {
    const polled = await pollApolloWebhookResult(requestId);
    response = polled.response || response;
    person = polled.person || person;
    extractedPhone = extractPhone(person);
    phoneStatus = extractedPhone.phone ? "found" : polled.timedOut ? "timeout" : "unavailable";
  } else if (revealMode === "webhook") {
    phoneStatus = "pending";
  } else if (revealPhoneNumber) {
    phoneStatus = "unavailable";
  }

  const mapped = mapPerson(person, "match");
  if (!mapped) return null;

  if (phoneStatus === "pending" && input.actor) {
    rememberApolloPhoneReveal({
      requestId: requestId || `apollo-${mapped.apolloPersonId}`,
      apolloPersonId: mapped.apolloPersonId,
      userId: input.actor.userId,
      companyId: input.actor.companyId,
      phone: null,
      phoneType: null,
      status: "pending",
    });
  } else if (phoneStatus === "found" && input.actor) {
    rememberApolloPhoneReveal({
      requestId: requestId || `apollo-${mapped.apolloPersonId}`,
      apolloPersonId: mapped.apolloPersonId,
      userId: input.actor.userId,
      companyId: input.actor.companyId,
      phone: extractedPhone.phone,
      phoneType: extractedPhone.type,
      status: "found",
    });
  }

  logApolloEvent("info", "enrichment result", {
    found: true,
    hasWorkEmail: Boolean(mapped.workEmail),
    hasPhone: Boolean(extractedPhone.phone),
    phoneStatus,
    revealMode,
    hasRequestId: Boolean(requestId),
  });

  return {
    ...mapped,
    phone: extractedPhone.phone,
    phoneType: extractedPhone.type,
    emailStatus:
      stringOrNull(person?.email_status) ||
      stringOrNull(person?.work_email_status) ||
      stringOrNull(response?.email_status),
    requestId: requestId || (phoneStatus === "pending" ? `apollo-${mapped.apolloPersonId}` : null),
    phoneStatus,
  };
}

export function toApolloErrorResponse(error: unknown) {
  if (error instanceof ApolloServiceError) {
    return { status: error.statusCode, message: error.userMessage, meta: error.meta };
  }
  return { status: 502, message: "Unable to fetch Apollo data right now." };
}
