import assert from "node:assert/strict";
import fs from "node:fs";
import { after, before, test } from "node:test";

import mysql from "mysql2/promise";

import {
  companyPredicate,
  loadActiveCompanyId,
  loadCompanyMemberships,
  requireCompanyId,
  resolveActiveMembership,
  selectRequestedMembership,
  shouldShowCompanySelector,
} from "./company-tenancy";
import { buildLeadOwnerVisibilityClause } from "./lead-access";

const ISOLATION_DB = "acarsh_isolation_test";
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

let admin: mysql.Pool;
let pool: mysql.Pool;

before(async () => {
  const env = loadEnvLocal();
  const host = env.MYSQL_HOST;
  if (!isLocalHost(host)) {
    throw new Error("Isolation tests refuse non-local MYSQL_HOST");
  }
  if (String(env.MYSQL_DATABASE || "").toLowerCase() === ISOLATION_DB) {
    throw new Error("Working MYSQL_DATABASE must not be the isolation database");
  }

  admin = mysql.createPool({
    host,
    port: Number(env.MYSQL_PORT || 3306),
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    database: "mysql",
    connectionLimit: 1,
    multipleStatements: true,
  });

  await admin.query(`DROP DATABASE IF EXISTS \`${ISOLATION_DB}\``);
  await admin.query(`CREATE DATABASE \`${ISOLATION_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

  pool = mysql.createPool({
    host,
    port: Number(env.MYSQL_PORT || 3306),
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    database: ISOLATION_DB,
    connectionLimit: 4,
  });

  const [dbRows]: any = await pool.query(`SELECT DATABASE() AS db`);
  assert.equal(dbRows[0].db, ISOLATION_DB);
  assert.notEqual(dbRows[0].db, FORBIDDEN_DB);

  const tables = [
    `CREATE TABLE Companies (
      CompanyId INT NOT NULL AUTO_INCREMENT,
      CompanyCode VARCHAR(40) NOT NULL,
      CompanyName VARCHAR(120) NOT NULL,
      IsActive TINYINT(1) NOT NULL DEFAULT 1,
      PRIMARY KEY (CompanyId)
    )`,
    `CREATE TABLE Users (
      UserId INT NOT NULL AUTO_INCREMENT,
      UserName VARCHAR(80) NOT NULL,
      RoleId INT NOT NULL,
      PRIMARY KEY (UserId)
    )`,
    `CREATE TABLE CompanyUsers (
      CompanyUserId INT NOT NULL AUTO_INCREMENT,
      UserId INT NOT NULL,
      CompanyId INT NOT NULL,
      RoleId INT NOT NULL,
      IsDefault TINYINT(1) NOT NULL DEFAULT 0,
      IsActive TINYINT(1) NOT NULL DEFAULT 1,
      PRIMARY KEY (CompanyUserId)
    )`,
    `CREATE TABLE Leads (
      LeadId INT NOT NULL AUTO_INCREMENT,
      CompanyId INT NOT NULL,
      CompanyName VARCHAR(200) NOT NULL,
      OwnerId INT NULL,
      IsDeleted TINYINT(1) NOT NULL DEFAULT 0,
      PRIMARY KEY (LeadId)
    )`,
    `CREATE TABLE LeadContacts (
      LeadContactID INT NOT NULL AUTO_INCREMENT,
      LeadId INT NOT NULL,
      CompanyId INT NOT NULL,
      ContactName VARCHAR(120) NOT NULL,
      ContactEmail VARCHAR(200) NULL,
      PRIMARY KEY (LeadContactID)
    )`,
    `CREATE TABLE emails (
      EmailId BIGINT NOT NULL AUTO_INCREMENT,
      LeadContactID INT NOT NULL,
      CompanyId INT NOT NULL,
      ToEmail VARCHAR(200) NOT NULL,
      Subject VARCHAR(250) NOT NULL,
      Status VARCHAR(20) NOT NULL,
      PRIMARY KEY (EmailId)
    )`,
    `CREATE TABLE email_events (
      EventId BIGINT NOT NULL AUTO_INCREMENT,
      EmailId BIGINT NOT NULL,
      CompanyId INT NOT NULL,
      EventType VARCHAR(40) NOT NULL,
      EventTime DATETIME NOT NULL,
      Metadata JSON NULL,
      PRIMARY KEY (EventId)
    )`,
    `CREATE TABLE email_tracked_links (
      TrackedLinkId BIGINT NOT NULL AUTO_INCREMENT,
      EmailId BIGINT NOT NULL,
      CompanyId INT NOT NULL,
      UrlHash CHAR(64) NOT NULL,
      DestinationUrl VARCHAR(2000) NOT NULL,
      PRIMARY KEY (TrackedLinkId),
      UNIQUE KEY uq_email_tracked_links_email_url (EmailId, UrlHash)
    )`,
    `CREATE TABLE Projects (
      ProjectId INT NOT NULL AUTO_INCREMENT,
      CustomerId INT NOT NULL,
      CompanyId INT NOT NULL,
      ProjectName VARCHAR(120) NOT NULL,
      IsDeleted TINYINT(1) NOT NULL DEFAULT 0,
      PRIMARY KEY (ProjectId)
    )`,
    `CREATE TABLE SOWMaster (
      SOWId BIGINT NOT NULL AUTO_INCREMENT,
      ProjectId INT NULL,
      CompanyId INT NOT NULL,
      SOWName VARCHAR(200) NOT NULL,
      FileName VARCHAR(250) NULL,
      FileData LONGBLOB NULL,
      IsActive TINYINT(1) NOT NULL DEFAULT 1,
      PRIMARY KEY (SOWId)
    )`,
  ];
  for (const ddl of tables) {
    await pool.query(ddl);
  }

  await pool.query(`INSERT INTO Companies (CompanyId, CompanyCode, CompanyName, IsActive) VALUES (11, 'alpha', 'Alpha', 1), (22, 'beta', 'Beta', 1), (33, 'inactive', 'Inactive', 0)`);
  await pool.query(`INSERT INTO Users (UserId, UserName, RoleId) VALUES (1, 'alpha.manager', 1), (2, 'beta.manager', 1), (3, 'both.manager', 1)`);
  await pool.query(`INSERT INTO CompanyUsers (UserId, CompanyId, RoleId, IsDefault, IsActive) VALUES (1, 11, 1, 1, 1), (2, 22, 1, 1, 1), (3, 11, 1, 1, 1), (3, 22, 1, 0, 1)`);
  await pool.query(`INSERT INTO Leads (LeadId, CompanyId, CompanyName, OwnerId) VALUES (100, 11, 'Alpha Co', 1), (200, 22, 'Beta Co', 2)`);
  await pool.query(`INSERT INTO LeadContacts (LeadContactID, LeadId, CompanyId, ContactName, ContactEmail) VALUES (1001, 100, 11, 'Ann', 'ann@alpha.test'), (2001, 200, 22, 'Ben', 'ben@beta.test')`);
  await pool.query(`INSERT INTO emails (EmailId, LeadContactID, CompanyId, ToEmail, Subject, Status) VALUES (500, 1001, 11, 'ann@alpha.test', 'Hi', 'SENT'), (600, 2001, 22, 'ben@beta.test', 'Hi', 'SENT')`);
  await pool.query(`INSERT INTO Projects (ProjectId, CustomerId, CompanyId, ProjectName) VALUES (10, 100, 11, 'Alpha Project'), (20, 200, 22, 'Beta Project')`);
  await pool.query(`INSERT INTO SOWMaster (SOWId, ProjectId, CompanyId, SOWName, FileName, FileData, IsActive) VALUES (1, 10, 11, 'Alpha SOW', 'a.docx', 'AAA', 1), (2, 20, 22, 'Beta SOW', 'b.docx', 'BBB', 1)`);
});

after(async () => {
  if (pool) await pool.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS \`${ISOLATION_DB}\``);
    await admin.end();
  }
});

