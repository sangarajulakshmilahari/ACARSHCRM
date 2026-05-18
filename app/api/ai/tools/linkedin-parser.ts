// app/api/ai/tools/linkedin-parser.ts
// Parses LinkedIn export CSVs (Connections + Invitations) and computes analytics
// that get injected into Groq's system prompt as structured context.

export type LinkedInConnection = {
  firstName: string;
  lastName: string;
  fullName: string;
  url: string;
  email: string;
  company: string;
  position: string;
  connectedOn: Date | null;
  connectedOnRaw: string;
};

export type LinkedInInvitation = {
  from: string;
  to: string;
  sentAt: Date | null;
  sentAtRaw: string;
  direction: "OUTGOING" | "INCOMING" | string;
  inviterUrl: string;
  inviteeUrl: string;
};

export type LinkedInAnalytics = {
  ownerName: string;

  // Connections
  totalConnections: number;
  connections: LinkedInConnection[];

  // Invitations
  totalInvitationsSent: number;       // OUTGOING
  totalInvitationsReceived: number;   // INCOMING
  invitations: LinkedInInvitation[];

  // Derived: accepted = person is in connections AND was in outgoing invitations
  // LinkedIn doesn't give "accepted" directly — connections list IS the accepted list
  acceptedCount: number;
  acceptanceRate: string;             // e.g. "68.5%"

  // Who accepted (matched between outgoing invites and connections)
  accepted: Array<{ name: string; company: string; position: string; connectedOn: string }>;

  // Who hasn't accepted yet (outgoing invite but NOT in connections)
  pending: Array<{ name: string; sentAt: string }>;

  // Connections by company (top 10)
  byCompany: Array<{ company: string; count: number }>;

  // Daily/weekly trend (last 30 days)
  recentActivity: Array<{ date: string; connectionsMade: number; invitesSent: number }>;

  parseErrors: string[];
};

// ─── DATE PARSERS ───

// Connections format: "16 Mar 2026"
function parseConnectionDate(raw: string): Date | null {
  if (!raw?.trim()) return null;
  const months: Record<string, number> = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
  };
  const m = raw.trim().match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if (!m) return null;
  const month = months[m[2]];
  if (month === undefined) return null;
  return new Date(parseInt(m[3]), month, parseInt(m[1]));
}

// Invitations format: "3/10/26, 10:22 PM"
function parseInvitationDate(raw: string): Date | null {
  if (!raw?.trim()) return null;
  // "M/D/YY, H:MM AM/PM"
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) return null;
  let year = parseInt(m[3]);
  if (year < 100) year += 2000;
  let hours = parseInt(m[4]);
  const minutes = parseInt(m[5]);
  const ampm = m[6]?.toUpperCase();
  if (ampm === "PM" && hours !== 12) hours += 12;
  if (ampm === "AM" && hours === 12) hours = 0;
  return new Date(year, parseInt(m[1]) - 1, parseInt(m[2]), hours, minutes);
}

function formatDate(d: Date | null): string {
  if (!d) return "Unknown";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// ─── CSV PARSER ───
// Simple CSV parser that handles quoted fields with commas/newlines

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') { field += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { field += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { row.push(field.trim()); field = ""; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && next === '\n') i++;
        row.push(field.trim());
        if (row.some(f => f !== "")) rows.push(row);
        row = []; field = "";
      } else { field += ch; }
    }
  }
  if (field || row.length) { row.push(field.trim()); if (row.some(f => f !== "")) rows.push(row); }
  return rows;
}

// ─── PARSE CONNECTIONS CSV ───

