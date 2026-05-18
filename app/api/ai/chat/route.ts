// app/api/ai/chat/route.ts
// v5: Multiple file upload support (up to 5 files per message)

import { NextRequest, NextResponse } from "next/server";
import { TOOL_DEFINITIONS } from "../tools/definitions";
import { executeTool } from "../tools/executor";
import { parseUploadedFile, buildDocumentContext } from "../tools/file-parser";
import {
  parseConnections,
  parseInvitations,
  computeLinkedInAnalytics,
  buildLinkedInContext,
  type LinkedInConnection,
  type LinkedInInvitation,
} from "../tools/linkedin-parser";

// ─── IN-MEMORY LINKEDIN SESSION STORE ───
// Persists parsed LinkedIn data per CRM owner within the server session.
// In production, replace with your DB (save to a linkedin_data table keyed by ownerName).
const linkedInStore = new Map<string, {
  connections: LinkedInConnection[];
  invitations: LinkedInInvitation[];
  updatedAt: Date;
}>();

const today = new Date().toISOString().split("T")[0];

// ─── SYSTEM PROMPT ───
const SYSTEM_PROMPT = `You are ACARsh CRM Assistant — a professional business tool. Today: ${today}

RULES:
1. INTENT: Understand what user wants. If unclear, ask ONE clarifying question. Never say "could not process".

2. STOP WORDS: If user says "nothing", "no", "cancel", "stop", "nevermind", "that's all", "no thanks" → Reply professionally: "Understood. Let me know if you need anything." and STOP completely. Do NOT ask follow-up questions.

3. CREATE LEAD: Collect required fields one by one: CompanyName, ContactName, ContactEmail, ContactRoleName, OwnerName. Show summary before creating. Ask "Shall I proceed?" — only create after "yes".

4. SEARCH: Always call search_lead when user mentions a lead by name. Use count_leads for "how many leads", "total leads", "leads by [owner]".

5. CONFIRMATION: For delete/convert → set confirmed=false FIRST. Show what will happen. Only set confirmed=true AFTER user says "yes". If user says "no" → "Action cancelled." and STOP.

6. ACTIVITIES: "emailed"→Email, "called"→Call, "met"→Meeting, "visited"→Visit. Ask for lead name if not given.

7. REMINDERS: Parse dates: "tomorrow"=+1 day, "next week"=+7 days, "after a month"=+30 days from today.

8. RESPONSE FORMAT:
   - Professional, concise, business-friendly
   - NEVER show internal lead IDs or database field names in the response text
   - For summaries: "There are 62 leads in total. 45 are new, 10 contacted, 7 in follow-up."
   - For specific queries: "Hazara Sayyed has created 25 leads, including Delta Capita, Vanderlande, and others."
   - Always give ACCURATE counts from tool results. Never estimate or guess.

9. DOCUMENT MODE: If one or more documents or files have been uploaded (shown in the UPLOADED DOCUMENT sections), answer the user's question directly from that content. Be specific and accurate. If multiple files are uploaded, synthesize across all of them when relevant.

10. LINKEDIN MODE: If LinkedIn data is present (shown in the LINKEDIN DATA section), answer questions about:
    - Invitations sent/received — use totalInvitationsSent / totalInvitationsReceived
    - Accepted connections — use totalConnections (connections list = people who accepted)
    - Acceptance rate — use acceptanceRate field
    - Pending invites — use pending list (sent but not yet connected)
    - Date-filtered queries — use FILTERED section for "last N days" questions
    - Company/industry breakdown — use TOP COMPANIES section
    - Daily trends — use DAILY ACTIVITY TREND section
    Always cite exact numbers. Never estimate. If data is missing (e.g. only one file uploaded), say "Please also upload your [Connections/Invitations].csv for complete analysis."`;

// ─── INTENT DETECTION ───
type Intent = "search" | "create" | "update" | "delete" | "convert" | "activity" | "reminder" | "details" | "dropdowns" | "count" | "confirm_yes" | "confirm_no" | "general" | "stop" | "document";

