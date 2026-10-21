const fs = require("fs");
const mysql = require("mysql2/promise");

function loadEnv(path) {
  const env = { ...process.env };
  const text = fs.readFileSync(path, "utf8");

  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const idx = t.indexOf("=");
    if (idx <= 0) continue;

    const key = t.slice(0, idx).trim();
    let value = t.slice(idx + 1).trim();

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

  const marker = `VERIFY_TEMPLATE_${Date.now()}`;
  let templateId = 0;

  try {
    const [insertResult] = await pool.query(
      "INSERT INTO email_templates (TemplateName, Subject, Body, CreatedBy, CreatedAt, UpdatedAt) VALUES (?, ?, ?, ?, NOW(), NOW())",
      [marker, "Initial Subject", "Initial Body {{firstName}}", 1]
    );

    templateId = Number(insertResult.insertId || 0);

    const [fetched] = await pool.query(
      "SELECT TemplateId, TemplateName, Subject, Body FROM email_templates WHERE TemplateId = ?",
      [templateId]
    );

    await pool.query(
      "UPDATE email_templates SET TemplateName = ?, Subject = ?, Body = ?, UpdatedAt = NOW() WHERE TemplateId = ?",
      [
        `${marker}_EDIT`,
        "Updated Subject {{companyName}}",
        "Updated Body {{contactName}}",
        templateId,
      ]
    );

    const [updated] = await pool.query(
      "SELECT TemplateName, Subject, Body FROM email_templates WHERE TemplateId = ?",
      [templateId]
    );

    await pool.query("DELETE FROM email_templates WHERE TemplateId = ?", [templateId]);

    const [afterDelete] = await pool.query(
      "SELECT COUNT(*) AS c FROM email_templates WHERE TemplateId = ?",
      [templateId]
    );

    const result = {
      createOk: templateId > 0,
      fetchOk: Array.isArray(fetched) && fetched.length === 1,
      updateOk:
        Array.isArray(updated) &&
        updated.length === 1 &&
        String(updated[0].Subject || "").includes("Updated Subject"),
      deleteOk: Number(afterDelete[0].c) === 0,
      templateId,
    };

    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("VERIFY_FAILED", error?.message || error);
    process.exitCode = 1;
  } finally {
    if (templateId) {
      try {
        await pool.query("DELETE FROM email_templates WHERE TemplateId = ?", [templateId]);
      } catch (_) {
        // noop
      }
    }
    await pool.end();
  }
}

run();