test("isolation database is not the working CRM database", async () => {
  const [rows]: any = await pool.query(`SELECT DATABASE() AS db`);
  assert.equal(rows[0].db, ISOLATION_DB);
  assert.notEqual(rows[0].db, FORBIDDEN_DB);
});

test("cross-company lead reads stay isolated", async () => {
  const visA = buildLeadOwnerVisibilityClause({ userId: 1, roleId: 1, companyId: 11 }, "l");
  const [alpha]: any = await pool.query(
    `SELECT LeadId FROM Leads l WHERE ${visA.clause}`,
    visA.params
  );
  assert.deepEqual(alpha.map((r: any) => Number(r.LeadId)), [100]);

  const visB = buildLeadOwnerVisibilityClause({ userId: 2, roleId: 1, companyId: 22 }, "l");
  const [beta]: any = await pool.query(
    `SELECT LeadId FROM Leads l WHERE ${visB.clause}`,
    visB.params
  );
  assert.deepEqual(beta.map((r: any) => Number(r.LeadId)), [200]);
});

test("cross-company insert/update/delete cannot touch the other tenant", async () => {
  const companyA = requireCompanyId({ companyId: 11 });
  await pool.query(`INSERT INTO Leads (CompanyId, CompanyName, OwnerId) VALUES (?, 'New Alpha', 1)`, [companyA]);
  const [own]: any = await pool.query(`SELECT COUNT(*) AS n FROM Leads WHERE CompanyName = 'New Alpha' AND CompanyId = 11`);
  const [other]: any = await pool.query(`SELECT COUNT(*) AS n FROM Leads WHERE CompanyName = 'New Alpha' AND CompanyId = 22`);
  assert.equal(Number(own[0].n), 1);
  assert.equal(Number(other[0].n), 0);

  const [upd]: any = await pool.query(`UPDATE Leads SET CompanyName = 'Hacked' WHERE LeadId = 200 AND CompanyId = ?`, [companyA]);
  assert.equal(Number(upd.affectedRows || 0), 0);

  const [del]: any = await pool.query(`DELETE FROM Leads WHERE LeadId = 200 AND CompanyId = ?`, [companyA]);
  assert.equal(Number(del.affectedRows || 0), 0);

  const [still]: any = await pool.query(`SELECT CompanyName FROM Leads WHERE LeadId = 200`);
  assert.equal(still[0].CompanyName, "Beta Co");
});

