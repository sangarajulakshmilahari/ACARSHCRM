import assert from "node:assert/strict";
import { test } from "node:test";

import { listWorkbookSheets, parseSpreadsheetTable } from "./excel-parser";

function workbookBuffer(sheets: Record<string, Array<Array<string>>>) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require("xlsx") as typeof import("xlsx");
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
}

test("listWorkbookSheets reports every worksheet independently", () => {
  const fileBuffer = workbookBuffer({
    Contacts: [
      ["Company Name", "Contact Name"],
      ["Acme", "Jane"],
    ],
    Summary: [["Total", "Count"], ["2", "2"]],
    Empty: [[" "]],
  });
  const sheets = listWorkbookSheets({ fileName: "clients.xlsx", fileBuffer });
  assert.equal(sheets.map((sheet) => sheet.name).join(","), "Contacts,Summary,Empty");
  assert.equal(sheets.find((sheet) => sheet.name === "Contacts")?.importable, true);
  assert.equal(sheets.find((sheet) => sheet.name === "Summary")?.likelyReferenceSheet, true);
  assert.equal(sheets.find((sheet) => sheet.name === "Empty")?.importable, false);
});

test("parseSpreadsheetTable can import a non-first worksheet with different headers", () => {
  const fileBuffer = workbookBuffer({
    Overview: [["Notes"], ["Do not import"]],
    ClientA: [
      ["Organization", "Person", "Email"],
      ["Globex", "Sam", "sam@globex.com"],
    ],
  });
  const first = parseSpreadsheetTable({ fileName: "clients.xlsx", fileBuffer });
  assert.equal(first.sheetName, "Overview");
  const selected = parseSpreadsheetTable({ fileName: "clients.xlsx", fileBuffer, sheetName: "ClientA" });
  assert.equal(selected.sheetName, "ClientA");
  assert.equal(selected.rows[0]?.Organization, "Globex");
  assert.equal(selected.columns.includes("Email"), true);
});

test("missing and empty worksheets fail closed", () => {
  const fileBuffer = workbookBuffer({
    Contacts: [
      ["Company Name", "Contact Name"],
      ["Acme", "Jane"],
    ],
    Empty: [[" "]],
  });
  assert.throws(
    () => parseSpreadsheetTable({ fileName: "clients.xlsx", fileBuffer, sheetName: "Missing" }),
    /not found/i,
  );
  assert.throws(
    () => parseSpreadsheetTable({ fileName: "clients.xlsx", fileBuffer, sheetName: "Empty" }),
    /empty or has no usable tabular data/i,
  );
});
