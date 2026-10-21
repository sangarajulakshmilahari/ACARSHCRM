import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/config/db";
import { getAuthUser } from "@/app/api/lib/auth";
import { canUserViewLeadById } from "@/app/api/lib/lead-access";
import { loadRecordCompanyId, resolveWriteCompanyId } from "@/app/api/lib/company-tenancy";
import { calculateAndStoreLeadScore } from "@/app/api/lib/lead-scoring";

const deps = {
  getPool,
  getAuthUser,
  canUserViewLeadById,
};

/* ----------------------------------------------------
   POST → CREATE NEW OPPORTUNITY
---------------------------------------------------- */

export async function POST(
  req: NextRequest,
  { params }: { params: { leadID: string } }
) {
  const authUser = await deps.getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const leadId = Number(params.leadID);
  if (isNaN(leadId)) {
    return NextResponse.json({ error: "Invalid Lead ID" }, { status: 400 });
  }

  const pool = await deps.getPool();
  const hasLeadAccess = await deps.canUserViewLeadById(pool, authUser, leadId);
  if (!hasLeadAccess) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const companyId = resolveWriteCompanyId(
    authUser.companyId,
    await loadRecordCompanyId(pool, "lead", leadId)
  );

  const {
    projectId,
    serviceId,
    statusId,
    probabilityId,
    engagementId,
    technologies,
    otherTechnologies,
    hasOtherTechnology,
    isComplete,
  } = await req.json();

  if (
    !statusId ||
    !serviceId ||
    !probabilityId ||
    !engagementId ||
    !Array.isArray(technologies)
  ) {
    return NextResponse.json(
      { error: "Invalid request payload" },
      { status: 400 }
    );
  }

  let conn: any;
  const normalizedProjectId =
    projectId !== undefined && projectId !== null && projectId !== ""
      ? Number(projectId)
      : null;

  if (normalizedProjectId !== null && Number.isNaN(normalizedProjectId)) {
    return NextResponse.json(
      { error: "Invalid ProjectId" },
      { status: 400 }
    );
  }

  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    if (normalizedProjectId !== null) {
      const [projectRows]: any = await conn.query(
        `
        SELECT ProjectId
        FROM Projects
        WHERE ProjectId = ?
          AND CustomerId = ?
          AND COALESCE(IsHidden, 0) = 0
        `,
        [normalizedProjectId, leadId]
      );

      if (!projectRows.length) {
        await conn.rollback();
        return NextResponse.json(
          { error: "Selected project does not belong to this customer" },
          { status: 400 }
        );
      }
    }

    /* 1 INSERT OPPORTUNITY */
    const [insertResult]: any = await conn.query(
      `
      INSERT INTO Opportunities
      (
        LeadId,
        CompanyId,
        ProjectId,
        ServiceId,
        ProbabilityId,
        EngagementId,
        Opportunity_StatusId,
        IsCompleted,
        CreatedOn,
        IsDeleted
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), 0)
      `,
      [
        leadId,
        companyId,
        normalizedProjectId,
        serviceId,
        probabilityId,
        engagementId,
        statusId,
        Number(Boolean(isComplete)),
      ]
    );

    const OpportunityId = insertResult.insertId;

    /* 2 RESOLVE TECHNOLOGIES (HANDLE "OTHER") */
    let finalTechnologyIds = [...technologies];

    if (
      hasOtherTechnology &&
      otherTechnologies &&
      Object.keys(otherTechnologies).length > 0
    ) {
      for (const [otherId, techName] of Object.entries(otherTechnologies)) {
        const [existing]: any = await conn.query(
          `SELECT SubCategoryId FROM SubCategory WHERE SubCategoryName = ?`,
          [techName]
        );

        let newSubCategoryId: number;

        if (existing.length > 0) {
          newSubCategoryId = existing[0].SubCategoryId;
        } else {
          const [insert]: any = await conn.query(
            `
            INSERT INTO SubCategory (SubCategoryName, CategoryId)
            SELECT ?, CategoryId
            FROM SubCategory
            WHERE SubCategoryId = ?
            `,
            [techName, Number(otherId)]
          );

          newSubCategoryId = insert.insertId;
        }

        finalTechnologyIds = finalTechnologyIds.filter(
          (id) => id !== Number(otherId)
        );

        finalTechnologyIds.push(newSubCategoryId);
      }
    }

    /* 3 INSERT TECHNOLOGIES */
    for (const subCategoryId of finalTechnologyIds) {
      await conn.query(
        `
        INSERT INTO Opportunity_categories
        (OpportunityId, CompanyId, SubCategoryId)
        VALUES (?, ?, ?)
        `,
        [OpportunityId, companyId, subCategoryId]
      );
    }

    await conn.commit();

    await calculateAndStoreLeadScore(pool, leadId);

    /* 4 RETURN FULL ROW */
    const [rows]: any = await pool.query(
      getOpportunitySelectQuery(),
      [OpportunityId]
    );

    return NextResponse.json(rows[0]);
  } catch (error) {
    if (conn) await conn.rollback();
    console.error("POST opportunity error:", error);
    return NextResponse.json(
      { error: "Failed to create opportunity" },
      { status: 500 }
    );
  } finally {
    if (conn) conn.release();
  }
}

