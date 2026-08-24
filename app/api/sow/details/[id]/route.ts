import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/config/db";
import { getAuthUser } from "@/app/api/lib/auth";

async function getTableColumns(poolOrConn: any, tableName: string): Promise<Set<string>> {
  const [rows]: any = await poolOrConn.query(
    `
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
    `,
    [tableName]
  );
  return new Set((rows || []).map((r: any) => String(r.COLUMN_NAME)));
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sowId = Number(params.id);
    if (!sowId || Number.isNaN(sowId)) {
      return NextResponse.json({ error: "Invalid sowId" }, { status: 400 });
    }

    const pool = await getPool();
    const masterCols = await getTableColumns(pool, "SOWMaster");
    const positionCols = await getTableColumns(pool, "SOWPosition");
    const resourceCols = await getTableColumns(pool, "SOWPositionResource");
    const mHas = (name: string) => masterCols.has(name);
    const pHas = (name: string) => positionCols.has(name);
    const rHas = (name: string) => resourceCols.has(name);
    const fileNameCol = mHas("FileName") ? "FileName" : mHas("SOWFileName") ? "SOWFileName" : null;

    const positionSelectCols = [
      "sp.SOWPositionId",
      "sp.SOWId",
      "sp.PositionNumber",
      "sp.Role",
      pHas("StartDate") ? "sp.StartDate" : "NULL AS StartDate",
      pHas("EndDate") ? "sp.EndDate" : "NULL AS EndDate",
    ];

    const resourceSelectCols = [
      "spr.SOWPositionResourceId",
      "spr.SOWPositionId",
      rHas("Resource") ? "spr.Resource" : "NULL AS Resource",
      rHas("ResourceId") ? "spr.ResourceId" : "NULL AS ResourceId",
      rHas("Location") ? "spr.Location" : "NULL AS Location",
      rHas("EmployeeCode") ? "spr.EmployeeCode" : "NULL AS EmployeeCode",
      rHas("BusinessHours") ? "spr.BusinessHours" : "NULL AS BusinessHours",
      rHas("StartDate") ? "spr.StartDate" : "NULL AS StartDate",
      rHas("EndDate") ? "spr.EndDate" : "NULL AS EndDate",
      rHas("BillingStartDate") ? "spr.BillingStartDate" : "NULL AS BillingStartDate",
      rHas("BillingEndDate") ? "spr.BillingEndDate" : "NULL AS BillingEndDate",
      rHas("BudgetedHours") ? "spr.BudgetedHours" : "NULL AS BudgetedHours",
      rHas("BudgetedFees") ? "spr.BudgetedFees" : "NULL AS BudgetedFees",
      rHas("Currency") ? "spr.Currency" : "NULL AS Currency",
      rHas("RateType") ? "spr.RateType" : "NULL AS RateType",
      rHas("EndReason") ? "spr.EndReason" : "NULL AS EndReason",
      rHas("SOWRate") ? "spr.SOWRate" : "NULL AS SOWRate",
      rHas("BillingRate") ? "spr.BillingRate" : "NULL AS BillingRate",
    ];

    const [masterRows]: any = await pool.query(
      `
      SELECT s.*
      FROM SOWMaster s
      WHERE s.SOWId = ?
        ${mHas("IsActive") ? "AND s.IsActive = 1" : ""}
      LIMIT 1
      `,
      [sowId]
    );

    const master = masterRows?.[0];
    if (!master) {
      return NextResponse.json({ error: "SOW not found" }, { status: 404 });
    }

    const [positionRows]: any = await pool.query(
      `
      SELECT
        ${positionSelectCols.join(",\n        ")}
      FROM SOWPosition sp
      WHERE sp.SOWId = ?
        ${pHas("IsActive") ? "AND COALESCE(sp.IsActive, 1) = 1" : ""}
      ORDER BY sp.PositionNumber ASC, sp.Role ASC
      `,
      [sowId]
    );

    const [resourceRows]: any = await pool.query(
      `
      SELECT
        ${resourceSelectCols.join(",\n        ")}
      FROM SOWPositionResource spr
      INNER JOIN SOWPosition sp
        ON sp.SOWPositionId = spr.SOWPositionId
      WHERE sp.SOWId = ?
        ${pHas("IsActive") ? "AND COALESCE(sp.IsActive, 1) = 1" : ""}
      ORDER BY sp.PositionNumber ASC, spr.Resource ASC
      `,
      [sowId]
    );

    const resourcesByPosition = new Map<number, any[]>();
    for (const resource of resourceRows || []) {
      const positionId = Number(resource.SOWPositionId);
      if (!resourcesByPosition.has(positionId)) {
        resourcesByPosition.set(positionId, []);
      }

      const billingRateRaw =
        resource.BillingRate ??
        resource.billingRate ??
        resource.SOWRate ??
        resource.sowRate ??
        null;

      resourcesByPosition.get(positionId)!.push({
        SOWPositionResourceId: Number(resource.SOWPositionResourceId),
        SOWPositionId: Number(resource.SOWPositionId),
        Resource: resource.Resource,
        ResourceId: resource.ResourceId ?? null,
        Location: resource.Location,
        EmployeeCode: resource.EmployeeCode,
        BusinessHours: resource.BusinessHours ?? null,
        StartDate: resource.StartDate,
        EndDate: resource.EndDate,
        BillingStartDate: resource.BillingStartDate ?? null,
        BillingEndDate: resource.BillingEndDate ?? null,
        BudgetedHours:
          resource.BudgetedHours !== null && resource.BudgetedHours !== undefined
            ? Number(resource.BudgetedHours)
            : null,
        BudgetedFees:
          resource.BudgetedFees !== null && resource.BudgetedFees !== undefined
            ? Number(resource.BudgetedFees)
            : null,
        Currency: resource.Currency ?? null,
        RateType: resource.RateType ?? null,
        EndReason: resource.EndReason,
        SOWRate:
          resource.SOWRate !== null && resource.SOWRate !== undefined
            ? Number(resource.SOWRate)
            : null,
        BillingRate:
          billingRateRaw !== null && billingRateRaw !== undefined
            ? Number(billingRateRaw)
          : null,
      });
    }

    const positions = (positionRows || []).map((position: any) => ({
      SOWPositionId: Number(position.SOWPositionId),
      SOWId: Number(position.SOWId),
      PositionNumber: Number(position.PositionNumber),
      Role: position.Role,
      StartDate: position.StartDate,
      EndDate: position.EndDate,
      Resources: resourcesByPosition.get(Number(position.SOWPositionId)) || [],
    }));

    return NextResponse.json({
      ...master,
      SOWId: Number(master.SOWId),
      FileName: fileNameCol ? master[fileNameCol] : null,
      ProjectId: mHas("ProjectId") && master.ProjectId !== null && master.ProjectId !== undefined ? Number(master.ProjectId) : null,
      NumberOfPositions: Number(positions.length || 0),
      NumberOfResources: Number((resourceRows || []).length || 0),
      VersionNo: mHas("VersionNo") ? Number(master.VersionNo || 1) : 1,
      Positions: positions,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to fetch SOW details" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  let conn: any;
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sowId = Number(params.id);
    if (!sowId || Number.isNaN(sowId)) {
      return NextResponse.json({ error: "Invalid sowId" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const sow = body?.SOW ?? body?.sow ?? body ?? {};
    const positionsInput = Array.isArray(body?.Positions)
      ? body.Positions
      : Array.isArray(body?.positions)
        ? body.positions
        : [];

    const pool = await getPool();
    conn = await pool.getConnection();
    const masterCols = await getTableColumns(conn, "SOWMaster");
    const positionCols = await getTableColumns(conn, "SOWPosition");
    const resourceCols = await getTableColumns(conn, "SOWPositionResource");
    const mHas = (name: string) => masterCols.has(name);
    const pHas = (name: string) => positionCols.has(name);
    const rHas = (name: string) => resourceCols.has(name);

    await conn.beginTransaction();

    const [existingRows]: any = await conn.query(
      `SELECT SOWId FROM SOWMaster WHERE SOWId = ? ${mHas("IsActive") ? "AND IsActive = 1" : ""} LIMIT 1`,
      [sowId]
    );
    if (!existingRows?.length) {
      await conn.rollback();
      return NextResponse.json({ error: "SOW not found" }, { status: 404 });
    }

    const masterSet: string[] = [];
    const masterValues: any[] = [];
    if (mHas("SOWName")) {
      masterSet.push("SOWName = COALESCE(?, SOWName)");
      masterValues.push(typeof sow?.SOWName === "string" ? sow.SOWName.trim() || null : null);
    }
    if (mHas("Client")) {
      masterSet.push("Client = COALESCE(?, Client)");
      masterValues.push(typeof sow?.Client === "string" ? sow.Client.trim() || null : null);
    }
    if (mHas("EffectiveDate")) {
      masterSet.push("EffectiveDate = ?");
      masterValues.push(sow?.EffectiveDate ?? null);
    }
    if (mHas("StartDate")) {
      masterSet.push("StartDate = ?");
      masterValues.push(sow?.StartDate ?? null);
    }
    if (mHas("EndDate")) {
      masterSet.push("EndDate = ?");
      masterValues.push(sow?.EndDate ?? null);
    }
    if (mHas("ParseStatus")) {
      masterSet.push("ParseStatus = COALESCE(?, ParseStatus)");
      masterValues.push(typeof sow?.ParseStatus === "string" ? sow.ParseStatus.trim() || null : null);
    }
    if (mHas("ParseMessage")) {
      masterSet.push("ParseMessage = COALESCE(?, ParseMessage)");
      masterValues.push(typeof sow?.ParseMessage === "string" ? sow.ParseMessage.trim() || null : null);
    }
    if (mHas("Status")) {
      masterSet.push("Status = COALESCE(?, Status)");
      masterValues.push(typeof sow?.Status === "string" ? sow.Status.trim() || null : null);
    }
    if (masterSet.length) {
      await conn.query(
        `
        UPDATE SOWMaster
        SET ${masterSet.join(", ")}
        WHERE SOWId = ?
        `,
        [...masterValues, sowId]
      );
    }

    const [existingPositionRows]: any = await conn.query(
      `SELECT SOWPositionId FROM SOWPosition WHERE SOWId = ?`,
      [sowId]
    );
    const existingPositionIds = new Set<number>(
      (existingPositionRows || []).map((r: any) => Number(r.SOWPositionId)).filter((v: number) => !Number.isNaN(v))
    );

    const retainedPositionIds = new Set<number>();

    for (let index = 0; index < positionsInput.length; index += 1) {
      const position = positionsInput[index] || {};
      const maybePositionId = Number(position?.SOWPositionId ?? NaN);
      const hasExisting = !Number.isNaN(maybePositionId) && existingPositionIds.has(maybePositionId);

      let finalPositionId: number;
      if (hasExisting) {
        await conn.query(
          `
          UPDATE SOWPosition
          SET
            ${[
              pHas("PositionNumber") ? "PositionNumber = ?" : null,
              pHas("Role") ? "Role = ?" : null,
              pHas("StartDate") ? "StartDate = ?" : null,
              pHas("EndDate") ? "EndDate = ?" : null,
              pHas("IsActive") ? "IsActive = 1" : null,
            ]
              .filter(Boolean)
              .join(",\n            ")}
          WHERE SOWPositionId = ?
            AND SOWId = ?
          `,
          [
            ...(pHas("PositionNumber") ? [Number(position?.PositionNumber || index + 1)] : []),
            ...(pHas("Role") ? [String(position?.Role || "").trim() || null] : []),
            ...(pHas("StartDate") ? [position?.StartDate ?? null] : []),
            ...(pHas("EndDate") ? [position?.EndDate ?? null] : []),
            maybePositionId,
            sowId,
          ]
        );
        finalPositionId = maybePositionId;
      } else {
        const [insertPosition]: any = await conn.query(
          `
          INSERT INTO SOWPosition (
            ${[
              "SOWId",
              pHas("PositionNumber") ? "PositionNumber" : null,
              pHas("Role") ? "Role" : null,
              pHas("StartDate") ? "StartDate" : null,
              pHas("EndDate") ? "EndDate" : null,
              pHas("IsActive") ? "IsActive" : null,
            ]
              .filter(Boolean)
              .join(", ")}
          )
          VALUES (${[
            "?",
            ...(pHas("PositionNumber") ? ["?"] : []),
            ...(pHas("Role") ? ["?"] : []),
            ...(pHas("StartDate") ? ["?"] : []),
            ...(pHas("EndDate") ? ["?"] : []),
            ...(pHas("IsActive") ? ["1"] : []),
          ].join(", ")})
          `,
          [
            sowId,
            ...(pHas("PositionNumber") ? [Number(position?.PositionNumber || index + 1)] : []),
            ...(pHas("Role") ? [String(position?.Role || "").trim() || null] : []),
            ...(pHas("StartDate") ? [position?.StartDate ?? null] : []),
            ...(pHas("EndDate") ? [position?.EndDate ?? null] : []),
          ]
        );
        finalPositionId = Number(insertPosition.insertId);
      }

      retainedPositionIds.add(finalPositionId);

      const resourcesInput = Array.isArray(position?.Resources)
        ? position.Resources
        : Array.isArray(position?.resources)
          ? position.resources
          : [];

      const [existingResourceRows]: any = await conn.query(
        `SELECT SOWPositionResourceId FROM SOWPositionResource WHERE SOWPositionId = ?`,
        [finalPositionId]
      );
      const existingResourceIds = new Set<number>(
        (existingResourceRows || [])
          .map((r: any) => Number(r.SOWPositionResourceId))
          .filter((v: number) => !Number.isNaN(v))
      );
      const retainedResourceIds = new Set<number>();

      for (const resource of resourcesInput) {
        const maybeResourceId = Number(resource?.SOWPositionResourceId ?? NaN);
        const hasExistingResource = !Number.isNaN(maybeResourceId) && existingResourceIds.has(maybeResourceId);

        const updateArgs = [
          finalPositionId,
          ...(rHas("Resource") ? [String(resource?.Resource || resource?.resource || "").trim() || null] : []),
          ...(rHas("ResourceId") ? [resource?.ResourceId ?? resource?.resourceId ?? null] : []),
          ...(rHas("Location") ? [String(resource?.Location || resource?.location || "").trim() || null] : []),
          ...(rHas("EmployeeCode") ? [String(resource?.EmployeeCode || resource?.employeeCode || "").trim() || null] : []),
          ...(rHas("BusinessHours")
            ? [String(resource?.BusinessHours || resource?.businessHours || "").trim() || null]
            : []),
          ...(rHas("StartDate") ? [resource?.StartDate ?? null] : []),
          ...(rHas("EndDate") ? [resource?.EndDate ?? null] : []),
          ...(rHas("BillingStartDate") ? [resource?.BillingStartDate ?? null] : []),
          ...(rHas("BillingEndDate") ? [resource?.BillingEndDate ?? null] : []),
          ...(rHas("BudgetedHours") ? [resource?.BudgetedHours ?? null] : []),
          ...(rHas("BudgetedFees") ? [resource?.BudgetedFees ?? null] : []),
          ...(rHas("Currency") ? [String(resource?.Currency || resource?.currency || "").trim() || null] : []),
          ...(rHas("RateType") ? [String(resource?.RateType || resource?.rateType || "").trim() || null] : []),
          ...(rHas("SOWRate") ? [resource?.SOWRate ?? null] : []),
          ...(rHas("BillingRate") ? [resource?.BillingRate ?? null] : []),
          ...(rHas("EndReason") ? [String(resource?.EndReason || resource?.endReason || "").trim() || null] : []),
        ];

        if (hasExistingResource) {
          await conn.query(
            `
            UPDATE SOWPositionResource
            SET
              SOWPositionId = ?,
              ${[
                rHas("Resource") ? "Resource = ?" : null,
                rHas("ResourceId") ? "ResourceId = ?" : null,
                rHas("Location") ? "Location = ?" : null,
                rHas("EmployeeCode") ? "EmployeeCode = ?" : null,
                rHas("BusinessHours") ? "BusinessHours = ?" : null,
                rHas("StartDate") ? "StartDate = ?" : null,
                rHas("EndDate") ? "EndDate = ?" : null,
                rHas("BillingStartDate") ? "BillingStartDate = ?" : null,
                rHas("BillingEndDate") ? "BillingEndDate = ?" : null,
                rHas("BudgetedHours") ? "BudgetedHours = ?" : null,
                rHas("BudgetedFees") ? "BudgetedFees = ?" : null,
                rHas("Currency") ? "Currency = ?" : null,
                rHas("RateType") ? "RateType = ?" : null,
                rHas("SOWRate") ? "SOWRate = ?" : null,
                rHas("BillingRate") ? "BillingRate = ?" : null,
                rHas("EndReason") ? "EndReason = ?" : null,
              ]
                .filter(Boolean)
                .join(",\n              ")}
            WHERE SOWPositionResourceId = ?
            `,
            [...updateArgs, maybeResourceId]
          );
          retainedResourceIds.add(maybeResourceId);
        } else {
          const [insertResource]: any = await conn.query(
            `
            INSERT INTO SOWPositionResource (
              ${[
                "SOWPositionId",
                rHas("Resource") ? "Resource" : null,
                rHas("ResourceId") ? "ResourceId" : null,
                rHas("Location") ? "Location" : null,
                rHas("EmployeeCode") ? "EmployeeCode" : null,
                rHas("BusinessHours") ? "BusinessHours" : null,
                rHas("StartDate") ? "StartDate" : null,
                rHas("EndDate") ? "EndDate" : null,
                rHas("BillingStartDate") ? "BillingStartDate" : null,
                rHas("BillingEndDate") ? "BillingEndDate" : null,
                rHas("BudgetedHours") ? "BudgetedHours" : null,
                rHas("BudgetedFees") ? "BudgetedFees" : null,
                rHas("Currency") ? "Currency" : null,
                rHas("RateType") ? "RateType" : null,
                rHas("SOWRate") ? "SOWRate" : null,
                rHas("BillingRate") ? "BillingRate" : null,
                rHas("EndReason") ? "EndReason" : null,
              ]
                .filter(Boolean)
                .join(",\n              ")}
            )
            VALUES (${[
              "?",
              ...(rHas("Resource") ? ["?"] : []),
              ...(rHas("ResourceId") ? ["?"] : []),
              ...(rHas("Location") ? ["?"] : []),
              ...(rHas("EmployeeCode") ? ["?"] : []),
              ...(rHas("BusinessHours") ? ["?"] : []),
              ...(rHas("StartDate") ? ["?"] : []),
              ...(rHas("EndDate") ? ["?"] : []),
              ...(rHas("BillingStartDate") ? ["?"] : []),
              ...(rHas("BillingEndDate") ? ["?"] : []),
              ...(rHas("BudgetedHours") ? ["?"] : []),
              ...(rHas("BudgetedFees") ? ["?"] : []),
              ...(rHas("Currency") ? ["?"] : []),
              ...(rHas("RateType") ? ["?"] : []),
              ...(rHas("SOWRate") ? ["?"] : []),
              ...(rHas("BillingRate") ? ["?"] : []),
              ...(rHas("EndReason") ? ["?"] : []),
            ].join(", ")})
            `,
            updateArgs
          );
          retainedResourceIds.add(Number(insertResource.insertId));
        }
      }

      const resourceIdsToDelete = [...existingResourceIds].filter((id) => !retainedResourceIds.has(id));
      if (resourceIdsToDelete.length) {
        await conn.query(
          `DELETE FROM SOWPositionResource WHERE SOWPositionResourceId IN (${resourceIdsToDelete.map(() => "?").join(",")})`,
          resourceIdsToDelete
        );
      }
    }

    const positionIdsToDeactivate = [...existingPositionIds].filter((id) => !retainedPositionIds.has(id));
    if (positionIdsToDeactivate.length) {
      await conn.query(
        `DELETE FROM SOWPositionResource WHERE SOWPositionId IN (${positionIdsToDeactivate.map(() => "?").join(",")})`,
        positionIdsToDeactivate
      );
      if (pHas("IsActive")) {
        await conn.query(
          `UPDATE SOWPosition SET IsActive = 0 WHERE SOWPositionId IN (${positionIdsToDeactivate.map(() => "?").join(",")})`,
          positionIdsToDeactivate
        );
      } else {
        await conn.query(
          `DELETE FROM SOWPosition WHERE SOWPositionId IN (${positionIdsToDeactivate.map(() => "?").join(",")})`,
          positionIdsToDeactivate
        );
      }
    }

    if (mHas("NumberOfPositions") || mHas("NumberOfResources")) {
      const [countRows]: any = await conn.query(
        `
        SELECT
          (
            SELECT COUNT(*)
            FROM SOWPosition
            WHERE SOWId = ?
              ${pHas("IsActive") ? "AND COALESCE(IsActive, 1) = 1" : ""}
          ) AS PositionCount,
          (
            SELECT COUNT(*)
            FROM SOWPositionResource spr
            INNER JOIN SOWPosition sp ON sp.SOWPositionId = spr.SOWPositionId
            WHERE sp.SOWId = ?
              ${pHas("IsActive") ? "AND COALESCE(sp.IsActive, 1) = 1" : ""}
          ) AS ResourceCount
        `,
        [sowId, sowId]
      );

      const updateParts: string[] = [];
      const updateVals: any[] = [];
      if (mHas("NumberOfPositions")) {
        updateParts.push("NumberOfPositions = ?");
        updateVals.push(Number(countRows?.[0]?.PositionCount || 0));
      }
      if (mHas("NumberOfResources")) {
        updateParts.push("NumberOfResources = ?");
        updateVals.push(Number(countRows?.[0]?.ResourceCount || 0));
      }

      await conn.query(
        `
        UPDATE SOWMaster
        SET ${updateParts.join(", ")}
        WHERE SOWId = ?
        `,
        [...updateVals, sowId]
      );
    }

    await conn.commit();

    const detailReq = new NextRequest(`${req.nextUrl.origin}/api/sow/details/${sowId}`, {
      headers: req.headers,
    });
    return await GET(detailReq, { params: { id: String(sowId) } });
  } catch (error: any) {
    if (conn) {
      try {
        await conn.rollback();
      } catch {}
    }
    return NextResponse.json({ error: error?.message || "Failed to update SOW details" }, { status: 500 });
  } finally {
    if (conn) conn.release();
  }
}

