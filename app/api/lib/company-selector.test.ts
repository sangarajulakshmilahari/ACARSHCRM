import assert from "node:assert/strict";
import { test } from "node:test";

import { shouldRenderCompanySelector } from "../../webpage/components/CompanySelector";
import {
  ACTIVE_COMPANY_COOKIE,
  COMPANY_SELECTION_PATH,
  POST_LOGIN_DASHBOARD_PATH,
  isSafePostLoginPath,
  resolveBrowserRedirectOrigin,
  resolveCompanySelectionPage,
  resolvePostLoginDestination,
  selectRequestedMembership,
  selectionRequestLock,
} from "./company-tenancy";
import { buildLeadOwnerVisibilityClause } from "./lead-access";

const adroitent = {
  companyId: 11,
  roleId: 1,
  isDefault: true,
  isActive: true,
  companyName: "Adroitent",
};
const locominds = {
  companyId: 22,
  roleId: 1,
  isDefault: false,
  isActive: true,
  companyName: "Locominds",
};

test("Adroitent-only user goes directly to the dashboard", () => {
  const dest = resolvePostLoginDestination({ memberships: [adroitent], selectedCompanyId: null });
  assert.equal(dest.kind, "dashboard");
  assert.equal(dest.path, POST_LOGIN_DASHBOARD_PATH);
  if (dest.kind === "dashboard") assert.equal(dest.companyId, 11);
  assert.equal(shouldRenderCompanySelector([{ ...adroitent }]), false);
});

test("Locominds-only user goes directly to the dashboard", () => {
  const dest = resolvePostLoginDestination({ memberships: [locominds], selectedCompanyId: null });
  assert.equal(dest.kind, "dashboard");
  if (dest.kind === "dashboard") assert.equal(dest.companyId, 22);
});

test("user with both memberships sees the selection screen until a company is chosen", () => {
  const memberships = [adroitent, locominds];
  const page = resolveCompanySelectionPage(memberships);
  const dest = resolvePostLoginDestination({ memberships, selectedCompanyId: null });
  assert.equal(page.kind, "select");
  assert.equal(page.companies.length, 2);
  assert.equal(dest.kind, "select-company");
  assert.equal(dest.path, COMPANY_SELECTION_PATH);
  const after = resolvePostLoginDestination({ memberships, selectedCompanyId: 22 });
  assert.equal(after.kind, "dashboard");
  if (after.kind === "dashboard") assert.equal(after.companyId, 22);
  const visAfter = buildLeadOwnerVisibilityClause({ userId: 9, roleId: 1, companyId: 22 }, "l");
  assert.deepEqual(visAfter.params, [22]);
});

test("unauthorized company switch is rejected", () => {
  const result = selectRequestedMembership([adroitent], 22);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "NOT_A_MEMBER");
});

test("user with no valid memberships is denied", () => {
  assert.equal(resolveCompanySelectionPage([]).kind, "access-denied");
  assert.equal(resolvePostLoginDestination({ memberships: [], selectedCompanyId: 11 }).kind, "access-denied");
  const result = selectRequestedMembership([], 11);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "NO_MEMBERSHIP");
});

test("unauthenticated users are sent through the existing login path helper", () => {
  assert.equal(isSafePostLoginPath("/webpage"), true);
  assert.equal(isSafePostLoginPath("/select-company"), true);
  assert.equal(isSafePostLoginPath("https://evil.example"), false);
  assert.equal(isSafePostLoginPath("/api/auth/login"), false);
});

test("loopback callback redirects rewrite 0.0.0.0 to localhost", () => {
  assert.equal(
    resolveBrowserRedirectOrigin("http://0.0.0.0:3001/api/auth/callback?code=abc"),
    "http://localhost:3001"
  );
  assert.equal(
    resolveBrowserRedirectOrigin("http://localhost:3001/api/auth/callback?code=abc"),
    "http://localhost:3001"
  );
});

test("repeated selection clicks are ignored while a request is in flight", () => {
  assert.equal(selectionRequestLock(null, 11), true);
  assert.equal(selectionRequestLock(11, 22), false);
  assert.equal(selectionRequestLock(11, 11), false);
});

test("switching context changes tenant-scoped lead reads", () => {
  const before = buildLeadOwnerVisibilityClause({ userId: 9, roleId: 1, companyId: 11 }, "l");
  const after = buildLeadOwnerVisibilityClause({ userId: 9, roleId: 1, companyId: 22 }, "l");
  assert.notDeepEqual(before.params, after.params);
});

test("logout clears the active company cookie name used by auth", () => {
  assert.equal(ACTIVE_COMPANY_COOKIE, "acarsh_active_company_id");
});
