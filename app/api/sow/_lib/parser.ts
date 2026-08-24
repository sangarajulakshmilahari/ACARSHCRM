import mammoth from "mammoth";

export type ParsedSowResource = {
  resourceName: string;
  role: string;
  location: string | null;
  businessHours: string | null;
  hourlyRate: number | null;
  startDate: string | null;
  endDate: string | null;
  budgetedHours: number | null;
  budgetedFees: number | null;
};

export type ParsedSowDocument = {
  sowName: string;
  client: string;
  effectiveDate: string | null;
  startDate: string | null;
  endDate: string | null;
  resources: ParsedSowResource[];
};

function normalizeSpaces(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
}

function parseDateText(value?: string | null): string | null {
  if (!value) return null;
  const v = normalizeSpaces(String(value));
  if (!v) return null;

  const monthMap: Record<string, number> = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
  };

  const toIso = (year: number, month: number, day: number): string | null => {
    if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1900) return null;
    const dt = new Date(Date.UTC(year, month - 1, day));
    if (dt.getUTCFullYear() !== year || dt.getUTCMonth() + 1 !== month || dt.getUTCDate() !== day) return null;
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  };

  const isoMatch = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const iso = toIso(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
    if (iso) return iso;
  }

  // Month-name first: January 1, 2026
  const monthNameFirst = v.match(/([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{2,4})/);
  if (monthNameFirst) {
    const month = monthMap[String(monthNameFirst[1]).toLowerCase()] || 0;
    const day = Number(monthNameFirst[2]);
    const year = Number(monthNameFirst[3].length === 2 ? `20${monthNameFirst[3]}` : monthNameFirst[3]);
    const iso = toIso(year, month, day);
    if (iso) return iso;
  }

  // Day first with month name: 15 October 2024
  const dayFirstName = v.match(/(\d{1,2})\s+([A-Za-z]{3,9}),?\s+(\d{2,4})/);
  if (dayFirstName) {
    const day = Number(dayFirstName[1]);
    const month = monthMap[String(dayFirstName[2]).toLowerCase()] || 0;
    const year = Number(dayFirstName[3].length === 2 ? `20${dayFirstName[3]}` : dayFirstName[3]);
    const iso = toIso(year, month, day);
    if (iso) return iso;
  }

  // Numeric patterns: prefer MM/DD/YYYY when ambiguous
  const numeric = v.match(/(\d{1,2})[\-\/. ](\d{1,2})[\-\/. ](\d{2,4})/);
  if (numeric) {
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    const year = Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3]);

    const mmdd = toIso(year, a, b);
    if (mmdd) return mmdd;
    const ddmm = toIso(year, b, a);
    if (ddmm) return ddmm;
  }

  return null;
}

function extractSingleValue(rawText: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = rawText.match(pattern);
    if (match?.[1]) {
      const value = normalizeSpaces(match[1]);
      if (value) return value;
    }
  }
  return null;
}

