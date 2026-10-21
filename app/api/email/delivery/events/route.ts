import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/config/db";
import {
  authorizeEmailDeliveryRequest,
  EMAIL_DELIVERY_TOKEN_HEADER,
  ingestDeliveryEvents,
} from "@/app/api/lib/email-delivery";

export async function POST(req: NextRequest) {
  try {
    const auth = authorizeEmailDeliveryRequest(req.headers.get(EMAIL_DELIVERY_TOKEN_HEADER));
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error || "Forbidden" }, { status: auth.status || 403 });
    }

    const body = (await req.json().catch(() => null)) as { events?: unknown } | null;
    const events = Array.isArray(body?.events) ? body.events : [];

    const pool = await getPool();
    const summary = await ingestDeliveryEvents({ pool, events });
    return NextResponse.json({ success: true, ...summary });
  } catch (error) {
    console.error("[email-delivery] POST error");
    return NextResponse.json({ error: "Failed to ingest delivery events" }, { status: 500 });
  }
}
