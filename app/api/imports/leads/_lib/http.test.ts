import assert from "node:assert/strict";
import { test } from "node:test";

import { CompanyRequiredError } from "@/app/api/lib/company-tenancy";
import { LeadImportAccessError, LeadImportStateError } from "@/app/api/lib/lead-import-core";
import { classifyImportFailure } from "./http";

test("missing LeadImports table is classified as 503 instead of a hidden 500", () => {
  const error = Object.assign(new Error("Table 'acarsh_db.leadimports' doesn't exist"), {
    code: "ER_NO_SUCH_TABLE",
    errno: 1146,
    sqlState: "42S02",
  });
  const classified = classifyImportFailure(error);
  assert.equal(classified.status, 503);
  assert.match(classified.error, /local import migration/i);
  assert.equal(/leadimports/i.test(classified.error), false);
});

test("missing custom-field tables are classified as 503", () => {
  const error = Object.assign(new Error("Table 'acarsh_db.customfielddefinitions' doesn't exist"), {
    code: "ER_NO_SUCH_TABLE",
    errno: 1146,
    sqlState: "42S02",
  });
  const classified = classifyImportFailure(error);
  assert.equal(classified.status, 503);
  assert.match(classified.error, /custom-fields migration/i);
});

test("tenant and validation failures stay fail-closed without leaking stack traces", () => {
  assert.equal(classifyImportFailure(new CompanyRequiredError()).status, 403);
  assert.equal(classifyImportFailure(new LeadImportAccessError()).status, 404);
  assert.equal(classifyImportFailure(new LeadImportStateError("Generate a preview before confirming this import.")).status, 409);
  const generic = classifyImportFailure(new Error("random failure"));
  assert.equal(generic.status, 500);
  assert.equal(generic.error, "Import request failed.");
});
