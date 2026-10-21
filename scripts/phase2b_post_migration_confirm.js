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

async function main() {
  const env = loadEnv(".env.local");
  const pool = await mysql.createPool({
    host: env.MYSQL_HOST,
    port: Number(env.MYSQL_PORT || 3306),
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    database: env.MYSQL_DATABASE,
    connectionLimit: 1,
  });

  const [company] = await pool.query(
    "SELECT CompanyId, CompanyCode, CompanyName FROM Companies WHERE CompanyCode = 'adroitent'"
  );
  const companyId = company[0]?.CompanyId;
  const [owner] = await pool.query(
    `SELECT COUNT(*) AS leads_total,
            SUM(CASE WHEN OwnerId IS NULL THEN 1 ELSE 0 END) AS leads_owner_null,
            SUM(LeadId) AS lead_id_sum,
            SUM(IFNULL(OwnerId, 0)) AS owner_id_sum,
            SUM(CASE WHEN CompanyId = ? THEN 1 ELSE 0 END) AS leads_adroitent,
            SUM(CASE WHEN CompanyId <> ? THEN 1 ELSE 0 END) AS leads_other_company
     FROM leads`,
    [companyId, companyId]
  );
  const [membership] = await pool.query(
    `SELECT COUNT(*) AS members,
            SUM(CASE WHEN cu.RoleId = u.RoleId THEN 1 ELSE 0 END) AS role_copied,
            SUM(CASE WHEN IsDefault = 1 THEN 1 ELSE 0 END) AS defaults
     FROM CompanyUsers cu
     INNER JOIN users u ON u.UserId = cu.UserId
     WHERE cu.CompanyId = ?`,
    [companyId]
  );
  const [nonAdroitent] = await pool.query(
    `SELECT SUM(cnt) AS other_company_rows FROM (
       SELECT COUNT(*) cnt FROM leads WHERE CompanyId <> ?
       UNION ALL SELECT COUNT(*) FROM emails WHERE CompanyId <> ?
       UNION ALL SELECT COUNT(*) FROM projects WHERE CompanyId <> ?
       UNION ALL SELECT COUNT(*) FROM email_templates WHERE CompanyId <> ?
     ) t`,
    [companyId, companyId, companyId, companyId]
  );

  console.log(
    "CONFIRM " +
      JSON.stringify({
        company: company[0] || null,
        owner: owner[0] || null,
        membership: membership[0] || null,
        otherCompanyRows: nonAdroitent[0]?.other_company_rows || 0,
      })
  );
  await pool.end();
}

main().catch((err) => {
  console.log("ERR " + JSON.stringify({ msg: String(err?.message || err).slice(0, 180) }));
  process.exit(1);
});
