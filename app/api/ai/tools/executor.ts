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

      // ═══════════════════════════════════════════════════
// REPLACE the count_leads case in your executor.ts with this:
// ═══════════════════════════════════════════════════

      case "count_leads": {
        // Base query using same table structure as searchLead
        let query = `
          SELECT 
            COUNT(DISTINCT l.LeadId) as total,
            SUM(CASE WHEN ls.StatusName = 'New' THEN 1 ELSE 0 END) as newCount,
            SUM(CASE WHEN ls.StatusName = 'Contacted' THEN 1 ELSE 0 END) as contactedCount,
            SUM(CASE WHEN ls.StatusName = 'Follow-Up' THEN 1 ELSE 0 END) as followUpCount,
            SUM(CASE WHEN ls.StatusName = 'Qualified' THEN 1 ELSE 0 END) as qualifiedCount,
            SUM(CASE WHEN ls.StatusName = 'Unqualified' THEN 1 ELSE 0 END) as unqualifiedCount,
            SUM(CASE WHEN ls.StatusName = 'Lost' THEN 1 ELSE 0 END) as lostCount,
            SUM(CASE WHEN ls.StatusName = 'Converted' THEN 1 ELSE 0 END) as convertedCount
          FROM leads l
          LEFT JOIN (
            SELECT LeadId, StatusId
            FROM (
              SELECT
                la.LeadId,
                la.StatusId,
                ROW_NUMBER() OVER (
                  PARTITION BY la.LeadId
                  ORDER BY la.ActivityDate DESC, la.CreatedOn DESC, la.ActivityId DESC
                ) AS rn
              FROM LeadActivities la
            ) ranked
            WHERE rn = 1
          ) latestActivity ON latestActivity.LeadId = l.LeadId
          LEFT JOIN LeadStatuses ls ON latestActivity.StatusId = ls.StatusId
          LEFT JOIN Users u ON l.OwnerId = u.UserId
          LEFT JOIN AccountTypes at ON l.AccountTypeId = at.AccountTypeId
          WHERE 1=1
        `;
        const countParams: any[] = [];

        if (params.ownerName) {
          query += ` AND u.UserName LIKE ?`;
          countParams.push(`%${params.ownerName}%`);
        }
        if (params.statusName) {
          query += ` AND ls.StatusName = ?`;
          countParams.push(params.statusName);
        }
        if (params.accountType) {
          query += ` AND at.Name = ?`;
          countParams.push(params.accountType);
        }

        const [countRows]: any = await pool.execute(query, countParams);
        const cr = countRows[0];

        let filterDesc = "all records";
        if (params.ownerName) filterDesc = `records managed by ${params.ownerName}`;
        if (params.statusName) filterDesc = `records with status "${params.statusName}"`;
        if (params.accountType) filterDesc = `${params.accountType}s`;

        return {
          success: true,
          message: `${filterDesc}: ${cr.total} total. Breakdown — ${cr.newCount} New, ${cr.contactedCount} Contacted, ${cr.followUpCount} Follow-Up, ${cr.qualifiedCount} Qualified, ${cr.unqualifiedCount} Unqualified, ${cr.lostCount} Lost, ${cr.convertedCount} Converted.`,
          total: cr.total,
          breakdown: {
            new: cr.newCount,
            contacted: cr.contactedCount,
            followUp: cr.followUpCount,
            qualified: cr.qualifiedCount,
            unqualified: cr.unqualifiedCount,
            lost: cr.lostCount,
            converted: cr.convertedCount,
          },
          filter: filterDesc,
        };
      }

      // ─── CONVERSION TOOLS  ───
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
