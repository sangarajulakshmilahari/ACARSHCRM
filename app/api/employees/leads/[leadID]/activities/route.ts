import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/config/db";


  //  POST → CREATE ACTIVITY

export async function POST(
  req: NextRequest,
  { params }: { params: { leadID: string } }
) {
  try {
    const { Mode, Notes, Status, ActivityDate } = await req.json();

    //  Strong validation
    if (!Mode?.trim() || !Notes?.trim() || !Status?.trim()) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const leadId = Number(params.leadID);
    if (isNaN(leadId)) {
      return NextResponse.json(
        { error: "Invalid LeadId" },
        { status: 400 }
      );
    }

    const pool = await getPool();

   
      //  1 Resolve StatusId
  
    const [statusRows]: any = await pool.query(
      `
      SELECT StatusId
      FROM LeadStatuses
      WHERE StatusName = ?
      `,
      [Status]
    );

    const StatusId = statusRows[0]?.StatusId ?? 1;

  
      //  2 Insert Activity
 
    const [insertResult]: any = await pool.query(
      `
      INSERT INTO LeadActivities
        (LeadId, ActivityType, Notes, StatusId, ActivityDate)
      VALUES (?, ?, ?, ?, ?)
      `,
      [
        leadId,
        Mode,
        Notes,
        StatusId,
        ActivityDate ? new Date(ActivityDate) : new Date(),
      ]
    );

    return NextResponse.json({
      ActivityId: insertResult.insertId,
      ActivityDate: ActivityDate ? new Date(ActivityDate) : new Date(),
      Mode,
      Notes,
      Status,
    });
  } catch (error) {
    console.error("Activity API error:", error);
    return NextResponse.json(
      { error: "Activity save failed" },
      { status: 500 }
    );
  }
}


  //  PUT → UPDATE ACTIVITY

export async function PUT(
  req: NextRequest,
  { params }: { params: { leadID: string } }
) {
  try {
    const { ActivityId, Mode, Notes, Status, ActivityDate } = await req.json();

    if (!ActivityId) {
      return NextResponse.json(
        { error: "ActivityId is required" },
        { status: 400 }
      );
    }

    const pool = await getPool();

   
      //  1 Resolve StatusId
   
    const [statusRows]: any = await pool.query(
      `
      SELECT StatusId
      FROM LeadStatuses
      WHERE StatusName = ?
      `,
      [Status]
    );

    const StatusId = statusRows[0]?.StatusId ?? 1;


      //  2 Update Activity
      
    await pool.query(
      `
      UPDATE LeadActivities
      SET
        ActivityType = ?,
        Notes = ?,
        StatusId = ?,
        ActivityDate = ?
      WHERE ActivityId = ?
      `,
      [
        Mode,
        Notes,
        StatusId,
        ActivityDate ? new Date(ActivityDate) : new Date(),
        ActivityId,
      ]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Activity PUT error:", error);
    return NextResponse.json(
      { error: "Activity update failed" },
      { status: 500 }
    );
  }
}
