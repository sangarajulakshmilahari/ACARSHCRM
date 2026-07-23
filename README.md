# Next.js + TypeScript + Redux Sample

## Role-aware CRM chatbot

The chatbot at `/api/ai/assistant` uses Groq for tool selection and the local
FastMCP service for governed CRM reads and writes. Start MCP before Next.js:

```bash
cd mcp-server
cp config.example.env config.env
uv sync --dev
uv run acarsh-mcp
```

Set `GROQ_API_KEY`, `ACARSH_MCP_URL`, and the same
`ACARSH_MCP_INTERNAL_TOKEN` in the Next.js environment. See
`mcp-server/README.md` for the access matrix and full configuration.

Chat conversations are persisted in `AIChatConversations` and
`AIChatMessages`. Refreshing resumes the latest conversation, the chatbot can
switch among previous conversations, and pending write confirmations survive
application restarts. The deployable migration is in
`database/migrations/20260722_ai_chat_history.sql`; the API also creates the
tables idempotently when its database account has DDL permission.

Features:
- Login page (demo credentials: admin / 1234)
- Employee CRUD with Next.js API routes
- Local JSON file persistence (`/data/employees.json`)
- Redux Toolkit for session and employee state

How to run:
1. npm install
2. npm run dev
3. Open http://localhost:3000

Project structure:
- app/                 -> Next.js app (pages, API routes)
- store/               -> Redux store + slices
- data/employees.json  -> JSON file used by API routes
