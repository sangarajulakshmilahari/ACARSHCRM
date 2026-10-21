import { andSql, companyPredicate } from "@/app/api/lib/company-tenancy";

export type AuthUserScope = {
  userId: number;
  roleId: number;
  companyId?: number | null;
};

export function hasGlobalLeadAccess(roleId: number): boolean {
  return roleId === 1 || roleId === 3;
}

export function buildLeadOwnerVisibilityClause(
  authUser: AuthUserScope,
  leadTableAlias = "l"
): { clause: string; params: number[] } {
  const tenant = companyPredicate(leadTableAlias, authUser.companyId);

  if (hasGlobalLeadAccess(authUser.roleId)) {
    return tenant;
  }

  const ownerColumn = `${leadTableAlias}.OwnerId`;
  const ownerScope = {
    clause: `(${ownerColumn} = ? OR ${ownerColumn} IN (
      SELECT ula.allowed_user_id
      FROM user_lead_access ula
      WHERE ula.user_id = ?
    ))`,
    params: [authUser.userId, authUser.userId],
  };

  return andSql([tenant, ownerScope]);
}

export async function canUserViewLeadById(
  poolOrConn: any,
  authUser: AuthUserScope,
  leadId: number
): Promise<boolean> {
  const visibility = buildLeadOwnerVisibilityClause(authUser, "l");
  const [rows]: any = await poolOrConn.query(
    `
    SELECT 1
    FROM Leads l
    WHERE l.LeadId = ?
      AND ${visibility.clause}
    LIMIT 1
    `,
    [leadId, ...visibility.params]
  );

  return Array.isArray(rows) && rows.length > 0;
}
