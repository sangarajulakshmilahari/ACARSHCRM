import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/config/db";
import { getAuthUser } from "@/app/api/lib/auth";
import { CompanyRequiredError, requireCompanyId } from "@/app/api/lib/company-tenancy";
import { hasGlobalLeadAccess } from "@/app/api/lib/lead-access";
import {
  isNormalizedEmail,
  listActiveSuppressions,
  normalizeRecipientEmail,
  revokeSuppression,
  upsertEmailSuppression,
} from "@/app/api/lib/email-suppressions";

export async function GET(req: NextRequest) {
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasGlobalLeadAccess(authUser.roleId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const companyId = requireCompanyId(authUser);
    const pool = await getPool();
    const items = await listActiveSuppressions(pool, companyId);
    return NextResponse.json({ items });
  } catch (error) {
    if (error instanceof CompanyRequiredError) {
      return NextResponse.json({ error: "Company membership required" }, { status: 403 });
    }
    console.error("[email-suppressions] GET error");
    return NextResponse.json({ error: "Failed to load suppressions" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasGlobalLeadAccess(authUser.roleId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as { email?: unknown };
    const normalizedEmail = normalizeRecipientEmail(body.email);
    if (!isNormalizedEmail(normalizedEmail)) {
      return NextResponse.json({ error: "A valid email address is required" }, { status: 400 });
    }

    const companyId = requireCompanyId(authUser);
    const pool = await getPool();
    const result = await upsertEmailSuppression({
      poolOrConn: pool,
      normalizedEmail,
      reason: "MANUAL",
      source: "OPERATOR",
      createdByUserId: authUser.userId,
      companyId,
    });

    return NextResponse.json({
      success: true,
      already: result.already,
      message: result.already ? "Address is already suppressed." : "Address suppressed.",
    });
  } catch (error) {
    if (error instanceof CompanyRequiredError) {
      return NextResponse.json({ error: "Company membership required" }, { status: 403 });
    }
    console.error("[email-suppressions] POST error");
    return NextResponse.json({ error: "Failed to add suppression" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasGlobalLeadAccess(authUser.roleId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as { suppressionId?: unknown };
    const suppressionId = Number(body.suppressionId || 0);
    if (!Number.isInteger(suppressionId) || suppressionId <= 0) {
      return NextResponse.json({ error: "Invalid suppression id" }, { status: 400 });
    }

    const companyId = requireCompanyId(authUser);
    const pool = await getPool();
    const result = await revokeSuppression({
      pool,
      suppressionId,
      revokedByUserId: authUser.userId,
      companyId,
    });
    if (!result.revoked) {
      return NextResponse.json({ error: "Suppression was not found or already removed" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: "Suppression removed. Existing enrollments stay paused until re-enrolled.",
    });
  } catch (error) {
    if (error instanceof CompanyRequiredError) {
      return NextResponse.json({ error: "Company membership required" }, { status: 403 });
    }
    console.error("[email-suppressions] DELETE error");
    return NextResponse.json({ error: "Failed to remove suppression" }, { status: 500 });
  }
}
