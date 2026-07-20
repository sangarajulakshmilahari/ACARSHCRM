import { NextRequest, NextResponse } from "next/server";
import { dispatchReminderEmails } from "@/app/api/lib/reminder-dispatch";

function isAuthorized(req: NextRequest) {
  const configuredToken = (process.env.REMINDER_DISPATCH_TOKEN || "").trim();
  if (!configuredToken) return true;

  const incomingToken = req.headers.get("x-reminder-dispatch-token")?.trim();
  return incomingToken === configuredToken;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await dispatchReminderEmails();
    return NextResponse.json({ success: true, summary });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || "Reminder dispatch failed" },
      { status: 500 }
    );
  }
}

