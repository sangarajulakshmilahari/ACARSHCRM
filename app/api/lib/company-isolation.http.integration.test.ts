import assert from "node:assert/strict";
import fs from "node:fs";
import { after, before, test } from "node:test";

import mysql from "mysql2/promise";
import { NextRequest } from "next/server";

const ISOLATION_DB = "acarsh_isolation_http_test";
const FORBIDDEN_DB = "acarsh_db";

function loadEnvLocal(): Record<string, string> {
  const env: Record<string, string> = {};
  const text = fs.readFileSync(".env.local", "utf8");
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const key = t.slice(0, i).trim();
    let value = t.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function isLocalHost(host: string): boolean {
  const h = String(host || "").trim().toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

type TestUser = {
  userId: number;
  roleId: number;
  userName: string;
  matchedBy: "UserName";
  companyId: number | null;
};

const state: { pool: mysql.Pool | null; user: TestUser | null } = {
  pool: null,
  user: null,
};

let admin: mysql.Pool;

function alphaManager(): TestUser {
  return {
    userId: 1,
    roleId: 1,
    userName: "alpha.manager",
    matchedBy: "UserName",
    companyId: 11,
  };
}

async function assertRoutePoolIsIsolationDb(): Promise<void> {
  const { getPool } = await import("@/config/db");
  const pool = await getPool();
  const [rows]: any = await pool.query(`SELECT DATABASE() AS db`);
  assert.equal(rows[0].db, ISOLATION_DB);
  assert.notEqual(rows[0].db, FORBIDDEN_DB);
}

function jsonRequest(url: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

before(async () => {
  const env = loadEnvLocal();
  if (!isLocalHost(env.MYSQL_HOST)) {
    throw new Error("HTTP isolation tests refuse non-local MYSQL_HOST");
  }
  if (String(env.MYSQL_DATABASE || "").toLowerCase() === ISOLATION_DB) {
    throw new Error("Working MYSQL_DATABASE must not be the HTTP isolation database");
  }
  if (String(env.MYSQL_DATABASE || "").toLowerCase() === FORBIDDEN_DB) {
    // Isolation tests may read credentials from .env.local, but they must never
    // point Next.js getPool() at the working CRM database.
  }

  admin = mysql.createPool({
    host: env.MYSQL_HOST,
    port: Number(env.MYSQL_PORT || 3306),
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    database: "mysql",
    connectionLimit: 1,
  });
  await admin.query(`DROP DATABASE IF EXISTS \`${ISOLATION_DB}\``);
  await admin.query(
    `CREATE DATABASE \`${ISOLATION_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );

  process.env.MYSQL_HOST = env.MYSQL_HOST;
  process.env.MYSQL_PORT = String(env.MYSQL_PORT || 3306);
  process.env.MYSQL_USER = env.MYSQL_USER;
  process.env.MYSQL_PASSWORD = env.MYSQL_PASSWORD;
  process.env.MYSQL_DATABASE = ISOLATION_DB;
  assert.notEqual(String(process.env.MYSQL_DATABASE).toLowerCase(), FORBIDDEN_DB);

  const { __setAuthUserForTests } = await import("@/app/api/lib/auth");
  __setAuthUserForTests(() => state.user);

  const { getPool } = await import("@/config/db");
  state.pool = await getPool();
  const [dbRows]: any = await state.pool.query(`SELECT DATABASE() AS db`);
  assert.equal(dbRows[0].db, ISOLATION_DB);
  assert.notEqual(dbRows[0].db, FORBIDDEN_DB);

  await state.pool.query(`
    CREATE TABLE Leads (
      LeadId INT NOT NULL AUTO_INCREMENT,
      CompanyId INT NOT NULL,
      CompanyName VARCHAR(200) NOT NULL,
      OwnerId INT NULL,
      AccountTypeId INT NULL,
      PRIMARY KEY (LeadId)
    )
  `);
  await state.pool.query(`
    CREATE TABLE AccountTypes (
      AccountTypeId INT NOT NULL,
      Name VARCHAR(40) NOT NULL,
      PRIMARY KEY (AccountTypeId)
    )
  `);
  await state.pool.query(
    `INSERT INTO AccountTypes (AccountTypeId, Name) VALUES (10, 'Lead'), (20, 'Prospect'), (30, 'Account')`
  );
  await state.pool.query(
    `INSERT INTO Leads (LeadId, CompanyId, CompanyName, OwnerId, AccountTypeId) VALUES
      (100, 11, 'Alpha Co', 1, 10),
      (200, 22, 'Beta Co', 2, 10),
      (300, 11, 'Alpha Convert Account', 1, 10),
      (400, 22, 'Beta Convert Account', 2, 10)`
  );
});

after(async () => {
  const { __setAuthUserForTests } = await import("@/app/api/lib/auth");
  __setAuthUserForTests(null);
  if (state.pool) {
    try {
      await state.pool.end();
    } catch {
      // pool may already be closed
    }
    state.pool = null;
  }
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS \`${ISOLATION_DB}\``);
    await admin.end();
  }
});

test("HTTP isolation pool never points at the working CRM database", async () => {
  await assertRoutePoolIsIsolationDb();
});

test("HTTP convert rejects cross-company lead access", async () => {
  await assertRoutePoolIsIsolationDb();
  const { POST } = await import("../employees/leads/[leadID]/convert/route");
  state.user = alphaManager();
  const res = await POST(jsonRequest("http://localhost/api/employees/leads/200/convert"), {
    params: { leadID: "200" },
  });
  assert.equal(res.status, 403);
  const [still]: any = await state.pool!.query(`SELECT AccountTypeId FROM Leads WHERE LeadId = 200`);
  assert.equal(Number(still[0].AccountTypeId), 10);
});

test("HTTP convert allows same-company lead", async () => {
  await assertRoutePoolIsIsolationDb();
  const { POST } = await import("../employees/leads/[leadID]/convert/route");
  state.user = alphaManager();
  const res = await POST(
    jsonRequest("http://localhost/api/employees/leads/100/convert", { target: "Prospect" }),
    { params: { leadID: "100" } }
  );
  assert.equal(res.status, 200);
  const [updated]: any = await state.pool!.query(`SELECT AccountTypeId FROM Leads WHERE LeadId = 100`);
  assert.equal(Number(updated[0].AccountTypeId), 20);
});

test("HTTP convert-to-account rejects cross-company lead access", async () => {
  await assertRoutePoolIsIsolationDb();
  const { POST } = await import("../employees/leads/[leadID]/converttoaccount/route");
  state.user = alphaManager();
  const res = await POST(jsonRequest("http://localhost/api/employees/leads/400/converttoaccount"), {
    params: { leadID: "400" },
  });
  assert.equal(res.status, 403);
  const [still]: any = await state.pool!.query(`SELECT AccountTypeId FROM Leads WHERE LeadId = 400`);
  assert.equal(Number(still[0].AccountTypeId), 10);
});

test("HTTP meeting schedule rejects cross-company lead access", async () => {
  await assertRoutePoolIsIsolationDb();
  const { POST } = await import("../employees/leads/[leadID]/meetings/schedule/route");
  state.user = alphaManager();
  const res = await POST(
    jsonRequest("http://localhost/api/employees/leads/200/meetings/schedule", {
      subject: "Sync",
      startDateTime: "2026-10-21T10:00:00Z",
      endDateTime: "2026-10-21T10:30:00Z",
      attendees: [],
      sendEmail: false,
    }),
    { params: { leadID: "200" } }
  );
  assert.equal(res.status, 403);
});
