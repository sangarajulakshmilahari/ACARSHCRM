const fs = require("fs");
const mysql = require("mysql2/promise");

function loadEnv(path) {
  const env = {};
  const text = fs.readFileSync(path, "utf8");
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

function isLocalHost(host) {
  const h = String(host || "").trim().toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

async function main() {
  const env = loadEnv(".env.local");
  if (!isLocalHost(env.MYSQL_HOST) || env.MYSQL_DATABASE !== "acarsh_db") {
    console.log(JSON.stringify({ ok: false, reason: "not_local_acarsh_db" }));
    process.exit(1);
  }
  const websiteCompanyId = Number(env.WEBSITE_CRM_COMPANY_ID);
  const pool = await mysql.createPool({
    host: env.MYSQL_HOST,
    port: Number(env.MYSQL_PORT || 3306),
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    database: env.MYSQL_DATABASE,
    connectionLimit: 1,
  });
  const [db] = await pool.query(`SELECT DATABASE() AS db`);
  const [tables] = await pool.query(
    `
      SELECT TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN ('companies', 'Companies', 'email_tracked_links', 'subcategory', 'SubCategory')
      ORDER BY TABLE_NAME
    `
  );
  const [companyCols] = await pool.query(
    `
      SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN ('companies', 'Companies')
        AND COLUMN_NAME = 'CompanyId'
    `
  );
  const [tracked] = await pool.query(
    `
      SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'email_tracked_links'
        AND COLUMN_NAME = 'CompanyId'
    `
  );
  const [fks] = await pool.query(
    `
      SELECT CONSTRAINT_NAME, TABLE_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
      FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'email_tracked_links'
        AND REFERENCED_TABLE_NAME IS NOT NULL
    `
  );
  const [subCols] = await pool.query(
    `
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN ('subcategory', 'SubCategory')
      ORDER BY ORDINAL_POSITION
    `
  );
  let websiteCompany = null;
  if (Number.isInteger(websiteCompanyId) && websiteCompanyId > 0) {
    const [rows] = await pool.query(
      `SELECT CompanyId, IsActive FROM Companies WHERE CompanyId = ? LIMIT 1`,
      [websiteCompanyId]
    );
    websiteCompany = rows[0] || null;
  }
  await pool.end();
  console.log(
    JSON.stringify(
      {
        ok: true,
        database: db[0].db,
        websiteCompanyIdConfigured: Number.isInteger(websiteCompanyId) && websiteCompanyId > 0,
        websiteCompanyId: Number.isInteger(websiteCompanyId) && websiteCompanyId > 0 ? websiteCompanyId : null,
        websiteCompanyActive:
          websiteCompany == null ? null : Number(websiteCompany.IsActive) === 1,
        tables: tables.map((row) => row.TABLE_NAME),
        companiesCompanyId: companyCols,
        trackedLinksCompanyId: tracked,
        trackedLinksForeignKeys: fks,
        subcategoryColumns: subCols.map((row) => row.COLUMN_NAME),
        subcategoryHasCompanyId: subCols.some(
          (row) => String(row.COLUMN_NAME).toLowerCase() === "companyid"
        ),
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.log(JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err) }));
  process.exit(1);
});
