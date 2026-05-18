// app/api/ai/tools/file-parser.ts
// Parses uploaded files (PDF, DOCX, XLSX, CSV, images) into plain text
// that Groq can read in its system/user prompt.
// LinkedIn-aware: detects Connections.csv / Invitations.csv and routes to linkedin-parser.

import * as path from "path";
import {
  parseConnections,
  parseInvitations,
  computeLinkedInAnalytics,
  buildLinkedInContext,
  type LinkedInConnection,
  type LinkedInInvitation,
} from "./linkedin-parser";

// pdf-parse must be required (not imported) to avoid TS2349 call signature error
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse") as (buffer: Buffer) => Promise<{ text: string; numpages: number }>;

export type ParsedFile = {
  name: string;
  type: "pdf" | "docx" | "xlsx" | "csv" | "image" | "text" | "linkedin_connections" | "linkedin_invitations" | "unknown";
  text: string;       // Extracted text content (empty for images)
  isImage: boolean;   // True for JPG/PNG — handled via prompt hint
  mimeType: string;
  sizeKB: number;
  // LinkedIn-specific parsed data (stored for session merging)
  linkedInData?: {
    connections?: LinkedInConnection[];
    invitations?: LinkedInInvitation[];
  };
};

// ─── LINKEDIN FILE DETECTION ───
function isLinkedInConnections(fileName: string, firstLine: string): boolean {
  const name = fileName.toLowerCase();
  return name.includes("connection") || firstLine.toLowerCase().includes("first name,last name,url");
}

function isLinkedInInvitations(fileName: string, firstLine: string): boolean {
  const name = fileName.toLowerCase();
  return name.includes("invitation") || firstLine.toLowerCase().startsWith("from,to,sent");
}

/**
 * Parse a base64-encoded file and return its text content.
 * Call this in route.ts before building the Groq messages array.
 */
