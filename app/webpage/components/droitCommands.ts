export type DroitCommand =
  | {
      id: string;
      type: "research_contact";
      contextLeadId: string | number;
      contextContactId: string | number;
    }
  | {
      id: string;
      type: "research_company";
      contextLeadId: string | number;
    }
  | {
      id: string;
      type: "meeting_brief";
      contextLeadId: string | number;
      contextContactId: string | number;
    };

export type DroitCommandInput =
  | {
      type: "research_contact";
      contextLeadId: string | number;
      contextContactId: string | number;
    }
  | {
      type: "research_company";
      contextLeadId: string | number;
    }
  | {
      type: "meeting_brief";
      contextLeadId: string | number;
      contextContactId: string | number;
    };

export function droitCommandMessage(command: DroitCommand): string {
  if (command.type === "research_contact") {
    return "Research this contact using the CRM context and current public web information. Use Markdown sections ### Contact Snapshot, ### Public Professional Information, ### Recent Developments, ### CRM Relationship, ### Sales-Relevant Insights, and ### Sources. Omit empty sections. Clearly label inferences. Do not invent sources.";
  }
  if (command.type === "research_company") {
    return "Research this company using the CRM context and current public web information. Use Markdown sections ### Company Overview, ### CRM Context, ### Recent Developments, ### Sales Opportunity Insights, ### Risks and Considerations, ### Recommended Next Actions, and ### Sources. Omit empty sections. Clearly label inferences. Do not invent sources or ACARSH services.";
  }
  return "Prepare a meeting brief for this contact. What should I know? Use Markdown sections ### Meeting Snapshot, ### Company Context, ### CRM Relationship, ### Recent Developments, ### Likely Priorities, ### Conversation Starters, ### Questions to Ask, ### Risks and Objections, ### Recommended Next Steps, and ### Sources. Omit empty sections. Do not invent a meeting date or calendar event. Clearly label inferences. Do not invent sources.";
}
