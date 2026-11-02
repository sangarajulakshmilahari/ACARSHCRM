import { NextRequest, NextResponse } from "next/server";

import { getAuthUser } from "@/app/api/lib/auth";
import {
  CompanyMismatchError,
  CompanyRequiredError,
} from "@/app/api/lib/company-tenancy";
import {
  LeadImportAccessError,
  LeadImportStateError,
  requireLeadImportActor,
  type LeadImportActor,
} from "@/app/api/lib/lead-import-core";

export async function requireImportActor(req: NextRequest): Promise<
  | { ok: true; actor: LeadImportActor; userName?: string }
  | { ok: false; response: NextResponse }
> {
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  try {
    const actor = requireLeadImportActor(authUser);
    return { ok: true, actor };
  } catch (error) {
    return { ok: false, response: importErrorResponse(error) };
  }
}

export function parseJobId(raw: string | undefined) {
  const jobId = Number(raw);
  if (!Number.isInteger(jobId) || jobId <= 0) return null;
  return jobId;
}

type MysqlLikeError = {
  name?: string;
  code?: string;
  errno?: number;
  sqlState?: string;
  message?: string;
};

function mysqlLikeError(error: unknown): MysqlLikeError | null {
  if (!error || typeof error !== "object") return null;
  const value = error as MysqlLikeError;
  return {
    name: value.name,
    code: value.code,
    errno: value.errno,
    sqlState: value.sqlState,
    message: typeof value.message === "string" ? value.message : undefined,
  };
}

export function classifyImportFailure(error: unknown): { status: number; error: string } {
  if (error instanceof CompanyRequiredError) {
    return { status: 403, error: "Company membership required" };
  }
  if (error instanceof CompanyMismatchError || error instanceof LeadImportAccessError) {
    return { status: 404, error: "Import job was not found." };
  }
  if (error instanceof LeadImportStateError) {
    return { status: 409, error: error.message };
  }
  const mysql = mysqlLikeError(error);
  const message = error instanceof Error ? error.message : "Import request failed.";
  const missingImportTable =
    mysql?.code === "ER_NO_SUCH_TABLE" ||
    mysql?.errno === 1146 ||
    (/doesn't exist/i.test(message) && /(leadimports|customfield)/i.test(message));
  if (missingImportTable) {
    const customFieldTable = /customfield/i.test(message);
    return {
      status: 503,
      error: customFieldTable
        ? "Custom fields are unavailable because required database tables are not installed. Apply the local custom-fields migration."
        : "Smart Lead & Contact Import is unavailable because required database tables are not installed. Apply the local import migration.",
    };
  }
  if (/unsupported format|empty or unreadable|10 MB|no worksheets|empty/i.test(message)) {
    return { status: 400, error: message };
  }
  return { status: 500, error: "Import request failed." };
}

export function importErrorResponse(error: unknown) {
  const classified = classifyImportFailure(error);
  const mysql = mysqlLikeError(error);
  console.error("[lead-import-job]", {
    status: classified.status,
    name: mysql?.name || (error instanceof Error ? error.name : "error"),
    code: mysql?.code || null,
    errno: mysql?.errno || null,
    sqlState: mysql?.sqlState || null,
  });
  return NextResponse.json({ error: classified.error }, { status: classified.status });
}
