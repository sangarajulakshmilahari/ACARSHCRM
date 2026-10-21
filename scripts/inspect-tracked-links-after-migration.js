const fs = require("fs");
const mysql = require("mysql2/promise");

function loadEnv(path) {
  const env = { ...process.env };
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
  const pool = await mysql.createPool({
    host: env.MYSQL_HOST,
    port: Number(env.MYSQL_PORT || 3306),
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    database: env.MYSQL_DATABASE,
    connectionLimit: 1,
  });
  const [db] = await pool.query(`SELECT DATABASE() AS db`);
  const [cols] = await pool.query(
    `
      SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_TYPE, COLUMN_KEY
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'email_tracked_links'
      ORDER BY ORDINAL_POSITION
    `
  );
  const [indexes] = await pool.query(
    `
      SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE
      FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'email_tracked_links'
      ORDER BY INDEX_NAME, SEQ_IN_INDEX
    `
  );
  const [counts] = await pool.query(
    `
      SELECT
        COUNT(*) AS tracked_links_total,
        SUM(CASE WHEN CompanyId IS NULL THEN 1 ELSE 0 END) AS tracked_links_null_company
      FROM email_tracked_links
    `
  );
  const [orphans] = await pool.query(
    `
      SELECT COUNT(*) AS orphan_count
      FROM email_tracked_links t
      LEFT JOIN emails e ON e.EmailId = t.EmailId
      WHERE t.CompanyId IS NULL
         OR e.EmailId IS NULL
         OR e.CompanyId IS NULL
    `
  );
  const [mismatches] = await pool.query(
    `
      SELECT COUNT(*) AS mismatch_count
      FROM email_tracked_links t
      INNER JOIN emails e ON e.EmailId = t.EmailId
      WHERE t.CompanyId IS NOT NULL
        AND e.CompanyId IS NOT NULL
        AND t.CompanyId <> e.CompanyId
    `
  );
  console.log(
    JSON.stringify(
      {
        ok: true,
        db: db[0].db,
        columns: cols,
        indexes,
        counts: counts[0],
        orphans: orphans[0],
        mismatches: mismatches[0],
      },
      null,
      2
    )
  );
  await pool.end();
}

main().catch((err) => {
  console.log(JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err) }));
  process.exit(1);
});