function detectIntent(
  message: string,
  history: Array<{ role: string; content: string }>,
  hasFile: boolean
): Intent {
  const msg = message.toLowerCase().trim();

  // ─── FILE UPLOADED ───
  // If files are attached, document Q&A takes priority
  if (hasFile) return "document";

  // ─── STOP / DISINTEREST ───
  if (msg.match(/^(nothing|no thanks|that'?s all|nah|nope|never\s?mind|i'?m good|stop|cancel|not now|no need)\b/)) {
    return "stop";
  }

  // ─── CONFIRMATION RESPONSES ───
  const lastAssistant = [...history].reverse().find(h => h.role === "assistant")?.content?.toLowerCase() || "";
  const isConfirmationPending = lastAssistant.includes("confirm") || lastAssistant.includes("are you sure") ||
    lastAssistant.includes("shall i") || lastAssistant.includes("proceed") ||
    lastAssistant.includes("(yes/no)") || lastAssistant.includes("say \"yes") ||
    lastAssistant.includes("to confirm") || lastAssistant.includes("delete it");

  if (isConfirmationPending) {
    if (msg.match(/^(yes|yeah|yep|confirm|go ahead|do it|sure|ok|okay|proceed|delete it|yes delete|yes convert)\b/)) {
      return "confirm_yes";
    }
    if (msg.match(/^(no|nope|cancel|stop|abort|don'?t|nevermind|no thanks)\b/)) {
      return "confirm_no";
    }
  }

  // ─── CHECK IF AI IS ASKING FOR A FIELD (data collection) ───
  const isCollecting = lastAssistant.includes("company name") || lastAssistant.includes("contact name") ||
    lastAssistant.includes("email") || lastAssistant.includes("role") || lastAssistant.includes("owner name") ||
    lastAssistant.includes("what is the") || lastAssistant.includes("what's the");
  if (isCollecting) return "create";

  // ─── DIRECT INTENT ───
  if (msg.match(/\b(how many|total|count|number of)\b.*\b(lead|prospect|account)/)) return "count";
  if (msg.match(/\b(lead|prospect|account)\b.*\b(how many|total|count)/)) return "count";
  if (msg.match(/\b(leads?\s+(created|owned|managed|assigned)\s+(by|to))/)) return "count";
  if (msg.match(/\b(search|find|look\s?up|show|list|who is)\b/)) return "search";
  if (msg.match(/\b(create|add|new)\b.*\b(lead|contact|prospect)\b/) || msg.match(/\b(lead|contact)\b.*\b(create|add|new)\b/)) return "create";
  if (msg.match(/\b(update|edit|change|modify|set)\b/)) return "update";
  if (msg.match(/\b(delete|remove|drop)\b/)) return "delete";
  if (msg.match(/\b(convert|promote|move\s?to|upgrade)\b/)) return "convert";
  if (msg.match(/\b(activity|log|logged|emailed|called|met|meeting|visited|note)\b/)) return "activity";
  if (msg.match(/\b(remind|reminder|follow.?up|schedule)\b/)) return "reminder";
  if (msg.match(/\b(detail|info|about|view)\b/)) return "details";
  if (msg.match(/\b(dropdown|options|companies|owners|roles|sources)\b/)) return "dropdowns";

  return "general";
}

// ─── TOOL SELECTION ───
function getToolsForIntent(intent: Intent): typeof TOOL_DEFINITIONS {
  const map: Record<string, string[]> = {
    search:      ["search_lead"],
    count:       ["count_leads", "search_lead"],
    create:      ["create_lead", "get_dropdowns", "search_lead"],
    update:      ["update_lead", "search_lead", "get_lead_details"],
    delete:      ["delete_lead", "search_lead"],
    convert:     ["convert_lead", "search_lead"],
    activity:    ["add_activity", "search_lead"],
    reminder:    ["add_reminder", "search_lead"],
    details:     ["get_lead_details", "search_lead"],
    dropdowns:   ["get_dropdowns"],
    confirm_yes: ["delete_lead", "convert_lead", "create_lead", "search_lead"],
    confirm_no:  [],
    stop:        [],
    document:    [], // No CRM tools — answer purely from document context
    general:     ["search_lead", "count_leads", "get_dropdowns"],
  };
  const names = map[intent] || map.general;
  return TOOL_DEFINITIONS.filter(t => names.includes(t.function.name));
}

// ─── MODEL SELECTION ───
function getModel(intent: Intent): string {
  const simple: Intent[] = ["search", "details", "dropdowns", "count", "document"];
  return simple.includes(intent) ? "llama-3.1-8b-instant" : "llama-3.3-70b-versatile";
}

// ─── HISTORY TRIM ───
function trimHistory(history: Array<{ role: string; content: string }>): Array<{ role: string; content: string }> {
  return history.slice(-6).map((msg) => ({
    role: msg.role,
    content: msg.content.length > 200 ? msg.content.substring(0, 200) + "..." : msg.content,
  }));
}

// ─── XML TOOL FALLBACK ───
function parseXmlToolCall(text: string): { name: string; params: any } | null {
  const match = text.match(/<function=(\w+)>?\s*(\{[\s\S]*?\})\s*<\/function>/);
  if (!match) return null;
  try { return { name: match[1], params: JSON.parse(match[2]) }; } catch { return null; }
}

// ─── GROQ API CALL ───
async function callGroq(
  messages: any[], tools: any[], model: string, retryCount = 0
): Promise<{ ok: boolean; data?: any; error?: string; status?: number }> {
  const body: any = {
    model,
    messages,
    temperature: 0.1,
    max_tokens: 500,
  };
  if (tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify(body),
  });

  if (res.ok) return { ok: true, data: await res.json() };

  const errorText = await res.text();
  const status = res.status;

  if (status === 429 && retryCount < 1) {
    const m = errorText.match(/try again in (\d+)m?([\d.]+)?s/);
    let ms = 5000;
    if (m) ms = Math.min(((parseInt(m[1]) || 0) * 60 + (parseFloat(m[2]) || 0)) * 1000, 30000);
    if (ms > 30000) return { ok: false, status, error: "Rate limit. Please wait a moment." };
    await new Promise(r => setTimeout(r, ms));
    return callGroq(messages, tools, model, retryCount + 1);
  }

  if (status === 400) {
    try {
      const fg = JSON.parse(errorText)?.error?.failed_generation;
      if (fg) { const p = parseXmlToolCall(fg); if (p) return { ok: true, data: { choices: [{ finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: `fb_${Date.now()}`, type: "function", function: { name: p.name, arguments: JSON.stringify(p.params) } }] } }] } }; }
    } catch {}
    if (model === "llama-3.1-8b-instant" && retryCount < 1) {
      console.log("8b failed, falling back to 70b");
      return callGroq(messages, tools, "llama-3.3-70b-versatile", retryCount + 1);
    }
  }

  console.error(`Groq ${status}:`, errorText.substring(0, 200));
  return { ok: false, status, error: errorText };
}

