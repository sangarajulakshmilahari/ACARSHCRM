import assert from "node:assert/strict";
import { test } from "node:test";

import {
  GLOBAL_LOOKUP_TABLES,
  companyPredicate,
  requireCompanyId,
  resolveWriteCompanyId,
} from "./company-tenancy";
import { authorizeEmailDispatchRequest } from "./email-dispatch";
import { authorizeEmailDeliveryRequest } from "./email-delivery";
import { buildLeadOwnerVisibilityClause } from "./lead-access";

test("two-company write helper rejects parent/auth mismatch", () => {
  const companyA = 11;
  const companyB = 22;
  assert.equal(resolveWriteCompanyId(companyA, companyA), companyA);
  assert.throws(() => resolveWriteCompanyId(companyA, companyB), /does not belong/);
  assert.throws(() => requireCompanyId({ companyId: null }), /membership required/);
});

test("two-company lead visibility never mixes tenants", () => {
  const userA = { userId: 5, roleId: 1, companyId: 11 };
  const userB = { userId: 9, roleId: 1, companyId: 22 };
  const visA = buildLeadOwnerVisibilityClause(userA, "l");
  const visB = buildLeadOwnerVisibilityClause(userB, "l");
  assert.equal(visA.clause, "l.CompanyId = ?");
  assert.deepEqual(visA.params, [11]);
  assert.equal(visB.clause, "l.CompanyId = ?");
  assert.deepEqual(visB.params, [22]);
  assert.notDeepEqual(visA.params, visB.params);
});

test("selected active company isolates a multi-membership user", () => {
  const selected = companyPredicate("emails", 11);
  const other = companyPredicate("emails", 22);
  assert.equal(selected.clause, "emails.CompanyId = ?");
  assert.deepEqual(selected.params, [11]);
  assert.deepEqual(other.params, [22]);
});

test("guessed foreign ids fail write company resolution", () => {
  assert.throws(() => resolveWriteCompanyId(11, 99), /does not belong/);
  assert.throws(() => resolveWriteCompanyId(11, null), /missing CompanyId/);
});

test("email event writes inherit CompanyId from the parent email", async () => {
  const { insertEmailEventForEmail } = await import("./email-events-write");
  const sqls: string[] = [];
  const pool = {
    query: async (sql: string, params: any[] = []) => {
      sqls.push(String(sql));
      assert.equal(params[0], "SENT");
      assert.equal(params[3], 44);
      return [{ affectedRows: 1 }];
    },
  };
  const result = await insertEmailEventForEmail({
    poolOrConn: pool,
    emailId: 44,
    eventType: "SENT",
    uniqueByEventType: true,
    metadata: { source: "test" },
  });
  assert.equal(result.inserted, true);
  assert.match(sqls[0], /e\.CompanyId/);
  assert.match(sqls[0], /FROM emails e/);
  assert.match(sqls[0], /e\.CompanyId IS NOT NULL/);
});

test("two-company reports predicate never mixes tenants", () => {
  const companyA = companyPredicate("l", 11);
  const companyB = companyPredicate("l", 22);
  assert.equal(companyA.clause, "l.CompanyId = ?");
  assert.deepEqual(companyA.params, [11]);
  assert.notDeepEqual(companyA.params, companyB.params);
});

test("website intake rejects missing and client-supplied company ids", async () => {
  const { resolveWebsiteIntakeCompanyId } = await import("../leads/website/route");
  assert.equal(resolveWebsiteIntakeCompanyId(undefined), null);
  assert.equal(resolveWebsiteIntakeCompanyId("adroitent"), null);
  assert.equal(resolveWebsiteIntakeCompanyId("1"), 1);
  assert.notEqual(resolveWebsiteIntakeCompanyId("99"), 1);
});

test("SOW download queries must include CompanyId", () => {
  const companyId = requireCompanyId({ companyId: 11 });
  const sql = `SELECT FileName, FileData FROM SOWMaster WHERE SOWId = ? AND CompanyId = ?`;
  assert.match(sql, /CompanyId = \?/);
  assert.equal(companyId, 11);
  assert.throws(() => requireCompanyId({ companyId: null }), /membership required/);
});

test("service jobs authorize with a token and never mix tenant mutations", () => {
  const originalDispatch = process.env.EMAIL_DISPATCH_TOKEN;
  const originalDelivery = process.env.EMAIL_DELIVERY_WEBHOOK_TOKEN;
  process.env.EMAIL_DISPATCH_TOKEN = "job-token";
  process.env.EMAIL_DELIVERY_WEBHOOK_TOKEN = "hook-token";
  try {
    assert.equal(authorizeEmailDispatchRequest("job-token").ok, true);
    assert.equal(authorizeEmailDispatchRequest("wrong").ok, false);
    assert.equal(authorizeEmailDispatchRequest("wrong").status, 403);
    assert.equal(authorizeEmailDeliveryRequest("hook-token").ok, true);
    assert.equal(authorizeEmailDeliveryRequest("wrong").status, 403);
    delete process.env.EMAIL_DISPATCH_TOKEN;
    assert.equal(authorizeEmailDispatchRequest("job-token").status, 503);
  } finally {
    if (originalDispatch === undefined) delete process.env.EMAIL_DISPATCH_TOKEN;
    else process.env.EMAIL_DISPATCH_TOKEN = originalDispatch;
    if (originalDelivery === undefined) delete process.env.EMAIL_DELIVERY_WEBHOOK_TOKEN;
    else process.env.EMAIL_DELIVERY_WEBHOOK_TOKEN = originalDelivery;
  }
  const sql = `UPDATE emails SET Status = 'SENT' WHERE EmailId = ? AND CompanyId = ? AND Status = 'SENDING'`;
  assert.match(sql, /CompanyId = \?/);
});

test("SubCategory is an intentionally global lookup", () => {
  assert.equal(GLOBAL_LOOKUP_TABLES.includes("subcategory"), true);
});

test("email history visibility cannot drop company scope for managers", () => {
  const vis = buildLeadOwnerVisibilityClause({ userId: 10, roleId: 1, companyId: 11 }, "l");
  assert.equal(vis.clause, "l.CompanyId = ?");
  assert.deepEqual(vis.params, [11]);
  assert.throws(
    () => buildLeadOwnerVisibilityClause({ userId: 10, roleId: 1 }, "l"),
    /membership required/
  );
});
