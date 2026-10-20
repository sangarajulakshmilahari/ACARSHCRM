import assert from "node:assert/strict";
import { test } from "node:test";

import { createOpportunityContactHandlers } from "./opportunity-contacts-route";

type TestState = {
  allowLeadAccess: boolean;
  opportunityExists: boolean;
  contactBelongs: boolean;
  selectRows: any[];
  insertCount: number;
};

function createDeps(state: TestState, authUser: { userId: number; roleId: number } | null) {
  const pool = {
    query: async (sql: string, params: any[] = []) => {
      const normalized = sql.replace(/\s+/g, " ").toLowerCase();

      if (normalized.includes("from opportunities")) {
        return [state.opportunityExists ? [{ OpportunityId: Number(params[0]) }] : []];
      }

      if (normalized.includes("select companyid") && normalized.includes("from `leads`")) {
        return [[{ CompanyId: 1 }]];
      }

      if (
        normalized.includes("from opportunitycontacts") &&
        normalized.includes("select opportunitycontactid") &&
        normalized.includes("where opportunitycontactid = ?")
      ) {
        return [state.contactBelongs ? [{ OpportunityContactId: Number(params[0]) }] : []];
      }

      if (
        normalized.includes("from opportunitycontacts") &&
        normalized.includes("select") &&
        normalized.includes("order by opportunitycontactid")
      ) {
        return [state.selectRows];
      }

      if (normalized.includes("insert into opportunitycontacts")) {
        state.insertCount += 1;
        return [{ insertId: state.insertCount, affectedRows: 1 }];
      }

      if (normalized.includes("update opportunitycontacts")) {
        return [{ affectedRows: 1 }];
      }

      throw new Error(`Unexpected SQL in test: ${normalized}`);
    },
  };

  return {
    getPool: async () => pool,
    getAuthUser: async () => authUser,
    canUserViewLeadById: async () => state.allowLeadAccess,
  };
}

function routeParams(leadID = "10", OpportunityId = "20") {
  return { params: { leadID, OpportunityId } };
}

test("nested opportunity contacts rejects missing authentication", async () => {
  const state: TestState = {
    allowLeadAccess: true,
    opportunityExists: true,
    contactBelongs: true,
    selectRows: [],
    insertCount: 0,
  };

  const handlers = createOpportunityContactHandlers(createDeps(state, null));
  const response = await handlers.GET(new Request("http://localhost") as any, routeParams());

  assert.equal(response.status, 401);
});

test("nested opportunity contacts rejects unauthorized parent lead access", async () => {
  const state: TestState = {
    allowLeadAccess: false,
    opportunityExists: true,
    contactBelongs: true,
    selectRows: [],
    insertCount: 0,
  };

  const handlers = createOpportunityContactHandlers(
    createDeps(state, { userId: 21, roleId: 2 })
  );
  const response = await handlers.GET(new Request("http://localhost") as any, routeParams());

  assert.equal(response.status, 403);
});

test("nested opportunity contacts rejects when opportunity does not belong to lead", async () => {
  const state: TestState = {
    allowLeadAccess: true,
    opportunityExists: false,
    contactBelongs: true,
    selectRows: [],
    insertCount: 0,
  };

  const handlers = createOpportunityContactHandlers(
    createDeps(state, { userId: 21, roleId: 2 })
  );
  const response = await handlers.GET(new Request("http://localhost") as any, routeParams());

  assert.equal(response.status, 404);
});

test("nested opportunity contacts prevents payload opportunity reassignment on create", async () => {
  const state: TestState = {
    allowLeadAccess: true,
    opportunityExists: true,
    contactBelongs: true,
    selectRows: [],
    insertCount: 0,
  };

  const handlers = createOpportunityContactHandlers(
    createDeps(state, { userId: 1, roleId: 1 })
  );

  const response = await handlers.POST(
    new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify([{ OpportunityId: 999, FullName: "Mismatch" }]),
      headers: { "content-type": "application/json" },
    }) as any,
    routeParams()
  );

  assert.equal(response.status, 400);
  assert.equal(state.insertCount, 0);
});

test("nested opportunity contacts rejects update when contact is outside route opportunity", async () => {
  const state: TestState = {
    allowLeadAccess: true,
    opportunityExists: true,
    contactBelongs: false,
    selectRows: [],
    insertCount: 0,
  };

  const handlers = createOpportunityContactHandlers(
    createDeps(state, { userId: 7, roleId: 2 })
  );
  const response = await handlers.PUT(
    new Request("http://localhost", {
      method: "PUT",
      body: JSON.stringify({ OpportunityContactId: 44, FullName: "Update" }),
      headers: { "content-type": "application/json" },
    }) as any,
    routeParams()
  );

  assert.equal(response.status, 404);
});

test("nested opportunity contacts rejects delete when contact is outside route opportunity", async () => {
  const state: TestState = {
    allowLeadAccess: true,
    opportunityExists: true,
    contactBelongs: false,
    selectRows: [],
    insertCount: 0,
  };

  const handlers = createOpportunityContactHandlers(
    createDeps(state, { userId: 7, roleId: 2 })
  );
  const response = await handlers.DELETE(
    new Request("http://localhost", {
      method: "DELETE",
      body: JSON.stringify({ OpportunityContactId: 44 }),
      headers: { "content-type": "application/json" },
    }) as any,
    routeParams()
  );

  assert.equal(response.status, 404);
});

test("nested opportunity contacts allows valid manager/admin read", async () => {
  const state: TestState = {
    allowLeadAccess: true,
    opportunityExists: true,
    contactBelongs: true,
    selectRows: [{ OpportunityContactId: 1, OpportunityId: 20, FullName: "A" }],
    insertCount: 0,
  };

  const handlers = createOpportunityContactHandlers(
    createDeps(state, { userId: 1, roleId: 1 })
  );
  const response = await handlers.GET(new Request("http://localhost") as any, routeParams());

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(Array.isArray(body), true);
  assert.equal(body[0].OpportunityContactId, 1);
});

test("nested opportunity contacts allows valid sales create within authorized scope", async () => {
  const state: TestState = {
    allowLeadAccess: true,
    opportunityExists: true,
    contactBelongs: true,
    selectRows: [],
    insertCount: 0,
  };

  const handlers = createOpportunityContactHandlers(
    createDeps(state, { userId: 9, roleId: 2 })
  );
  const response = await handlers.POST(
    new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify([{ FullName: "New Contact", WorkEmail: "new@example.com" }]),
      headers: { "content-type": "application/json" },
    }) as any,
    routeParams()
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(state.insertCount, 1);
});

