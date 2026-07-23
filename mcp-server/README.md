# ACARSH MCP Server

FastMCP service exposing ACARSH CRM data and workflows to the in-app chatbot and
other MCP-compatible agents.

The server is deliberately separate from the Next.js routes. It uses a constrained
entity catalog, parameterized SQL and transaction-backed domain commands. It never
accepts raw SQL, table names or column expressions from an MCP client.

The in-app chatbot resolves the signed-in ACARSH user in Next.js and passes a
server-only actor context to MCP. The model never supplies a user id or role.

## Capabilities

Read tools:

- `list_capabilities`, `explain_capability`, `describe_entity`, `get_record`
- `search_records` with structured filters, selected fields, sorting and pagination
- `query_crm` for safe semantic plans with boolean groups, allow-listed relationships,
  related-record counts, grouped metrics and HAVING conditions
- `get_company_contacts` for reliable role-scoped company contact details
- `aggregate_records` for safe counts/grouping
- `pipeline_summary`
- `list_lookup_values`
- `health`

Write tools:

- `create_lead`, `update_lead`, `delete_lead`, `convert_lead`
- `add_contact`, `update_contact`, `delete_contact`
- `add_activity`, `update_activity`
- `schedule_reminder`, `update_reminder`
- `create_opportunity`, `update_opportunity`
- `add_opportunity_contact`, `update_opportunity_contact`, `delete_opportunity_contact`
- `create_project`, `update_project`
- `add_project_contact`, `update_project_contact`, `delete_project_contact`
- `assign_project_resource`, `update_project_resource`, `delete_project_resource`

Resources:

- `acarsh://schema/catalog`
- `acarsh://schema/{entity}`
- `acarsh://lookups/{lookup}`

Write tools accept partial drafts. If required values are missing, the result has
`status: needs_input`, the missing field names, and questions for the agent to ask.
Calling the same tool with the completed draft performs the transaction.

Record references accept either numeric ids or names where a stable natural key is
available: company names for leads/customers, project names or codes, contact names,
opportunity customer names, and user names. Resolution is role-scoped. A unique exact
match is preferred; ambiguous matches return a candidate list and never guess.

## Setup

Requires Python 3.11+ and [`uv`](https://docs.astral.sh/uv/).

```bash
cd mcp-server
cp config.example.env config.env
# Edit config.env and set the dedicated MySQL user/password.
uv sync --dev
```

Use a dedicated database account. The initial account needs `SELECT`, `INSERT`, and
`UPDATE` on `acarsh_db`; it does not need `DROP`, `ALTER`, `CREATE`, `FILE`, or global
privileges.

For HTTP mode, generate a long random `ACARSH_MCP_INTERNAL_TOKEN` and put the same
value in the Next.js `.env` and `mcp-server/config.env`. The token authorizes the
Next.js server—not the browser—to pass `UserId` and `RoleId` headers. Keep the MCP
listener on localhost/private networking. For direct STDIO use, configure both
`ACARSH_MCP_DEFAULT_ACTOR_USER_ID` and `ACARSH_MCP_DEFAULT_ACTOR_ROLE_ID`.

## Role enforcement

The current database roles are enforced inside query and domain services, below the
LLM/tool-selection layer:

| Role | Reads | Writes |
| --- | --- | --- |
| Manager (`RoleId=1`) | Organization-wide CRM records | Any accessible CRM record; may assign owners |
| Sales Executive (`RoleId=2`) | Owned leads and descendants; own/owned activities and reminders; own user row | Owned leads and descendants only; new leads are self-owned and cannot be reassigned |

Lookup catalogs are shared because they contain controlled values rather than CRM
business records. Unsupported roles are rejected by the chatbot and MCP boundary.

## Run locally over STDIO

```bash
cd mcp-server
uv run acarsh-mcp
```

Example MCP client configuration:

```json
{
  "mcpServers": {
    "acarsh": {
      "command": "uv",
      "args": [
        "--directory",
        "/absolute/path/to/Acarsh123/mcp-server",
        "run",
        "acarsh-mcp"
      ]
    }
  }
}
```

## Run over Streamable HTTP

Set these in `config.env`:

```dotenv
ACARSH_MCP_TRANSPORT=http
ACARSH_MCP_HOST=127.0.0.1
ACARSH_MCP_PORT=8000
ACARSH_MCP_HTTP_PATH=/mcp
ACARSH_MCP_INTERNAL_TOKEN=use-the-same-long-random-value-as-nextjs
```

Then run:

```bash
uv run acarsh-mcp
```

The endpoint is `http://127.0.0.1:8000/mcp`. Keep it on localhost/private networking
and do not expose the internal token to browser code. Then configure Next.js:

```dotenv
GROQ_API_KEY=your-groq-key
GROQ_MODEL=llama-3.3-70b-versatile
ACARSH_MCP_URL=http://127.0.0.1:8000/mcp
ACARSH_MCP_INTERNAL_TOKEN=use-the-same-long-random-value-as-mcp
```

The chatbot presents explicit **Confirm** and **Reject** buttons before calling a write
tool. Pending decisions are stored with the conversation, survive refreshes, and block
unrelated chat requests until resolved. This application-level safeguard is in addition
to MCP's role and record-level checks.

## Query examples

Find prospects containing “Acme”:

```json
{
  "entity": "leads",
  "filters": [
    {"field": "account_type", "operator": "eq", "value": "Prospect"},
    {"field": "company_name", "operator": "contains", "value": "Acme"}
  ],
  "fields": ["id", "company_name", "owner_name", "status"],
  "sort": [{"field": "created_on", "direction": "desc"}],
  "limit": 25
}
```

Count funnel records by account type:

```json
{
  "entity": "leads",
  "group_by": ["account_type"],
  "metrics": [{"function": "count", "alias": "records"}],
  "sort": [{"field": "records", "direction": "desc"}]
}
```

Find prospects with no activity in the last 30 days using `query_crm`:

```json
{
  "entity": "leads",
  "fields": ["company_name", "owner_name", "status"],
  "filters": [
    {"field": "account_type", "operator": "eq", "value": "Prospect"}
  ],
  "related": [
    {
      "relationship": "activities",
      "quantifier": "not_exists",
      "filters": [
        {"field": "date", "operator": "gte", "value": "last_30_days"}
      ]
    }
  ]
}
```

The LLM produces only this bounded plan. MCP resolves relative dates, validates every
entity, field, relationship, metric and sort, applies the authenticated actor's access
scope, parameterizes values, enforces limits, and then executes the read. The response
includes a machine-readable explanation of the applied plan but never exposes SQL.

Writes remain explicit domain commands such as `create_lead` and `update_activity`.
They are not routed through the semantic planner and still require application-level
confirmation before execution.

## Development checks

```bash
uv run pytest
uv run ruff check .
uv run fastmcp inspect src/acarsh_mcp/server.py:mcp
```

## Reusing the architecture

For another application, retain `config.py`, `db.py`, `query.py`, `semantic.py`,
`errors.py`, and the FastMCP server conventions. Replace:

1. `catalog.py` with that application's safe entity, field and relationship catalog.
2. `models.py` with its command contracts.
3. `crm.py` with its domain transactions.
4. The application-specific tool registrations in `server.py`.

For another application, keep the same actor-provider and access-policy seam, but
replace its roles and entity-to-owner predicates. If the MCP endpoint later needs
to serve untrusted remote clients directly, replace the internal-token adapter with
OAuth/token validation while preserving the same `ActorContext` contract.