/* ----------------------------------------------------
   PUT → UPDATE EXISTING OPPORTUNITY
---------------------------------------------------- */

export async function PUT(
  req: NextRequest,
  { params }: { params: { leadID: string } }
) {
  const authUser = await deps.getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const {
    OpportunityId,
    projectId,
    serviceId,
    statusId,
    probabilityId,
    engagementId,
    technologies,
    otherTechnologies,
    hasOtherTechnology,
    isComplete,
  } = await req.json();

  if (
    !OpportunityId ||
    !serviceId ||
    !statusId ||
    !probabilityId ||
    !engagementId ||
    !Array.isArray(technologies)
  ) {
    return NextResponse.json(
      { error: "Invalid request payload" },
      { status: 400 }
    );
  }

  const pool = await deps.getPool();
  let conn: any;
  const leadId = Number(params.leadID);
  const normalizedProjectId =
    projectId !== undefined && projectId !== null && projectId !== ""
      ? Number(projectId)
      : null;

  if (normalizedProjectId !== null && Number.isNaN(normalizedProjectId)) {
    return NextResponse.json(
      { error: "Invalid ProjectId" },
      { status: 400 }
    );
  }

  if (isNaN(leadId)) {
    return NextResponse.json({ error: "Invalid Lead ID" }, { status: 400 });
  }

  const hasLeadAccess = await deps.canUserViewLeadById(pool, authUser, leadId);
  if (!hasLeadAccess) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const companyId = resolveWriteCompanyId(
    authUser.companyId,
    await loadRecordCompanyId(pool, "lead", leadId)
  );

  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [existingRows]: any = await conn.query(
      `
      SELECT OpportunityId, ProjectId
      FROM Opportunities
      WHERE OpportunityId = ?
        AND LeadId = ?
        AND IsDeleted = 0
      `,
      [OpportunityId, leadId]
    );

    if (!existingRows.length) {
      await conn.rollback();
      return NextResponse.json(
        { error: "Opportunity not found" },
        { status: 404 }
      );
    }

    const existingOpportunity = existingRows[0];
    const currentProjectId = existingOpportunity.ProjectId ?? null;
    let projectIdToSave =
      normalizedProjectId !== null ? normalizedProjectId : currentProjectId;

    if (projectIdToSave !== null) {
      const [projectRows]: any = await conn.query(
        `
        SELECT ProjectId
        FROM Projects
        WHERE ProjectId = ?
          AND CustomerId = ?
          AND COALESCE(IsHidden, 0) = 0
        `,
        [projectIdToSave, leadId]
      );

      if (!projectRows.length) {
        await conn.rollback();
        return NextResponse.json(
          { error: "Selected project does not belong to this customer" },
          { status: 400 }
        );
      }
    }

    /* 2 RESET TECHNOLOGIES */
    await conn.query(
      `
      DELETE FROM Opportunity_categories
      WHERE OpportunityId = ?
      `,
      [OpportunityId]
    );

    /* 3 RESOLVE TECHNOLOGIES (HANDLE "OTHER") */
    let finalTechnologyIds = [...technologies];

    if (
      hasOtherTechnology &&
      otherTechnologies &&
      Object.keys(otherTechnologies).length > 0
    ) {
      for (const [otherId, techName] of Object.entries(otherTechnologies)) {
        const [existing]: any = await conn.query(
          `SELECT SubCategoryId FROM SubCategory WHERE SubCategoryName = ?`,
          [techName]
        );

        let newSubCategoryId: number;

        if (existing.length > 0) {
          newSubCategoryId = existing[0].SubCategoryId;
        } else {
          const [insert]: any = await conn.query(
            `
            INSERT INTO SubCategory (SubCategoryName, CategoryId)
            SELECT ?, CategoryId
            FROM SubCategory
            WHERE SubCategoryId = ?
            `,
            [techName, Number(otherId)]
          );

          newSubCategoryId = insert.insertId;
        }

        finalTechnologyIds = finalTechnologyIds.filter(
          (id) => id !== Number(otherId)
        );

        finalTechnologyIds.push(newSubCategoryId);
      }
    }

    /* 4 INSERT UPDATED TECHNOLOGIES */
    for (const subCategoryId of finalTechnologyIds) {
      await conn.query(
        `
        INSERT INTO Opportunity_categories
        (OpportunityId, CompanyId, SubCategoryId)
        VALUES (?, ?, ?)
        `,
        [OpportunityId, companyId, subCategoryId]
      );
    }

    /* 5 UPDATE OPPORTUNITY */
    await conn.query(
      `
      UPDATE Opportunities
      SET
        ProjectId = ?,
        ServiceId = ?,
        ProbabilityId = ?,
        EngagementId = ?,
        Opportunity_StatusId = ?,
        IsCompleted = COALESCE(?, IsCompleted),
        ModifiedOn = NOW()
      WHERE OpportunityId = ?
        AND LeadId = ?
      `,
      [
        projectIdToSave,
        serviceId,
        probabilityId,
        engagementId,
        statusId,
        isComplete === undefined || isComplete === null
          ? null
          : Number(Boolean(isComplete)),
        OpportunityId,
        leadId,
      ]
    );

    await conn.commit();

    await calculateAndStoreLeadScore(pool, leadId);

    /* 5 RETURN UPDATED ROW */
    const [rows]: any = await pool.query(
      getOpportunitySelectQuery(),
      [OpportunityId]
    );

    return NextResponse.json(rows[0]);
  } catch (error) {
    if (conn) await conn.rollback();
    console.error("PUT opportunity error:", error);
    return NextResponse.json(
      { error: "Failed to update opportunity" },
      { status: 500 }
    );
  } finally {
    if (conn) conn.release();
  }
}

