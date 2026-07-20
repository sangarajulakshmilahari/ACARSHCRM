import { NextRequest, NextResponse } from "next/server";

export async function POST(_req: NextRequest) {
  return NextResponse.json({
    success: true,
    message: "Meeting scheduler placeholder is active",
    event: {
      id: null,
      webLink: null,
      onlineMeetingUrl: null,
      start: null,
      end: null,
    },
  });
}