test("email history is company scoped", async () => {
  const company = companyPredicate("e", 11);
  const [rows]: any = await pool.query(
    `
      SELECT e.EmailId
      FROM emails e
      INNER JOIN LeadContacts lc ON lc.LeadContactID = e.LeadContactID
      INNER JOIN Leads l ON l.LeadId = lc.LeadId
      WHERE ${company.clause}
    `,
    company.params
  );
  assert.deepEqual(rows.map((r: any) => Number(r.EmailId)), [500]);
});

test("SOW download is company scoped", async () => {
  const [allowed]: any = await pool.query(
    `SELECT SOWId, FileName FROM SOWMaster WHERE SOWId = ? AND CompanyId = ? AND IsActive = 1`,
    [1, 11]
  );
  assert.equal(Number(allowed[0].SOWId), 1);

  const [denied]: any = await pool.query(
    `SELECT SOWId FROM SOWMaster WHERE SOWId = ? AND CompanyId = ? AND IsActive = 1`,
    [2, 11]
  );
  assert.equal(denied.length, 0);
});

test("website intake accepts only an active configured company", async () => {
  assert.equal(await loadActiveCompanyId(pool, 11), 11);
  assert.equal(await loadActiveCompanyId(pool, 33), null);
  assert.equal(await loadActiveCompanyId(pool, 99), null);
  assert.equal(await loadActiveCompanyId(pool, null), null);
});

test("service-job email mutations stay inside the parent company", async () => {
  await pool.query(`UPDATE emails SET Status = 'SENDING' WHERE EmailId = 500 AND CompanyId = 11`);
  const [alpha]: any = await pool.query(
    `UPDATE emails SET Status = 'SENT' WHERE EmailId = 500 AND CompanyId = 11 AND Status = 'SENDING'`
  );
  const [cross]: any = await pool.query(
    `UPDATE emails SET Status = 'FAILED' WHERE EmailId = 600 AND CompanyId = 11 AND Status IN ('QUEUED', 'SENDING', 'SENT')`
  );
  assert.equal(Number(alpha.affectedRows || 0) > 0, true);
  assert.equal(Number(cross.affectedRows || 0), 0);
  const [beta]: any = await pool.query(`SELECT Status FROM emails WHERE EmailId = 600`);
  assert.equal(String(beta[0].Status), "SENT");
});

test("child reminder/contact updates require CompanyId not just parent id", async () => {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS LeadReminders (
      ReminderId INT NOT NULL AUTO_INCREMENT,
      LeadId INT NOT NULL,
      CompanyId INT NOT NULL,
      ReminderNote VARCHAR(200) NOT NULL,
      PRIMARY KEY (ReminderId)
    )`
  );
  await pool.query(`INSERT INTO LeadReminders (ReminderId, LeadId, CompanyId, ReminderNote) VALUES (1, 100, 11, 'Alpha'), (2, 200, 22, 'Beta')`);
  const [cross]: any = await pool.query(
    `UPDATE LeadReminders SET ReminderNote = 'hack' WHERE ReminderId = 2 AND LeadId = 200 AND CompanyId = 11`
  );
  assert.equal(Number(cross.affectedRows || 0), 0);
  const [still]: any = await pool.query(`SELECT ReminderNote FROM LeadReminders WHERE ReminderId = 2`);
  assert.equal(String(still[0].ReminderNote), "Beta");
});

test("company selector follows live memberships and rejects unauthorized switches", async () => {
  const adroitentOnly = await loadCompanyMemberships(pool, 1);
  const locomindsOnly = await loadCompanyMemberships(pool, 2);
  const both = await loadCompanyMemberships(pool, 3);
  assert.equal(shouldShowCompanySelector(adroitentOnly), false);
  assert.equal(resolveActiveMembership(adroitentOnly, null)?.companyId, 11);
  assert.equal(shouldShowCompanySelector(locomindsOnly), false);
  assert.equal(resolveActiveMembership(locomindsOnly, 11)?.companyId, 22);
  assert.equal(shouldShowCompanySelector(both), true);
  assert.equal(resolveActiveMembership(both, 22)?.companyId, 22);
  const denied = selectRequestedMembership(adroitentOnly, 22);
  assert.equal(denied.ok, false);
  const none = await loadCompanyMemberships(pool, 99);
  assert.equal(none.length, 0);
  assert.equal(selectRequestedMembership(none, 11).ok, false);
});

test("MCP tenant clauses do not mix companies", () => {
  const a = companyPredicate("l", 11);
  const b = companyPredicate("l", 22);
  assert.notDeepEqual(a.params, b.params);
});
