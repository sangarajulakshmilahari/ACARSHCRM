export type CompanyMembership = {
  companyId: number;
  roleId: number;
  isDefault: boolean;
  isActive: boolean;
  companyName?: string;
};

export const ACTIVE_COMPANY_COOKIE = "acarsh_active_company_id";

export type TenantScopedUser = {
  userId: number;
  roleId: number;
  companyId?: number | null;
};

export function pickDefaultMembership(
  memberships: CompanyMembership[]
): CompanyMembership | null {
  const active = memberships.filter((row) => row.isActive && row.companyId > 0);
  if (active.length === 0) return null;
  return active.find((row) => row.isDefault) ?? active[0];
}

export function parseRequestedCompanyId(raw: unknown): number | null {
  const companyId = Number(raw);
  if (!Number.isInteger(companyId) || companyId <= 0) return null;
  return companyId;
}

export function activeMemberships(memberships: CompanyMembership[]): CompanyMembership[] {
  return memberships.filter((row) => row.isActive && row.companyId > 0);
}

export function resolveActiveMembership(
  memberships: CompanyMembership[],
  requestedCompanyId?: number | null
): CompanyMembership | null {
  const active = activeMemberships(memberships);
  if (active.length === 0) return null;
  const requested = parseRequestedCompanyId(requestedCompanyId);
  if (requested) {
    const match = active.find((row) => row.companyId === requested);
    if (match) return match;
  }
  return pickDefaultMembership(active);
}

export function selectRequestedMembership(
  memberships: CompanyMembership[],
  requestedCompanyId: number | null
):
  | { ok: true; membership: CompanyMembership }
  | { ok: false; reason: "NO_MEMBERSHIP" | "NOT_A_MEMBER" | "INVALID_COMPANY" } {
  const active = activeMemberships(memberships);
  if (active.length === 0) return { ok: false, reason: "NO_MEMBERSHIP" };
  const requested = parseRequestedCompanyId(requestedCompanyId);
  if (!requested) return { ok: false, reason: "INVALID_COMPANY" };
  const match = active.find((row) => row.companyId === requested);
  if (!match) return { ok: false, reason: "NOT_A_MEMBER" };
  return { ok: true, membership: match };
}

export function shouldShowCompanySelector(memberships: CompanyMembership[]): boolean {
  return activeMemberships(memberships).length > 1;
}

export const POST_LOGIN_DASHBOARD_PATH = "/webpage";
export const COMPANY_SELECTION_PATH = "/select-company";

export type PostLoginDestination =
  | { kind: "dashboard"; companyId: number; path: typeof POST_LOGIN_DASHBOARD_PATH }
  | { kind: "select-company"; path: typeof COMPANY_SELECTION_PATH }
  | { kind: "access-denied"; path: typeof COMPANY_SELECTION_PATH };

export function isSafePostLoginPath(path: string): boolean {
  return path === POST_LOGIN_DASHBOARD_PATH || path === COMPANY_SELECTION_PATH;
}

export function resolveBrowserRedirectOrigin(requestUrl: string, forwardedHost?: string | null): string {
  const url = new URL(requestUrl);
  const hostHeader = String(forwardedHost || "").split(",")[0].trim();
  const host = hostHeader || url.host;
  const hostname = host.split(":")[0].replace(/^\[|\]$/g, "");
  const portFromHost = host.includes(":") ? host.slice(host.indexOf(":") + 1) : "";
  const port = portFromHost || url.port;
  const protocol = (url.protocol || "http:").replace(":", "") || "http";
  const safeHost = hostname === "0.0.0.0" || hostname === "::" || hostname === "[::]" ? "localhost" : hostname;
  const omitPort =
    !port ||
    (protocol === "http" && port === "80") ||
    (protocol === "https" && port === "443");
  return `${protocol}://${safeHost}${omitPort ? "" : `:${port}`}`;
}

export function resolvePostLoginDestination(input: {
  memberships: CompanyMembership[];
  selectedCompanyId?: number | null;
}): PostLoginDestination {
  const active = activeMemberships(input.memberships);
  if (active.length === 0) {
    return { kind: "access-denied", path: COMPANY_SELECTION_PATH };
  }
  if (active.length === 1) {
    return { kind: "dashboard", companyId: active[0].companyId, path: POST_LOGIN_DASHBOARD_PATH };
  }
  const selected = resolveActiveMembership(active, input.selectedCompanyId);
  const requested = parseRequestedCompanyId(input.selectedCompanyId);
  if (requested && selected && selected.companyId === requested) {
    return { kind: "dashboard", companyId: selected.companyId, path: POST_LOGIN_DASHBOARD_PATH };
  }
  return { kind: "select-company", path: COMPANY_SELECTION_PATH };
}

export function resolveCompanySelectionPage(memberships: CompanyMembership[]): {
  kind: "redirect-dashboard" | "select" | "access-denied";
  companies: ReturnType<typeof membershipsForClient>;
} {
  const companies = membershipsForClient(memberships);
  if (companies.length === 0) return { kind: "access-denied", companies };
  if (companies.length === 1) return { kind: "redirect-dashboard", companies };
  return { kind: "select", companies };
}

export function selectionRequestLock(inFlightId: number | null, nextId: number): boolean {
  if (inFlightId != null) return false;
  return Number.isInteger(nextId) && nextId > 0;
}

export function membershipsForClient(memberships: CompanyMembership[]): Array<{
  companyId: number;
  companyName: string;
  roleId: number;
  isDefault: boolean;
}> {
  return activeMemberships(memberships).map((row) => ({
    companyId: row.companyId,
    companyName: String(row.companyName || "").trim() || `Company ${row.companyId}`,
    roleId: row.roleId,
    isDefault: row.isDefault,
  }));
}

