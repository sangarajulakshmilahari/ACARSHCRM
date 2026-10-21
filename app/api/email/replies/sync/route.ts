import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/config/db";
import {
  authorizeEmailDispatchRequest,
  EMAIL_DISPATCH_TOKEN_HEADER,
} from "@/app/api/lib/email-dispatch";
import { processSharedMailboxReplies } from "@/app/api/lib/email-replies";

export async function POST(req: NextRequest) {
  try {
    const auth = authorizeEmailDispatchRequest(req.headers.get(EMAIL_DISPATCH_TOKEN_HEADER));
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error || "Forbidden" }, { status: auth.status || 403 });
    }

    const pool = await getPool();
    const summary = await processSharedMailboxReplies({ pool });
    return NextResponse.json({ success: true, ...summary });
  } catch (error) {
    console.error("[email-replies-sync] POST error", error);
    return NextResponse.json({ error: "Failed to process mailbox replies" }, { status: 500 });
  }
}
