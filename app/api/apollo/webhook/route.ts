import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  const payload = await req.json().catch(() => null);
  return NextResponse.json(
    {
      ok: true,
      received: Boolean(payload),
    },
    { status: 200 },
  );
  }
export async function GET() {
  return NextResponse.json({ ok: true, message: "Apollo webhook endpoint is live." }, { status: 200 });
}