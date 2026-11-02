import { NextRequest, NextResponse } from "next/server";

import { confirmLeadImport } from "../../_lib/jobs";
import { importErrorResponse, parseJobId, requireImportActor } from "../../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  context: { params: { jobId: string } },
) {
  const auth = await requireImportActor(req);
  if (!auth.ok) return auth.response;
  const jobId = parseJobId(context.params.jobId);
  if (!jobId) return NextResponse.json({ error: "Import job was not found." }, { status: 404 });
  try {
    const job = await confirmLeadImport(auth.actor, jobId);
    return NextResponse.json({ job });
  } catch (error) {
    return importErrorResponse(error);
  }
}
