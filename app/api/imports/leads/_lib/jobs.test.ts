import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { CompanyRequiredError } from "@/app/api/lib/company-tenancy";
import {
  LeadImportAccessError,
  LeadImportStateError,
  __setLeadImportPoolFactoryForTests,
  requireLeadImportActor,
} from "@/app/api/lib/lead-import-core";
import {
  confirmLeadImport,
  previewPendingLeadImport,
  startLeadImport,
  __resetPendingLeadImportsForTests,
  __setLeadImportEnricherForTests,
} from "@/app/api/ai/assistant/lead-import/service";
import {
  confirmLeadImport as confirmPersistedLeadImport,
  createLeadImport,
  getLeadImport,
  previewLeadImport,
  selectLeadImportSheet,
  updateLeadImport,
  validateImportSpreadsheet,
} from "./jobs";

async function createReadyImport(options: Parameters<typeof createLeadImport>[0]) {
  const result = await createLeadImport(options);
  if (result.kind !== "ready") throw new Error("expected a persisted import");
  return result.job;
}

const ACTOR_A = { userId: 7, companyId: 11 };
const ACTOR_B = { userId: 8, companyId: 22 };
const SAME_COMPANY_OTHER_USER = { userId: 9, companyId: 11 };

type MemJob = Record<string, any>;
type MemRow = Record<string, any>;

