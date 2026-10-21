import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildLeadOwnerVisibilityClause,
  canUserViewLeadById,
  hasGlobalLeadAccess,
} from "./lead-access";

test("global roles keep organization-wide lead visibility", () => {
  assert.equal(hasGlobalLeadAccess(1), true);
  assert.equal(hasGlobalLeadAccess(3), true);
  assert.equal(hasGlobalLeadAccess(2), false);

  const managerVisibility = buildLeadOwnerVisibilityClause(
    { userId: 10, roleId: 1, companyId: 11 },
    "l"
  );
  assert.equal(managerVisibility.clause, "l.CompanyId = ?");
  assert.deepEqual(managerVisibility.params, [11]);
});

test("sales visibility clause scopes to owner and delegated users", () => {
  const visibility = buildLeadOwnerVisibilityClause({ userId: 44, roleId: 2, companyId: 11 }, "l");
  assert.match(visibility.clause, /l\.OwnerId\s*=\s*\?/);
  assert.match(visibility.clause, /user_lead_access/);
  assert.deepEqual(visibility.params, [11, 44, 44]);
});

test("canUserViewLeadById enforces scoped access for non-global roles", async () => {
  const allowPool = {
    query: async () => [[{ 1: 1 }]],
  };
  const denyPool = {
    query: async () => [[]],
  };

  const allowed = await canUserViewLeadById(allowPool, { userId: 8, roleId: 2, companyId: 11 }, 201);
  const denied = await canUserViewLeadById(denyPool, { userId: 8, roleId: 2, companyId: 11 }, 202);

  assert.equal(allowed, true);
  assert.equal(denied, false);
});

