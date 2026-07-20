import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ meetings: [] });
}

export async function POST(_req: NextRequest) {
  return NextResponse.json({ error: "Meeting creation is not available" }, { status: 501 });
}

export async function PUT(_req: NextRequest) {
  return NextResponse.json({ error: "Meeting update is not available" }, { status: 501 });
}

export async function DELETE(_req: NextRequest) {
  return NextResponse.json({ error: "Meeting deletion is not available" }, { status: 501 });
}