export function roleIdForTenantScope(user: TenantScopedUser, membership: CompanyMembership | null): number {
  if (membership && membership.companyId === user.companyId) {
    return membership.roleId;
  }
  return user.roleId;
}

export function companyPredicate(
  tableAlias: string,
  companyId: number | null | undefined
): { clause: string; params: number[] } {
  const scopedCompanyId = Number(companyId);
  if (!Number.isInteger(scopedCompanyId) || scopedCompanyId <= 0) {
    throw new CompanyRequiredError();
  }
  return {
    clause: `${tableAlias}.CompanyId = ?`,
    params: [scopedCompanyId],
  };
}

export function andSql(parts: Array<{ clause: string; params: number[] }>): {
  clause: string;
  params: number[];
} {
  // 1=1 is only for non-tenant optional fragments. Tenant predicates must use companyPredicate().
  const used = parts.filter((part) => part.clause && part.clause !== "1=1");
  if (used.length === 0) {
    return { clause: "1=1", params: [] };
  }
  return {
    clause: used.map((part) => `(${part.clause})`).join(" AND "),
    params: used.flatMap((part) => part.params),
  };
}

export class CompanyRequiredError extends Error {
  constructor(message = "Company membership required") {
    super(message);
    this.name = "CompanyRequiredError";
  }
}

export class CompanyMismatchError extends Error {
  constructor(message = "Record does not belong to the active company") {
    super(message);
    this.name = "CompanyMismatchError";
  }
}

const COMPANY_ID_SOURCES: Record<string, { table: string; idColumn: string }> = {
  lead: { table: "leads", idColumn: "LeadId" },
  contact: { table: "leadcontacts", idColumn: "LeadContactID" },
  opportunity: { table: "opportunities", idColumn: "OpportunityId" },
  project: { table: "projects", idColumn: "ProjectId" },
  email: { table: "emails", idColumn: "EmailId" },
  sequence: { table: "email_sequences", idColumn: "SequenceId" },
  template: { table: "email_templates", idColumn: "TemplateId" },
  conversation: { table: "aichatconversations", idColumn: "ConversationId" },
  sow: { table: "sowmaster", idColumn: "SOWId" },
};

export function requireCompanyId(user: { companyId?: number | null }): number {
  const companyId = Number(user.companyId);
  if (!Number.isInteger(companyId) || companyId <= 0) {
    throw new CompanyRequiredError();
  }
  return companyId;
}

/**
 * CompanyId taken from a stored parent row for token-authenticated service jobs
 * (email dispatch, delivery webhooks, reply sync). These jobs must not require
 * an interactive user membership, and must not trust a client-supplied company.
 */
export function requireStoredCompanyId(value: unknown): number {
  const companyId = Number(value);
  if (!Number.isInteger(companyId) || companyId <= 0) {
    throw new CompanyRequiredError("Record is missing CompanyId");
  }
  return companyId;
}

/** Shared catalog tables with no CompanyId. Do not tenant-scope these lookups. */
export const GLOBAL_LOOKUP_TABLES = ["subcategory", "SubCategory"] as const;

export function resolveWriteCompanyId(
  authCompanyId: number | null | undefined,
  parentCompanyId: number | null | undefined
): number {
  const parentId = Number(parentCompanyId);
  if (!Number.isInteger(parentId) || parentId <= 0) {
    throw new CompanyRequiredError("Parent record is missing CompanyId");
  }
  if (authCompanyId != null && Number(authCompanyId) !== parentId) {
    throw new CompanyMismatchError();
  }
  return parentId;
}

export async function loadRecordCompanyId(
  poolOrConn: any,
  source: keyof typeof COMPANY_ID_SOURCES,
  recordId: number | string
): Promise<number | null> {
  const spec = COMPANY_ID_SOURCES[source];
  const [rows]: any = await poolOrConn.query(
    `SELECT CompanyId FROM \`${spec.table}\` WHERE \`${spec.idColumn}\` = ? LIMIT 1`,
    [recordId]
  );
  const companyId = Number(rows?.[0]?.CompanyId);
  return Number.isInteger(companyId) && companyId > 0 ? companyId : null;
}

export async function loadActiveCompanyId(
  poolOrConn: any,
  companyId: number | null | undefined
): Promise<number | null> {
  const scopedCompanyId = Number(companyId);
  if (!Number.isInteger(scopedCompanyId) || scopedCompanyId <= 0) {
    return null;
  }
  const [rows]: any = await poolOrConn.query(
    `SELECT CompanyId FROM Companies WHERE CompanyId = ? AND IsActive = 1 LIMIT 1`,
    [scopedCompanyId]
  );
  const found = Number(rows?.[0]?.CompanyId);
  return Number.isInteger(found) && found > 0 ? found : null;
}

export async function loadCompanyMemberships(
  poolOrConn: any,
  userId: number
): Promise<CompanyMembership[]> {
  const [rows]: any = await poolOrConn.query(
    `
    SELECT
      cu.CompanyId,
      cu.RoleId,
      cu.IsDefault,
      cu.IsActive,
      c.CompanyName
    FROM CompanyUsers cu
    INNER JOIN Companies c
      ON c.CompanyId = cu.CompanyId
     AND c.IsActive = 1
    WHERE cu.UserId = ?
      AND cu.IsActive = 1
    ORDER BY cu.IsDefault DESC, cu.CompanyUserId ASC
    `,
    [userId]
  );

  return (Array.isArray(rows) ? rows : []).map((row: any) => ({
    companyId: Number(row.CompanyId),
    roleId: Number(row.RoleId),
    isDefault: Number(row.IsDefault) === 1,
    isActive: Number(row.IsActive) === 1,
    companyName: String(row.CompanyName || "").trim() || undefined,
  }));
}
