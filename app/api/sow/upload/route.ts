import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/config/db";
import { getAuthUser } from "@/app/api/lib/auth";
import { saveSowForProject, SowApiError } from "../_lib/store";

export async function POST(req: NextRequest) {
  let conn: any;
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get("file");
    const rawProjectId = formData.get("projectId");
    const projectId = rawProjectId === null || String(rawProjectId).trim().length === 0
      ? null
      : Number(rawProjectId);
    const customerName = String(formData.get("customerName") || "").trim() || null;
    const replaceSowIdRaw = formData.get("replaceSowId");
    const replaceSowId = replaceSowIdRaw === null || String(replaceSowIdRaw).trim().length === 0
      ? null
      : Number(replaceSowIdRaw);
    const replaceExisting = true;

    if ((!projectId || Number.isNaN(projectId)) && !customerName) {
      return NextResponse.json(
        { error: "Either a valid projectId or customerName is required" },
        { status: 400 }
      );
    }

    if (replaceSowId !== null && Number.isNaN(replaceSowId)) {
      return NextResponse.json({ error: "replaceSowId must be numeric" }, { status: 400 });
    }

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "DOCX file is required" }, { status: 400 });
    }

    const fileName = String(file.name || "").trim();
    if (!/\.docx$/i.test(fileName)) {
      return NextResponse.json({ error: "Only .docx files are supported" }, { status: 415 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);
    if (!fileBuffer.length) {
      return NextResponse.json({ error: "Uploaded file is empty" }, { status: 400 });
    }

    const pool = await getPool();
    conn = await pool.getConnection();

    try {
      await conn.beginTransaction();
      const saved = await saveSowForProject({
        conn,
        projectId,
        customerName,
        replaceSowId,
        fileName,
        fileBuffer,
        createdBy: authUser.userId,
        replaceExisting,
      });
      await conn.commit();

      return NextResponse.json(
        {
          success: true,
          message: "SOW uploaded and parsed successfully",
          parseStatus: "Success",
          sow: {
            SOWId: saved.sowId,
            FileName: saved.fileName,
            SOWName: saved.sowName,
            Client: saved.client,
            StartDate: saved.startDate,
            EndDate: saved.endDate,
            UploadedOn: saved.uploadedOn,
            NumberOfPositions: saved.numberOfPositions,
            NumberOfResources: saved.numberOfResources,
          },
        },
        { status: 201 }
      );
    } catch (err: any) {
      try {
        await conn.rollback();
      } catch {}

      if (err instanceof SowApiError) {
        return NextResponse.json(
          {
            success: false,
            parseStatus: "Failed",
            error: err.message,
          },
          { status: err.status }
        );
      }

      return NextResponse.json(
        {
          success: false,
          parseStatus: "Failed",
          error: err?.message || "Failed to upload and parse SOW",
        },
        { status: 500 }
      );
    } finally {
      if (conn) conn.release();
    }
  } catch (error: any) {
    if (conn) {
      try {
        await conn.rollback();
      } catch {}
      conn.release();
    }
    return NextResponse.json(
      { error: error?.message || "Failed to process upload" },
      { status: 500 }
    );
  }
}