/* ----------------------------------------------------
   GET → FETCH SINGLE OPPORTUNITY FOR EDIT
---------------------------------------------------- */

export async function GET(
  req: NextRequest,
  { params }: { params: { leadID: string } }
) {
  const authUser = await deps.getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const leadId = Number(params.leadID);
  if (isNaN(leadId)) {
    return NextResponse.json({ error: "Invalid Lead ID" }, { status: 400 });
  }

  const pool = await deps.getPool();
  const hasLeadAccess = await deps.canUserViewLeadById(pool, authUser, leadId);
  if (!hasLeadAccess) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const OpportunityId = Number(searchParams.get("OpportunityId"));

  if (isNaN(OpportunityId)) {
    return NextResponse.json(
      { error: "OpportunityId required" },
      { status: 400 }
    );
  }

  try {
    const [rows]: any = await pool.query(
      `
      SELECT
        o.OpportunityId,
        o.ProjectId,
        pr.ProjectName,
        o.ServiceId,
        o.ProbabilityId,
        o.Opportunity_StatusId AS StatusId,
        o.EngagementId,

        s.ServiceName AS Service,
        p.ProbabilityRange AS Probability,
        os.Opportunities_StatusName AS Status,
        em.Engagement_ModelName AS EngagementModel,

        GROUP_CONCAT(sc.SubCategoryName SEPARATOR ', ') AS Technology,
        GROUP_CONCAT(sc.SubCategoryId SEPARATOR ',') AS TechnologyIds
      FROM Opportunities o
      LEFT JOIN Projects pr ON o.ProjectId = pr.ProjectId
      LEFT JOIN Services s ON o.ServiceId = s.ServiceId
      LEFT JOIN Probability p ON o.ProbabilityId = p.ProbabilityId
      LEFT JOIN Opportunities_Status os ON o.Opportunity_StatusId = os.Opportunity_StatusId
      LEFT JOIN Engagement_Models em ON o.EngagementId = em.EngagementId
      LEFT JOIN Opportunity_categories oc ON o.OpportunityId = oc.OpportunityId
      LEFT JOIN SubCategory sc ON oc.SubCategoryId = sc.SubCategoryId
      WHERE o.OpportunityId = ?
      GROUP BY
        o.OpportunityId,
        o.ProjectId,
        pr.ProjectName,
        o.ServiceId,
        o.ProbabilityId,
        o.Opportunity_StatusId,
        o.EngagementId,
        s.ServiceName,
        p.ProbabilityRange,
        os.Opportunities_StatusName,
        em.Engagement_ModelName
      `,
      [OpportunityId]
    );

    const row = rows[0];

    return NextResponse.json({
      ...row,
      TechnologyIds: row.TechnologyIds
        ? row.TechnologyIds.split(",").map(Number)
        : [],
    });
  } catch (err) {
    console.error("GET opportunity error:", err);
    return NextResponse.json(
      { error: "Failed to fetch opportunity" },
      { status: 500 }
    );
  }
}

