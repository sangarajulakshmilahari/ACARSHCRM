import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/config/db";
import { applyUnsubscribeFromToken } from "@/app/api/lib/email-suppressions";

function genericError() {
  return NextResponse.json(
    { error: "This unsubscribe request could not be completed." },
    { status: 400 }
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      token?: unknown;
      confirm?: unknown;
    };

    if (body.confirm !== true) {
      return NextResponse.json(
        { error: "Confirmation is required to unsubscribe." },
        { status: 400 }
      );
    }

    const pool = await getPool();
    const result = await applyUnsubscribeFromToken({
      pool,
      token: body.token,
      confirm: true,
    });

    if (!result.ok) {
      if (result.reason === "confirm_required") {
        return NextResponse.json(
          { error: "Confirmation is required to unsubscribe." },
          { status: 400 }
        );
      }
      return genericError();
    }

    return NextResponse.json({
      success: true,
      message: "You will no longer receive these emails.",
    });
  } catch (error) {
    console.error("[email-unsubscribe] POST error");
    return genericError();
  }
}
