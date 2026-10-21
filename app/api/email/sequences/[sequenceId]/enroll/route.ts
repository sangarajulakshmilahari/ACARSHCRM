import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/config/db";
import { getAuthUser } from "@/app/api/lib/auth";
import { enrollContactsInSequence, ensureSequenceSchema } from "@/app/api/lib/email-sequences";

type EnrollBody = {
  leadContactIds?: number[];
  reEnroll?: boolean;
};

function parseSequenceId(raw: string): number | null {
  const id = Number(raw || 0);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

export async function POST(
  req: NextRequest,
  context: { params: { sequenceId: string } }
) {
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sequenceId = parseSequenceId(context.params.sequenceId);
    if (!sequenceId) {
      return NextResponse.json({ error: "Invalid sequence id" }, { status: 400 });
    }

    const body = (await req.json().catch(() => ({}))) as EnrollBody;
    const leadContactIds = Array.from(
      new Set(
        (Array.isArray(body.leadContactIds) ? body.leadContactIds : [])
          .map((v) => Number(v || 0))
          .filter((id) => Number.isInteger(id) && id > 0)
      )
    );

    if (leadContactIds.length === 0) {
      return NextResponse.json({ error: "At least one leadContactId is required" }, { status: 400 });
    }

    const pool = await getPool();
    await ensureSequenceSchema(pool);

    const result = await enrollContactsInSequence({
      pool,
      sequenceId,
      leadContactIds,
      authUser,
      reEnroll: body.reEnroll === true,
    });

    return NextResponse.json({
      message: "Sequence enrollment processed",
      sequenceId,
      enrolledCount: result.enrolled.length,
      skippedCount: result.skipped.length,
      enrolled: result.enrolled,
      skipped: result.skipped,
    });
  } catch (error: any) {
    if (String(error?.message || "") === "SEQUENCE_NOT_FOUND") {
      return NextResponse.json({ error: "Sequence not found" }, { status: 404 });
    }
    if (String(error?.message || "") === "SEQUENCE_HAS_NO_STEPS") {
      return NextResponse.json({ error: "Sequence has no steps" }, { status: 400 });
    }
    if (String(error?.message || "") === "SEQUENCE_NOT_ACTIVE") {
      return NextResponse.json(
        { error: "Sequence must be ACTIVE to enroll contacts" },
        { status: 409 }
      );
    }

    console.error("[email-sequence-enroll] POST error", error);
    return NextResponse.json({ error: "Failed to enroll contacts" }, { status: 500 });
  }
}

