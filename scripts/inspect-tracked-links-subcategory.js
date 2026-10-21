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

  const [tables] = await pool.query(
    `
      SELECT TABLE_NAME, TABLE_TYPE
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND LOWER(TABLE_NAME) IN ('email_tracked_links', 'subcategory', 'sowmaster')
      ORDER BY TABLE_NAME
    `
  );
  const [cols] = await pool.query(
    `
      SELECT TABLE_NAME, COLUMN_NAME, IS_NULLABLE, COLUMN_TYPE, COLUMN_KEY
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND LOWER(TABLE_NAME) IN ('email_tracked_links', 'subcategory', 'sowmaster')
      ORDER BY TABLE_NAME, ORDINAL_POSITION
    `
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        host: env.MYSQL_HOST,
        database: env.MYSQL_DATABASE,
        tables,
        cols,
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
