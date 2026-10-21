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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

async function run() {
  const env = loadEnv(".env.local");
  const pool = mysql.createPool({
    host: env.MYSQL_HOST,
    port: Number(env.MYSQL_PORT || 3306),
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    database: env.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 2,
  });

  const tables = [
    "leads",
    "leadcontacts",
    "emails",
    "email_events",
    "email_templates",
    "email_sequence_contacts",
    "email_sequence_steps",
  ];

  try {
    for (const t of tables) {
      console.log(`\n===== DESCRIBE ${t} =====`);
      const [desc] = await pool.query(`DESCRIBE ${t}`);
      console.table(desc);

      console.log(`\n===== SHOW CREATE TABLE ${t} =====`);
      const [crt] = await pool.query(`SHOW CREATE TABLE ${t}`);
      const row = crt[0] || {};
      const createSql = row["Create Table"] || row["Create View"] || JSON.stringify(row);
      console.log(createSql);
    }
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error("SCHEMA_INSPECTION_FAILED", err?.message || err);
  process.exit(1);
});

