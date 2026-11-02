import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assignCombineMapping,
  combineColumnValues,
  combinedMappedValue,
  normalizeCombineMapping,
  removeCombineColumn,
  reorderCombineField,
} from "./column-combine";

test("First Name + Second Name become Contact Name with a single space", () => {
  assert.equal(combineColumnValues(["Steve", "Books"]), "Steve Books");
  assert.equal(combineColumnValues([" Steve ", "  Books "]), "Steve Books");
});

test("empty first or second names and null-like tokens are ignored", () => {
  assert.equal(combineColumnValues(["Steve", ""]), "Steve");
  assert.equal(combineColumnValues(["", "Books"]), "Books");
  assert.equal(combineColumnValues([null, "Books", undefined, "null"]), "Books");
  assert.equal(combineColumnValues(["undefined", "Steve"]), "Steve");
});

test("three or more columns combine in order and can be reordered or reduced", () => {
  let mapping: Record<string, unknown> = {};
  mapping = assignCombineMapping(mapping, "First Name", "contactName");
  mapping = assignCombineMapping(mapping, "Middle Name", "contactName");
  mapping = assignCombineMapping(mapping, "Last Name", "contactName");
  assert.deepEqual(mapping["First Name"], { kind: "combine", field: "contactName", order: 0 });
  assert.deepEqual(mapping["Last Name"], { kind: "combine", field: "contactName", order: 2 });
  const row = { "First Name": "Ada", "Middle Name": "Lovelace", "Last Name": "Byron" };
  assert.equal(combinedMappedValue(row, mapping, "contactName"), "Ada Lovelace Byron");
  mapping = reorderCombineField(mapping, "contactName", 2, 0);
  assert.equal(combinedMappedValue(row, mapping, "contactName"), "Byron Ada Lovelace");
  mapping = removeCombineColumn(mapping, "Middle Name");
  assert.equal(combinedMappedValue(row, mapping, "contactName"), "Byron Ada");
});

test("a leftover single column mapping stays a plain contactName string", () => {
  let mapping: Record<string, unknown> = {
    "First Name": { kind: "combine", field: "contactName", order: 0 },
    "Second Name": { kind: "combine", field: "contactName", order: 1 },
  };
  mapping = removeCombineColumn(mapping, "Second Name");
  assert.equal(mapping["First Name"], "contactName");
  assert.equal(normalizeCombineMapping({ "Contact Name": "contactName" })["Contact Name"], "contactName");
});
