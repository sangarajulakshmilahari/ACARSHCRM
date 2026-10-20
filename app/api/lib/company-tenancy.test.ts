import assert from "node:assert/strict";
import { test } from "node:test";

import {
  andSql,
  companyPredicate,
  pickDefaultMembership,
  requireCompanyId,
  resolveActiveMembership,
  resolveWriteCompanyId,
  roleIdForTenantScope,
  selectRequestedMembership,
  shouldShowCompanySelector,
} from "./company-tenancy";
import { buildLeadOwnerVisibilityClause } from "./lead-access";

test("pickDefaultMembership prefers the default active company", () => {
  const picked = pickDefaultMembership([
    { companyId: 2, roleId: 2, isDefault: false, isActive: true },
    { companyId: 5, roleId: 1, isDefault: true, isActive: true },
  ]);
  assert.equal(picked?.companyId, 5);
  assert.equal(picked?.roleId, 1);
});

test("single Adroitent membership hides the selector and stays on Adroitent", () => {
  const memberships = [
    { companyId: 11, roleId: 1, isDefault: true, isActive: true, companyName: "Adroitent" },
  ];
  assert.equal(shouldShowCompanySelector(memberships), false);
  assert.equal(resolveActiveMembership(memberships, 22)?.companyId, 11);
  assert.equal(resolveActiveMembership(memberships, null)?.companyName, "Adroitent");
});

test("single Locominds membership hides the selector and stays on Locominds", () => {
  const memberships = [
    { companyId: 22, roleId: 2, isDefault: true, isActive: true, companyName: "Locominds" },
  ];
  assert.equal(shouldShowCompanySelector(memberships), false);
  assert.equal(resolveActiveMembership(memberships, 11)?.companyId, 22);
});

test("dual membership shows the selector and honors an explicit switch", () => {
  const memberships = [
    { companyId: 11, roleId: 1, isDefault: true, isActive: true, companyName: "Adroitent" },
    { companyId: 22, roleId: 1, isDefault: false, isActive: true, companyName: "Locominds" },
  ];
  assert.equal(shouldShowCompanySelector(memberships), true);
  assert.equal(resolveActiveMembership(memberships, null)?.companyId, 11);
  assert.equal(resolveActiveMembership(memberships, 22)?.companyId, 22);
  assert.equal(selectRequestedMembership(memberships, 22).ok, true);
});

test("switching to a company without membership is rejected", () => {
  const memberships = [
    { companyId: 11, roleId: 1, isDefault: true, isActive: true, companyName: "Adroitent" },
  ];
  const result = selectRequestedMembership(memberships, 22);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "NOT_A_MEMBER");
});

test("no valid memberships fail closed", () => {
  assert.equal(resolveActiveMembership([], 11), null);
  const result = selectRequestedMembership([], 11);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "NO_MEMBERSHIP");
});

test("companyPredicate fails closed without a company", () => {
  assert.throws(() => companyPredicate("l", null), /membership required/);
  assert.throws(() => companyPredicate("l", 0), /membership required/);
  assert.deepEqual(companyPredicate("l", 9), { clause: "l.CompanyId = ?", params: [9] });
});

test("andSql combines tenant and owner predicates", () => {
  const combined = andSql([
    companyPredicate("l", 3),
    { clause: "l.OwnerId = ?", params: [44] },
  ]);
  assert.equal(combined.clause, "(l.CompanyId = ?) AND (l.OwnerId = ?)");
  assert.deepEqual(combined.params, [3, 44]);
});

test("roleIdForTenantScope uses membership role when company matches", () => {
  const membership = { companyId: 3, roleId: 2, isDefault: true, isActive: true };
  assert.equal(roleIdForTenantScope({ userId: 1, roleId: 1, companyId: 3 }, membership), 2);
  assert.equal(roleIdForTenantScope({ userId: 1, roleId: 1, companyId: 9 }, membership), 1);
});

test("loadActiveCompanyId requires an active Companies row", async () => {
  const { loadActiveCompanyId } = await import("./company-tenancy");
  const missing = {
    query: async () => [[]],
  };
  const found = {
    query: async (_sql: string, params: any[] = []) => {
      assert.equal(params[0], 11);
      return [[{ CompanyId: 11 }]];
    },
  };
  assert.equal(await loadActiveCompanyId(missing, 11), null);
  assert.equal(await loadActiveCompanyId(found, 11), 11);
  assert.equal(await loadActiveCompanyId(found, null), null);
});

test("resolveWriteCompanyId uses parent company and rejects mismatches", () => {
  assert.equal(resolveWriteCompanyId(7, 7), 7);
  assert.equal(resolveWriteCompanyId(null, 7), 7);
  assert.throws(() => resolveWriteCompanyId(7, 9), /does not belong/);
  assert.throws(() => requireCompanyId({ companyId: null }), /membership required/);
  assert.equal(requireCompanyId({ companyId: 3 }), 3);
});

test("lead visibility fails closed without companyId and filters when present", () => {
  assert.throws(
    () => buildLeadOwnerVisibilityClause({ userId: 10, roleId: 1 }),
    /membership required/
  );

  const afterMigration = buildLeadOwnerVisibilityClause({ userId: 10, roleId: 1, companyId: 7 });
  assert.equal(afterMigration.clause, "l.CompanyId = ?");
  assert.deepEqual(afterMigration.params, [7]);
});
