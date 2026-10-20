import { parseExcelAttachment, type ParsedDocument } from "./excel-parser";

export type AttachmentInput = {
  fileName: string;
  fileType: string;
  fileSize: number;
  fileBuffer: Buffer;
};

type ProcessedAttachment = {
  fileName: string;
  fileType: string;
  sizeBytes: number;
  parser: "excel" | "pdf";
  summary: string;
  structured: Record<string, unknown>;
  contextSnippet: string;
};

type AttachmentProcessingResult = {
  processed: ProcessedAttachment[];
  failed: Array<{ fileName: string; reason: string }>;
};

type DirectAttachmentAnswer = {
  reply: string;
};

const MAX_CONTEXT_CHARS_PER_FILE = 12000;
const MAX_TOTAL_CONTEXT_CHARS = 24000;

function extension(name: string) {
  const value = String(name || "").trim().toLowerCase();
  const idx = value.lastIndexOf(".");
  return idx >= 0 ? value.slice(idx) : "";
}

function lowerMime(value: string) {
  return String(value || "").trim().toLowerCase();
}

function mapParsedDocument(input: ParsedDocument): ProcessedAttachment {
  return {
    fileName: input.fileName,
    fileType: input.fileType,
    sizeBytes: 0,
    parser: input.fileType,
    summary: input.summary,
    structured: input.structured,
    contextSnippet: input.contextSnippet.slice(0, MAX_CONTEXT_CHARS_PER_FILE),
  };
}