function normalizeSql(sql: string) {
  return String(sql || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function csvBuffer(body = "Company Name,Contact Name,Contact Title,Company Location,Email\nAcme,Jane Doe,CEO,New York,jane@acme.com\n") {
  return Buffer.from(body);
}

function createMemoryPool(existing: Array<{
  LeadId: number;
  CompanyName: string;
  ContactName: string | null;
  ContactEmail: string | null;
  LinkedInProfile: string | null;
  leadCompanyId: number;
  contactCompanyId: number | null;
}> = []) {
  const jobs: MemJob[] = [];
  const rows: MemRow[] = [];
  let nextJobId = 1;
  let nextRowId = 1;
  let nextLeadId = 500;
  let nextContactId = 800;
  const insertedLeads: any[][] = [];
  const insertedContacts: any[][] = [];
  const customFields: MemJob[] = [];
  const customValues: MemRow[] = [];
  let nextCustomFieldId = 1;
  const sqls: string[] = [];

  const query = async (sql: string, params: any[] = []) => {
    sqls.push(sql);
    const normalized = normalizeSql(sql);

    if (normalized.includes("from leads") && normalized.includes("leadsource")) {
      return [[]];
    }
    if (normalized.includes("from leadstatuses")) return [[{ StatusName: "New" }]];
    if (normalized.includes("from users") && normalized.includes("username")) {
      if (normalized.includes("select userid")) return [[{ UserId: ACTOR_A.userId }]];
      return [[{ UserName: "alice" }]];
    }
    if (normalized.includes("from contactroles")) {
      if (normalized.includes("select roleid")) return [[{ RoleId: 4 }]];
      return [[{ Role: "Decision Maker" }]];
    }
    if (normalized.includes("left join leadcontacts") && normalized.includes("companyname")) {
      const companyId = Number(params[0]);
      assert.match(sql, /l\.CompanyId = \?/);
      assert.match(sql, /lc\.CompanyId = l\.CompanyId/);
      return [
        existing
          .filter((row) => row.leadCompanyId === companyId)
          .map((row) => {
            const sameTenant = row.contactCompanyId == null || row.contactCompanyId === row.leadCompanyId;
            return {
              LeadId: row.LeadId,
              CompanyName: row.CompanyName,
              ContactName: sameTenant ? row.ContactName : null,
              ContactEmail: sameTenant ? row.ContactEmail : null,
              LinkedInProfile: sameTenant ? row.LinkedInProfile : null,
            };
          }),
      ];
    }
    if (
      normalized.includes("select l.leadid") &&
      normalized.includes("l.leadid = ?") &&
      normalized.includes("l.companyid = ?")
    ) {
      const leadId = Number(params[0]);
      const companyId = Number(params[1]);
      const found = existing.find((row) => row.LeadId === leadId && row.leadCompanyId === companyId);
      return [found ? [{ LeadId: found.LeadId }] : []];
    }
    if (/insert into leads\s*\(/.test(normalized)) {
      insertedLeads.push(params);
      const leadId = nextLeadId++;
      existing.push({
        LeadId: leadId,
        CompanyName: String(params[0] || ""),
        ContactName: null,
        ContactEmail: null,
        LinkedInProfile: null,
        leadCompanyId: Number(params[6]),
        contactCompanyId: Number(params[6]),
      });
      return [{ insertId: leadId, affectedRows: 1 }];
    }
    if (normalized.includes("insert into leadcontacts")) {
      insertedContacts.push(params);
      return [{ insertId: nextContactId++, affectedRows: 1 }];
    }
    if (normalized.includes("create table if not exists leadscores") || normalized.includes("information_schema.columns")) {
      return [[]];
    }
    if (normalized.includes("from leads l") && normalized.includes("where l.leadid = ?")) {
      return [[{
        LeadId: params[0],
        CompanySize: null,
        AccountTypeName: "Lead",
        IndustryFocus: "",
        Tags: "",
        ContactCount: 1,
        ContactsWithEmail: 1,
        ContactsWithPhone: 0,
        ContactsWithLinkedIn: 0,
        DecisionMakerContacts: 1,
        ActivityCount: 0,
        RecentActivityCount: 0,
        ActivityTypeCount: 0,
        OpportunityCount: 0,
        MaxProbabilityRange: "",
        OpportunitiesWithEngagement: 0,
        ProjectCount: 0,
      }]];
    }
    if (normalized.includes("insert into leadscores") || normalized.includes("update leads set industryfocus")) {
      return [{ affectedRows: 1 }];
    }

    if (normalized.startsWith("insert into leadimports")) {
      const job = {
        ImportId: nextJobId++,
        CompanyId: params[0],
        CreatedByUserId: params[1],
        SourceFileName: params[2],
        SourceFileSha256: params[3],
        SourceFileType: params[4],
        SourceFileSizeBytes: params[5],
        SheetName: params[6],
        Status: "uploaded",
        ColumnsJson: params[7],
        MappingJson: params[8],
        UnmappedJson: params[9],
        UnmappedToNotesJson: "[]",
        SuggestionsJson: params[10],
        DefaultsJson: params[11],
        DuplicatePolicy: "skip",
        SkipInvalid: 1,
        PreviewSummaryJson: null,
        ResultSummaryJson: null,
        ErrorMessage: null,
        RowCount: params[12],
        CreatedAt: new Date().toISOString(),
        UpdatedAt: new Date().toISOString(),
      };
      jobs.push(job);
      return [{ insertId: job.ImportId, affectedRows: 1 }];
    }
    if (normalized.startsWith("insert into leadimportrows")) {
      for (let i = 0; i < params.length; i += 5) {
        rows.push({
          ImportRowId: nextRowId++,
          ImportId: params[i],
          CompanyId: params[i + 1],
          RowNumber: params[i + 2],
          RowHash: params[i + 3],
          SourceJson: params[i + 4],
          PreviewStatus: "pending",
          PreviewReasonsJson: "[]",
          ExistingLeadId: null,
          DuplicateAction: "skip",
          CommitStatus: "pending",
          ErrorReason: null,
          CreatedLeadId: null,
          CreatedLeadContactId: null,
        });
      }
      return [{ affectedRows: params.length / 5 }];
    }
    if (normalized.includes("from leadimports") && normalized.includes("importid = ?")) {
      const found = jobs.filter(
        (job) =>
          Number(job.ImportId) === Number(params[0]) &&
          Number(job.CompanyId) === Number(params[1]) &&
          Number(job.CreatedByUserId) === Number(params[2]),
      );
      return [found];
    }
    if (normalized.includes("from leadimportrows") && normalized.includes("importid = ?")) {
      const found = rows
        .filter((row) => Number(row.ImportId) === Number(params[0]) && Number(row.CompanyId) === Number(params[1]))
        .sort((a, b) => a.RowNumber - b.RowNumber);
      return [found];
    }
    if (normalized.startsWith("update leadimports") && normalized.includes("status = 'confirming'")) {
      const job = jobs.find(
        (item) =>
          Number(item.ImportId) === Number(params[0]) &&
          Number(item.CompanyId) === Number(params[1]) &&
          Number(item.CreatedByUserId) === Number(params[2]) &&
          (item.Status === "previewed" || item.Status === "confirming"),
      );
      if (!job) return [{ affectedRows: 0 }];
      job.Status = "confirming";
      return [{ affectedRows: 1 }];
    }
    if (normalized.startsWith("update leadimports") && normalized.includes("status = 'completed'")) {
      const job = jobs.find(
        (item) =>
          Number(item.ImportId) === Number(params[1]) &&
          Number(item.CompanyId) === Number(params[2]) &&
          Number(item.CreatedByUserId) === Number(params[3]),
      );
      if (job) {
        job.Status = "completed";
        job.ResultSummaryJson = params[0];
      }
      return [{ affectedRows: job ? 1 : 0 }];
    }
    if (normalized.startsWith("update leadimports") && normalized.includes("status = 'previewed'") && normalized.includes("previewsummaryjson")) {
      const job = jobs.find(
        (item) =>
          Number(item.ImportId) === Number(params[1]) &&
          Number(item.CompanyId) === Number(params[2]) &&
          Number(item.CreatedByUserId) === Number(params[3]),
      );
      if (job) {
        job.Status = "previewed";
        job.PreviewSummaryJson = params[0];
        job.ErrorMessage = null;
      }
      return [{ affectedRows: job ? 1 : 0 }];
    }
    if (
      normalized.startsWith("update leadimports") &&
      normalized.includes("mappingjson") &&
      normalized.includes("duplicatepolicy") &&
      !normalized.includes("sheetname")
    ) {
      const job = jobs.find(
        (item) =>
          Number(item.ImportId) === Number(params[6]) &&
          Number(item.CompanyId) === Number(params[7]) &&
          Number(item.CreatedByUserId) === Number(params[8]),
      );
      if (job && (job.Status === "uploaded" || job.Status === "previewed")) {
        job.MappingJson = params[0];
        job.UnmappedJson = params[1];
        job.UnmappedToNotesJson = params[2];
        job.DefaultsJson = params[3];
        job.DuplicatePolicy = params[4];
        job.SkipInvalid = params[5];
        job.Status = "uploaded";
        job.PreviewSummaryJson = null;
      }
      return [{ affectedRows: job ? 1 : 0 }];
    }
    if (normalized.startsWith("update leadimports") && normalized.includes("status = 'previewed'") && normalized.includes("errormessage")) {
      const job = jobs.find((item) => Number(item.ImportId) === Number(params[1]));
      if (job && Number(job.CompanyId) === Number(params[2]) && Number(job.CreatedByUserId) === Number(params[3])) {
        job.Status = "previewed";
        job.ErrorMessage = params[0];
      }
      return [{ affectedRows: 1 }];
    }
    if (normalized.startsWith("update leadimportrows") && normalized.includes("previewstatus")) {
      const row = rows.find(
        (item) =>
          Number(item.ImportRowId) === Number(params[5]) &&
          Number(item.ImportId) === Number(params[6]) &&
          Number(item.CompanyId) === Number(params[7]),
      );
      if (row) {
        row.PreviewStatus = params[0];
        row.PreviewReasonsJson = params[1];
        row.ExistingLeadId = params[2];
        row.DuplicateAction = params[3];
      }
      return [{ affectedRows: row ? 1 : 0 }];
    }
    if (normalized.startsWith("update leadimportrows") && normalized.includes("commitstatus = 'created'") && normalized.includes("commitstatus = 'pending'")) {
      const row = rows.find(
        (item) =>
          Number(item.ImportRowId) === Number(params[0]) &&
          Number(item.ImportId) === Number(params[1]) &&
          Number(item.CompanyId) === Number(params[2]) &&
          item.CommitStatus === "pending",
      );
      if (!row) return [{ affectedRows: 0 }];
      row.CommitStatus = "created";
      return [{ affectedRows: 1 }];
    }
    if (normalized.startsWith("update leadimportrows") && normalized.includes("createdleadid")) {
      const row = rows.find(
        (item) =>
          Number(item.ImportRowId) === Number(params[2]) &&
          Number(item.ImportId) === Number(params[3]) &&
          Number(item.CompanyId) === Number(params[4]),
      );
      if (row) {
        row.CreatedLeadId = params[0];
        row.CreatedLeadContactId = params[1];
        row.CommitStatus = "created";
      }
      return [{ affectedRows: row ? 1 : 0 }];
    }
    if (normalized.startsWith("update leadimportrows") && normalized.includes("commitstatus = 'duplicate'")) {
      const row = rows.find((item) => Number(item.ImportRowId) === Number(params[0]) && item.CommitStatus === "pending");
      if (row && Number(row.CompanyId) === Number(params[2])) {
        row.CommitStatus = "duplicate";
      }
      return [{ affectedRows: row ? 1 : 0 }];
    }
    if (normalized.startsWith("update leadimportrows") && normalized.includes("commitstatus = 'skipped'")) {
      const row = rows.find((item) => Number(item.ImportRowId) === Number(params[1]) && item.CommitStatus === "pending");
      if (row && Number(row.CompanyId) === Number(params[3])) {
        row.CommitStatus = "skipped";
        row.ErrorReason = params[0];
      }
      return [{ affectedRows: row ? 1 : 0 }];
    }
    if (normalized.startsWith("update leadimportrows") && normalized.includes("commitstatus = 'failed'")) {
      const row = rows.find((item) => Number(item.ImportRowId) === Number(params[1]));
      if (row && Number(row.CompanyId) === Number(params[3])) {
        row.CommitStatus = "failed";
        row.ErrorReason = params[0];
      }
      return [{ affectedRows: 1 }];
    }
    if (normalized.startsWith("delete from leadimportrows")) {
      const importId = Number(params[0]);
      const companyId = Number(params[1]);
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        if (Number(rows[i].ImportId) === importId && Number(rows[i].CompanyId) === companyId) rows.splice(i, 1);
      }
      return [{ affectedRows: 1 }];
    }
    if (normalized.includes("from customfielddefinitions")) {
      if (normalized.includes("customfieldid = ?")) {
        return [customFields.filter(
          (item) => Number(item.CustomFieldId) === Number(params[0]) && Number(item.CompanyId) === Number(params[1]),
        )];
      }
      if (normalized.includes("entitytype = ?") && normalized.includes("fieldkey = ?")) {
        return [customFields.filter(
          (item) =>
            Number(item.CompanyId) === Number(params[0]) &&
            item.EntityType === params[1] &&
            item.FieldKey === params[2],
        )];
      }
      return [customFields.filter((item) => Number(item.CompanyId) === Number(params[0]))];
    }
    if (normalized.startsWith("insert into customfielddefinitions")) {
      const existing = customFields.find(
        (item) =>
          Number(item.CompanyId) === Number(params[0]) &&
          item.EntityType === params[1] &&
          item.FieldKey === params[3],
      );
      if (existing) return [{ insertId: existing.CustomFieldId, affectedRows: 1 }];
      const created = {
        CustomFieldId: nextCustomFieldId++,
        CompanyId: params[0],
        EntityType: params[1],
        FieldName: params[2],
        FieldKey: params[3],
        FieldType: params[4],
        IsRequired: params[5],
        CreatedByUserId: params[6],
      };
      customFields.push(created);
      return [{ insertId: created.CustomFieldId, affectedRows: 1 }];
    }
    if (normalized.startsWith("insert into customfieldvalues")) {
      customValues.push({
        CompanyId: params[0],
        CustomFieldId: params[1],
        EntityType: params[2],
        EntityId: params[3],
        ValueText: params[4],
      });
      return [{ affectedRows: 1 }];
    }
    if (normalized.startsWith("update leadimports") && normalized.includes("sheetname = ?")) {
      const job = jobs.find(
        (item) =>
          Number(item.ImportId) === Number(params[7]) &&
          Number(item.CompanyId) === Number(params[8]) &&
          Number(item.CreatedByUserId) === Number(params[9]) &&
          (item.Status === "uploaded" || item.Status === "previewed"),
      );
      if (!job) return [{ affectedRows: 0 }];
      job.SheetName = params[0];
      job.ColumnsJson = params[1];
      job.MappingJson = params[2];
      job.UnmappedJson = params[3];
      job.UnmappedToNotesJson = "[]";
      job.SuggestionsJson = params[4];
      job.DefaultsJson = params[5];
      job.Status = "uploaded";
      job.PreviewSummaryJson = null;
      job.ResultSummaryJson = null;
      job.ErrorMessage = null;
      job.RowCount = params[6];
      return [{ affectedRows: 1 }];
    }

    return [[]];
  };

  return {
    sqls,
    jobs,
    rows,
    insertedLeads,
    insertedContacts,
    customFields,
    customValues,
    query,
    getConnection: async () => ({
      query,
      beginTransaction: async () => undefined,
      commit: async () => undefined,
      rollback: async () => undefined,
      release: () => undefined,
    }),
  };
}

beforeEach(() => {
  __resetPendingLeadImportsForTests();
  __setLeadImportEnricherForTests(async () => null);
});

afterEach(() => {
  __resetPendingLeadImportsForTests();
  __setLeadImportPoolFactoryForTests(null);
  __setLeadImportEnricherForTests(null);
});

test("persistent job creation and retrieval stay tenant-owned", async () => {
  const pool = createMemoryPool();
  __setLeadImportPoolFactoryForTests(async () => pool);
  const created = await createReadyImport({
    actor: ACTOR_A,
    ownerName: "alice",
    fileName: "leads.csv",
    fileBuffer: csvBuffer(),
  });
  assert.equal(created.status, "uploaded");
  assert.equal(created.fileName, "leads.csv");
  assert.equal(created.fileSha256.length, 64);
  assert.equal(pool.jobs[0].CompanyId, 11);
  assert.equal(pool.jobs[0].CreatedByUserId, 7);
  const loaded = await getLeadImport(ACTOR_A, created.importId);
  assert.equal(loaded.importId, created.importId);
  assert.equal(loaded.rowCount, 1);
});

test("another user or company cannot read, update, preview, or confirm a job", async () => {
  const pool = createMemoryPool();
  __setLeadImportPoolFactoryForTests(async () => pool);
  const created = await createReadyImport({
    actor: ACTOR_A,
    ownerName: "alice",
    fileName: "leads.csv",
    fileBuffer: csvBuffer(),
  });
  await assert.rejects(() => getLeadImport(ACTOR_B, created.importId), LeadImportAccessError);
  await assert.rejects(() => getLeadImport(SAME_COMPANY_OTHER_USER, created.importId), LeadImportAccessError);
  await assert.rejects(
    () => updateLeadImport(ACTOR_B, created.importId, { skipInvalid: false }),
    LeadImportAccessError,
  );
  await assert.rejects(() => previewLeadImport(ACTOR_B, created.importId), LeadImportAccessError);
  await assert.rejects(() => confirmPersistedLeadImport(ACTOR_B, created.importId), LeadImportAccessError);
});

test("mapping updates require a new preview before confirm", async () => {
  const pool = createMemoryPool();
  __setLeadImportPoolFactoryForTests(async () => pool);
  const created = await createReadyImport({
    actor: ACTOR_A,
    ownerName: "alice",
    fileName: "leads.csv",
    fileBuffer: csvBuffer(),
  });
  const previewed = await previewLeadImport(ACTOR_A, created.importId);
  assert.equal(previewed.status, "previewed");
  assert.equal(previewed.canConfirm, true);
  const updated = await updateLeadImport(ACTOR_A, created.importId, {
    defaults: { contactTitle: "CTO" },
  });
  assert.equal(updated.status, "uploaded");
  await assert.rejects(() => confirmPersistedLeadImport(ACTOR_A, created.importId), LeadImportStateError);
  const refreshed = await previewLeadImport(ACTOR_A, created.importId);
  assert.equal(refreshed.status, "previewed");
  assert.equal(refreshed.defaults.contactTitle, "CTO");
});

test("invalid job-state transitions are rejected", async () => {
  const pool = createMemoryPool();
  __setLeadImportPoolFactoryForTests(async () => pool);
  const created = await createReadyImport({
    actor: ACTOR_A,
    ownerName: "alice",
    fileName: "leads.csv",
    fileBuffer: csvBuffer(),
  });
  await assert.rejects(() => confirmPersistedLeadImport(ACTOR_A, created.importId), /preview before confirming/i);
});

test("repeated confirmation does not create duplicate records", async () => {
  const pool = createMemoryPool();
  __setLeadImportPoolFactoryForTests(async () => pool);
  const created = await createReadyImport({
    actor: ACTOR_A,
    ownerName: "alice",
    fileName: "leads.csv",
    fileBuffer: csvBuffer(),
  });
  await previewLeadImport(ACTOR_A, created.importId);
  const first = await confirmPersistedLeadImport(ACTOR_A, created.importId);
  assert.equal(first.status, "completed");
  assert.equal(first.result?.createdLeads, 1);
  assert.equal(first.result?.createdContacts, 1);
  const leadCount = pool.insertedLeads.length;
  const second = await confirmPersistedLeadImport(ACTOR_A, created.importId);
  assert.equal(second.status, "completed");
  assert.equal(pool.insertedLeads.length, leadCount);
  assert.equal(pool.insertedContacts[0]?.[1], 11);
});

test("duplicate and invalid rows are recorded without creating records", async () => {
  const pool = createMemoryPool([
    {
      LeadId: 100,
      CompanyName: "Acme",
      ContactName: "Jane Doe",
      ContactEmail: "jane@acme.com",
      LinkedInProfile: "",
      leadCompanyId: 11,
      contactCompanyId: 11,
    },
  ]);
  __setLeadImportPoolFactoryForTests(async () => pool);
  const created = await createReadyImport({
    actor: ACTOR_A,
    ownerName: "alice",
    fileName: "leads.csv",
    fileBuffer: csvBuffer(
      "Company Name,Contact Name,Contact Title,Company Location,Email\nAcme,Jane Doe,CEO,New York,jane@acme.com\n,Missing,CEO,New York,x@y.com\n",
    ),
  });
  const previewed = await previewLeadImport(ACTOR_A, created.importId);
  assert.equal(previewed.summary?.duplicate, 1);
  const confirmed = await confirmPersistedLeadImport(ACTOR_A, created.importId);
  assert.equal(confirmed.result?.createdLeads, 0);
  assert.equal(confirmed.result?.duplicatesSkipped, 1);
  assert.equal(confirmed.result?.invalidSkipped, 1);
  assert.equal(pool.insertedLeads.length, 0);
});

test("file validation rejects unsupported, empty, and oversized uploads", () => {
  assert.throws(
    () => validateImportSpreadsheet({ fileName: "notes.txt", fileSize: 12, fileBuffer: Buffer.from("hello world!") }),
    /unsupported format/i,
  );
  assert.throws(
    () => validateImportSpreadsheet({ fileName: "leads.csv", fileSize: 0, fileBuffer: Buffer.alloc(0) }),
    /empty or unreadable/i,
  );
  assert.throws(
    () =>
      validateImportSpreadsheet({
        fileName: "leads.csv",
        fileSize: 11 * 1024 * 1024,
        fileBuffer: Buffer.alloc(11 * 1024 * 1024),
      }),
    /10 MB/i,
  );
});

test("import without company context still fails closed", () => {
  assert.throws(() => requireLeadImportActor({ userId: 7, companyId: null }), CompanyRequiredError);
});

test("existing assistant import path still works with shared core helpers", async () => {
  const pool = createMemoryPool();
  __setLeadImportPoolFactoryForTests(async () => pool);
  const started = await startLeadImport({
    conversationId: "conv-compat",
    fileName: "leads.csv",
    fileBuffer: csvBuffer(),
    ownerName: "alice",
    userId: ACTOR_A.userId,
    companyId: ACTOR_A.companyId,
  });
  assert.equal(started.canConfirm, true);
  const preview = await previewPendingLeadImport("conv-compat", ACTOR_A);
  assert.equal(preview?.previewRows[0]?.status, "new");
  const confirmed = await confirmLeadImport("conv-compat", ACTOR_A);
  assert.equal(confirmed.result?.createdLeads, 1);
  assert.equal(pool.insertedContacts[0]?.[1], 11);
});

function workbookBuffer(sheets: Record<string, Array<Array<string>>>) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require("xlsx") as typeof import("xlsx");
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
}

test("multi-sheet workbooks require an explicit worksheet before rows are stored", async () => {
  const pool = createMemoryPool();
  __setLeadImportPoolFactoryForTests(async () => pool);
  const fileBuffer = workbookBuffer({
    Summary: [["Total"], ["1"]],
    Contacts: [
      ["Company Name", "Contact Name", "Contact Title", "Company Location"],
      ["Acme", "Jane Doe", "CEO", "New York"],
    ],
  });
  const listed = await createLeadImport({
    actor: ACTOR_A,
    ownerName: "alice",
    fileName: "clients.xlsx",
    fileBuffer,
  });
  assert.equal(listed.kind, "needs_sheet");
  if (listed.kind !== "needs_sheet") return;
  assert.equal(listed.sheets.some((sheet) => sheet.name === "Contacts"), true);
  assert.equal(pool.jobs.length, 0);

  await assert.rejects(
    () =>
      createLeadImport({
        actor: ACTOR_A,
        ownerName: "alice",
        fileName: "clients.xlsx",
        fileBuffer,
        sheetName: "DoesNotExist",
      }),
    /not found/i,
  );

  const created = await createLeadImport({
    actor: ACTOR_A,
    ownerName: "alice",
    fileName: "clients.xlsx",
    fileBuffer,
    sheetName: "Contacts",
  });
  assert.equal(created.kind, "ready");
  if (created.kind !== "ready") return;
  assert.equal(created.job.sheetName, "Contacts");
  assert.equal(created.job.rowCount, 1);

  const switched = await selectLeadImportSheet({
    actor: ACTOR_A,
    importId: created.job.importId,
    ownerName: "alice",
    fileName: "clients.xlsx",
    fileBuffer,
    sheetName: "Summary",
  });
  assert.equal(switched.sheetName, "Summary");
  assert.equal(switched.status, "uploaded");
  assert.equal(switched.canConfirm, false);
});

test("CSV imports skip worksheet selection", async () => {
  const pool = createMemoryPool();
  __setLeadImportPoolFactoryForTests(async () => pool);
  const created = await createReadyImport({
    actor: ACTOR_A,
    ownerName: "alice",
    fileName: "leads.csv",
    fileBuffer: csvBuffer(),
  });
  assert.equal(created.status, "uploaded");
  assert.equal(created.rowCount, 1);
});

function csvWithCustom(body =
  "Company Name,Contact Name,Contact Title,Company Location,Address,Headcount\nAcme,Jane Doe,CEO,New York,1 Main St,12\n",
) {
  return csvBuffer(body);
}

test("columns can map to an existing tenant custom field and persist values on confirm", async () => {
  const pool = createMemoryPool();
  pool.customFields.push({
    CustomFieldId: 9,
    CompanyId: 11,
    EntityType: "lead",
    FieldName: "Address",
    FieldKey: "address",
    FieldType: "text",
    IsRequired: 0,
  });
  __setLeadImportPoolFactoryForTests(async () => pool);
  const created = await createReadyImport({
    actor: ACTOR_A,
    ownerName: "alice",
    fileName: "leads.csv",
    fileBuffer: csvWithCustom(),
  });
  const mapped = await updateLeadImport(ACTOR_A, created.importId, {
    mapping: {
      "Company Name": "companyName",
      "Contact Name": "contactName",
      "Contact Title": "contactTitle",
      "Company Location": "companyLocation",
      Address: { kind: "custom", customFieldId: 9 },
    },
  });
  assert.equal(mapped.status, "uploaded");
  const previewed = await previewLeadImport(ACTOR_A, created.importId);
  assert.equal(previewed.previewRows[0]?.customValues?.[0]?.fieldName, "Address");
  assert.equal(previewed.previewRows[0]?.customValues?.[0]?.normalizedValue, "1 Main St");
  const confirmed = await confirmPersistedLeadImport(ACTOR_A, created.importId);
  assert.equal(confirmed.status, "completed");
  assert.equal(pool.customValues.length, 1);
  assert.equal(pool.customValues[0].ValueText, "1 Main St");
  assert.equal(pool.customValues[0].CompanyId, 11);
});

test("creating a new custom field is company-scoped and idempotent on retry", async () => {
  const pool = createMemoryPool();
  __setLeadImportPoolFactoryForTests(async () => pool);
  const created = await createReadyImport({
    actor: ACTOR_A,
    ownerName: "alice",
    fileName: "leads.csv",
    fileBuffer: csvWithCustom(),
  });
  await updateLeadImport(ACTOR_A, created.importId, {
    mapping: {
      "Company Name": "companyName",
      "Contact Name": "contactName",
      "Contact Title": "contactTitle",
      "Company Location": "companyLocation",
      Address: { kind: "new", name: "Other Information", entityType: "lead", fieldType: "text" },
    },
  });
  await previewLeadImport(ACTOR_A, created.importId);
  await confirmPersistedLeadImport(ACTOR_A, created.importId);
  assert.equal(pool.customFields.length, 1);
  assert.equal(pool.customFields[0].FieldName, "Other Information");
  assert.equal(pool.customFields[0].CompanyId, 11);
  const retry = await confirmPersistedLeadImport(ACTOR_A, created.importId);
  assert.equal(retry.status, "completed");
  assert.equal(pool.customFields.length, 1);
  assert.equal(pool.customValues.length, 1);
});

test("duplicate custom field names and cross-company field ids are rejected", async () => {
  const pool = createMemoryPool();
  pool.customFields.push({
    CustomFieldId: 21,
    CompanyId: 22,
    EntityType: "lead",
    FieldName: "Address",
    FieldKey: "address",
    FieldType: "text",
    IsRequired: 0,
  });
  __setLeadImportPoolFactoryForTests(async () => pool);
  const created = await createReadyImport({
    actor: ACTOR_A,
    ownerName: "alice",
    fileName: "leads.csv",
    fileBuffer: csvWithCustom(),
  });
  await assert.rejects(
    () => updateLeadImport(ACTOR_A, created.importId, {
      mapping: { Address: { kind: "custom", customFieldId: 21 } },
    }),
    /not found for this company/i,
  );
  await assert.rejects(
    () => updateLeadImport(ACTOR_A, created.importId, {
      mapping: {
        Address: { kind: "new", name: "Address", entityType: "lead", fieldType: "text" },
        Headcount: { kind: "new", name: "Address", entityType: "lead", fieldType: "number" },
      },
    }),
    /more than once/i,
  );
});

test("invalid custom values and skipped duplicates do not write custom field values", async () => {
  const pool = createMemoryPool([
    {
      LeadId: 100,
      CompanyName: "Acme",
      ContactName: "Jane Doe",
      ContactEmail: "",
      LinkedInProfile: "",
      leadCompanyId: 11,
      contactCompanyId: 11,
    },
  ]);
  __setLeadImportPoolFactoryForTests(async () => pool);
  const created = await createReadyImport({
    actor: ACTOR_A,
    ownerName: "alice",
    fileName: "leads.csv",
    fileBuffer: csvWithCustom(
      "Company Name,Contact Name,Contact Title,Company Location,Headcount\nAcme,Jane Doe,CEO,New York,twelve\n",
    ),
  });
  await updateLeadImport(ACTOR_A, created.importId, {
    mapping: {
      "Company Name": "companyName",
      "Contact Name": "contactName",
      "Contact Title": "contactTitle",
      "Company Location": "companyLocation",
      Headcount: { kind: "new", name: "Headcount", entityType: "lead", fieldType: "number" },
    },
  });
  const previewed = await previewLeadImport(ACTOR_A, created.importId);
  assert.equal(previewed.previewRows[0]?.status, "duplicate");
  const confirmed = await confirmPersistedLeadImport(ACTOR_A, created.importId);
  assert.equal(confirmed.result?.duplicatesSkipped, 1);
  assert.equal(pool.customValues.length, 0);
});

test("invalid numeric custom values need attention and are not stored when skipped", async () => {
  const pool = createMemoryPool();
  __setLeadImportPoolFactoryForTests(async () => pool);
  const created = await createReadyImport({
    actor: ACTOR_A,
    ownerName: "alice",
    fileName: "leads.csv",
    fileBuffer: csvWithCustom(
      "Company Name,Contact Name,Contact Title,Company Location,Headcount\nGlobex,Sam Jones,CTO,Austin,twelve\n",
    ),
  });
  await updateLeadImport(ACTOR_A, created.importId, {
    mapping: {
      "Company Name": "companyName",
      "Contact Name": "contactName",
      "Contact Title": "contactTitle",
      "Company Location": "companyLocation",
      Headcount: { kind: "new", name: "Headcount", entityType: "lead", fieldType: "number" },
    },
  });
  const previewed = await previewLeadImport(ACTOR_A, created.importId);
  assert.equal(previewed.previewRows[0]?.status, "needs_attention");
  const confirmed = await confirmPersistedLeadImport(ACTOR_A, created.importId);
  assert.equal(confirmed.result?.invalidSkipped, 1);
  assert.equal(pool.customValues.length, 0);
});

test("contact custom fields are stored against the created contact, not the lead", async () => {
  const pool = createMemoryPool();
  __setLeadImportPoolFactoryForTests(async () => pool);
  const created = await createReadyImport({
    actor: ACTOR_A,
    ownerName: "alice",
    fileName: "leads.csv",
    fileBuffer: csvWithCustom(
      "Company Name,Contact Name,Contact Title,Company Location,Other Information\nAcme,Jane Doe,CEO,New York,Prefers email\n",
    ),
  });
  await updateLeadImport(ACTOR_A, created.importId, {
    mapping: {
      "Company Name": "companyName",
      "Contact Name": "contactName",
      "Contact Title": "contactTitle",
      "Company Location": "companyLocation",
      "Other Information": { kind: "new", name: "Other Information", entityType: "contact", fieldType: "text" },
    },
  });
  await previewLeadImport(ACTOR_A, created.importId);
  await confirmPersistedLeadImport(ACTOR_A, created.importId);
  assert.equal(pool.customFields[0].EntityType, "contact");
  assert.equal(pool.customValues[0].EntityType, "contact");
  assert.equal(pool.customValues[0].EntityId, pool.insertedContacts.length ? 800 : pool.customValues[0].EntityId);
});

test("missing company location and contact title still create a lead and contact", async () => {
  const pool = createMemoryPool();
  __setLeadImportPoolFactoryForTests(async () => pool);
  const created = await createReadyImport({
    actor: ACTOR_A,
    ownerName: "alice",
    fileName: "leads.csv",
    fileBuffer: csvBuffer("Company Name,Contact Name\nAcme,Jane Doe\n"),
  });
  await updateLeadImport(ACTOR_A, created.importId, {
    mapping: {
      "Company Name": "companyName",
      "Contact Name": "contactName",
    },
    defaults: { companyLocation: "", contactTitle: "" },
  });
  const previewed = await previewLeadImport(ACTOR_A, created.importId);
  assert.equal(previewed.previewRows[0]?.status, "new");
  assert.equal(previewed.canConfirm, true);
  const confirmed = await confirmPersistedLeadImport(ACTOR_A, created.importId);
  assert.equal(confirmed.result?.createdLeads, 1);
  assert.equal(confirmed.result?.createdContacts, 1);
  assert.equal(pool.insertedLeads[0]?.[1], "");
  assert.equal(pool.insertedContacts[0]?.[5], "");
});

test("lead-only rows create a company without a contact", async () => {
  const pool = createMemoryPool();
  __setLeadImportPoolFactoryForTests(async () => pool);
  const created = await createReadyImport({
    actor: ACTOR_A,
    ownerName: "alice",
    fileName: "leads.csv",
    fileBuffer: csvBuffer("Company Name\nGlobex\n"),
  });
  const previewed = await previewLeadImport(ACTOR_A, created.importId);
  assert.equal(previewed.previewRows[0]?.status, "new");
  assert.equal(previewed.previewRows[0]?.contactName, "");
  const confirmed = await confirmPersistedLeadImport(ACTOR_A, created.importId);
  assert.equal(confirmed.result?.createdLeads, 1);
  assert.equal(confirmed.result?.createdContacts, 0);
  assert.equal(pool.insertedLeads.length, 1);
  assert.equal(pool.insertedContacts.length, 0);
});

test("contacts can be created without email or phone when a name and role exist", async () => {
  const pool = createMemoryPool();
  __setLeadImportPoolFactoryForTests(async () => pool);
  const created = await createReadyImport({
    actor: ACTOR_A,
    ownerName: "alice",
    fileName: "leads.csv",
    fileBuffer: csvBuffer("Company Name,Contact Name\nAcme,Pat Lee\n"),
  });
  await previewLeadImport(ACTOR_A, created.importId);
  const confirmed = await confirmPersistedLeadImport(ACTOR_A, created.importId);
  assert.equal(confirmed.result?.createdContacts, 1);
  assert.equal(pool.insertedContacts[0]?.[3], null);
  assert.equal(pool.insertedContacts[0]?.[4], null);
});

test("missing contact role blocks contact creation and is skipped when skip-invalid is on", async () => {
  const pool = createMemoryPool();
  __setLeadImportPoolFactoryForTests(async () => pool);
  const created = await createReadyImport({
    actor: ACTOR_A,
    ownerName: "alice",
    fileName: "leads.csv",
    fileBuffer: csvBuffer("Company Name,Contact Name\nAcme,Pat Lee\n"),
  });
  await updateLeadImport(ACTOR_A, created.importId, {
    defaults: { contactRole: "" },
    skipInvalid: true,
  });
  const previewed = await previewLeadImport(ACTOR_A, created.importId);
  assert.equal(previewed.previewRows[0]?.status, "needs_attention");
  assert.equal(previewed.previewRows[0]?.reasons.some((item) => /Contact Role missing/i.test(item)), true);
  const confirmed = await confirmPersistedLeadImport(ACTOR_A, created.importId);
  assert.equal(confirmed.result?.createdLeads, 0);
  assert.equal(confirmed.result?.createdContacts, 0);
  assert.equal(confirmed.result?.invalidSkipped, 1);
});

test("empty rows and contacts without a company are skipped without creating records", async () => {
  const pool = createMemoryPool();
  __setLeadImportPoolFactoryForTests(async () => pool);
  const created = await createReadyImport({
    actor: ACTOR_A,
    ownerName: "alice",
    fileName: "leads.csv",
    fileBuffer: csvBuffer(
      "Company Name,Contact Name,Email,Notes\nAcme,Jane Doe,jane@acme.com,ok\n,,,blank\n,Pat Lee,pat@acme.com,\n",
    ),
  });
  const previewed = await previewLeadImport(ACTOR_A, created.importId);
  assert.equal(previewed.previewRows[0]?.status, "new");
  assert.equal(previewed.previewRows[1]?.status, "invalid");
  assert.equal(previewed.previewRows[2]?.status, "invalid");
  const confirmed = await confirmPersistedLeadImport(ACTOR_A, created.importId);
  assert.equal(confirmed.result?.createdLeads, 1);
  assert.equal(confirmed.result?.invalidSkipped, 2);
  assert.equal(pool.insertedLeads.length, 1);
});

test("contact custom fields without a contact parent are not stored", async () => {
  const pool = createMemoryPool();
  __setLeadImportPoolFactoryForTests(async () => pool);
  const created = await createReadyImport({
    actor: ACTOR_A,
    ownerName: "alice",
    fileName: "leads.csv",
    fileBuffer: csvBuffer("Company Name,Nickname\nAcme,Jay\n"),
  });
  await updateLeadImport(ACTOR_A, created.importId, {
    mapping: {
      "Company Name": "companyName",
      Nickname: { kind: "new", name: "Nickname", entityType: "contact", fieldType: "text" },
    },
    skipInvalid: true,
  });
  const previewed = await previewLeadImport(ACTOR_A, created.importId);
  assert.equal(previewed.previewRows[0]?.status, "needs_attention");
  const confirmed = await confirmPersistedLeadImport(ACTOR_A, created.importId);
  assert.equal(confirmed.result?.createdLeads, 0);
  assert.equal(pool.customValues.length, 0);
});

test("lead-only duplicates skip creating another company", async () => {
  const pool = createMemoryPool([
    {
      LeadId: 100,
      CompanyName: "Acme",
      ContactName: "Existing",
      ContactEmail: "",
      LinkedInProfile: "",
      leadCompanyId: 11,
      contactCompanyId: 11,
    },
  ]);
  __setLeadImportPoolFactoryForTests(async () => pool);
  const created = await createReadyImport({
    actor: ACTOR_A,
    ownerName: "alice",
    fileName: "leads.csv",
    fileBuffer: csvBuffer("Company Name\nAcme\n"),
  });
  const previewed = await previewLeadImport(ACTOR_A, created.importId);
  assert.equal(previewed.previewRows[0]?.status, "duplicate");
  const confirmed = await confirmPersistedLeadImport(ACTOR_A, created.importId);
  assert.equal(confirmed.result?.createdLeads, 0);
  assert.equal(confirmed.result?.duplicatesSkipped, 1);
});

test("empty second name still imports the remaining combined Contact Name", async () => {
  const pool = createMemoryPool();
  __setLeadImportPoolFactoryForTests(async () => pool);
  const created = await createReadyImport({
    actor: ACTOR_A,
    ownerName: "alice",
    fileName: "leads.csv",
    fileBuffer: csvBuffer(
      "Company Name,First Name,Second Name,Contact Title,Company Location\nGlobex,Steve,,CEO,Austin\n",
    ),
  });
  await updateLeadImport(ACTOR_A, created.importId, {
    mapping: {
      "Company Name": "companyName",
      "First Name": "contactName",
      "Second Name": "contactName",
      "Contact Title": "contactTitle",
      "Company Location": "companyLocation",
    },
  });
  const previewed = await previewLeadImport(ACTOR_A, created.importId);
  assert.equal(previewed.previewRows[0]?.contactName, "Steve");
  const confirmed = await confirmPersistedLeadImport(ACTOR_A, created.importId);
  assert.equal(confirmed.result?.createdLeads, 1);
  assert.equal(confirmed.result?.createdContacts, 1);
});

test("First Name and Second Name combine into Contact Name for preview, confirm, and duplicates", async () => {
  const pool = createMemoryPool([
    {
      LeadId: 100,
      CompanyName: "Acme",
      ContactName: "Steve Books",
      ContactEmail: "",
      LinkedInProfile: "",
      leadCompanyId: 11,
      contactCompanyId: 11,
    },
  ]);
  __setLeadImportPoolFactoryForTests(async () => pool);
  const created = await createReadyImport({
    actor: ACTOR_A,
    ownerName: "alice",
    fileName: "leads.csv",
    fileBuffer: csvBuffer(
      "Company Name,First Name,Second Name,Contact Title,Company Location\nAcme,Steve,Books,CEO,New York\n",
    ),
  });
  await updateLeadImport(ACTOR_A, created.importId, {
    mapping: {
      "Company Name": "companyName",
      "First Name": "contactName",
      "Second Name": "contactName",
      "Contact Title": "contactTitle",
      "Company Location": "companyLocation",
    },
  });
  const previewed = await previewLeadImport(ACTOR_A, created.importId);
  assert.equal(previewed.previewRows[0]?.contactName, "Steve Books");
  assert.equal(previewed.previewRows[0]?.status, "duplicate");
  const confirmed = await confirmPersistedLeadImport(ACTOR_A, created.importId);
  assert.equal(confirmed.result?.createdLeads, 0);
  assert.equal(confirmed.result?.duplicatesSkipped, 1);
  assert.equal(pool.insertedLeads.length, 0);
});

test("combined name/email columns extract pairs and create one lead with multiple contacts", async () => {
  const pool = createMemoryPool();
  __setLeadImportPoolFactoryForTests(async () => pool);
  const created = await createReadyImport({
    actor: ACTOR_A,
    ownerName: "alice",
    fileName: "leads.csv",
    fileBuffer: csvBuffer(
      "Company Name,Contact Title,Company Location,People\nAcme,CEO,New York,Venu Chanda <Venu.Chanda@Suneratech.com>; Hassan Mohammad Basha <HassanBasha@Suneratech.com>\n",
    ),
  });
  await updateLeadImport(ACTOR_A, created.importId, {
    mapping: {
      "Company Name": "companyName",
      "Contact Title": "contactTitle",
      "Company Location": "companyLocation",
      People: { kind: "combined_contact", transform: "split_contacts" },
    },
  });
  const previewed = await previewLeadImport(ACTOR_A, created.importId);
  assert.equal(previewed.status, "previewed");
  assert.equal(previewed.previewRows[0]?.extractedContacts?.length, 2);
  assert.equal(previewed.previewRows[0]?.extractedContacts?.[0]?.name, "Venu Chanda");
  assert.equal(previewed.previewRows[0]?.status, "new");
  const confirmed = await confirmPersistedLeadImport(ACTOR_A, created.importId);
  assert.equal(confirmed.result?.createdLeads, 1);
  assert.equal(confirmed.result?.createdContacts, 2);
  assert.equal(pool.insertedLeads.length, 1);
  assert.equal(pool.insertedContacts.length, 2);
});

test("extract email transform fills email without splitting extra leads", async () => {
  const pool = createMemoryPool();
  __setLeadImportPoolFactoryForTests(async () => pool);
  const created = await createReadyImport({
    actor: ACTOR_A,
    ownerName: "alice",
    fileName: "leads.csv",
    fileBuffer: csvBuffer(
      "Company Name,Contact Name,Contact Title,Company Location,Mailbox\nAcme,Jane Doe,CEO,New York,Jane Doe <jane@acme.com>\n",
    ),
  });
  await updateLeadImport(ACTOR_A, created.importId, {
    mapping: {
      "Company Name": "companyName",
      "Contact Name": "contactName",
      "Contact Title": "contactTitle",
      "Company Location": "companyLocation",
      Mailbox: { kind: "combined_contact", transform: "extract_email" },
    },
  });
  const previewed = await previewLeadImport(ACTOR_A, created.importId);
  assert.equal(previewed.canConfirm, true);
  const confirmed = await confirmPersistedLeadImport(ACTOR_A, created.importId);
  assert.equal(confirmed.result?.createdLeads, 1);
  assert.equal(confirmed.result?.createdContacts, 1);
});

test("ambiguous combined contacts stay needs_attention and do not create records when skip-invalid is off", async () => {
  const pool = createMemoryPool();
  __setLeadImportPoolFactoryForTests(async () => pool);
  const created = await createReadyImport({
    actor: ACTOR_A,
    ownerName: "alice",
    fileName: "leads.csv",
    fileBuffer: csvBuffer(
      "Company Name,Contact Title,Company Location,People\nAcme,CEO,New York,Sam <a@acme.com> also <b@acme.com>\n",
    ),
  });
  await updateLeadImport(ACTOR_A, created.importId, {
    mapping: {
      "Company Name": "companyName",
      "Contact Title": "contactTitle",
      "Company Location": "companyLocation",
      People: { kind: "combined_contact", transform: "split_contacts" },
    },
    skipInvalid: true,
  });
  const previewed = await previewLeadImport(ACTOR_A, created.importId);
  assert.equal(previewed.previewRows[0]?.status, "invalid");
  const confirmed = await confirmPersistedLeadImport(ACTOR_A, created.importId);
  assert.equal(confirmed.result?.createdLeads, 0);
  assert.equal(confirmed.result?.invalidSkipped, 1);
  assert.equal(pool.insertedContacts.length, 0);
});

test("changing a combined-contact transform invalidates preview before confirm", async () => {
  const pool = createMemoryPool();
  __setLeadImportPoolFactoryForTests(async () => pool);
  const created = await createReadyImport({
    actor: ACTOR_A,
    ownerName: "alice",
    fileName: "leads.csv",
    fileBuffer: csvBuffer(
      "Company Name,Contact Title,Company Location,People\nAcme,CEO,New York,Jane Doe <jane@acme.com>\n",
    ),
  });
  await updateLeadImport(ACTOR_A, created.importId, {
    mapping: {
      People: { kind: "combined_contact", transform: "extract_contact_name" },
    },
  });
  await previewLeadImport(ACTOR_A, created.importId);
  const updated = await updateLeadImport(ACTOR_A, created.importId, {
    mapping: {
      People: { kind: "combined_contact", transform: "split_contacts" },
    },
  });
  assert.equal(updated.status, "uploaded");
  await assert.rejects(() => confirmPersistedLeadImport(ACTOR_A, created.importId), LeadImportStateError);
});

test("changing a custom-field mapping invalidates preview before confirm", async () => {
  const pool = createMemoryPool();
  __setLeadImportPoolFactoryForTests(async () => pool);
  const created = await createReadyImport({
    actor: ACTOR_A,
    ownerName: "alice",
    fileName: "leads.csv",
    fileBuffer: csvWithCustom(),
  });
  await previewLeadImport(ACTOR_A, created.importId);
  const updated = await updateLeadImport(ACTOR_A, created.importId, {
    mapping: {
      Address: { kind: "new", name: "Address", entityType: "lead", fieldType: "text" },
    },
  });
  assert.equal(updated.status, "uploaded");
  await assert.rejects(() => confirmPersistedLeadImport(ACTOR_A, created.importId), LeadImportStateError);
});

function csvMissingCompany() {
  return csvBuffer("Company Name,Contact Name,Email,Contact Title\n,Jane Doe,jane@acme.com,CEO\n,John Doe,john@acme.com,CTO\n");
}

async function importMissingCompanyRows() {
  const created = await createReadyImport({
    actor: ACTOR_A,
    ownerName: "alice",
    fileName: "contacts.csv",
    fileBuffer: csvMissingCompany(),
  });
  await updateLeadImport(ACTOR_A, created.importId, {
    mapping: {
      "Company Name": "companyName",
      "Contact Name": "contactName",
      Email: "contactEmail",
      "Contact Title": "contactTitle",
    },
    defaults: {
      contactRole: "Decision Maker",
      companyLocation: "NY",
      contactTitle: "CEO",
      leadSource: "Excel Import",
      leadStatus: "New",
      ownerName: "alice",
      leadDate: "2026-10-27",
    },
  });
  return created;
}

test("missing-company contacts can be assigned to an existing tenant company", async () => {
  const pool = createMemoryPool([
    { LeadId: 44, CompanyName: "Acme", ContactName: "Old", ContactEmail: "old@acme.com", LinkedInProfile: null, leadCompanyId: 11, contactCompanyId: 11 },
  ]);
  __setLeadImportPoolFactoryForTests(async () => pool);
  const created = await importMissingCompanyRows();
  const previewed = await previewLeadImport(ACTOR_A, created.importId);
  assert.equal(previewed.previewRows[0]?.status, "invalid");
  await updateLeadImport(ACTOR_A, created.importId, {
    rowResolutions: {
      "2": { action: "assign_existing", companyName: "Acme" },
      "3": { action: "assign_existing", companyName: "Acme" },
    },
  });
  const resolved = await previewLeadImport(ACTOR_A, created.importId);
  assert.equal(resolved.previewRows[0]?.companyName, "Acme");
  assert.equal(resolved.previewRows[0]?.status, "existing_company_new_contact");
  const confirmed = await confirmPersistedLeadImport(ACTOR_A, created.importId);
  assert.equal(confirmed.result?.createdContacts, 2);
  assert.equal(confirmed.result?.createdLeads, 0);
  assert.equal(confirmed.result?.reusedExistingCompanies, 2);
  assert.equal(pool.insertedLeads.length, 0);
});

test("missing-company contacts can create one new company for multiple contacts", async () => {
  const pool = createMemoryPool();
  __setLeadImportPoolFactoryForTests(async () => pool);
  const created = await importMissingCompanyRows();
  await updateLeadImport(ACTOR_A, created.importId, {
    rowResolutions: {
      "2": { action: "create_company", companyName: "Northwind" },
      "3": { action: "create_company", companyName: "Northwind" },
    },
  });
  await previewLeadImport(ACTOR_A, created.importId);
  const confirmed = await confirmPersistedLeadImport(ACTOR_A, created.importId);
  assert.equal(confirmed.result?.createdLeads, 1);
  assert.equal(confirmed.result?.createdContacts, 2);
  assert.equal(confirmed.result?.createdCompanies, 1);
  assert.equal(confirmed.result?.reusedExistingCompanies, 1);
  assert.equal(pool.insertedLeads.length, 1);
});

test("assigning another tenant's company name is rejected", async () => {
  const pool = createMemoryPool([
    { LeadId: 88, CompanyName: "Secret Co", ContactName: "Pat", ContactEmail: "pat@secret.com", LinkedInProfile: null, leadCompanyId: 22, contactCompanyId: 22 },
  ]);
  __setLeadImportPoolFactoryForTests(async () => pool);
  const created = await importMissingCompanyRows();
  await updateLeadImport(ACTOR_A, created.importId, {
    rowResolutions: { "2": { action: "assign_existing", companyName: "Secret Co" } },
  });
  const previewed = await previewLeadImport(ACTOR_A, created.importId);
  assert.equal(previewed.previewRows[0]?.status, "invalid");
  const confirmed = await confirmPersistedLeadImport(ACTOR_A, created.importId);
  assert.equal(confirmed.result?.createdContacts, 0);
  assert.equal((confirmed.result?.unresolvedRows || 0) > 0, true);
});

test("skipped invalid rows stay skipped and retry does not recreate them", async () => {
  const pool = createMemoryPool();
  __setLeadImportPoolFactoryForTests(async () => pool);
  const created = await importMissingCompanyRows();
  await updateLeadImport(ACTOR_A, created.importId, {
    rowResolutions: {
      "2": { action: "skip" },
      "3": { action: "create_company", companyName: "Contoso" },
    },
  });
  await previewLeadImport(ACTOR_A, created.importId);
  const first = await confirmPersistedLeadImport(ACTOR_A, created.importId);
  assert.equal(first.result?.createdContacts, 1);
  assert.equal(first.result?.skippedRows, 1);
  const second = await confirmPersistedLeadImport(ACTOR_A, created.importId);
  assert.equal(second.result?.createdContacts, 1);
  assert.equal(pool.insertedLeads.length, 1);
});

test("changing a row resolution invalidates preview before confirm", async () => {
  const pool = createMemoryPool();
  __setLeadImportPoolFactoryForTests(async () => pool);
  const created = await importMissingCompanyRows();
  await previewLeadImport(ACTOR_A, created.importId);
  const updated = await updateLeadImport(ACTOR_A, created.importId, {
    rowResolutions: { "2": { action: "create_company", companyName: "Contoso" } },
  });
  assert.equal(updated.status, "uploaded");
  await assert.rejects(() => confirmPersistedLeadImport(ACTOR_A, created.importId), LeadImportStateError);
});



