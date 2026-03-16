// app/api/ai/tools/definitions.ts
// OPTIMIZED: Compact tool schemas — saves ~600 tokens per request
// Key changes:
//   1. Shorter descriptions (every word costs tokens)
//   2. Removed descriptions from obvious properties
//   3. Removed Phase 3 stubs (don't send tools that don't work yet)
//   4. Merged convert_lead_to_account into convert_lead with a "target" param

export const TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "search_lead",
      description: "Search leads by company, contact, or owner name. Use this first when user refers to an existing lead.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search term" },
        },
        required: ["query"],
      },
    },
  },

  {
    type: "function" as const,
    function: {
      name: "get_lead_details",
      description: "Get full lead details. Needs leadId from search_lead.",
      parameters: {
        type: "object",
        properties: {
          leadId: { type: "number" },
        },
        required: ["leadId"],
      },
    },
  },

  {
    type: "function" as const,
    function: {
      name: "create_lead",
      description: "Create a new lead. Required: CompanyName, ContactName, ContactEmail, ContactRoleName, OwnerName.",
      parameters: {
        type: "object",
        properties: {
          CompanyName: { type: "string" },
          ContactName: { type: "string" },
          ContactEmail: { type: "string" },
          ContactRoleName: { type: "string" },
          OwnerName: { type: "string" },
          CompanyLocation: { type: "string" },
          LeadSource: { type: "string" },
          ContactPhone: { type: "string" },
          ContactTitle: { type: "string" },
          Notes: { type: "string" },
        },
        required: ["CompanyName", "ContactName", "ContactEmail", "ContactRoleName", "OwnerName"],
      },
    },
  },

  {
    type: "function" as const,
    function: {
      name: "update_lead",
      description: "Update a lead. Needs leadId. Only include changed fields.",
      parameters: {
        type: "object",
        properties: {
          leadId: { type: "number" },
          CompanyName: { type: "string" },
          CompanyLocation: { type: "string" },
          LeadSource: { type: "string" },
          OwnerName: { type: "string" },
          StatusName: { type: "string" },
          LeadNotes: { type: "string" },
          ContactName: { type: "string" },
          ContactEmail: { type: "string" },
          ContactPhone: { type: "string" },
          ContactTitle: { type: "string" },
          ContactRoleName: { type: "string" },
        },
        required: ["leadId"],
      },
    },
  },

  {
    type: "function" as const,
    function: {
      name: "delete_lead",
      description: "Delete a lead permanently. Ask user to confirm first.",
      parameters: {
        type: "object",
        properties: {
          leadId: { type: "number" },
          confirmed: { type: "boolean", description: "true only after user confirms" },
        },
        required: ["leadId", "confirmed"],
      },
    },
  },

  {
    type: "function" as const,
    function: {
      name: "convert_lead",
      description: "Convert lead to next stage (Lead→Prospect→Account) or directly to Account. Ask user to confirm first.",
      parameters: {
        type: "object",
        properties: {
          leadId: { type: "number" },
          confirmed: { type: "boolean", description: "true only after user confirms" },
          directToAccount: { type: "boolean", description: "true to skip Prospect and go directly to Account" },
        },
        required: ["leadId", "confirmed"],
      },
    },
  },

  {
    type: "function" as const,
    function: {
      name: "add_activity",
      description: "Log activity for a lead. Modes: Call, Email, Meeting, Visit, Other.",
      parameters: {
        type: "object",
        properties: {
          leadId: { type: "number" },
          Mode: { type: "string" },
          Notes: { type: "string" },
          Status: { type: "string", description: "Lead status after activity" },
          ActivityDate: { type: "string", description: "YYYY-MM-DD, defaults to today" },
        },
        required: ["leadId", "Mode", "Notes", "Status"],
      },
    },
  },

  {
    type: "function" as const,
    function: {
      name: "add_reminder",
      description: "Set reminder for a lead. Parse relative dates to YYYY-MM-DD.",
      parameters: {
        type: "object",
        properties: {
          leadId: { type: "number" },
          ReminderDate: { type: "string", description: "YYYY-MM-DD" },
          Notes: { type: "string" },
        },
        required: ["leadId", "ReminderDate", "Notes"],
      },
    },
  },

  {
    type: "function" as const,
    function: {
      name: "get_dropdowns",
      description: "Fetch valid dropdown options: companies, owners, roles, sources.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
];

// Phase 1: core lead tools
export const PHASE1_TOOLS = TOOL_DEFINITIONS.filter((t) =>
  ["search_lead", "get_lead_details", "create_lead", "update_lead", "delete_lead", "get_dropdowns"].includes(t.function.name)
);

// Phase 2: + convert, activity, reminder
export const PHASE2_TOOLS = TOOL_DEFINITIONS;

// Phase 3 will add opportunity tools here
export const PHASE3_TOOLS = TOOL_DEFINITIONS;