/* ----------------------------------------------------
   SHARED SELECT QUERY
---------------------------------------------------- */

function getOpportunitySelectQuery() {
  return `
    SELECT
      o.OpportunityId,
      o.ProjectId,
      pr.ProjectName,

      -- IDS
      o.ServiceId,
      o.ProbabilityId,
      o.Opportunity_StatusId AS StatusId,
      o.EngagementId,

      -- DISPLAY
      s.ServiceName AS Service,
      p.ProbabilityRange AS Probability,
      os.Opportunities_StatusName AS Status,
      em.Engagement_ModelName AS EngagementModel,

      -- TECHNOLOGY
      GROUP_CONCAT(DISTINCT sc.SubCategoryName SEPARATOR ', ') AS Technology,
      GROUP_CONCAT(DISTINCT sc.SubCategoryId SEPARATOR ',') AS TechnologyIds,

      -- OPPORTUNITY CONTACTS (GROUPED)
      GROUP_CONCAT(
        DISTINCT CONCAT(
          'Full Name: ', oc.FullName, '\n',
          'Mobile: ', oc.MobilePhone, '\n',
          'Email: ', oc.WorkEmail
        )
        SEPARATOR '\n---\n'
      ) AS OpportunityContact,

      o.CreatedOn AS CreatedDate
    FROM Opportunities o
    LEFT JOIN Projects pr ON o.ProjectId = pr.ProjectId
    LEFT JOIN Services s ON o.ServiceId = s.ServiceId
    LEFT JOIN Probability p ON o.ProbabilityId = p.ProbabilityId
    LEFT JOIN Opportunities_Status os ON o.Opportunity_StatusId = os.Opportunity_StatusId
    LEFT JOIN Engagement_Models em ON o.EngagementId = em.EngagementId
    LEFT JOIN Opportunity_categories ocg ON o.OpportunityId = ocg.OpportunityId
    LEFT JOIN SubCategory sc ON ocg.SubCategoryId = sc.SubCategoryId
    LEFT JOIN OpportunityContacts oc
      ON o.OpportunityId = oc.OpportunityId
     AND oc.IsDeleted = 0
    WHERE o.OpportunityId = ?
    GROUP BY
      o.OpportunityId,
      o.ProjectId,
      pr.ProjectName,
      o.ServiceId,
      o.ProbabilityId,
      o.Opportunity_StatusId,
      o.EngagementId,
      s.ServiceName,
      p.ProbabilityRange,
      os.Opportunities_StatusName,
      em.Engagement_ModelName,
      o.CreatedOn
  `;
}
