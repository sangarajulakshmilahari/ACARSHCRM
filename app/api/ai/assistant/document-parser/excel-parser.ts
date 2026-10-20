function loadXlsx() {
  // Keep SheetJS out of the Next.js compile graph so the assistant route
  // does not crash while loading Excel files.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("xlsx") as typeof import("xlsx");
}

export type ParsedDocument = {
  fileName: string;
  fileType: "excel" | "pdf";
  summary: string;
  structured: Record<string, unknown>;
  contextSnippet: string;
};

type ParsedSheet = {
  name: string;
  rowCount: number;
  columns: string[];
  rows: Array<Record<string, string>>;
};

const MAX_ROWS_PER_SHEET = 2000;
const MAX_RELEVANT_ROWS = 120;

function normalizeKey(value: string) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function rowToString(row: Record<string, string>) {
  return Object.entries(row)
    .map(([key, value]) => `${key}: ${value}`)
    .join(" | ")
    .toLowerCase();
}

function tokenizeQuery(question: string) {
  const stopWords = new Set([
    "the",
    "and",
    "from",
    "this",
    "that",
    "with",
    "where",
    "which",
    "show",
    "list",
    "file",
    "excel",
    "sheet",
    "rows",
    "row",
  ]);
  return String(question || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !stopWords.has(token));
}

function pickColumn(columns: string[], tests: RegExp[]) {
  return columns.find((column) => tests.some((test) => test.test(column.toLowerCase()))) || null;
}

function countByValue(rows: Array<Record<string, string>>, column: string) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = String(row[column] || "").trim();
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return counts;
}

function buildRelevantRows(
  question: string,
  rows: Array<Record<string, string>>,
  columns: string[],
) {
  if (!rows.length) return [] as Array<Record<string, string>>;

  const normalizedQuestion = String(question || "").toLowerCase();
  const companyColumn = pickColumn(columns, [/company|organisation|organization|account|client/]);
  const designationColumn = pickColumn(columns, [/(^|\s)(designation|title|role|position)(\s|$)/]);
  const linkedInColumn = pickColumn(columns, [/(linkedin|profile\s*url|linked\s*in)/]);

  const firstNMatch = normalizedQuestion.match(/\bfirst\s+(\d{1,3})\b/);
  if (firstNMatch) {
    const limit = Math.max(1, Math.min(Number(firstNMatch[1] || "10"), 100));
    return rows.slice(0, limit);
  }

  const designationMatch = normalizedQuestion.match(
    /\b(?:designation|title|role)\s*(?:=|is)?\s*([a-z0-9 .&/-]{2,40})/i,
  );
  const directRoleMatch = normalizedQuestion.match(/\b(ceo|cto|cfo|coo|founder|director|vp|manager)s?\b/i);
  const roleNeedle =
    designationMatch?.[1]?.trim().toLowerCase() || directRoleMatch?.[1]?.trim().toLowerCase() || "";
  if (designationColumn && roleNeedle) {
    const filtered = rows.filter((row) =>
      String(row[designationColumn] || "").toLowerCase().includes(roleNeedle),
    );
    if (filtered.length) return filtered.slice(0, MAX_RELEVANT_ROWS);
  }

  if (linkedInColumn && /missing\s+linkedin|without\s+linkedin|no\s+linkedin/i.test(normalizedQuestion)) {
    const filtered = rows.filter((row) => !String(row[linkedInColumn] || "").trim());
    if (filtered.length) return filtered.slice(0, MAX_RELEVANT_ROWS);
  }

  if (companyColumn && /duplicate\s+compan/i.test(normalizedQuestion)) {
    const counts = countByValue(rows, companyColumn);
    const duplicates = new Set(Array.from(counts.entries()).filter(([, count]) => count > 1).map(([name]) => name));
    const filtered = rows.filter((row) => duplicates.has(String(row[companyColumn] || "").trim()));
    if (filtered.length) return filtered.slice(0, MAX_RELEVANT_ROWS);
  }

  const tokens = tokenizeQuery(question);
  if (tokens.length) {
    const filtered = rows.filter((row) => {
      const normalized = rowToString(row);
      return tokens.some((token) => normalized.includes(token));
    });
    if (filtered.length) return filtered.slice(0, MAX_RELEVANT_ROWS);
  }

  return rows.slice(0, Math.min(40, rows.length));
}