export async function processAttachmentsForAssistant(options: {
  attachments: AttachmentInput[];
  question: string;
}): Promise<AttachmentProcessingResult> {
  const processed: ProcessedAttachment[] = [];
  const failed: Array<{ fileName: string; reason: string }> = [];

  for (const attachment of options.attachments) {
    const ext = extension(attachment.fileName);
    const mime = lowerMime(attachment.fileType);
    try {
      if (ext === ".xlsx" || ext === ".xls" || ext === ".csv" || mime.includes("excel") || mime.includes("spreadsheet") || mime.includes("csv")) {
        const parsed = parseExcelAttachment({
          fileName: attachment.fileName,
          fileBuffer: attachment.fileBuffer,
          question: options.question,
        });
        const mapped = mapParsedDocument(parsed);
        mapped.sizeBytes = attachment.fileSize;
        processed.push(mapped);
        continue;
      }

      if (ext === ".pdf" || mime === "application/pdf") {
        const { parsePdfAttachment } = await import("./pdf-parser");
        const parsed = await parsePdfAttachment({
          fileName: attachment.fileName,
          fileBuffer: attachment.fileBuffer,
          question: options.question,
        });
        const mapped = mapParsedDocument(parsed);
        mapped.sizeBytes = attachment.fileSize;
        processed.push(mapped);
        continue;
      }

      failed.push({
        fileName: attachment.fileName,
        reason: "Unsupported attachment format. Only PDF, XLS and XLSX are supported.",
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown parsing error";
      failed.push({ fileName: attachment.fileName, reason });
    }
  }

  return { processed, failed };
}

export function buildAttachmentContextMessage(options: {
  question: string;
  processed: ProcessedAttachment[];
  failed: Array<{ fileName: string; reason: string }>;
}) {
  if (!options.processed.length && !options.failed.length) return "";

  const meta = options.processed.map((item) => ({
    fileName: item.fileName,
    parser: item.parser,
    fileType: item.fileType,
    sizeBytes: item.sizeBytes,
    summary: item.summary,
  }));

  let remaining = MAX_TOTAL_CONTEXT_CHARS;
  const contextBlocks: string[] = [];
  for (const item of options.processed) {
    if (remaining <= 0) break;
    const snippet = item.contextSnippet.slice(0, remaining);
    if (!snippet) continue;
    contextBlocks.push(`Attachment: ${item.fileName}\n${snippet}`);
    remaining -= snippet.length;
  }

  const failedBlock = options.failed.length
    ? `\n\nFailed attachments:\n${options.failed
        .map((item) => `- ${item.fileName}: ${item.reason}`)
        .join("\n")}`
    : "";

  return (
    `\n\nUploaded document context for this user request:\n` +
    `User question: ${options.question}\n` +
    `Attachment metadata: ${JSON.stringify(meta, null, 2)}\n\n` +
    `Extracted attachment content (structured and truncated for relevance/safety):\n${contextBlocks.join("\n\n")}${failedBlock}\n\n` +
    `Instruction: Use this extracted content to answer questions about uploaded files. ` +
    `If extraction failed for a file, explain that clearly and continue using successfully parsed files.`
  );
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asRows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item === "object") as Array<Record<string, unknown>>
    : [];
}

function detectN(question: string, fallback: number) {
  const match = String(question || "").match(/\b(?:first|top)\s+(\d{1,3})\b/i);
  return Math.max(1, Math.min(Number(match?.[1] || fallback), 100));
}

export function tryBuildDirectAttachmentAnswer(options: {
  question: string;
  processed: Array<{
    fileName: string;
    parser: "excel" | "pdf";
    structured: Record<string, unknown>;
    summary: string;
  }>;
}): DirectAttachmentAnswer | null {
  const question = String(options.question || "").trim();
  if (!question) return null;
  const normalized = question.toLowerCase();

  const excelFiles = options.processed.filter((item) => item.parser === "excel");
  if (!excelFiles.length) return null;

  const file = excelFiles[0];
  const structured = asObject(file.structured);
  const derived = asObject(structured.derivedInsights);
  const relevantRows = asRows(structured.relevantRows);
  const sampleRows = asRows(structured.sampleRows);
  const companyNames = Array.isArray(structured.companyNames)
    ? structured.companyNames.map((item) => String(item || "").trim()).filter(Boolean)
    : [];

  if (
    /\bcompan(?:y|ies)\b/.test(normalized) &&
    /\b(list|show|give|names?|from this)\b/.test(normalized)
  ) {
    const n = detectN(question, 80);
    const names = (companyNames.length
      ? companyNames
      : relevantRows
          .map((row) => {
            const company =
              Object.entries(row).find(([key]) => /company|organisation|organization|account|client/i.test(key)) ||
              Object.entries(row)[0];
            return company ? String(company[1] || "").trim() : "";
          })
          .filter(Boolean)
    ).slice(0, n);
    if (!names.length) return null;
    return {
      reply:
        `Here are the company names from the uploaded Excel file:\n\n` +
        names.map((name, index) => `${index + 1}. ${name}`).join("\n") +
        `\n\nI found ${companyNames.length || names.length} compan${(companyNames.length || names.length) === 1 ? "y" : "ies"} in the file.`,
    };
  }

  if (/\bhow\s+many\b[\s\S]*\bcompan(?:y|ies)\b/.test(normalized) || /\bcompany\s+count\b/.test(normalized)) {
    const count = Number(derived.companyCount || companyNames.length || 0);
    return {
      reply: `I found ${count} compan${count === 1 ? "y" : "ies"} in the uploaded Excel file.`,
    };
  }

  if (/\bfirst\s+\d+\b[\s\S]*\bcompan(?:y|ies)\b/.test(normalized)) {
    const n = detectN(question, 10);
    const names = companyNames.slice(0, n);
    if (!names.length) return null;
    return {
      reply:
        `Here are the first ${names.length} companies from the uploaded Excel file:\n\n` +
        names.map((name, index) => `${index + 1}. ${name}`).join("\n"),
    };
  }

  if (/\b(find|show|list)\b[\s\S]*\b(ceo|cto|cfo|coo|founder|director|vp|manager)s?\b/.test(normalized)) {
    const roleMatch = normalized.match(/\b(ceo|cto|cfo|coo|founder|director|vp|manager)s?\b/);
    const role = String(roleMatch?.[1] || "").toUpperCase();
    const rows = (relevantRows.length ? relevantRows : sampleRows).slice(0, 40);
    if (!rows.length) return null;
    const lines = rows.map((row, index) => {
      const company =
        String(
          Object.entries(row).find(([key]) => /company/i.test(key))?.[1] ||
            Object.values(row)[0] ||
            "",
        ).trim() || "(Unknown company)";
      const person =
        String(
          Object.entries(row).find(([key]) => /^(name|person|contact)/i.test(key))?.[1] ||
            "",
        ).trim();
      const designation =
        String(
          Object.entries(row).find(([key]) => /(designation|title|role|position)/i.test(key))?.[1] ||
            "",
        ).trim();
      return `${index + 1}. ${company}${person ? ` — ${person}` : ""}${designation ? ` (${designation})` : ""}`;
    });
    return {
      reply:
        `Here are ${role || "the matching"} contacts from the uploaded Excel file:\n\n` +
        lines.join("\n"),
    };
  }

  if (/missing\s+linkedin|without\s+linkedin|no\s+linkedin/i.test(normalized)) {
    const count = Number(derived.missingLinkedInCount || 0);
    const rows = relevantRows.slice(0, 25);
    const lines = rows.map((row, index) => {
      const company =
        String(Object.entries(row).find(([key]) => /company/i.test(key))?.[1] || "").trim() ||
        "(Unknown company)";
      const person =
        String(Object.entries(row).find(([key]) => /^(name|person|contact)/i.test(key))?.[1] || "").trim();
      return `${index + 1}. ${company}${person ? ` — ${person}` : ""}`;
    });
    return {
      reply:
        `I found ${count} row(s) with missing LinkedIn URL/profile in the uploaded Excel file.` +
        (lines.length ? `\n\nExamples:\n${lines.join("\n")}` : ""),
    };
  }

  if (/duplicate\s+compan/i.test(normalized)) {
    const duplicates = Array.isArray(derived.duplicateCompanies)
      ? (derived.duplicateCompanies as Array<Record<string, unknown>>)
      : [];
    if (!duplicates.length) {
      return { reply: "I did not find duplicate company names in the uploaded Excel file." };
    }
    const lines = duplicates.slice(0, 30).map((item, index) => {
      const name = String(item.company || "").trim() || "(Unknown)";
      const count = Number(item.count || 0);
      return `${index + 1}. ${name} — ${count} occurrence(s)`;
    });
    return { reply: `I found duplicate company names:\n\n${lines.join("\n")}` };
  }

  if (/\bsummar(?:y|ize|ise)\b/.test(normalized)) {
    const workbook = asObject(structured.workbook);
    const sheetCount = Number(workbook.sheetCount || 0);
    const totalRows = Number(workbook.totalRows || 0);
    const companyCount = Number(derived.companyCount || companyNames.length || 0);
    const topDesignations = Array.isArray(derived.topDesignations)
      ? (derived.topDesignations as Array<Record<string, unknown>>)
      : [];
    const topLine = topDesignations
      .slice(0, 5)
      .map((item) => `${String(item.designation || "Unknown")}: ${Number(item.count || 0)}`)
      .join(", ");
    return {
      reply:
        `Summary of ${file.fileName}:\n` +
        `- Sheets: ${sheetCount}\n` +
        `- Total rows: ${totalRows}\n` +
        `- Companies: ${companyCount}\n` +
        (topLine ? `- Top designations: ${topLine}\n` : "") +
        `- Notes: ${file.summary}`,
    };
  }

  return null;
}

