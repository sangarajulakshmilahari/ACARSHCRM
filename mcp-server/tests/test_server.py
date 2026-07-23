import asyncio

from fastmcp import Client

from acarsh_mcp.server import mcp


def test_protocol_client_can_discover_and_call_tools() -> None:
    async def exercise_client() -> None:
        async with Client(mcp) as client:
            tools = await client.list_tools()
            tool_names = {tool.name for tool in tools}
            assert {
                "search_records",
                "aggregate_records",
                "query_crm",
                "get_company_contacts",
                "create_lead",
                "create_opportunity",
                "create_project",
                "update_activity",
                "update_reminder",
                "update_opportunity",
                "update_project",
                "delete_lead",
                "explain_capability",
            } <= tool_names

            result = await client.call_tool("list_capabilities", {})
            assert result.data["status"] == "ok"
            assert "leads" in result.data["query_entities"]
            assert "update_activity" in result.data["write_workflows"]

            explanation = await client.call_tool(
                "explain_capability", {"action": "update_activity"}
            )
            assert explanation.data["status"] == "ok"
            assert explanation.data["role_scoped"] is True

    asyncio.run(exercise_client())


def test_protocol_write_tool_returns_guided_missing_input() -> None:
    async def exercise_client() -> None:
        async with Client(mcp) as client:
            result = await client.call_tool("create_lead", {"draft": {}})
            assert result.data["status"] == "needs_input"
            assert result.data["missing_fields"] == ["company_name"]
            assert result.data["questions"][0]["field"] == "company_name"

    asyncio.run(exercise_client())


def test_protocol_data_query_requires_actor_context() -> None:
    async def exercise_client() -> None:
        async with Client(mcp) as client:
            result = await client.call_tool(
                "search_records",
                {"entity": "leads", "limit": 1},
            )
            assert result.data["status"] == "error"
            assert result.data["error"]["code"] == "access_denied"

    asyncio.run(exercise_client())


def test_query_tool_schema_has_no_request_wrapper() -> None:
    async def exercise_client() -> None:
        async with Client(mcp) as client:
            tools = {tool.name: tool for tool in await client.list_tools()}
            search_schema = tools["search_records"].inputSchema
            aggregate_schema = tools["aggregate_records"].inputSchema

            assert "entity" in search_schema["properties"]
            assert "request" not in search_schema["properties"]
            assert "entity" in aggregate_schema["properties"]
            assert "request" not in aggregate_schema["properties"]

            semantic_schema = tools["query_crm"].inputSchema
            assert semantic_schema["required"] == ["plan"]
            plan_schema = semantic_schema["properties"]["plan"]
            assert "entity" in plan_schema["properties"]
            assert "related" in plan_schema["properties"]
            assert plan_schema["additionalProperties"] is False

    asyncio.run(exercise_client())


def test_company_contacts_tool_has_direct_company_argument() -> None:
    async def exercise_client() -> None:
        async with Client(mcp) as client:
            tools = {tool.name: tool for tool in await client.list_tools()}
            schema = tools["get_company_contacts"].inputSchema

            assert schema["required"] == ["company_name"]
            assert set(schema["properties"]) == {"company_name", "limit"}

    asyncio.run(exercise_client())


def test_write_tool_schemas_accept_ids_or_names() -> None:
    async def exercise_client() -> None:
        async with Client(mcp) as client:
            tools = {tool.name: tool for tool in await client.list_tools()}
            update_schema = tools["update_lead"].inputSchema
            lead_id_schema = update_schema["properties"]["lead_id"]
            variants = lead_id_schema.get("anyOf", [])

            assert {variant.get("type") for variant in variants} >= {"integer", "string"}

            contact_schema = tools["add_contact"].inputSchema
            draft_schema = contact_schema["properties"]["draft"]
            lead_reference = draft_schema["properties"]["lead_id"]
            assert {variant.get("type") for variant in lead_reference["anyOf"]} >= {
                "integer",
                "string",
            }

    asyncio.run(exercise_client())