function summarizeWorkbook(question: string, sheets: ParsedSheet[]) {
  const allRows = sheets.flatMap((sheet) => sheet.rows);
  const allColumns = Array.from(
    new Set(
      sheets.flatMap((sheet) => sheet.columns).map((column) => column.trim()).filter(Boolean),
    ),
  );
  const companyColumn =
    pickColumn(allColumns, [/company|organisation|organization|account|client/]) ||
    allColumns[0] ||
    null;
  const designationColumn = pickColumn(allColumns, [/(^|\s)(designation|title|role|position)(\s|$)/]);
  const linkedInColumn = pickColumn(allColumns, [/(linkedin|profile\s*url|linked\s*in)/]);

  const relevantRows = buildRelevantRows(question, allRows, allColumns);

  const companyNames = companyColumn
    ? Array.from(new Set(allRows.map((row) => String(row[companyColumn] || "").trim()).filter(Boolean)))
    : [];
  const missingLinkedInCount =
    linkedInColumn
      ? allRows.filter((row) => !String(row[linkedInColumn] || "").trim()).length
      : 0;

  const duplicateCompanies = companyColumn
    ? Array.from(countByValue(allRows, companyColumn).entries())
        .filter(([, count]) => count > 1)
        .slice(0, 50)
        .map(([name, count]) => ({ company: name, count }))
    : [];

  const topDesignations = designationColumn
    ? Array.from(countByValue(allRows, designationColumn).entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([designation, count]) => ({ designation, count }))
    : [];

  const structured = {
    workbook: {
      sheetCount: sheets.length,
      totalRows: allRows.length,
      sheets: sheets.map((sheet) => ({
        name: sheet.name,
        rowCount: sheet.rowCount,
        columns: sheet.columns,
      })),
    },
    keyColumns: {
      companyColumn,
      designationColumn,
      linkedInColumn,
    },
    derivedInsights: {
      companyCount: companyNames.length,
      missingLinkedInCount,
      duplicateCompanies,
      topDesignations,
    },
    relevantRows,
    sampleRows: allRows.slice(0, 20),
    companyNames: companyNames.slice(0, 300),
  };

  const summary =
    `Workbook has ${sheets.length} sheet(s) and ${allRows.length} row(s). ` +
    (companyNames.length ? `Detected ${companyNames.length} company value(s). ` : "") +
    (linkedInColumn ? `${missingLinkedInCount} row(s) have missing LinkedIn values.` : "");

  const contextSnippet = JSON.stringify(structured, null, 2).slice(0, 12000);

  return { summary, structured, contextSnippet };
}

export function parseSpreadsheetTable(options: {
  fileName: string;
  fileBuffer: Buffer;
}): { sheetName: string; columns: string[]; rows: Array<Record<string, string>> } {
  let XLSX: typeof import("xlsx");
  try {
    XLSX = loadXlsx();
  } catch {
    throw new Error("Spreadsheet parser is unavailable on the server.");
  }

  let workbook: import("xlsx").WorkBook;
  try {
    workbook = XLSX.read(options.fileBuffer, {
      type: "buffer",
      cellDates: true,
      raw: false,
    });
  } catch {
    throw new Error("I couldn't read this spreadsheet. Please use a valid .xls, .xlsx, or .csv file.");
  }

  const sheetNames = Array.isArray(workbook.SheetNames) ? workbook.SheetNames : [];
  if (!sheetNames.length) {
    throw new Error("The spreadsheet has no worksheets.");
  }

  for (const sheetName of sheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
      defval: "",
      raw: false,
    });
    const rows = rawRows.slice(0, MAX_ROWS_PER_SHEET).map((row) => {
      const normalized: Record<string, string> = {};
      for (const [key, value] of Object.entries(row || {})) {
        const normalizedKey = normalizeKey(String(key || ""));
        if (!normalizedKey) continue;
        normalized[normalizedKey] = String(value ?? "").replace(/\u0000/g, "").trim().slice(0, 2000);
      }
      return normalized;
    }).filter((row) => Object.values(row).some((value) => value));
    const columns = Array.from(
      new Set(
        rows
          .flatMap((row) => Object.keys(row))
          .map((column) => normalizeKey(column))
          .filter(Boolean),
      ),
    ).slice(0, 100);
    if (rows.length && columns.length) {
      return { sheetName, columns, rows };
    }
  }

  throw new Error("The spreadsheet is empty.");
}

export function parseExcelAttachment(options: {
  fileName: string;
  fileBuffer: Buffer;
  question: string;
}): ParsedDocument {
  let XLSX: typeof import("xlsx");
  try {
    XLSX = loadXlsx();
  } catch {
    throw new Error("Excel parser is unavailable on the server.");
  }

  let workbook: import("xlsx").WorkBook;
  try {
    workbook = XLSX.read(options.fileBuffer, {
      type: "buffer",
      cellDates: true,
    });
  } catch {
    throw new Error("I couldn't read this Excel file. Please make sure it is a valid .xls or .xlsx file.");
  }
  const sheetNames = Array.isArray(workbook.SheetNames) ? workbook.SheetNames : [];
  if (!sheetNames.length) {
    throw new Error("The Excel file has no worksheets.");
  }

  const sheets: ParsedSheet[] = sheetNames.map((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
      defval: "",
      raw: false,
    });
    const rows = rawRows.slice(0, MAX_ROWS_PER_SHEET).map((row) => {
      const normalized: Record<string, string> = {};
      for (const [key, value] of Object.entries(row || {})) {
        const normalizedKey = normalizeKey(String(key || ""));
        if (!normalizedKey) continue;
        normalized[normalizedKey] = String(value ?? "").trim();
      }
      return normalized;
    });
    const columns = Array.from(
      new Set(
        rows
          .flatMap((row) => Object.keys(row))
          .map((column) => normalizeKey(column))
          .filter(Boolean),
      ),
    ).slice(0, 100);
    return {
      name: sheetName,
      rowCount: rows.length,
      columns,
      rows,
    };
  });

  const hasRows = sheets.some((sheet) => sheet.rowCount > 0);
  if (!hasRows) {
    throw new Error("The Excel file is empty.");
  }

  const { summary, structured, contextSnippet } = summarizeWorkbook(options.question, sheets);

  return {
    fileName: options.fileName,
    fileType: "excel",
    summary,
    structured,
    contextSnippet,
  };
}

