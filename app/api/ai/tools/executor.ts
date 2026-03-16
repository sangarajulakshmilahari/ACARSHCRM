// app/api/ai/tools/executor.ts
// Central dispatcher: receives a tool call from the LLM, executes it, returns result
//
// Phase 2 UPDATE: convert, activity, and reminder tools are now live

import { getPool } from "@/config/db";
import {
  searchLead,
  getLeadDetails,
  createLead,
  updateLead,
  deleteLead,
  getDropdowns,
} from "./lead-tool";
import { addActivity, updateActivity } from "./activity-tools";
import { addReminder, updateReminder } from "./reminder-tools";
import { convertLead, convertLeadToAccount } from "./convert-tools";

export type ToolResult = {
  success: boolean;
  message: string;
  needsConfirmation?: boolean;
  data?: any;
  [key: string]: any;
};

/**
 * Execute a tool call from the LLM.
 */
export async function executeTool(
  toolName: string,
  params: any
): Promise<ToolResult> {
  const pool = await getPool();

  try {
    switch (toolName) {
      // ─── LEAD TOOLS (Phase 1) ───
      case "search_lead":
        return await searchLead(pool, params.query);

      case "get_lead_details":
        return await getLeadDetails(pool, params.leadId);

      case "create_lead":
        return await createLead(pool, params);

      case "update_lead":
        return await updateLead(pool, params);

      case "delete_lead":
        return await deleteLead(pool, params.leadId, params.confirmed);

      case "get_dropdowns":
        return await getDropdowns(pool);

      // ─── CONVERSION TOOLS (Phase 2) ───
      case "convert_lead":
        return await convertLead(pool, params.leadId, params.confirmed);

      case "convert_lead_to_account":
        return await convertLeadToAccount(
          pool,
          params.leadId,
          params.confirmed
        );

      // ─── ACTIVITY TOOLS (Phase 2) ───
      case "add_activity":
        return await addActivity(pool, params);

      // ─── REMINDER TOOLS (Phase 2) ───
      case "add_reminder":
        return await addReminder(pool, params);

      // ─── OPPORTUNITY TOOLS (Phase 3 — stubs) ───
      case "create_opportunity":
        return {
          success: false,
          message: "Create opportunity tool is coming in Phase 3.",
        };

      case "add_opportunity_contact":
        return {
          success: false,
          message: "Add opportunity contact tool is coming in Phase 3.",
        };

      default:
        return {
          success: false,
          message: `Unknown tool: ${toolName}. Available tools: search_lead, get_lead_details, create_lead, update_lead, delete_lead, convert_lead, convert_lead_to_account, add_activity, add_reminder, get_dropdowns.`,
        };
    }
  } catch (error: any) {
    console.error(`Tool execution error [${toolName}]:`, error);
    return {
      success: false,
      message: `Tool "${toolName}" failed: ${error.message}`,
    };
  }
}