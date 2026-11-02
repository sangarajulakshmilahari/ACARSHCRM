import { NextRequest, NextResponse } from "next/server";

import { getLeadImport, selectLeadImportSheet, updateLeadImport } from "../_lib/jobs";
import { importErrorResponse, parseJobId, requireImportActor } from "../_lib/http";
import { resolveAuthUser } from "@/app/api/lib/auth";
import type { DuplicatePolicy } from "@/app/api/lib/lead-import-core";
import type { ImportMappingValue } from "@/app/api/lib/custom-fields";
import { parseRowResolutions } from "@/app/api/lib/import-row-resolutions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  context: { params: { jobId: string } },
) {
  const auth = await requireImportActor(req);
  if (!auth.ok) return auth.response;
  const jobId = parseJobId(context.params.jobId);
  if (!jobId) return NextResponse.json({ error: "Import job was not found." }, { status: 404 });
  try {
    const job = await getLeadImport(auth.actor, jobId);
    return NextResponse.json({ job });
  } catch (error) {
    return importErrorResponse(error);
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: { jobId: string } },
) {
  const auth = await requireImportActor(req);
  if (!auth.ok) return auth.response;
  const jobId = parseJobId(context.params.jobId);
  if (!jobId) return NextResponse.json({ error: "Import job was not found." }, { status: 404 });
  try {
    const contentType = String(req.headers.get("content-type") || "").toLowerCase();
    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "Spreadsheet file is required." }, { status: 400 });
      }
      const resolved = await resolveAuthUser(req);
      const job = await selectLeadImportSheet({
        actor: auth.actor,
        importId: jobId,
        ownerName: resolved?.userName || "Unknown",
        fileName: String(file.name || "").trim(),
        fileBuffer: Buffer.from(await file.arrayBuffer()),
        sheetName: String(formData.get("sheetName") || "").trim(),
      });
      return NextResponse.json({ job });
    }
    const body = (await req.json().catch(() => ({}))) as {
      mapping?: Record<string, ImportMappingValue | "">;
      defaults?: Record<string, string>;
      unmappedToNotes?: string[];
      skipInvalid?: boolean;
      duplicatePolicy?: DuplicatePolicy;
      rowResolutions?: Record<string, unknown>;
    };
    const job = await updateLeadImport(auth.actor, jobId, {
      mapping: body.mapping,
      defaults: body.defaults,
      unmappedToNotes: body.unmappedToNotes,
      skipInvalid: body.skipInvalid,
      duplicatePolicy: body.duplicatePolicy,
      rowResolutions: body.rowResolutions ? parseRowResolutions(body.rowResolutions) : undefined,
    });
    return NextResponse.json({ job });
  } catch (error) {
    return importErrorResponse(error);
  }
}
