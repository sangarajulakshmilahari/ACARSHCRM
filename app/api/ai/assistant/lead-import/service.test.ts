import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { CompanyMismatchError, CompanyRequiredError } from "@/app/api/lib/company-tenancy";

import {
  __resetPendingLeadImportsForTests,
  __seedPendingLeadImportForTests,
  __setLeadImportEnricherForTests,
  __setLeadImportPoolFactoryForTests,
  applyLeadImportUpdate,
  confirmLeadImport,
  LeadImportAccessError,
  previewPendingLeadImport,
  requireLeadImportActor,
  startLeadImport,
} from "./service";
import type { AcarshField } from "./mapping";

type ExistingRow = {
  LeadId: number;
  CompanyName: string;
  ContactName: string | null;
  ContactEmail: string | null;
  LinkedInProfile: string | null;
  leadCompanyId: number;
  contactCompanyId: number | null;
};

type Capture = {
  sqls: string[];
  params: any[][];
  insertedLeads: any[][];
  insertedContacts: any[][];
  updatedLeads: any[][];
};

const ACTOR_A = { userId: 7, companyId: 11 };
const ACTOR_B = { userId: 8, companyId: 22 };
const SAME_USER_OTHER_COMPANY = { userId: 7, companyId: 22 };

const DEFAULT_MAPPING: Record<string, AcarshField> = {
  "Company Name": "companyName",
  "Contact Name": "contactName",
  "Contact Title": "contactTitle",
  "Company Location": "companyLocation",
  Email: "contactEmail",
};

const VALID_ROW = {
  "Company Name": "Acme",
  "Contact Name": "Jane Doe",
  "Contact Title": "CEO",
  "Company Location": "New York",
  Email: "jane@acme.com",
};