function parseHourlyRate(value?: string | null): number | null {
  if (!value) return null;
  const cleaned = String(value).replace(/[^0-9.\-]/g, "").trim();
  if (!cleaned) return null;
  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseNumber(value?: string | null): number | null {
  if (!value) return null;
  const cleaned = String(value).replace(/[^0-9.\-]/g, "").trim();
  if (!cleaned) return null;
  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? numeric : null;
}

function pickColumn(cells: string[], index: number): string {
  if (index < 0 || index >= cells.length) return "";
  return normalizeSpaces(cells[index] || "");
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function stripHtml(value: string): string {
  return normalizeSpaces(decodeHtmlEntities(value.replace(/<[^>]*>/g, " ")));
}

function splitTextRowToCells(row: string): string[] {
  if (row.includes("\t")) {
    return row.split("\t").map(normalizeSpaces).filter(Boolean);
  }
  if (row.includes("|")) {
    return row.split("|").map(normalizeSpaces).filter(Boolean);
  }
  return row.split(/\s{2,}/).map(normalizeSpaces).filter(Boolean);
}

function extractTableRowsFromHtml(html: string): string[][] {
  const rows: string[][] = [];
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch: RegExpExecArray | null;

  while ((trMatch = trRegex.exec(html)) !== null) {
    const rowHtml = trMatch[1] || "";
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    const cells: string[] = [];
    let cellMatch: RegExpExecArray | null;

    while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
      const text = stripHtml(cellMatch[1] || "");
      if (text) cells.push(text);
    }

    if (cells.length > 0) rows.push(cells);
  }

  return rows;
}

function extractTablesFromHtml(html: string): string[][][] {
  const tables: string[][][] = [];
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch: RegExpExecArray | null;

  while ((tableMatch = tableRegex.exec(html)) !== null) {
    const tableHtml = tableMatch[1] || "";
    const rows = extractTableRowsFromHtml(tableHtml);
    if (rows.length > 0) tables.push(rows);
  }

  return tables;
}

function looksCurrencyLike(value: string): boolean {
  const text = normalizeSpaces(value);
  if (!text) return false;
  return /[$₹€£]|\b(?:usd|inr|eur|gbp)\b/i.test(text) || /^\d+(?:\.\d+)?$/.test(text);
}

function looksMeaningfulCell(value: string): boolean {
  const text = normalizeSpaces(value);
  if (!text) return false;
  if (["#", "-", "--", "n/a", "na", "null", "undefined"].includes(text.toLowerCase())) return false;
  return true;
}

function normalizeHeaderToken(value: string): string {
  return normalizeSpaces(value).toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

type HeaderMapping = {
  headerIndex: number;
  resourceCol: number;
  roleCol: number;
  locationCol: number;
  businessHoursCol: number;
  rateCol: number;
  startCol: number;
  endCol: number;
  budgetedHoursCol: number;
  budgetedFeesCol: number;
};

function resolveHeaderMapping(rows: string[][]): HeaderMapping | null {
  const findIndex = (headers: string[], predicates: Array<(v: string) => boolean>) =>
    headers.findIndex((h) => predicates.some((p) => p(h)));

  for (let i = 0; i < rows.length; i += 1) {
    const headers = rows[i].map(normalizeHeaderToken);
    if (headers.length < 3) continue;

    const resourceCol = findIndex(headers, [
      (h) => h.includes("resource name"),
      (h) => h === "resource",
      (h) => h.includes("consultant"),
      (h) => h.includes("employee name"),
      (h) => h.includes("name"),
    ]);
    const roleCol = findIndex(headers, [
      (h) => h.includes("role"),
      (h) => h.includes("designation"),
      (h) => h.includes("position"),
      (h) => h.includes("title"),
    ]);

    if (resourceCol < 0 || roleCol < 0) continue;

    const locationCol = findIndex(headers, [(h) => h.includes("location")]);
    const businessHoursCol = findIndex(headers, [
      (h) => h.includes("business hour") && !h.includes("rate"),
      (h) => h === "hours",
    ]);
    const rateCol = findIndex(headers, [
      (h) => h.includes("rate"),
      (h) => h.includes("hourly"),
      (h) => h.includes("billing"),
    ]);
    const startCol = findIndex(headers, [(h) => h.includes("start") || h === "from"]);
    const endCol = findIndex(headers, [(h) => h.includes("end") || h === "to"]);
    const budgetedHoursCol = findIndex(headers, [
      (h) => h.includes("budgeted hours"),
      (h) => h.includes("budget hours"),
    ]);
    const budgetedFeesCol = findIndex(headers, [
      (h) => h.includes("budgeted fees"),
      (h) => h.includes("budget fees"),
      (h) => h.includes("fees"),
    ]);

    return {
      headerIndex: i,
      resourceCol,
      roleCol,
      locationCol,
      businessHoursCol,
      rateCol,
      startCol,
      endCol,
      budgetedHoursCol,
      budgetedFeesCol,
    };
  }

  return null;
}

function parseResourceRows(rows: string[][]): ParsedSowResource[] {
  const mapping = resolveHeaderMapping(rows);
  if (!mapping) return [];

  const resources: ParsedSowResource[] = [];
  const dataRows = rows.slice(mapping.headerIndex + 1);

  for (const cells of dataRows) {
    if (cells.length < 2) continue;
    const firstCell = normalizeSpaces(cells[0] || "").toLowerCase();
    if (/^appendix\s*\d+/i.test(firstCell) || /^terms?$/i.test(firstCell) || /grand\s*total/i.test(firstCell)) break;

    const role = pickColumn(cells, mapping.roleCol);
    const resourceName = pickColumn(cells, mapping.resourceCol);
    if (!looksMeaningfulCell(role) || !looksMeaningfulCell(resourceName)) continue;

    let businessHours = pickColumn(cells, mapping.businessHoursCol) || null;
    const rateText = pickColumn(cells, mapping.rateCol);
    if (businessHours && mapping.businessHoursCol === mapping.rateCol && looksCurrencyLike(rateText)) {
      businessHours = null;
    }

    resources.push({
      resourceName: normalizeSpaces(resourceName),
      role: normalizeSpaces(role),
      location: pickColumn(cells, mapping.locationCol) || null,
      businessHours,
      hourlyRate: parseHourlyRate(rateText),
      startDate: parseDateText(pickColumn(cells, mapping.startCol)),
      endDate: parseDateText(pickColumn(cells, mapping.endCol)),
      budgetedHours: parseNumber(pickColumn(cells, mapping.budgetedHoursCol)),
      budgetedFees: parseNumber(pickColumn(cells, mapping.budgetedFeesCol)),
    });
  }

  return resources;
}

export async function parseSowDocxBuffer(fileBuffer: Buffer, fallbackFileName: string): Promise<ParsedSowDocument> {
  const mammothResult = await mammoth.extractRawText({ buffer: fileBuffer });
  const mammothHtmlResult = await mammoth.convertToHtml({ buffer: fileBuffer });
  const rawText = String(mammothResult?.value || "").replace(/\r/g, "");
  const rawHtml = String(mammothHtmlResult?.value || "");
  const lines = rawText
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);

  if (!lines.length) {
    throw new Error("Uploaded document appears to be empty or unreadable.");
  }

  const titleLine = lines.find((line) => /statement\s+of\s+work/i.test(line)) || "";

  const clientFromTitle = (() => {
    const m = titleLine.match(/^[^-\n]+-\s*(.*?)\s*statement\s+of\s+work/i);
    if (!m?.[1]) return null;
    const text = normalizeSpaces(m[1]);
    return text || null;
  })();

  const client = extractSingleValue(rawText, [
    /(?:^|\n)\s*Client\s*[:\-]\s*([^\n]+)/i,
    /(?:^|\n)\s*Customer\s*[:\-]\s*([^\n]+)/i,
    /(?:^|\n)\s*Client Name\s*[:\-]\s*([^\n]+)/i,
  ]) || clientFromTitle || "Unknown Client";

  const sowName = extractSingleValue(rawText, [
    /(?:^|\n)\s*SOW\s*Name\s*[:\-]\s*([^\n]+)/i,
    /(?:^|\n)\s*Statement\s+of\s+Work\s*[:\-]\s*([^\n]+)/i,
    /(?:^|\n)\s*Project\s*Name\s*[:\-]\s*([^\n]+)/i,
  ]) || normalizeSpaces(titleLine || "") || fallbackFileName.replace(/\.docx$/i, "");

  const effectiveDate = parseDateText(
    extractSingleValue(rawText, [
      /(?:^|\n)\s*Effective\s*Date\s*[:\-]\s*([^\n]+)/i,
      /effective\s+as\s+of\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[A-Za-z]+\s+\d{4})/i,
    ])
  );
  const startDate = parseDateText(
    extractSingleValue(rawText, [
      /(?:^|\n)\s*Start\s*Date\s*[:\-]\s*([^\n]+)/i,
      /(?:^|\n)\s*Commencement\s*Date\s*[:\-]\s*([^\n]+)/i,
      /commence\s+on\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[A-Za-z]+\s+\d{4})/i,
    ])
  );
  const endDate = parseDateText(
    extractSingleValue(rawText, [
      /(?:^|\n)\s*End\s*Date\s*[:\-]\s*([^\n]+)/i,
      /(?:^|\n)\s*Completion\s*Date\s*[:\-]\s*([^\n]+)/i,
      /expiration\s+date\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[A-Za-z]+\s+\d{4})/i,
      /continue\s+until\s+[^\n]*?\b([A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[A-Za-z]+\s+\d{4})\b/i,
    ])
  );

  const tables = extractTablesFromHtml(rawHtml);
  let resources: ParsedSowResource[] = [];

  for (const tableRows of tables) {
    const parsedRows = parseResourceRows(tableRows);
    if (parsedRows.length > resources.length) {
      resources = parsedRows;
    }
  }

  if (resources.length === 0) {
    const appendixStartIndex = lines.findIndex((line) => /appendix\s*1/i.test(line) && /resourcing\s*plan/i.test(line));
    const resourceLines = appendixStartIndex >= 0 ? lines.slice(appendixStartIndex + 1) : lines;
    const textRows = resourceLines
      .map(splitTextRowToCells)
      .filter((cells) => cells.length > 1);
    resources = parseResourceRows(textRows).filter((row) => looksMeaningfulCell(row.resourceName) && looksMeaningfulCell(row.role));
  }

  if (resources.length === 0) {
    throw new Error("Unable to parse Appendix 1 (Resourcing Plan). Ensure table headers and rows are present.");
  }

  return {
    sowName,
    client,
    effectiveDate,
    startDate,
    endDate,
    resources,
  };
}

