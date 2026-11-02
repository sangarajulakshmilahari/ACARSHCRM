import { NextRequest, NextResponse } from "next/server";

import { getAuthUser } from "@/app/api/lib/auth";
import { getApolloPhoneRevealStatus } from "@/app/api/lib/apollo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requestId = String(req.nextUrl.searchParams.get("requestId") || "").trim();
  const apolloPersonId = String(req.nextUrl.searchParams.get("apolloPersonId") || "").trim();
  if (!requestId && !apolloPersonId) {
    return NextResponse.json({ error: "requestId is required." }, { status: 400 });
  }

  const record = getApolloPhoneRevealStatus({
    requestId,
    apolloPersonId,
    userId: user.userId,
    companyId: user.companyId,
  });

  if (!record) {
    return NextResponse.json({ error: "Phone reveal status was not found." }, { status: 404 });
  }

  return NextResponse.json({
    requestId: record.requestId,
    apolloPersonId: record.apolloPersonId,
    phone: record.phone,
    phoneType: record.phoneType,
    phoneStatus: record.status,
    hasPhone: Boolean(record.phone),
  });
}