function normalizeSql(sql: string) {
  return String(sql || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function createPool(existing: ExistingRow[], capture: Capture) {
  const query = async (sql: string, params: any[] = []) => {
    capture.sqls.push(sql);
    capture.params.push(params);
    const normalized = normalizeSql(sql);

    if (normalized.includes("from leads") && normalized.includes("leadsource")) {
      const companyId = Number(params[0]);
      const sources = existing
        .filter((row) => row.leadCompanyId === companyId)
        .map((row) => ({ LeadSource: `${row.CompanyName} Source` }));
      return [sources];
    }

    if (normalized.includes("from leadstatuses")) {
      return [[{ StatusName: "New" }]];
    }
    if (normalized.includes("from users") && normalized.includes("username")) {
      if (normalized.includes("select userid")) {
        return [[{ UserId: ACTOR_A.userId }]];
      }
      return [[{ UserName: "alice" }]];
    }
    if (normalized.includes("from contactroles")) {
      if (normalized.includes("select roleid")) {
        return [[{ RoleId: 4 }]];
      }
      return [[{ Role: "Decision Maker" }]];
    }

    if (
      normalized.includes("from leads l") &&
      normalized.includes("left join leadcontacts lc") &&
      normalized.includes("companyname")
    ) {
      const companyId = Number(params[0]);
      const scoped = existing.filter((row) => row.leadCompanyId === companyId);
      const joinEnforced = normalized.includes("lc.companyid = l.companyid");
      const tenantEnforced = normalized.includes("l.companyid = ?");
      assert.equal(tenantEnforced, true);
      return [
        scoped.map((row) => {
          const contactInTenant =
            row.contactCompanyId == null || row.contactCompanyId === row.leadCompanyId;
          if (joinEnforced && !contactInTenant) {
            return {
              LeadId: row.LeadId,
              CompanyName: row.CompanyName,
              ContactName: null,
              ContactEmail: null,
              LinkedInProfile: null,
            };
          }
          return {
            LeadId: row.LeadId,
            CompanyName: row.CompanyName,
            ContactName: row.ContactName,
            ContactEmail: row.ContactEmail,
            LinkedInProfile: row.LinkedInProfile,
          };
        }),
      ];
    }

    if (
      normalized.includes("select l.leadid") &&
      normalized.includes("from leads l") &&
      normalized.includes("l.leadid = ?") &&
      normalized.includes("l.companyid = ?") &&
      !normalized.includes("left join")
    ) {
      const leadId = Number(params[0]);
      const companyId = Number(params[1]);
      const found = existing.find((row) => row.LeadId === leadId && row.leadCompanyId === companyId);
      return [found ? [{ LeadId: found.LeadId }] : []];
    }

    if (/insert into leads\s*\(/.test(normalized)) {
      capture.insertedLeads.push(params);
      return [{ insertId: 501, affectedRows: 1 }];
    }
    if (normalized.includes("insert into leadcontacts")) {
      capture.insertedContacts.push(params);
      return [{ insertId: 801, affectedRows: 1 }];
    }
    if (normalized.includes("update leads set industryfocus")) {
      capture.updatedLeads.push(params);
      return [{ affectedRows: 1 }];
    }
    if (normalized.includes("create table if not exists leadscores")) {
      return [[]];
    }
    if (normalized.includes("information_schema.columns")) {
      return [[]];
    }
    if (normalized.includes("from leads l") && normalized.includes("where l.leadid = ?")) {
      return [[
        {
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
        },
      ]];
    }
    if (normalized.includes("insert into leadscores")) {
      return [{ affectedRows: 1 }];
    }
    if (normalized.includes("update leadcontacts")) {
      return [{ affectedRows: 1 }];
    }
    if (normalized.includes("insert into leadscores") || normalized.includes("from leads l")) {
      return [[{ LeadId: params[0] || 501, affectedRows: 1 }]];
    }

    return [[]];
  };

  return {
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

function seedValidPending(conversationId = "conv-a") {
  __seedPendingLeadImportForTests({
    conversationId,
    ownerUserId: ACTOR_A.userId,
    companyId: ACTOR_A.companyId,
    columns: Object.keys(DEFAULT_MAPPING),
    rows: [VALID_ROW],
    mapping: DEFAULT_MAPPING,
  });
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

test("lead import fails closed without a valid company context", async () => {
  assert.throws(() => requireLeadImportActor({ userId: 7, companyId: null }), CompanyRequiredError);
  assert.throws(() => requireLeadImportActor({ userId: 7, companyId: 0 }), /membership required/);

  const capture: Capture = { sqls: [], params: [], insertedLeads: [], insertedContacts: [], updatedLeads: [] };
  __setLeadImportPoolFactoryForTests(async () => createPool([], capture));

  await assert.rejects(
    () =>
      startLeadImport({
        conversationId: "conv-none",
        fileName: "leads.csv",
        fileBuffer: Buffer.from("Company Name,Contact Name\nAcme,Jane\n"),
        ownerName: "alice",
        userId: 7,
        companyId: 0,
      }),
    CompanyRequiredError,
  );

  seedValidPending("conv-a");
  await assert.rejects(
    () => previewPendingLeadImport("conv-a", { userId: 7, companyId: null as unknown as number }),
    CompanyRequiredError,
  );
  await assert.rejects(
    () => confirmLeadImport("conv-a", { userId: 7, companyId: 0 }),
    CompanyRequiredError,
  );
  assert.equal(capture.insertedLeads.length, 0);
});

test("another user cannot preview, update, or confirm a pending import", async () => {
  const capture: Capture = { sqls: [], params: [], insertedLeads: [], insertedContacts: [], updatedLeads: [] };
  __setLeadImportPoolFactoryForTests(async () => createPool([], capture));
  seedValidPending("conv-a");

  await assert.rejects(() => previewPendingLeadImport("conv-a", ACTOR_B), LeadImportAccessError);
  assert.throws(
    () => applyLeadImportUpdate("conv-a", ACTOR_B, { skipInvalid: false }),
    LeadImportAccessError,
  );
  await assert.rejects(() => confirmLeadImport("conv-a", ACTOR_B), LeadImportAccessError);
  assert.equal(capture.insertedLeads.length, 0);
});

test("duplicate detection only uses records from the authorized company", async () => {
  const existing: ExistingRow[] = [
    {
      LeadId: 100,
      CompanyName: "Acme",
      ContactName: "Jane Doe",
      ContactEmail: "jane@acme.com",
      LinkedInProfile: "",
      leadCompanyId: 11,
      contactCompanyId: 11,
    },
    {
      LeadId: 200,
      CompanyName: "Acme",
      ContactName: "Jane Doe",
      ContactEmail: "jane@acme.com",
      LinkedInProfile: "",
      leadCompanyId: 22,
      contactCompanyId: 22,
    },
  ];
  const capture: Capture = { sqls: [], params: [], insertedLeads: [], insertedContacts: [], updatedLeads: [] };
  __setLeadImportPoolFactoryForTests(async () => createPool(existing, capture));

  seedValidPending("conv-a");
  const cardA = await previewPendingLeadImport("conv-a", ACTOR_A);
  assert.equal(cardA?.previewRows[0]?.status, "duplicate");
  assert.equal(cardA?.previewRows[0]?.existingLeadId, 100);

  __seedPendingLeadImportForTests({
    conversationId: "conv-b",
    ownerUserId: ACTOR_B.userId,
    companyId: ACTOR_B.companyId,
    columns: Object.keys(DEFAULT_MAPPING),
    rows: [VALID_ROW],
    mapping: DEFAULT_MAPPING,
  });
  const cardB = await previewPendingLeadImport("conv-b", ACTOR_B);
  assert.equal(cardB?.previewRows[0]?.status, "duplicate");
  assert.equal(cardB?.previewRows[0]?.existingLeadId, 200);

  const existingSql = capture.sqls.find((sql) => /left join leadcontacts/i.test(sql));
  assert.match(String(existingSql), /l\.CompanyId = \?/);
  assert.match(String(existingSql), /lc\.CompanyId = l\.CompanyId/);
});

test("cross-company lead/contact rows are excluded from duplicate matching", async () => {
  const existing: ExistingRow[] = [
    {
      LeadId: 300,
      CompanyName: "Globex",
      ContactName: "Sam Smith",
      ContactEmail: "sam@globex.com",
      LinkedInProfile: "",
      leadCompanyId: 11,
      contactCompanyId: 22,
    },
  ];
  const capture: Capture = { sqls: [], params: [], insertedLeads: [], insertedContacts: [], updatedLeads: [] };
  __setLeadImportPoolFactoryForTests(async () => createPool(existing, capture));

  __seedPendingLeadImportForTests({
    conversationId: "conv-a",
    ownerUserId: ACTOR_A.userId,
    companyId: ACTOR_A.companyId,
    columns: Object.keys(DEFAULT_MAPPING),
    rows: [
      {
        "Company Name": "Globex",
        "Contact Name": "Sam Smith",
        "Contact Title": "CEO",
        "Company Location": "New York",
        Email: "sam@globex.com",
      },
    ],
    mapping: DEFAULT_MAPPING,
  });

  const card = await previewPendingLeadImport("conv-a", ACTOR_A);
  assert.equal(card?.previewRows[0]?.status, "existing_company_new_contact");
  assert.equal(card?.previewRows[0]?.existingLeadId, 300);
  assert.equal(card?.previewRows[0]?.reasons.includes("Company already exists with this contact"), false);
});

test("preview then commit with a switched or unauthorized company context is rejected", async () => {
  const capture: Capture = { sqls: [], params: [], insertedLeads: [], insertedContacts: [], updatedLeads: [] };
  __setLeadImportPoolFactoryForTests(async () => createPool([], capture));
  seedValidPending("conv-a");

  const preview = await previewPendingLeadImport("conv-a", ACTOR_A);
  assert.equal(preview?.canConfirm, true);

  await assert.rejects(
    () => confirmLeadImport("conv-a", SAME_USER_OTHER_COMPANY),
    CompanyMismatchError,
  );
  await assert.rejects(() => confirmLeadImport("conv-a", ACTOR_B), LeadImportAccessError);
  assert.equal(capture.insertedLeads.length, 0);

  const confirmed = await confirmLeadImport("conv-a", ACTOR_A);
  assert.equal(confirmed.result?.createdLeads, 1);
  assert.equal(confirmed.result?.createdContacts, 1);
  assert.equal(capture.insertedLeads[0]?.[6], 11);
  assert.equal(capture.insertedContacts[0]?.[1], 11);
});

test("commit revalidates existingLeadId ownership instead of trusting preview", async () => {
  const existing: ExistingRow[] = [
    {
      LeadId: 200,
      CompanyName: "Acme",
      ContactName: "Pat Lee",
      ContactEmail: "pat@acme.com",
      LinkedInProfile: "",
      leadCompanyId: 22,
      contactCompanyId: 22,
    },
  ];
  const capture: Capture = { sqls: [], params: [], insertedLeads: [], insertedContacts: [], updatedLeads: [] };
  __setLeadImportPoolFactoryForTests(async () => createPool(existing, capture));

  __seedPendingLeadImportForTests({
    conversationId: "conv-a",
    ownerUserId: ACTOR_A.userId,
    companyId: ACTOR_A.companyId,
    columns: Object.keys(DEFAULT_MAPPING),
    rows: [
      {
        "Company Name": "Acme",
        "Contact Name": "New Person",
        "Contact Title": "CTO",
        "Company Location": "New York",
        Email: "new@acme.com",
      },
    ],
    mapping: DEFAULT_MAPPING,
  });

  const card = await previewPendingLeadImport("conv-a", ACTOR_A);
  assert.equal(card?.previewRows[0]?.status, "new");

  const confirmed = await confirmLeadImport("conv-a", ACTOR_A);
  assert.equal(confirmed.result?.createdLeads, 1);
  assert.equal(confirmed.result?.createdContacts, 1);
  assert.equal(capture.insertedContacts[0]?.[0], 501);
  assert.equal(capture.insertedContacts[0]?.[1], 11);
  assert.ok(!capture.insertedContacts.some((params) => params[0] === 200));
});

test("existing valid imports continue to create tenant-owned leads and contacts", async () => {
  const capture: Capture = { sqls: [], params: [], insertedLeads: [], insertedContacts: [], updatedLeads: [] };
  __setLeadImportPoolFactoryForTests(async () => createPool([], capture));

  const csv = Buffer.from(
    "Company Name,Contact Name,Contact Title,Company Location,Email\nAcme,Jane Doe,CEO,New York,jane@acme.com\n",
  );
  const started = await startLeadImport({
    conversationId: "conv-valid",
    fileName: "leads.csv",
    fileBuffer: csv,
    ownerName: "alice",
    userId: ACTOR_A.userId,
    companyId: ACTOR_A.companyId,
  });
  assert.equal(started.canConfirm, true);
  assert.equal(started.previewRows[0]?.status, "new");

  const confirmed = await confirmLeadImport("conv-valid", ACTOR_A);
  assert.equal(confirmed.result?.createdLeads, 1);
  assert.equal(confirmed.result?.createdContacts, 1);
  assert.equal(confirmed.result?.failed.length, 0);
  assert.equal(capture.insertedLeads[0]?.[6], 11);
  assert.equal(capture.insertedContacts[0]?.[1], 11);
  assert.equal(capture.insertedContacts[0]?.[2], "Jane Doe");
});
