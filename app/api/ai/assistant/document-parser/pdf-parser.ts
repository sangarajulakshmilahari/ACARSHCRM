import type { ParsedDocument } from "./excel-parser";

const MAX_PDF_CONTEXT_CHARS = 12000;

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
    "pdf",
    "document",
  ]);
  return String(question || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !stopWords.has(token));
}

function relevantPdfLines(question: string, text: string) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [] as string[];
  const tokens = tokenizeQuery(question);
  if (!tokens.length) return lines.slice(0, 120);
  const matched = lines.filter((line) => {
    const normalized = line.toLowerCase();
    return tokens.some((token) => normalized.includes(token));
  });
  return (matched.length ? matched : lines).slice(0, 160);
}

export async function parsePdfAttachment(options: {
  fileName: string;
  fileBuffer: Buffer;
  question: string;
}): Promise<ParsedDocument> {
  const pdfModule = await import("pdf-parse");
  const PDFParse = (pdfModule as any).PDFParse;
  if (typeof PDFParse !== "function") {
    throw new Error("PDF parser is unavailable in this runtime.");
  }

  const parser = new PDFParse({ data: options.fileBuffer });
  const parsed = await parser.getText();
  await parser.destroy().catch(() => undefined);
  const text = String(parsed?.text || "").replace(/\u0000/g, "").trim();
  if (!text) {
    throw new Error("The PDF appears to be empty or does not contain extractable text.");
  }

  const relevantLines = relevantPdfLines(options.question, text);
  const structured = {
    pageCount: Number(parsed?.pages || 0),
    lineCount: relevantLines.length,
    relevantLines,
    sampleText: text.slice(0, 5000),
  };
  const contextSnippet = JSON.stringify(structured, null, 2).slice(0, MAX_PDF_CONTEXT_CHARS);

  return {
    fileName: options.fileName,
    fileType: "pdf",
    summary: `PDF has ${Number(parsed?.pages || 0)} page(s). Extracted ${text.length} characters of text.`,
    structured,
    contextSnippet,
  };
}

