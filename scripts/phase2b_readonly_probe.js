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

const TARGET_TABLES = [
  "Users",
  "Roles",
  "Leads",
  "LeadContacts",
  "LeadActivities",
  "LeadReminders",
  "LeadNotes",
  "Opportunities",
  "OpportunityContacts",
  "Projects",
  "ProjectContacts",
  "ProjectResources",
  "customer_leads",
  "emails",
  "email_events",
  "email_attachments",
  "email_sequences",
  "email_sequence_steps",
  "email_sequence_contacts",
  "email_templates",
  "email_suppressions",
  "email_tracked_links",
  "AIChatConversations",
  "AIChatMessages",
  "AIChatMessageAttachments",
];

function qMarks(n) {
  return Array.from({ length: n }, () => "?").join(",");
}

async function main() {
  const env = loadEnv(".env.local");
  const cfg = {
    host: env.MYSQL_HOST,
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    database: env.MYSQL_DATABASE,
    port: Number(env.MYSQL_PORT || 3306),
  };

  if (!cfg.host || !cfg.user || !cfg.database) {
    console.log(JSON.stringify({ ok: false, reason: "config_missing" }));
    process.exit(1);
  }

  const pool = await mysql.createPool(cfg);

  const [envRows] = await pool.query("SELECT DATABASE() AS db, VERSION() AS ver");
  console.log("ENV " + JSON.stringify(envRows[0] || {}));

  const [tableRows] = await pool.query(
    "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE()"
  );
  const existing = new Set((tableRows || []).map((r) => r.TABLE_NAME));
  const present = TARGET_TABLES.filter((t) => existing.has(t));
  const missing = TARGET_TABLES.filter((t) => !existing.has(t));
  console.log("PRESENT " + present.join(","));
  console.log("MISSING " + missing.join(","));

  if (present.length > 0) {
    const [cols] = await pool.query(
      `SELECT TABLE_NAME,COLUMN_NAME,ORDINAL_POSITION,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,COLUMN_KEY
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${qMarks(present.length)})
       ORDER BY TABLE_NAME, ORDINAL_POSITION`,
      present
    );
    console.log("COLUMNS_BEGIN");
    for (const row of cols || []) console.log(JSON.stringify(row));
    console.log("COLUMNS_END");

    const [cons] = await pool.query(
      `SELECT tc.TABLE_NAME, tc.CONSTRAINT_NAME, tc.CONSTRAINT_TYPE,
              kcu.COLUMN_NAME, kcu.REFERENCED_TABLE_NAME, kcu.REFERENCED_COLUMN_NAME, kcu.ORDINAL_POSITION
       FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
       LEFT JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
         ON tc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
        AND tc.TABLE_NAME = kcu.TABLE_NAME
        AND tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
       WHERE tc.CONSTRAINT_SCHEMA = DATABASE()
         AND tc.TABLE_NAME IN (${qMarks(present.length)})
       ORDER BY tc.TABLE_NAME, tc.CONSTRAINT_TYPE, tc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`,
      present
    );
    console.log("CONSTRAINTS_BEGIN");
    for (const row of cons || []) console.log(JSON.stringify(row));
    console.log("CONSTRAINTS_END");

    const [idx] = await pool.query(
      `SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME IN (${qMarks(present.length)})
       ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
      present
    );
    console.log("INDEXES_BEGIN");
    for (const row of idx || []) console.log(JSON.stringify(row));
    console.log("INDEXES_END");
  }

  for (const t of present) {
    const [rows] = await pool.query(`SELECT COUNT(*) AS c FROM \`${t}\``);
    console.log(`COUNT ${t} ${rows?.[0]?.c ?? 0}`);
  }

  if (existing.has("Users")) {
    const [rd] = await pool.query(
      "SELECT RoleId, COUNT(*) AS c FROM Users GROUP BY RoleId ORDER BY c DESC"
    );
    console.log("USER_ROLE_DIST_BEGIN");
    for (const row of rd || []) console.log(JSON.stringify(row));
    console.log("USER_ROLE_DIST_END");
  }

  const orphanChecks = [
    ["orphan_leadcontacts", "SELECT COUNT(*) c FROM LeadContacts lc LEFT JOIN Leads l ON l.LeadId=lc.LeadId WHERE l.LeadId IS NULL"],
    ["orphan_leadactivities", "SELECT COUNT(*) c FROM LeadActivities la LEFT JOIN Leads l ON l.LeadId=la.LeadId WHERE l.LeadId IS NULL"],
    ["orphan_leadreminders", "SELECT COUNT(*) c FROM LeadReminders lr LEFT JOIN Leads l ON l.LeadId=lr.LeadId WHERE l.LeadId IS NULL"],
    ["orphan_opportunities", "SELECT COUNT(*) c FROM Opportunities o LEFT JOIN Leads l ON l.LeadId=o.LeadId WHERE l.LeadId IS NULL"],
    ["orphan_oppcontacts", "SELECT COUNT(*) c FROM OpportunityContacts oc LEFT JOIN Opportunities o ON o.OpportunityId=oc.OpportunityId WHERE o.OpportunityId IS NULL"],
    ["orphan_projects", "SELECT COUNT(*) c FROM Projects p LEFT JOIN Leads l ON l.LeadId=p.CustomerId WHERE l.LeadId IS NULL"],
    ["orphan_projectcontacts", "SELECT COUNT(*) c FROM ProjectContacts pc LEFT JOIN Projects p ON p.ProjectId=pc.ProjectId WHERE p.ProjectId IS NULL"],
    ["orphan_projectresources", "SELECT COUNT(*) c FROM ProjectResources pr LEFT JOIN Projects p ON p.ProjectId=pr.ProjectId WHERE p.ProjectId IS NULL"],
    ["orphan_emails", "SELECT COUNT(*) c FROM emails e LEFT JOIN LeadContacts lc ON lc.LeadContactID=e.LeadContactID WHERE lc.LeadContactID IS NULL"],
    ["orphan_emailevents", "SELECT COUNT(*) c FROM email_events ev LEFT JOIN emails e ON e.EmailId=ev.EmailId WHERE e.EmailId IS NULL"],
    ["orphan_emailattachments", "SELECT COUNT(*) c FROM email_attachments ea LEFT JOIN emails e ON e.EmailId=ea.EmailId WHERE e.EmailId IS NULL"],
    ["orphan_seqsteps", "SELECT COUNT(*) c FROM email_sequence_steps s LEFT JOIN email_sequences q ON q.SequenceId=s.SequenceId WHERE q.SequenceId IS NULL"],
    ["orphan_seqcontacts_seq", "SELECT COUNT(*) c FROM email_sequence_contacts sc LEFT JOIN email_sequences s ON s.SequenceId=sc.SequenceId WHERE s.SequenceId IS NULL"],
    ["orphan_seqcontacts_contact", "SELECT COUNT(*) c FROM email_sequence_contacts sc LEFT JOIN LeadContacts lc ON lc.LeadContactID=sc.LeadContactID WHERE lc.LeadContactID IS NULL"],
    ["orphan_aichatmessages", "SELECT COUNT(*) c FROM AIChatMessages m LEFT JOIN AIChatConversations c ON c.ConversationId=m.ConversationId WHERE c.ConversationId IS NULL"],
  ];

  for (const [name, sql] of orphanChecks) {
    try {
      const [rows] = await pool.query(sql);
      console.log(`CHECK ${name} ${rows?.[0]?.c ?? 0}`);
    } catch {
      console.log(`CHECK ${name} SKIP`);
    }
  }

  if (existing.has("Leads")) {
    const [rows] = await pool.query("SELECT COUNT(*) c FROM Leads WHERE OwnerId IS NULL");
    console.log(`LEADS_OWNER_NULL ${rows?.[0]?.c ?? 0}`);
  }

  await pool.end();
}

main().catch((err) => {
  console.log(
    "ERR " +
      JSON.stringify({
        code: err?.code || null,
        msg: String(err?.message || err).slice(0, 200),
      })
  );
  process.exit(1);
});