export function parseConnections(csvText: string): { connections: LinkedInConnection[]; errors: string[] } {
  const errors: string[] = [];
  const rows = parseCSV(csvText);

  // LinkedIn prepends 3 lines of notes — find the real header
  const headerIdx = rows.findIndex(r => r[0] === "First Name");
  if (headerIdx === -1) {
    errors.push("Could not find header row in Connections file.");
    return { connections: [], errors };
  }

  const header = rows[headerIdx];
  const col = (name: string) => header.findIndex(h => h.toLowerCase().includes(name.toLowerCase()));

  const idxFirst = col("First Name");
  const idxLast = col("Last Name");
  const idxUrl = col("URL");
  const idxEmail = col("Email");
  const idxCompany = col("Company");
  const idxPosition = col("Position");
  const idxConnected = col("Connected On");

  const connections: LinkedInConnection[] = [];

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 4) continue;
    const firstName = r[idxFirst] || "";
    const lastName = r[idxLast] || "";
    const fullName = `${firstName} ${lastName}`.trim();
    const raw = r[idxConnected] || "";
    const date = parseConnectionDate(raw);

    connections.push({
      firstName,
      lastName,
      fullName,
      url: r[idxUrl] || "",
      email: r[idxEmail] || "",
      company: r[idxCompany] || "",
      position: r[idxPosition] || "",
      connectedOn: date,
      connectedOnRaw: raw,
    });
  }

  return { connections, errors };
}

// ─── PARSE INVITATIONS CSV ───

export function parseInvitations(csvText: string): { invitations: LinkedInInvitation[]; errors: string[] } {
  const errors: string[] = [];
  const rows = parseCSV(csvText);

  if (rows.length < 2) {
    errors.push("Invitations file appears empty.");
    return { invitations: [], errors };
  }

  // First row IS the header (no LinkedIn notes header in invitations)
  const header = rows[0];
  const col = (name: string) => header.findIndex(h => h.toLowerCase().includes(name.toLowerCase()));

  const idxFrom = col("From");
  const idxTo = col("To");
  const idxSent = col("Sent");
  const idxDirection = col("Direction");
  const idxInviterUrl = col("inviterProfile");
  const idxInviteeUrl = col("inviteeProfile");

  const invitations: LinkedInInvitation[] = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 3) continue;
    const raw = r[idxSent] || "";
    const date = parseInvitationDate(raw);

    invitations.push({
      from: r[idxFrom] || "",
      to: r[idxTo] || "",
      sentAt: date,
      sentAtRaw: raw,
      direction: (r[idxDirection] || "").toUpperCase() as "OUTGOING" | "INCOMING",
      inviterUrl: idxInviterUrl >= 0 ? r[idxInviterUrl] || "" : "",
      inviteeUrl: idxInviteeUrl >= 0 ? r[idxInviteeUrl] || "" : "",
    });
  }

  return { invitations, errors };
}

// ─── COMPUTE FULL ANALYTICS ───

export function computeLinkedInAnalytics(
  connections: LinkedInConnection[],
  invitations: LinkedInInvitation[],
  ownerName: string
): LinkedInAnalytics {
  const now = new Date();

  const outgoing = invitations.filter(i => i.direction === "OUTGOING");
  const incoming = invitations.filter(i => i.direction === "INCOMING");

  // Build a Set of connection names (lowercase) for fast matching
  const connectionNameSet = new Set(connections.map(c => c.fullName.toLowerCase().trim()));

  // Accepted = outgoing invites where the person IS now a connection
  const accepted = connections.map(c => ({
    name: c.fullName,
    company: c.company,
    position: c.position,
    connectedOn: formatDate(c.connectedOn),
  }));

  // Pending = outgoing invites where the person is NOT yet a connection
  const pending = outgoing
    .filter(inv => !connectionNameSet.has(inv.to.toLowerCase().trim()))
    .map(inv => ({
      name: inv.to,
      sentAt: formatDate(inv.sentAt),
    }));

  const acceptanceRate = outgoing.length > 0
    ? ((connections.length / outgoing.length) * 100).toFixed(1) + "%"
    : "N/A";

  // ─── By Company ───
  const companyMap = new Map<string, number>();
  for (const c of connections) {
    const co = c.company?.trim() || "Unknown";
    companyMap.set(co, (companyMap.get(co) || 0) + 1);
  }
  const byCompany = [...companyMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([company, count]) => ({ company, count }));

  // ─── Daily trend (last 30 days) ───
  const recentActivity: Array<{ date: string; connectionsMade: number; invitesSent: number }> = [];
  for (let d = 29; d >= 0; d--) {
    const day = new Date(now);
    day.setDate(now.getDate() - d);
    const dayStr = formatDate(day);

    const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    const dayEnd = new Date(dayStart.getTime() + 86400000);

    const connectionsMade = connections.filter(c =>
      c.connectedOn && c.connectedOn >= dayStart && c.connectedOn < dayEnd
    ).length;

    const invitesSent = outgoing.filter(i =>
      i.sentAt && i.sentAt >= dayStart && i.sentAt < dayEnd
    ).length;

    if (connectionsMade > 0 || invitesSent > 0) {
      recentActivity.push({ date: dayStr, connectionsMade, invitesSent });
    }
  }

  return {
    ownerName,
    totalConnections: connections.length,
    connections,
    totalInvitationsSent: outgoing.length,
    totalInvitationsReceived: incoming.length,
    invitations,
    acceptedCount: connections.length,
    acceptanceRate,
    accepted,
    pending,
    byCompany,
    recentActivity,
    parseErrors: [],
  };
}