// ─── MAIN HANDLER ───
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userMessage, chatHistory, files } = body;
    // files = Array of { name: string, base64: string, mimeType: string } | undefined

    if (!userMessage?.trim()) return NextResponse.json({ message: "Please type a message.", action: null });
    if (!process.env.GROQ_API_KEY) return NextResponse.json({ message: "⚠️ GROQ_API_KEY not set.", action: null });

    const cleanHistory = Array.isArray(chatHistory)
      ? trimHistory(chatHistory.filter((m: any) => m?.role && m?.content).map((m: any) => ({ role: m.role === "user" ? "user" : "assistant", content: String(m.content) })))
      : [];

    // ─── FILE PARSING ───
    let documentContext = "";
    let parsedFiles: Awaited<ReturnType<typeof parseUploadedFile>>[] = [];
    const ownerName = body.ownerName || "CRM User";

    const fileList = Array.isArray(files) ? files : [];

    if (fileList.length > 0) {
      console.log(`\n=== FILE UPLOAD: ${fileList.length} file(s) — ${fileList.map((f: any) => f.name).join(", ")} ===`);

      // Parse all files in parallel
      parsedFiles = await Promise.all(
        fileList.map((f: any) =>
          parseUploadedFile(
            f.base64,
            f.name,
            f.mimeType || "application/octet-stream"
          )
        )
      );

      parsedFiles.forEach(pf =>
        console.log(`  Parsed: ${pf.name} → type=${pf.type}, chars=${pf.text.length}`)
      );

      // ─── LinkedIn-specific: merge all LinkedIn files into session store ───
      const existing = linkedInStore.get(ownerName) || {
        connections: [],
        invitations: [],
        updatedAt: new Date(),
      };

      let hasLinkedIn = false;
      for (const parsedFile of parsedFiles) {
        if (parsedFile.type === "linkedin_connections" && parsedFile.linkedInData?.connections) {
          existing.connections = parsedFile.linkedInData.connections;
          hasLinkedIn = true;
        }
        if (parsedFile.type === "linkedin_invitations" && parsedFile.linkedInData?.invitations) {
          existing.invitations = parsedFile.linkedInData.invitations;
          hasLinkedIn = true;
        }
      }

      if (hasLinkedIn) {
        existing.updatedAt = new Date();
        linkedInStore.set(ownerName, existing);
        // Recompute analytics with both datasets merged
        const analytics = computeLinkedInAnalytics(existing.connections, existing.invitations, ownerName);
        documentContext = buildLinkedInContext(analytics);
      } else {
        // Regular documents — build context blocks for each file and join
        const contexts = parsedFiles.map(pf => buildDocumentContext(pf));
        documentContext = contexts.join("\n");
      }

    } else {
      // ─── No files uploaded: check if we have stored LinkedIn data for this owner ───
      const stored = linkedInStore.get(ownerName);
      if (stored && (stored.connections.length > 0 || stored.invitations.length > 0)) {
        const analytics = computeLinkedInAnalytics(stored.connections, stored.invitations, ownerName);
        // Extract days filter from user message (e.g. "last 10 days")
        const daysMatch = userMessage.match(/last\s+(\d+)\s+day/i);
        const daysFilter = daysMatch ? parseInt(daysMatch[1]) : undefined;
        documentContext = buildLinkedInContext(analytics, daysFilter);
      }
    }

    const hasFile = !!documentContext;
    const intent = detectIntent(userMessage, cleanHistory, hasFile);

    console.log(`\n=== [${intent}] "${userMessage.substring(0, 60)}" ===`);

    // ─── IMMEDIATE RETURNS (no AI call needed) ───
    if (intent === "stop") {
      return NextResponse.json({
        message: "Understood. Let me know whenever you need assistance.",
        action: null,
      });
    }

    if (intent === "confirm_no") {
      return NextResponse.json({
        message: "Action cancelled. Is there anything else I can help you with?",
        action: null,
      });
    }

    // ─── BUILD SYSTEM PROMPT (inject document context if present) ───
    const systemPrompt = documentContext
      ? SYSTEM_PROMPT + documentContext
      : SYSTEM_PROMPT;

    // ─── AI CALL ───
    const tools = getToolsForIntent(intent);
    const model = getModel(intent);

    const messages: any[] = [
      { role: "system", content: systemPrompt },
      ...cleanHistory,
      { role: "user", content: userMessage },
    ];

    let iteration = 0;
    let lastToolCall: { name: string; params: any; result: any } | null = null;

    while (iteration < 5) {
      iteration++;
      const result = await callGroq(messages, tools, model);

      if (!result.ok) {
        return NextResponse.json({
          message: result.status === 429
            ? `⚠️ ${result.error || "Rate limit. Please wait a moment."}`
            : "⚠️ Service temporarily unavailable. Please try again.",
          action: null,
        });
      }

      const choice = result.data?.choices?.[0];
      if (!choice) return NextResponse.json({ message: "⚠️ Empty response. Please try again.", action: null });

      const am = choice.message;

      // ─── Tool call ───
      if (choice.finish_reason === "tool_calls" && am.tool_calls?.length) {
        const tc = am.tool_calls[0];
        const tn = tc.function.name;
        let tp: any;
        try { tp = JSON.parse(tc.function.arguments); } catch { tp = {}; }

        console.log(`  Tool: ${tn}(${JSON.stringify(tp).substring(0, 120)})`);

        let atn = tn;
        if (tn === "convert_lead" && tp.directToAccount) { atn = "convert_lead_to_account"; delete tp.directToAccount; }

        const tr = await executeTool(atn, tp);
        console.log(`  Result: success=${tr.success} ${JSON.stringify(tr).substring(0, 150)}`);

        lastToolCall = { name: atn, params: tp, result: tr };

        if (tr.needsConfirmation) {
          return NextResponse.json({
            message: tr.message,
            action: { type: "confirmation_needed", tool: atn, params: tp },
          });
        }

        messages.push(am);
        messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(tr) });
        continue;
      }

      // ─── Text response ───
      const text = am.content || "";
      if (!text.trim()) {
        return NextResponse.json({
          message: "How can I assist you? I can search leads, create new ones, log activities, set reminders, or answer questions from uploaded documents.",
          action: null,
        });
      }

      let action: any = null;

      // ─── File upload action (for UI indicator) ───
      if (hasFile && parsedFiles.length > 0) {
        // Check if any file is a LinkedIn type
        const linkedInFile = parsedFiles.find(
          pf => pf.type === "linkedin_connections" || pf.type === "linkedin_invitations"
        );
        const recordCount = parsedFiles.reduce(
          (sum, pf) =>
            sum +
            (pf.linkedInData?.connections?.length ??
              pf.linkedInData?.invitations?.length ??
              0),
          0
        );
        action = {
          type: "file_processed",
          fileName: parsedFiles.map(pf => pf.name).join(", "),
          fileType: linkedInFile ? linkedInFile.type : parsedFiles[0].type,
          sizeKB: parsedFiles.reduce((sum, pf) => sum + pf.sizeKB, 0),
          isImage: parsedFiles.every(pf => pf.isImage),
          recordCount,
        };
      } else if (lastToolCall) {
        const { name: n, result: r, params: p } = lastToolCall;
        if (n === "create_lead" && r.success) action = { type: "lead_created", leadId: r.LeadId };
        else if (n === "update_lead" && r.success) action = { type: "lead_updated", leadId: r.LeadId || p.leadId };
        else if (n === "delete_lead" && r.success) action = { type: "lead_deleted", leadId: p.leadId };
        else if (n === "search_lead" && r.success) action = { type: "search_results", leads: r.leads };
        else if (n === "count_leads" && r.success) action = null;
        else if (n === "get_lead_details" && r.success) action = { type: "lead_details", lead: r };
        else if ((n === "convert_lead" || n === "convert_lead_to_account") && r.success) action = { type: "lead_converted", leadId: p.leadId, from: r.from, to: r.to };
        else if (n === "add_activity" && r.success) action = { type: "activity_added", leadId: p.leadId, activityId: r.ActivityId };
        else if (n === "add_reminder" && r.success) action = { type: "reminder_created", leadId: p.leadId, reminderId: r.ReminderId };
      }

      return NextResponse.json({ message: text, action });
    }

    return NextResponse.json({
      message: "I'm having difficulty completing that request. Could you try a simpler command? For example: \"Search for Sanofi\" or \"Create a new lead\".",
      action: null,
    });

  } catch (error: any) {
    console.error("=== CRASH ===", error.message);
    return NextResponse.json({ message: `⚠️ Error: ${error.message}`, action: null });
  }
}