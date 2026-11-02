import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyRowResolutions,
  parseRowResolutions,
  suggestCompanyFromEmail,
} from "./import-row-resolutions";
import type { LeadImportPreviewRow } from "./lead-import-core";

function row(overrides: Partial<LeadImportPreviewRow> = {}): LeadImportPreviewRow {
  return {
    rowNumber: 2,
    companyName: "",
    contactName: "Jane Doe",
    contactTitle: "CEO",
    linkedInUrl: "",
    contactEmail: "jane@acme.com",
    status: "invalid",
    reasons: ["Company Name missing", "Contact cannot be created without a parent company"],
    ...overrides,
  };
}

test("email domain suggestions never invent names or use public mail hosts", () => {
  assert.equal(suggestCompanyFromEmail("jane@acme.com"), "acme.com");
  assert.equal(suggestCompanyFromEmail("jane@gmail.com"), null);
  assert.equal(suggestCompanyFromEmail("not-an-email"), null);
});

test("invalid resolution payloads are ignored", () => {
  const parsed = parseRowResolutions({
    2: { action: "create_company", companyName: "Acme" },
    3: { action: "assign_existing" },
    4: { action: "explode", companyName: "Nope" },
    leadId: 99,
  });
  assert.deepEqual(parsed, { "2": { action: "create_company", companyName: "Acme" } });
});

test("assign existing company stays tenant-scoped and never trusts a client lead id", () => {
  const previewed = applyRowResolutions({
    rows: [row()],
    resolutions: { "2": { action: "assign_existing", companyName: "Acme", ...( { leadId: 999 } as any) } },
    existing: [{ leadId: 501, companyName: "acme", contactName: "old", email: "", linkedIn: "" }],
  });
  assert.equal(previewed[0].status, "existing_company_new_contact");
  assert.equal(previewed[0].existingLeadId, 501);
  assert.equal(previewed[0].companyName, "Acme");
});

test("assign existing rejects companies that are not in the current tenant records", () => {
  const previewed = applyRowResolutions({
    rows: [row()],
    resolutions: { "2": { action: "assign_existing", companyName: "Other Tenant Co" } },
    existing: [{ leadId: 501, companyName: "acme", contactName: "old", email: "", linkedIn: "" }],
  });
  assert.equal(previewed[0].status, "invalid");
  assert.match(previewed[0].reasons.join(" "), /No company named/);
});

test("create company uses the typed name and can reuse one company for multiple contacts", () => {
  const previewed = applyRowResolutions({
    rows: [
      row({ rowNumber: 2, contactName: "Jane" }),
      row({ rowNumber: 3, contactName: "John", contactEmail: "john@acme.com" }),
    ],
    resolutions: {
      "2": { action: "create_company", companyName: "Acme North" },
      "3": { action: "create_company", companyName: "Acme North" },
    },
    existing: [],
  });
  assert.equal(previewed[0].status, "new");
  assert.equal(previewed[1].status, "new");
  assert.equal(previewed[0].companyName, "Acme North");
  assert.equal(previewed[1].companyName, "Acme North");
});

test("skip keeps the row with a clear explanation", () => {
  const previewed = applyRowResolutions({
    rows: [row()],
    resolutions: { "2": { action: "skip" } },
    existing: [],
  });
  assert.equal(previewed[0].status, "invalid");
  assert.equal(previewed[0].reasons[0], "Skipped by user");
});