// ─── BUILD GROQ CONTEXT STRING ───
// This gets injected into the system prompt so Groq can answer any question.

export function buildLinkedInContext(analytics: LinkedInAnalytics, daysFilter?: number): string {
  const now = new Date();
  const cutoff = daysFilter
    ? new Date(now.getTime() - daysFilter * 24 * 60 * 60 * 1000)
    : null;

  // Filter connections and invitations by date range if requested
  const filteredConnections = cutoff
    ? analytics.connections.filter(c => c.connectedOn && c.connectedOn >= cutoff)
    : analytics.connections;

  const filteredInvites = cutoff
    ? analytics.invitations.filter(i => i.sentAt && i.sentAt >= cutoff)
    : analytics.invitations;

  const filteredOutgoing = filteredInvites.filter(i => i.direction === "OUTGOING");

  const period = daysFilter ? `last ${daysFilter} days` : "all time";

  // Recent connections list (top 20 for context window)
  const recentConnectionsList = filteredConnections
    .slice(0, 20)
    .map(c => `  - ${c.fullName}${c.company ? ` (${c.company}` : ""}${c.position ? `, ${c.position}` : ""}${c.company || c.position ? ")" : ""} — connected ${c.connectedOnRaw}`)
    .join("\n");

  // Recent invitations sent list (top 20)
  const recentInvitesList = filteredOutgoing
    .slice(0, 20)
    .map(i => `  - To: ${i.to} — sent ${formatDate(i.sentAt)}`)
    .join("\n");

  // Top companies
  const companiesList = analytics.byCompany
    .map(b => `  - ${b.company}: ${b.count} connection${b.count !== 1 ? "s" : ""}`)
    .join("\n");

  // Recent activity trend
  const trendList = analytics.recentActivity
    .map(r => `  - ${r.date}: ${r.connectionsMade} connected, ${r.invitesSent} invited`)
    .join("\n");

  return `
--- LINKEDIN DATA FOR: ${analytics.ownerName} ---
Data period shown: ${period}

OVERALL SUMMARY:
- Total connections (accepted): ${analytics.totalConnections}
- Invitations sent (OUTGOING): ${analytics.totalInvitationsSent}
- Invitations received (INCOMING): ${analytics.totalInvitationsReceived}
- Estimated acceptance rate: ${analytics.acceptanceRate}
- Pending (sent but not connected yet): ${analytics.pending.length}

FILTERED TO "${period.toUpperCase()}":
- Connections made: ${filteredConnections.length}
- Invitations sent: ${filteredOutgoing.length}

RECENT CONNECTIONS (${period}, up to 20 shown):
${recentConnectionsList || "  None in this period"}

RECENT INVITATIONS SENT (${period}, up to 20 shown):
${recentInvitesList || "  None in this period"}

TOP COMPANIES IN CONNECTIONS:
${companiesList || "  No data"}

DAILY ACTIVITY TREND (last 30 days with activity):
${trendList || "  No recent activity"}

PENDING INVITATIONS (sent but not yet accepted, up to 15):
${analytics.pending.slice(0, 15).map(p => `  - ${p.name} (sent ${p.sentAt})`).join("\n") || "  None"}

--- END LINKEDIN DATA ---

You can answer questions about:
- How many invitations were sent in any time period
- How many connections/acceptances were made
- Acceptance rates and trends
- Who accepted, who is pending
- Connections by company or industry
- Daily/weekly patterns
Always be specific with numbers from the data above. If asked about a period not covered, say so clearly.
`;
}