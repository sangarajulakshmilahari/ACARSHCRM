import { NextRequest, NextResponse } from "next/server";

import {
  applyApolloPhoneWebhook,
  verifyApolloWebhookToken,
} from "@/app/api/lib/apollo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!verifyApolloWebhookToken(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await req.json().catch(() => null);
  const result = applyApolloPhoneWebhook(payload);
  if (!result.ok) {
    return NextResponse.json({ error: result.error || "Invalid webhook payload." }, { status: 400 });
  }

  return NextResponse.json(
    {
      ok: true,
      updated: result.updated,
    },
    { status: 200 },
  );
}

export async function GET() {
  return NextResponse.json({ ok: true, message: "Apollo webhook endpoint is live." }, { status: 200 });
}
