const fs = require("fs");
const mysql = require("mysql2/promise");

function loadEnv(path) {
  const env = { ...process.env };
  if (!fs.existsSync(path)) return env;
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

function tableMap(names) {
  const map = new Map();
  for (const name of names) map.set(String(name).toLowerCase(), name);
  return map;
}

function findTable(map, candidates) {
  for (const c of candidates) {
    const hit = map.get(String(c).toLowerCase());
    if (hit) return hit;
  }
  return null;
}

async function safeCount(pool, table) {
  const [rows] = await pool.query(`SELECT COUNT(*) AS c FROM \`${table}\``);
  return Number(rows?.[0]?.c || 0);
}

async function safeQuery(pool, sql, params = []) {
  try {
    const [rows] = await pool.query(sql, params);
    return { ok: true, rows: rows || [] };
  } catch (err) {
    return {
      ok: false,
      code: err?.code || null,
      msg: String(err?.message || err).slice(0, 180),
    };
  }
}

async function main() {
  const envPath = fs.existsSync(".env.local")
    ? ".env.local"
    : fs.existsSync(".env")
      ? ".env"
      : null;

  if (!envPath) {
    console.log("CONNECT {\"ok\":false,\"reason\":\"env_file_missing\"}");
    process.exit(1);
  }

  const env = loadEnv(envPath);
  const cfg = {
    host: env.MYSQL_HOST,
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    database: env.MYSQL_DATABASE,
    port: Number(env.MYSQL_PORT || 3306),
  };

  const missingKeys = ["MYSQL_HOST", "MYSQL_USER", "MYSQL_DATABASE"].filter(
    (k) => !env[k]
  );
  console.log(
    "CONFIG " +
      JSON.stringify({
        envFile: envPath,
        hostSet: Boolean(cfg.host),
        port: cfg.port || null,
        userSet: Boolean(cfg.user),
        passwordSet: Boolean(cfg.password),
        database: cfg.database || null,
        missingKeys,
      })
  );

  if (missingKeys.length) {
    console.log("CONNECT {\"ok\":false,\"reason\":\"config_missing\"}");
    process.exit(1);
  }

  let pool;
  try {
    pool = await mysql.createPool({
      ...cfg,
      waitForConnections: true,
      connectionLimit: 2,
    });
    const [envRows] = await pool.query(
      "SELECT DATABASE() AS db, VERSION() AS ver, CURRENT_USER() AS currentUser"
    );
    console.log("CONNECT " + JSON.stringify({ ok: true, ...(envRows[0] || {}) }));
  } catch (err) {
    console.log(
      "CONNECT " +
        JSON.stringify({
          ok: false,
          code: err?.code || null,
          errno: err?.errno || null,
          sqlState: err?.sqlState || null,
          msg: String(err?.message || err).slice(0, 220),
        })
    );
    process.exit(1);
  }

  const [tableRows] = await pool.query(
    `SELECT TABLE_NAME, TABLE_TYPE, ENGINE, TABLE_ROWS, AUTO_INCREMENT
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
     ORDER BY TABLE_NAME`
  );
  const tables = (tableRows || []).map((r) => r.TABLE_NAME);
  const tmap = tableMap(tables);
  console.log("TABLES_BEGIN");
  for (const row of tableRows || []) console.log(JSON.stringify(row));
  console.log("TABLES_END");
  console.log("TABLE_COUNT " + tables.length);

  if (tables.length) {
    const [cols] = await pool.query(
      `SELECT TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, COLUMN_TYPE, IS_NULLABLE,
              COLUMN_DEFAULT, EXTRA, COLUMN_KEY, CHARACTER_MAXIMUM_LENGTH
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
       ORDER BY TABLE_NAME, ORDINAL_POSITION`
    );
    console.log("COLUMNS_BEGIN");
    for (const row of cols || []) console.log(JSON.stringify(row));
    console.log("COLUMNS_END");

    const [cons] = await pool.query(
      `SELECT tc.TABLE_NAME, tc.CONSTRAINT_NAME, tc.CONSTRAINT_TYPE,
              kcu.COLUMN_NAME, kcu.REFERENCED_TABLE_NAME, kcu.REFERENCED_COLUMN_NAME,
              kcu.ORDINAL_POSITION
       FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
       LEFT JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
         ON tc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
        AND tc.TABLE_NAME = kcu.TABLE_NAME
        AND tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
       WHERE tc.CONSTRAINT_SCHEMA = DATABASE()
       ORDER BY tc.TABLE_NAME, tc.CONSTRAINT_TYPE, tc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`
    );
    console.log("CONSTRAINTS_BEGIN");
    for (const row of cons || []) console.log(JSON.stringify(row));
    console.log("CONSTRAINTS_END");

    const [idx] = await pool.query(
      `SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME, INDEX_TYPE
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE()
       ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`
    );
    console.log("INDEXES_BEGIN");
    for (const row of idx || []) console.log(JSON.stringify(row));
    console.log("INDEXES_END");
  }

  console.log("COUNTS_BEGIN");
  for (const t of tables) {
    try {
      const c = await safeCount(pool, t);
      console.log(JSON.stringify({ table: t, count: c }));
    } catch (err) {
      console.log(
        JSON.stringify({
          table: t,
          count: null,
          error: String(err?.message || err).slice(0, 120),
        })
      );
    }
  }
  console.log("COUNTS_END");

  const users = findTable(tmap, ["Users"]);
  const roles = findTable(tmap, ["Roles"]);
  const leads = findTable(tmap, ["Leads"]);
  const leadContacts = findTable(tmap, ["LeadContacts"]);
  const companies = findTable(tmap, ["Companies"]);
  const companyUsers = findTable(tmap, ["CompanyUsers"]);

  if (users) {
    const roleDist = await safeQuery(
      pool,
      `SELECT RoleId, COUNT(*) AS c FROM \`${users}\` GROUP BY RoleId ORDER BY c DESC`
    );
    console.log("USER_ROLE_DIST " + JSON.stringify(roleDist));
  }

  if (leads) {
    const ownerNull = await safeQuery(
      pool,
      `SELECT COUNT(*) AS c FROM \`${leads}\` WHERE OwnerId IS NULL`
    );
    console.log("LEADS_OWNER_NULL " + JSON.stringify(ownerNull));
    const accountTypes = await safeQuery(
      pool,
      `SELECT AccountTypeId, COUNT(*) AS c FROM \`${leads}\` GROUP BY AccountTypeId ORDER BY c DESC`
    );
    console.log("LEADS_ACCOUNT_TYPE_DIST " + JSON.stringify(accountTypes));
  }

  console.log(
    "TENANT_TABLES " +
      JSON.stringify({
        companies: companies || null,
        companyUsers: companyUsers || null,
        users: users || null,
        roles: roles || null,
        leads: leads || null,
        leadContacts: leadContacts || null,
      })
  );

  await pool.end();
}

main().catch((err) => {
  console.log(
    "ERR " +
      JSON.stringify({
        code: err?.code || null,
        msg: String(err?.message || err).slice(0, 220),
      })
  );
  process.exit(1);
});
