const fs = require("fs");
const mysql = require("mysql2/promise");

function loadEnv(path) {
  const env = { ...process.env };
  if (!fs.existsSync(path)) return env;
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const key = t.slice(0, i).trim();
    let value = t.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

async function main() {
  const envPath = fs.existsSync(".env.local") ? ".env.local" : fs.existsSync(".env") ? ".env" : null;
  if (!envPath) {
    console.log(JSON.stringify({ ok: false, reason: "env_file_missing" }));
    process.exit(1);
  }
  const env = loadEnv(envPath);
  const pool = await mysql.createPool({
    host: env.MYSQL_HOST,
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    database: env.MYSQL_DATABASE,
    port: Number(env.MYSQL_PORT || 3306),
  });
  try {
    const [dbRows] = await pool.query("SELECT DATABASE() AS db");
    const [tables] = await pool.query(
      `SELECT TABLE_NAME
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
         AND LOWER(TABLE_NAME) IN ('leadimports', 'leadimportrows', 'importjobs', 'importjobrows')
       ORDER BY TABLE_NAME`,
    );
    const [columns] = await pool.query(
      `SELECT TABLE_NAME, COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND LOWER(TABLE_NAME) IN ('leadimports', 'leadimportrows', 'importjobs', 'importjobrows')
       ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    );
    let insertError = null;
    try {
      await pool.query("SELECT ImportId FROM LeadImports LIMIT 0");
    } catch (err) {
      insertError = {
        code: err.code || null,
        errno: err.errno || null,
        sqlState: err.sqlState || null,
        message: String(err.message || "").replace(/'[^']*@[^']*'/g, "'[redacted]'").slice(0, 240),
      };
    }
    console.log(
      JSON.stringify({
        ok: true,
        database: dbRows?.[0]?.db || env.MYSQL_DATABASE || null,
        tables: (tables || []).map((row) => row.TABLE_NAME),
        columns: (columns || []).map((row) => `${row.TABLE_NAME}.${row.COLUMN_NAME}`),
        selectProbe: insertError,
      }),
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.log(JSON.stringify({
    ok: false,
    code: err.code || null,
    message: String(err.message || "").slice(0, 240),
  }));
  process.exit(1);
});
