const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

function loadEnv(filePath) {
  const env = { ...process.env };
  const text = fs.readFileSync(filePath, "utf8");
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

const MYSQL_BIN = "C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin";
const env = loadEnv(".env.local");

if (!isLocalHost(env.MYSQL_HOST) || env.MYSQL_DATABASE !== "acarsh_db") {
  console.error("REFUSING_NON_LOCAL_DB");
  process.exit(1);
}

const action = process.argv[2];
const target = process.argv[3];
const cnfPath = path.join(os.tmpdir(), `acarsh-mysql-${process.pid}.cnf`);
const escapedPassword = String(env.MYSQL_PASSWORD || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
fs.writeFileSync(
  cnfPath,
  `[client]\nhost=${env.MYSQL_HOST}\nport=${env.MYSQL_PORT || 3306}\nuser=${env.MYSQL_USER}\npassword="${escapedPassword}"\n`,
  { mode: 0o600 }
);

function run(bin, args, outfile) {
  const result = spawnSync(bin, args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 64,
    windowsHide: true,
  });
  if (outfile && result.stdout) fs.writeFileSync(outfile, result.stdout);
  if (result.stdout && !outfile) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.status || 0;
}

let status = 1;
try {
  if (action === "backup") {
    const outDir = path.join("database", "backups");
    fs.mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outFile = path.join(outDir, `acarsh_db_pre_multicompany_${stamp}.sql`);
    status = run(path.join(MYSQL_BIN, "mysqldump.exe"), [
      `--defaults-extra-file=${cnfPath}`,
      "--single-transaction",
      "--routines",
      "--triggers",
      "--set-gtid-purged=OFF",
      env.MYSQL_DATABASE,
      `--result-file=${outFile}`,
    ]);
    if (status === 0) {
      const size = fs.statSync(outFile).size;
      console.log("BACKUP " + JSON.stringify({ ok: true, file: outFile, bytes: size }));
    }
  } else if (action === "sql") {
    status = run(path.join(MYSQL_BIN, "mysql.exe"), [
      `--defaults-extra-file=${cnfPath}`,
      "--comments",
      env.MYSQL_DATABASE,
      "-e",
      `source ${path.resolve(target).replace(/\\/g, "/")}`,
    ]);
    console.log("SQL " + JSON.stringify({ ok: status === 0, file: target, status }));
  } else {
    console.error("USAGE backup|sql <file>");
    status = 1;
  }
} finally {
  try {
    fs.unlinkSync(cnfPath);
  } catch {
    /* ignore */
  }
}

process.exit(status);
