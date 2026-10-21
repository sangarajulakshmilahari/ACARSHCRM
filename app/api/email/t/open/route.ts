import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/config/db";
import {
  handleOpenPixel,
  TRANSPARENT_GIF,
  trackingPixelHeaders,
} from "@/app/api/lib/email-tracking";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("t");
  let pixel;
  try {
    const pool = await getPool();
    pixel = await handleOpenPixel({ pool, token });
  } catch {
    pixel = { status: 200, body: TRANSPARENT_GIF, headers: trackingPixelHeaders() };
  }

  return new NextResponse(Uint8Array.from(pixel.body), {
    status: pixel.status,
    headers: pixel.headers,
  });
}
