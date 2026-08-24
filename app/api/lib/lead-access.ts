export type AuthUserScope = {
  userId: number;
  roleId: number;
};

export function hasGlobalLeadAccess(roleId: number): boolean {
  return roleId === 1 || roleId === 3;
}

export function buildLeadOwnerVisibilityClause(
  authUser: AuthUserScope,
  leadTableAlias = "l"
): { clause: string; params: number[] } {
  if (hasGlobalLeadAccess(authUser.roleId)) {
    return { clause: "1=1", params: [] };
  }

  const ownerColumn = `${leadTableAlias}.OwnerId`;

  return {
    clause: `(${ownerColumn} = ? OR ${ownerColumn} IN (
      SELECT ula.allowed_user_id
      FROM user_lead_access ula
      WHERE ula.user_id = ?
    ))`,
    params: [authUser.userId, authUser.userId],
  };
}

export async function canUserViewLeadById(
  poolOrConn: any,
  authUser: AuthUserScope,
  leadId: number
): Promise<boolean> {
  if (hasGlobalLeadAccess(authUser.roleId)) {
    return true;
  }

  const [rows]: any = await poolOrConn.query(
    `
    SELECT 1
    FROM Leads l
    WHERE l.LeadId = ?
      AND (
        l.OwnerId = ?
        OR l.OwnerId IN (
          SELECT ula.allowed_user_id
          FROM user_lead_access ula
          WHERE ula.user_id = ?
        )
      )
    LIMIT 1
    `,
    [leadId, authUser.userId, authUser.userId]
  );

  return Array.isArray(rows) && rows.length > 0;
}

