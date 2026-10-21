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
  const host = env.MYSQL_HOST;
  const port = Number(env.MYSQL_PORT || 3306);
  const database = env.MYSQL_DATABASE;
  const local = isLocalHost(host);
  const looksRemote = /prod|production|rds|azure|aws|cloud|remote|\.com|\.net/i.test(
    String(host || "")
  );

  console.log(
    "GUARD " +
      JSON.stringify({
        envFile: ".env.local",
        host,
        port,
        database,
        localHost: local,
        looksRemote,
        userSet: Boolean(env.MYSQL_USER),
        passwordSet: Boolean(env.MYSQL_PASSWORD),
      })
  );

  if (!local || looksRemote || database !== "acarsh_db") {
    console.log("CONNECT {\"ok\":false,\"reason\":\"not_local_acarsh_db\"}");
    process.exit(1);
  }

  const pool = await mysql.createPool({
    host,
    port,
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    database,
    connectionLimit: 1,
  });

  const [info] = await pool.query(
    `SELECT DATABASE() AS db,
            VERSION() AS ver,
            @@hostname AS hostname,
            @@port AS serverPort,
            @@bind_address AS bindAddress`
  );
  const [owner] = await pool.query(
    `SELECT COUNT(*) AS leads_total,
            SUM(CASE WHEN OwnerId IS NULL THEN 1 ELSE 0 END) AS leads_owner_null,
            SUM(LeadId) AS lead_id_sum,
            SUM(IFNULL(OwnerId, 0)) AS owner_id_sum
     FROM leads`
  );
  console.log("CONNECT " + JSON.stringify({ ok: true, ...(info[0] || {}) }));
  console.log("OWNER_BASELINE " + JSON.stringify(owner[0] || {}));
  await pool.end();
}

main().catch((err) => {
  console.log(
    "ERR " +
      JSON.stringify({
        code: err?.code || null,
        msg: String(err?.message || err).slice(0, 180),
      })
  );
  process.exit(1);
});
