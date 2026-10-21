import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/config/db";
import { getAuthUser } from "@/app/api/lib/auth";
import {
  ensureSequenceSchema,
  normalizeSequenceSteps,
  pauseActiveSequenceEnrollments,
} from "@/app/api/lib/email-sequences";

type SequenceUpdateBody = {
  sequenceName?: string;
  description?: string | null;
  status?: string;
  steps?: Array<{
    stepOrder?: number;
    templateId?: number;
    delayMinutes?: number;
  }>;
};

function parseSequenceId(raw: string): number | null {
  const id = Number(raw || 0);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

function normalizeStatus(value: any): "DRAFT" | "ACTIVE" | "INACTIVE" {
  const v = String(value || "DRAFT").trim().toUpperCase();
  if (v === "ACTIVE") return "ACTIVE";
  if (v === "INACTIVE") return "INACTIVE";
  return "DRAFT";
}

export async function GET(
  req: NextRequest,
  context: { params: { sequenceId: string } }
) {
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sequenceId = parseSequenceId(context.params.sequenceId);
    if (!sequenceId) return NextResponse.json({ error: "Invalid sequence id" }, { status: 400 });

    const pool = await getPool();
    await ensureSequenceSchema(pool);

    const [rows]: any = await pool.query(
      `
        SELECT
          s.SequenceId,
          s.SequenceName,
          s.Description,
          s.Status,
          s.CreatedBy,
          s.CreatedAt,
          s.UpdatedAt,
          COALESCE(u.UserName, '') AS CreatedByName
        FROM email_sequences s
        LEFT JOIN users u ON u.UserId = s.CreatedBy
        WHERE s.SequenceId = ?
        LIMIT 1
      `,
      [sequenceId]
    );

    if (!Array.isArray(rows) || !rows[0]) {
      return NextResponse.json({ error: "Sequence not found" }, { status: 404 });
    }

    const [steps]: any = await pool.query(
      `
        SELECT
          st.StepId,
          st.SequenceId,
          st.StepOrder,
          st.TemplateId,
          COALESCE(st.DelayMinutes, st.DelayDays * 1440, 0) AS DelayMinutes,
          st.DelayDays,
          st.CreatedAt,
          t.TemplateName,
          t.Subject
        FROM email_sequence_steps st
        LEFT JOIN email_templates t ON t.TemplateId = st.TemplateId
        WHERE st.SequenceId = ?
        ORDER BY st.StepOrder ASC
      `,
      [sequenceId]
    );

    return NextResponse.json({
      ...rows[0],
      steps: Array.isArray(steps) ? steps : [],
    });
  } catch (error) {
    console.error("[email-sequence-detail] GET error", error);
    return NextResponse.json({ error: "Failed to fetch sequence" }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  context: { params: { sequenceId: string } }
) {
  let conn: any;
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sequenceId = parseSequenceId(context.params.sequenceId);
    if (!sequenceId) return NextResponse.json({ error: "Invalid sequence id" }, { status: 400 });

    const body = (await req.json().catch(() => ({}))) as SequenceUpdateBody;
    const sequenceName = String(body.sequenceName || "").trim();
    const description = body.description === null ? null : String(body.description || "").trim() || null;
    const status = normalizeStatus(body.status);

    if (!sequenceName) {
      return NextResponse.json({ error: "Sequence name is required" }, { status: 400 });
    }

    const pool = await getPool();
    await ensureSequenceSchema(pool);
    const normalized = await normalizeSequenceSteps(pool, body.steps || []);
    if (normalized.error) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [updateSeq]: any = await conn.query(
      `
        UPDATE email_sequences
        SET SequenceName = ?,
            Description = ?,
            Status = ?,
            UpdatedAt = UTC_TIMESTAMP()
        WHERE SequenceId = ?
      `,
      [sequenceName, description, status, sequenceId]
    );

    if (!Number(updateSeq?.affectedRows || 0)) {
      await conn.rollback();
      return NextResponse.json({ error: "Sequence not found" }, { status: 404 });
    }

    await conn.query(`DELETE FROM email_sequence_steps WHERE SequenceId = ?`, [sequenceId]);
    for (const step of normalized.steps) {
      await conn.query(
        `
          INSERT INTO email_sequence_steps (SequenceId, CompanyId, StepOrder, TemplateId, DelayDays, DelayMinutes, CreatedAt)
          VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())
        `,
        [
          sequenceId,
          authUser.companyId,
          step.stepOrder,
          step.templateId,
          Math.floor(step.delayMinutes / 1440),
          step.delayMinutes,
        ]
      );
    }

    if (status !== "ACTIVE") {
      await pauseActiveSequenceEnrollments(conn, sequenceId);
    }

    await conn.commit();

    return NextResponse.json({ message: "Sequence updated successfully" });
  } catch (error) {
    if (conn) {
      try {
        await conn.rollback();
      } catch {
        // ignore
      }
    }
    console.error("[email-sequence-detail] PUT error", error);
    return NextResponse.json({ error: "Failed to update sequence" }, { status: 500 });
  } finally {
    if (conn) conn.release();
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: { sequenceId: string } }
) {
  let conn: any;
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sequenceId = parseSequenceId(context.params.sequenceId);
    if (!sequenceId) return NextResponse.json({ error: "Invalid sequence id" }, { status: 400 });

    const body = (await req.json().catch(() => ({}))) as { status?: string };
    const status = normalizeStatus(body.status);

    const pool = await getPool();
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [locked]: any = await conn.query(
      `
        SELECT SequenceId
        FROM email_sequences
        WHERE SequenceId = ?
        LIMIT 1
        FOR UPDATE
      `,
      [sequenceId]
    );

    if (!Array.isArray(locked) || !locked[0]) {
      await conn.rollback();
      return NextResponse.json({ error: "Sequence not found" }, { status: 404 });
    }

    await conn.query(
      `
        UPDATE email_sequences
        SET Status = ?,
            UpdatedAt = UTC_TIMESTAMP()
        WHERE SequenceId = ?
      `,
      [status, sequenceId]
    );

    if (status !== "ACTIVE") {
      await pauseActiveSequenceEnrollments(conn, sequenceId);
    }

    await conn.commit();

    return NextResponse.json({ message: "Sequence status updated", sequenceId, status });
  } catch (error) {
    if (conn) {
      try {
        await conn.rollback();
      } catch {
        // ignore
      }
    }
    console.error("[email-sequence-detail] PATCH error", error);
    return NextResponse.json({ error: "Failed to update sequence status" }, { status: 500 });
  } finally {
    if (conn) conn.release();
  }
}