export async function parseUploadedFile(
  base64Data: string,
  fileName: string,
  mimeType: string
): Promise<ParsedFile> {
  const ext = path.extname(fileName).toLowerCase();
  const buffer = Buffer.from(base64Data, "base64");
  const sizeKB = Math.round(buffer.length / 1024);

  // ─── IMAGE ───
  if (
    mimeType.startsWith("image/") ||
    [".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext)
  ) {
    return {
      name: fileName,
      type: "image",
      text: "",
      isImage: true,
      mimeType,
      sizeKB,
    };
  }

  // ─── PDF ───
  if (ext === ".pdf" || mimeType === "application/pdf") {
    try {
      const data = await pdfParse(buffer);
      const text = data.text?.trim() || "";
      return {
        name: fileName,
        type: "pdf",
        text: truncateText(text, 8000),
        isImage: false,
        mimeType: "application/pdf",
        sizeKB,
      };
    } catch (err: any) {
      return makeError(fileName, "pdf", mimeType, sizeKB, `PDF parse failed: ${err.message}`);
    }
  }

  // ─── DOCX ───
  if (
    ext === ".docx" ||
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    try {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      const text = result.value?.trim() || "";
      return {
        name: fileName,
        type: "docx",
        text: truncateText(text, 8000),
        isImage: false,
        mimeType,
        sizeKB,
      };
    } catch (err: any) {
      return makeError(fileName, "docx", mimeType, sizeKB, `DOCX parse failed: ${err.message}`);
    }
  }

  // ─── XLSX ───
  if (
    ext === ".xlsx" ||
    ext === ".xls" ||
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimeType === "application/vnd.ms-excel"
  ) {
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(buffer, { type: "buffer" });
      let text = "";
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(sheet);
        text += `\n--- Sheet: ${sheetName} ---\n${csv}`;
      }
      return {
        name: fileName,
        type: "xlsx",
        text: truncateText(text.trim(), 8000),
        isImage: false,
        mimeType,
        sizeKB,
      };
    } catch (err: any) {
      return makeError(fileName, "xlsx", mimeType, sizeKB, `XLSX parse failed: ${err.message}`);
    }
  }

  // ─── CSV (with LinkedIn detection) ───
  if (ext === ".csv" || mimeType === "text/csv") {
    try {
      const text = buffer.toString("utf-8");
      const firstLine = text.split("\n")[0] || "";

      // ─── LinkedIn Connections ───
      if (isLinkedInConnections(fileName, firstLine)) {
        const { connections } = parseConnections(text);
        const analytics = computeLinkedInAnalytics(connections, [], "CRM User");
        const context = buildLinkedInContext(analytics);
        return {
          name: fileName,
          type: "linkedin_connections",
          text: context,
          isImage: false,
          mimeType: "text/csv",
          sizeKB,
          linkedInData: { connections },
        };
      }

      // ─── LinkedIn Invitations ───
      if (isLinkedInInvitations(fileName, firstLine)) {
        const { invitations } = parseInvitations(text);
        const analytics = computeLinkedInAnalytics([], invitations, "CRM User");
        const context = buildLinkedInContext(analytics);
        return {
          name: fileName,
          type: "linkedin_invitations",
          text: context,
          isImage: false,
          mimeType: "text/csv",
          sizeKB,
          linkedInData: { invitations },
        };
      }

      // Generic CSV
      return {
        name: fileName,
        type: "csv",
        text: truncateText(text, 8000),
        isImage: false,
        mimeType: "text/csv",
        sizeKB,
      };
    } catch (err: any) {
      return makeError(fileName, "csv", mimeType, sizeKB, `CSV parse failed: ${err.message}`);
    }
  }

  // ─── PLAIN TEXT / TXT / MD ───
  if (
    ext === ".txt" || ext === ".md" || ext === ".log" ||
    mimeType === "text/plain" || mimeType === "text/markdown"
  ) {
    const text = buffer.toString("utf-8");
    return {
      name: fileName,
      type: "text",
      text: truncateText(text, 8000),
      isImage: false,
      mimeType: "text/plain",
      sizeKB,
    };
  }

  // ─── UNKNOWN ───
  return {
    name: fileName,
    type: "unknown",
    text: "",
    isImage: false,
    mimeType,
    sizeKB,
  };
}

// ─── HELPERS ───

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return (
    text.substring(0, maxChars) +
    `\n\n[... Document truncated at ${maxChars} characters to fit context. ${text.length - maxChars} characters omitted ...]`
  );
}

function makeError(
  name: string,
  type: ParsedFile["type"],
  mimeType: string,
  sizeKB: number,
  errorMsg: string
): ParsedFile {
  return {
    name,
    type,
    text: `[Error reading file: ${errorMsg}]`,
    isImage: false,
    mimeType,
    sizeKB,
  };
}

/**
 * Build an injection block to prepend to the system prompt.
 * Groq will see the document text and answer questions from it.
 */
export function buildDocumentContext(file: ParsedFile): string {
  if (file.isImage) {
    return `\n\n--- UPLOADED IMAGE ---\nFile: ${file.name} (${file.sizeKB}KB)\nThe user has uploaded an image. Describe what you can infer from the filename and context, and let them know that image vision is not supported with this model — suggest they describe what they need from the image.\n--- END IMAGE ---\n`;
  }
  if (!file.text || file.text.startsWith("[Error")) {
    return `\n\n--- UPLOADED FILE ---\nFile: ${file.name} (${file.sizeKB}KB, type: ${file.type})\nStatus: Could not extract text from this file. Let the user know.\n--- END FILE ---\n`;
  }
  return `\n\n--- UPLOADED DOCUMENT ---\nFile: ${file.name} (${file.sizeKB}KB, type: ${file.type})\nContent:\n${file.text}\n--- END DOCUMENT ---\n\nThe user may ask questions about the document above. Answer accurately based on its content. If asked something not in the document, say so clearly.\n`;
}