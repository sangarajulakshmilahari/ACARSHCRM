import { parseSowDocxBuffer } from "./parser";

async function getTableColumns(conn: any, tableName: string): Promise<Set<string>> {
  const [rows]: any = await conn.query(
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

export class SowApiError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

type SaveSowInput = {
  conn: any;
  projectId?: number | null;
  customerId?: number | null;
  customerName?: string | null;
  replaceSowId?: number | null;
  fileName: string;
  fileBuffer: Buffer;
  createdBy: number | null;
  replaceExisting: boolean;
};

export async function saveSowForProject(input: SaveSowInput): Promise<{
  sowId: number;
  fileName: string;
  sowName: string;
  client: string;
  startDate: string | null;
  endDate: string | null;
  uploadedOn: string;
  numberOfPositions: number;
  numberOfResources: number;
}> {
  const {
    conn,
    projectId,
    customerName,
    replaceSowId,
    fileName,
    fileBuffer,
    createdBy,
    replaceExisting,
  } = input;

  if (!projectId && !customerName) {
    throw new SowApiError("Either projectId or customerName is required.", 400);
  }

  const parsed = await parseSowDocxBuffer(fileBuffer, fileName);
  const finalClient = String(customerName || parsed.client || "").trim() || "Unknown Client";

  const masterCols = await getTableColumns(conn, "SOWMaster");
  const has = (name: string) => masterCols.has(name);
  const hasClient = has("Client");

  const hasProjectId = has("ProjectId");
  const isProjectScoped = !!projectId && hasProjectId;
  if (!isProjectScoped && !hasClient) {
    throw new SowApiError("SOWMaster schema is missing required Client column for customer-level SOW.", 500);
  }

  const activeFilter = has("IsActive") ? "AND IsActive = 1" : "";
  const currentFilter = has("IsCurrent") ? "AND IsCurrent = 1" : "";
  const orderByCurrent = has("VersionNo") ? "ORDER BY VersionNo DESC" : "ORDER BY SOWId DESC";

  const scopeWhere = isProjectScoped
    ? "ProjectId = ?"
    : hasProjectId
      ? "ProjectId IS NULL AND LOWER(TRIM(COALESCE(Client, ''))) = LOWER(TRIM(?))"
      : "LOWER(TRIM(COALESCE(Client, ''))) = LOWER(TRIM(?))";
  const scopeParams = isProjectScoped ? [projectId] : [finalClient];

  let currentSow: any = null;

  if (replaceSowId && !Number.isNaN(Number(replaceSowId))) {
    const [replaceRows]: any = await conn.query(
      `
      SELECT
        SOWId
        ${hasProjectId ? ", ProjectId" : ""}
        ${hasClient ? ", Client" : ""}
      FROM SOWMaster
      WHERE SOWId = ?
        ${activeFilter}
      LIMIT 1
      `,
      [Number(replaceSowId)]
    );

    const replaceTarget = replaceRows?.[0] ?? null;
    if (!replaceTarget) {
      throw new SowApiError("SOW to replace was not found.", 404);
    }

    const replaceProjectId = replaceTarget.ProjectId === null || replaceTarget.ProjectId === undefined
      ? null
      : Number(replaceTarget.ProjectId);
    if (isProjectScoped && replaceProjectId !== Number(projectId)) {
      throw new SowApiError("Replacement target does not belong to the selected project.", 400);
    }

    if (!isProjectScoped && replaceProjectId !== null) {
      throw new SowApiError("Replacement target is project-linked; upload replacement from project context.", 400);
    }

    currentSow = replaceTarget;
  } else {
    const [currentRows]: any = await conn.query(
      `
      SELECT SOWId
      FROM SOWMaster
      WHERE ${scopeWhere}
        ${activeFilter}
        ${currentFilter}
      ${orderByCurrent}
      LIMIT 1
      `,
      scopeParams
    );
    currentSow = currentRows?.[0] ?? null;
  }

  if (currentSow && !replaceExisting) {
    throw new SowApiError(
      "A Statement of Work already exists for this scope. Use Replace SOW to upload a new version.",
      409
    );
  }

  const [versionRows]: any = await conn.query(
    `SELECT ${has("VersionNo") ? "COALESCE(MAX(VersionNo), 0)" : "0"} AS LastVersion FROM SOWMaster WHERE ${scopeWhere}`,
    scopeParams
  );
  const nextVersion = has("VersionNo") ? Number(versionRows?.[0]?.LastVersion || 0) + 1 : 1;

  const fileNameColumn = has("FileName")
    ? "FileName"
    : has("SOWFileName")
      ? "SOWFileName"
      : null;
  const fileDataColumn = has("FileData")
    ? "FileData"
    : has("SOWFileData")
      ? "SOWFileData"
      : null;

  if (!fileNameColumn) {
    throw new SowApiError("SOWMaster must include either FileName or SOWFileName column.", 500);
  }
  if (!fileDataColumn) {
    throw new SowApiError("SOWMaster must include either FileData or SOWFileData column.", 500);
  }

  const columns: string[] = [];
  const values: any[] = [];

  const addColumn = (columnName: string, value: any) => {
    if (!has(columnName)) return;
    columns.push(columnName);
    values.push(value);
  };

  addColumn("ProjectId", projectId ?? null);
  addColumn("SOWName", parsed.sowName);
  addColumn("Client", finalClient);
  addColumn(fileNameColumn, fileName);
  addColumn(fileDataColumn, fileBuffer);
  addColumn("EffectiveDate", parsed.effectiveDate);
  addColumn("StartDate", parsed.startDate);
  addColumn("EndDate", parsed.endDate);
  addColumn("NumberOfPositions", 0);
  addColumn("NumberOfResources", parsed.resources.length);
  addColumn("ParseStatus", "Success");
  addColumn("ParseMessage", null);
  addColumn("VersionNo", nextVersion);
  addColumn("ReplacesSOWId", currentSow?.SOWId ?? null);
  addColumn("IsCurrent", 1);
  addColumn("Status", "Active");
  addColumn("UploadedOn", { raw: "NOW()" } as any);
  addColumn("CreatedBy", createdBy);
  addColumn("IsActive", 1);

  if (!columns.includes("SOWName") || !columns.includes("Client")) {
    throw new SowApiError("SOWMaster schema is missing required columns (SOWName/Client).", 500);
  }

  const placeholders = values
    .map((value) => ((value && typeof value === "object" && (value as any).raw === "NOW()") ? "NOW()" : "?"))
    .join(", ");
  const valueParams = values.filter((value) => !(value && typeof value === "object" && (value as any).raw === "NOW()"));

  const [insertResult]: any = await conn.query(
    `
    INSERT INTO SOWMaster (
      ${columns.join(",\n      ")}
    )
    VALUES (${placeholders})
    `,
    valueParams
  );

  const sowId = Number(insertResult.insertId);

  const positionCols = await getTableColumns(conn, "SOWPosition");
  const pHas = (name: string) => positionCols.has(name);
  const resourceCols = await getTableColumns(conn, "SOWPositionResource");
  const rHas = (name: string) => resourceCols.has(name);
  let positionNumber = 1;
  for (const resource of parsed.resources) {
    const [positionInsert]: any = await conn.query(
      `
      INSERT INTO SOWPosition (SOWId, PositionNumber, Role${pHas("StartDate") ? ", StartDate" : ""}${pHas("EndDate") ? ", EndDate" : ""}${pHas("IsActive") ? ", IsActive" : ""})
      VALUES (?, ?, ?${pHas("StartDate") ? ", ?" : ""}${pHas("EndDate") ? ", ?" : ""}${pHas("IsActive") ? ", 1" : ""})
      `,
      [
        sowId,
        positionNumber,
        resource.role.trim(),
        ...(pHas("StartDate") ? [resource.startDate] : []),
        ...(pHas("EndDate") ? [resource.endDate] : []),
      ]
    );
    const sowPositionId = Number(positionInsert.insertId);
    positionNumber += 1;

    const rColumns: string[] = ["SOWPositionId", "Resource"];
    const rValues: any[] = [sowPositionId, resource.resourceName];
    if (rHas("Location")) {
      rColumns.push("Location");
      rValues.push(resource.location);
    }
    if (rHas("EmployeeCode")) {
      rColumns.push("EmployeeCode");
      rValues.push(null);
    }
    if (rHas("StartDate")) {
      rColumns.push("StartDate");
      rValues.push(resource.startDate);
    }
    if (rHas("EndDate")) {
      rColumns.push("EndDate");
      rValues.push(resource.endDate);
    }
    if (rHas("EndReason")) {
      rColumns.push("EndReason");
      rValues.push(null);
    }
    if (rHas("BillingRate")) {
      rColumns.push("BillingRate");
      rValues.push(resource.hourlyRate);
    }
    if (rHas("SOWRate")) {
      rColumns.push("SOWRate");
      rValues.push(resource.hourlyRate);
    }
    if (rHas("RateType")) {
      rColumns.push("RateType");
      rValues.push(resource.hourlyRate !== null ? "Hourly" : null);
    }
    if (rHas("BusinessHours")) {
      rColumns.push("BusinessHours");
      rValues.push(resource.businessHours);
    }
    if (rHas("BudgetedHours")) {
      rColumns.push("BudgetedHours");
      rValues.push(resource.budgetedHours);
    }
    if (rHas("BudgetedFees")) {
      rColumns.push("BudgetedFees");
      rValues.push(resource.budgetedFees);
    }

    await conn.query(
      `
      INSERT INTO SOWPositionResource (${rColumns.join(", ")})
      VALUES (${rColumns.map(() => "?").join(", ")})
      `,
      rValues
    );
  }

  const numberOfPositions = parsed.resources.length;
  const numberOfResources = parsed.resources.length;

  if (has("NumberOfPositions") || has("NumberOfResources")) {
    const setParts: string[] = [];
    const setValues: any[] = [];
    if (has("NumberOfPositions")) {
      setParts.push("NumberOfPositions = ?");
      setValues.push(numberOfPositions);
    }
    if (has("NumberOfResources")) {
      setParts.push("NumberOfResources = ?");
      setValues.push(numberOfResources);
    }
    await conn.query(
      `
      UPDATE SOWMaster
      SET ${setParts.join(", ")}
      WHERE SOWId = ?
      `,
      [...setValues, sowId]
    );
  }

  if (currentSow?.SOWId && (has("IsCurrent") || has("Status") || has("ReplacedBySOWId"))) {
    const setParts: string[] = [];
    const setValues: any[] = [];
    if (has("IsCurrent")) {
      setParts.push("IsCurrent = 0");
    }
    if (has("Status")) {
      setParts.push("Status = 'Replaced'");
    }
    if (has("ReplacedBySOWId")) {
      setParts.push("ReplacedBySOWId = ?");
      setValues.push(sowId);
    }
    await conn.query(
      `
      UPDATE SOWMaster
      SET ${setParts.join(",\n          ")}
      WHERE SOWId = ?
      `,
      [...setValues, currentSow.SOWId]
    );
  }

  const [savedRows]: any = await conn.query(
    `
    SELECT
      SOWId,
      ${fileNameColumn} AS FileName,
      SOWName,
      Client,
      ${has("StartDate") ? "StartDate" : "NULL AS StartDate"},
      ${has("EndDate") ? "EndDate" : "NULL AS EndDate"},
      ${has("UploadedOn") ? "UploadedOn" : "NULL AS UploadedOn"},
      ${has("NumberOfPositions") ? "NumberOfPositions" : "NULL AS NumberOfPositions"},
      ${has("NumberOfResources") ? "NumberOfResources" : "NULL AS NumberOfResources"}
    FROM SOWMaster
    WHERE SOWId = ?
    LIMIT 1
    `,
    [sowId]
  );

  const saved = savedRows?.[0];
  return {
    sowId,
    fileName: String(saved?.FileName || fileName),
    sowName: String(saved?.SOWName || parsed.sowName),
    client: String(saved?.Client || finalClient),
    startDate: saved?.StartDate ? String(saved.StartDate).slice(0, 10) : null,
    endDate: saved?.EndDate ? String(saved.EndDate).slice(0, 10) : null,
    uploadedOn: saved?.UploadedOn ? new Date(saved.UploadedOn).toISOString() : new Date().toISOString(),
    numberOfPositions: Number(saved?.NumberOfPositions || numberOfPositions),
    numberOfResources: Number(saved?.NumberOfResources || numberOfResources),
  };
}

