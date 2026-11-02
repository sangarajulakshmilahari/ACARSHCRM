import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyCustomFieldPreview,
  customFieldKey,
  parseCustomFieldValue,
  parseImportMapping,
  splitImportMapping,
  validateCustomFieldName,
} from "./custom-fields";
import { LeadImportStateError } from "./lead-import-core";

test("custom field names are normalized and cannot collide with standard fields", () => {
  assert.equal(customFieldKey(" Other  Information "), "other information");
  assert.equal(validateCustomFieldName("Address"), "Address");
  assert.throws(() => validateCustomFieldName("Company Name"), LeadImportStateError);
  assert.throws(() => validateCustomFieldName(" "), LeadImportStateError);
});

test("custom field values validate by type", () => {
  assert.equal(parseCustomFieldValue("number", "12").ok, true);
  assert.equal(parseCustomFieldValue("number", "abc").ok, false);
  assert.equal(parseCustomFieldValue("boolean", "Yes").ok, true);
  assert.equal(parseCustomFieldValue("boolean", "maybe").ok, false);
  assert.equal(parseCustomFieldValue("date", "2026-10-27").ok, true);
  assert.equal(parseCustomFieldValue("date", "not-a-date").ok, false);
  assert.equal(parseCustomFieldValue("text", "").ok, true);
});

test("import mapping split keeps standard fields separate from custom specs", () => {
  const mapping = parseImportMapping({
    "Company Name": "companyName",
    Address: { kind: "new", name: "Address", entityType: "lead", fieldType: "text" },
    SkipMe: "",
  });
  const split = splitImportMapping(mapping);
  assert.equal(split.standard["Company Name"], "companyName");
  assert.equal(split.custom.length, 1);
  assert.equal(split.custom[0]?.column, "Address");
});

test("invalid custom values mark otherwise valid preview rows as needing attention", () => {
  const rows = applyCustomFieldPreview(
    [{
      rowNumber: 2,
      companyName: "Acme",
      contactName: "Jane",
      contactTitle: "CEO",
      linkedInUrl: "",
      status: "new",
      reasons: [],
    }],
    [{ Headcount: "twelve" }],
    [{
      column: "Headcount",
      customFieldId: 3,
      fieldName: "Headcount",
      fieldKey: "headcount",
      entityType: "lead",
      fieldType: "number",
      isRequired: false,
      kind: "custom",
    }],
  );
  assert.equal(rows[0]?.status, "needs_attention");
  assert.equal(rows[0]?.customValues?.[0]?.valid, false);
});

test("contact custom fields without a parent contact need attention", () => {
  const rows = applyCustomFieldPreview(
    [{
      rowNumber: 2,
      companyName: "Acme",
      contactName: "",
      contactTitle: "",
      linkedInUrl: "",
      status: "new",
      reasons: [],
    }],
    [{ Nickname: "Jay" }],
    [{
      column: "Nickname",
      customFieldId: 4,
      fieldName: "Nickname",
      fieldKey: "nickname",
      entityType: "contact",
      fieldType: "text",
      isRequired: false,
      kind: "custom",
    }],
  );
  assert.equal(rows[0]?.status, "needs_attention");
  assert.match(rows[0]?.customValues?.[0]?.message || "", /no parent contact/i);
});
