import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/config/db";
import { getAuthUser } from "@/app/api/lib/auth";
import {
  applySequenceEnrollmentAction,
  ensureSequenceSchema,
  type EnrollmentAction,
} from "@/app/api/lib/email-sequences";

function parsePositiveInt(raw: string): number | null {
  const id = Number(raw || 0);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

function parseAction(value: unknown): EnrollmentAction | null {
  const action = String(value || "").trim().toLowerCase();
  if (action === "pause" || action === "resume" || action === "remove") {
    return action;
  }
  return null;
}

function mapActionError(error: unknown) {
  const code = String((error as any)?.message || "");
  if (code === "ENROLLMENT_NOT_FOUND") {
    return { status: 404, error: "Enrollment not found" };
  }
  if (code === "ACCESS_DENIED") {
    return { status: 403, error: "You do not have access to this enrollment" };
  }
  if (code === "SEQUENCE_NOT_ACTIVE") {
    return { status: 409, error: "Sequence must be ACTIVE to resume an enrollment" };
  }
  if (code === "INVALID_TRANSITION") {
    return { status: 409, error: "This enrollment cannot change to the requested status" };
  }
  if (code === "INVALID_ACTION") {
    return { status: 400, error: "Invalid enrollment action" };
  }
  return null;
}

export async function PATCH(
  req: NextRequest,
  context: { params: { sequenceId: string; sequenceContactId: string } }
) {
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sequenceId = parsePositiveInt(context.params.sequenceId);
    const sequenceContactId = parsePositiveInt(context.params.sequenceContactId);
    if (!sequenceId || !sequenceContactId) {
      return NextResponse.json({ error: "Invalid enrollment id" }, { status: 400 });
    }

    const body = (await req.json().catch(() => ({}))) as { action?: string };
    const action = parseAction(body.action);
    if (!action) {
      return NextResponse.json({ error: "Action must be pause, resume, or remove" }, { status: 400 });
    }

    const pool = await getPool();
    await ensureSequenceSchema(pool);

    const result = await applySequenceEnrollmentAction({
      pool,
      sequenceId,
      sequenceContactId,
      action,
      authUser,
    });

    const message =
      action === "pause"
        ? "Enrollment paused"
        : action === "resume"
          ? "Enrollment resumed"
          : "Enrollment removed from sequence";

    return NextResponse.json({
      message,
      action,
      item: {
        SequenceContactId: result.sequenceContactId,
        SequenceId: result.sequenceId,
        LeadContactID: result.leadContactId,
        Status: result.status,
        CurrentStep: result.currentStep,
        NextActionAt: result.nextActionAt,
      },
      pendingQueuedEmail: result.pendingQueuedEmail,
      queuedEmailId: result.queuedEmailId,
      warning: result.warning || null,
    });
  } catch (error) {
    const mapped = mapActionError(error);
    if (mapped) {
      return NextResponse.json({ error: mapped.error }, { status: mapped.status });
    }
    console.error("[email-sequence-enrollment-action] PATCH error", error);
    return NextResponse.json({ error: "Failed to update enrollment" }, { status: 500 });
  }
}
