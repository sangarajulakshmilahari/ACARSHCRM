import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/config/db";
import { resolveTrackedClick } from "@/app/api/lib/email-tracking";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get("t");
    const pool = await getPool();
    const resolved = await resolveTrackedClick({ pool, token });
    if (!resolved.ok) {
      return new NextResponse("This link is unavailable.", {
        status: 400,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
    return NextResponse.redirect(resolved.url, { status: 302 });
  } catch {
    return new NextResponse("This link is unavailable.", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
}
