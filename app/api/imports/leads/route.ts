import { NextRequest, NextResponse } from "next/server";

import { resolveAuthUser } from "@/app/api/lib/auth";
import { createLeadImport } from "./_lib/jobs";
import { importErrorResponse, requireImportActor } from "./_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireImportActor(req);
  if (!auth.ok) return auth.response;
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Spreadsheet file is required." }, { status: 400 });
    }
    const fileName = String(file.name || "").trim();
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const sheetName = String(formData.get("sheetName") || "").trim();
    const resolved = await resolveAuthUser(req);
    const result = await createLeadImport({
      actor: auth.actor,
      ownerName: resolved?.userName || "Unknown",
      fileName,
      fileBuffer,
      sheetName: sheetName || undefined,
    });
    if (result.kind === "needs_sheet") {
      return NextResponse.json({
        needsSheetSelection: true,
        fileName: result.fileName,
        fileSizeBytes: result.fileSizeBytes,
        sheets: result.sheets,
      });
    }
    return NextResponse.json({ job: result.job }, { status: 201 });
  } catch (error) {
    return importErrorResponse(error);
  }
}
