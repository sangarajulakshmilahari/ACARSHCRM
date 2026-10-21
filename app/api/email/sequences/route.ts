import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/config/db";
import { getAuthUser } from "@/app/api/lib/auth";
import { ensureSequenceSchema, normalizeSequenceSteps } from "@/app/api/lib/email-sequences";

type SequenceCreateBody = {
  sequenceName?: string;
  description?: string;
  status?: string;
  steps?: Array<{
    stepOrder?: number;
    templateId?: number;
    delayMinutes?: number;
  }>;
};

function normalizeStatus(value: any): "DRAFT" | "ACTIVE" | "INACTIVE" {
  const v = String(value || "DRAFT").trim().toUpperCase();
  if (v === "ACTIVE") return "ACTIVE";
  if (v === "INACTIVE") return "INACTIVE";
  return "DRAFT";
}

export async function GET(req: NextRequest) {
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
          COALESCE(u.UserName, '') AS CreatedByName,
          COALESCE(stepAgg.StepCount, 0) AS StepCount,
          COALESCE(contactAgg.TotalContacts, 0) AS TotalContacts,
          COALESCE(contactAgg.ActiveContacts, 0) AS ActiveContacts,
          COALESCE(contactAgg.CompletedContacts, 0) AS CompletedContacts
        FROM email_sequences s
        LEFT JOIN users u ON u.UserId = s.CreatedBy
        LEFT JOIN (
          SELECT SequenceId, COUNT(*) AS StepCount
          FROM email_sequence_steps
          GROUP BY SequenceId
        ) stepAgg ON stepAgg.SequenceId = s.SequenceId
        LEFT JOIN (
          SELECT
            SequenceId,
            COUNT(*) AS TotalContacts,
            SUM(CASE WHEN UPPER(Status) = 'ACTIVE' THEN 1 ELSE 0 END) AS ActiveContacts,
            SUM(CASE WHEN UPPER(Status) = 'COMPLETED' THEN 1 ELSE 0 END) AS CompletedContacts
          FROM email_sequence_contacts
          GROUP BY SequenceId
        ) contactAgg ON contactAgg.SequenceId = s.SequenceId
        WHERE s.CompanyId = ?
        ORDER BY COALESCE(s.UpdatedAt, s.CreatedAt) DESC, s.SequenceId DESC
      `,
      [authUser.companyId]
    );

    const sequenceIds = (Array.isArray(rows) ? rows : []).map((r: any) => Number(r.SequenceId)).filter((id) => id > 0);
    let stepsBySequence = new Map<number, any[]>();

    if (sequenceIds.length > 0) {
      const [stepRows]: any = await pool.query(
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
          WHERE st.SequenceId IN (${sequenceIds.map(() => "?").join(",")})
          ORDER BY st.SequenceId ASC, st.StepOrder ASC
        `,
        sequenceIds
      );

      stepsBySequence = (Array.isArray(stepRows) ? stepRows : []).reduce((map: Map<number, any[]>, row: any) => {
        const sid = Number(row.SequenceId || 0);
        const list = map.get(sid) || [];
        list.push(row);
        map.set(sid, list);
        return map;
      }, new Map<number, any[]>());
    }

    return NextResponse.json(
      (Array.isArray(rows) ? rows : []).map((row: any) => ({
        ...row,
        steps: stepsBySequence.get(Number(row.SequenceId || 0)) || [],
      }))
    );
  } catch (error) {
    console.error("[email-sequences] GET error", error);
    return NextResponse.json({ error: "Failed to fetch email sequences" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let conn: any;
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as SequenceCreateBody;
    const sequenceName = String(body.sequenceName || "").trim();
    const description = String(body.description || "").trim() || null;
    const status = normalizeStatus(body.status);

    if (!sequenceName) {
      return NextResponse.json({ error: "Sequence name is required" }, { status: 400 });
    }

    if (sequenceName.length > 255) {
      return NextResponse.json({ error: "Sequence name is too long" }, { status: 400 });
    }

    const pool = await getPool();
    await ensureSequenceSchema(pool);

    const normalized = await normalizeSequenceSteps(pool, body.steps || []);
    if (normalized.error) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [insertSeq]: any = await conn.query(
      `
        INSERT INTO email_sequences (SequenceName, Description, CreatedBy, CompanyId, Status, CreatedAt, UpdatedAt)
        VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())
      `,
      [sequenceName, description, authUser.userId, authUser.companyId, status]
    );

    const sequenceId = Number(insertSeq?.insertId || 0);
    if (!sequenceId) {
      throw new Error("SEQUENCE_INSERT_FAILED");
    }

    for (const step of normalized.steps) {
      await conn.query(
        `
          INSERT INTO email_sequence_steps (
            SequenceId,
            CompanyId,
            StepOrder,
            TemplateId,
            DelayDays,
            DelayMinutes,
            CreatedAt
          )
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

    await conn.commit();

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

    const [stepRows]: any = await pool.query(
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

    return NextResponse.json(
      {
        message: "Sequence created successfully",
        item: {
          ...(rows?.[0] || null),
          steps: Array.isArray(stepRows) ? stepRows : [],
        },
      },
      { status: 201 }
    );
  } catch (error) {
    if (conn) {
      try {
        await conn.rollback();
      } catch {
        // ignore
      }
    }
    console.error("[email-sequences] POST error", error);
    return NextResponse.json({ error: "Failed to create sequence" }, { status: 500 });
  } finally {
    if (conn) conn.release();
  }
}

