// app/api/ai/chat/route.ts
// OPTIMIZED: Fixes 400 (XML tool call fallback) + 429 (retry) + token reduction
//
// Changes from previous version:
//   1. System prompt cut from ~400 tokens to ~200 tokens
//   2. Chat history trimmed to 6 messages (was 10)
//   3. History messages truncated to 200 chars each
//   4. XML-style tool call fallback for 400 errors
//   5. Single retry with delay for 429 errors
//   6. max_tokens reduced to 512 (was 1024)
//   7. Merged convert_lead + convert_lead_to_account into one tool

import { NextRequest, NextResponse } from "next/server";
import { PHASE2_TOOLS } from "../tools/definitions";
import { executeTool } from "../tools/executor";

// ─── COMPACT SYSTEM PROMPT (~200 tokens instead of ~400) ───
const SYSTEM_PROMPT = `You are ACARsh CRM assistant. Use tools for all CRM actions. Never guess data.

Rules:
- Use search_lead first when user mentions a lead by name
- For delete/convert: set confirmed=false first, only true after user says yes
- For add_reminder: parse relative dates to YYYY-MM-DD. Today: ${new Date().toISOString().split("T")[0]}
- For convert_lead: set directToAccount=true only when user says "directly to account"
- Keep responses short`;

const MAX_TOOL_ITERATIONS = 3;
const MAX_HISTORY = 6;
const MAX_MSG_LENGTH = 200;

// ─── TRIM + COMPRESS HISTORY ───
function trimHistory(
  history: Array<{ role: string; content: string }>
): Array<{ role: string; content: string }> {
  // Take last N messages
  const trimmed = history.slice(-MAX_HISTORY);

  // Truncate long messages to save tokens
  return trimmed.map((msg) => ({
    role: msg.role,
    content:
      msg.content.length > MAX_MSG_LENGTH
        ? msg.content.substring(0, MAX_MSG_LENGTH) + "..."
        : msg.content,
  }));
}

// ─── PARSE XML-STYLE TOOL CALLS (fallback for 400 errors) ───
// Llama 3.3 sometimes generates: <function=tool_name{"param":"value"}</function>
function parseXmlToolCall(
  text: string
): { name: string; params: any } | null {
  // Match: <function=name{json}</function> or <function=name>{json}</function>
  const match = text.match(
    /<function=(\w+)>?\s*(\{[\s\S]*?\})\s*<\/function>/
  );
  if (!match) return null;

  try {
    return {
      name: match[1],
      params: JSON.parse(match[2]),
    };
  } catch {
    return null;
  }
}

// ─── CALL GROQ WITH RETRY ON 429 ───
async function callGroq(
  messages: any[],
  tools: any[],
  retryCount: number = 0
): Promise<{ ok: boolean; data?: any; error?: string; status?: number }> {
  const res = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages,
        tools,
        tool_choice: "auto",
        temperature: 0.1,
        max_tokens: 512, // Reduced from 1024 — agent responses are short
      }),
    }
  );

  if (res.ok) {
    const data = await res.json();
    return { ok: true, data };
  }

  const errorText = await res.text();
  const status = res.status;

  // ─── 429: Rate limit — retry once after delay ───
  if (status === 429 && retryCount < 1) {
    // Extract wait time from error message
    const waitMatch = errorText.match(/try again in (\d+)m?([\d.]+)?s/);
    let waitMs = 5000; // default 5s
    if (waitMatch) {
      const minutes = parseInt(waitMatch[1]) || 0;
      const seconds = parseFloat(waitMatch[2]) || 0;
      waitMs = Math.min((minutes * 60 + seconds) * 1000, 30000); // Cap at 30s
    }

    // If wait is more than 30s, don't retry — tell user
    if (waitMs > 30000) {
      return {
        ok: false,
        status,
        error: `Rate limit reached. Please wait ${Math.ceil(waitMs / 60000)} minutes and try again.`,
      };
    }

    console.log(`Rate limited. Waiting ${waitMs}ms before retry...`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return callGroq(messages, tools, retryCount + 1);
  }

  // ─── 400: Tool use failed — try to parse XML fallback ───
  if (status === 400) {
    try {
      const errorJson = JSON.parse(errorText);
      const failedGen = errorJson?.error?.failed_generation;
      if (failedGen) {
        const parsed = parseXmlToolCall(failedGen);
        if (parsed) {
          console.log(`Parsed XML tool call fallback: ${parsed.name}`);
          // Return a synthetic response that looks like a normal tool call
          return {
            ok: true,
            data: {
              choices: [
                {
                  finish_reason: "tool_calls",
                  message: {
                    role: "assistant",
                    content: null,
                    tool_calls: [
                      {
                        id: `fallback_${Date.now()}`,
                        type: "function",
                        function: {
                          name: parsed.name,
                          arguments: JSON.stringify(parsed.params),
                        },
                      },
                    ],
                  },
                },
              ],
            },
          };
        }
      }
    } catch {
      // Couldn't parse — fall through to error
    }
  }

  console.error(`Groq API error ${status}:`, errorText.substring(0, 300));
  return { ok: false, status, error: errorText };
}

// ─── MAIN HANDLER ───
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userMessage, chatHistory } = body;

    if (!userMessage?.trim()) {
      return NextResponse.json({ message: "Please type a message.", action: null });
    }

    if (!process.env.GROQ_API_KEY) {
      return NextResponse.json({
        message: "⚠️ GROQ_API_KEY not configured.",
        action: null,
      });
    }

    // Clean and trim chat history aggressively
    const cleanHistory = Array.isArray(chatHistory)
      ? trimHistory(
          chatHistory
            .filter((msg: any) => msg && msg.role && msg.content)
            .map((msg: any) => ({
              role: msg.role === "user" ? "user" : "assistant",
              content: String(msg.content),
            }))
        )
      : [];

    const messages: any[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...cleanHistory,
      { role: "user", content: userMessage },
    ];

    console.log("\n=== AI AGENT REQUEST ===");
    console.log("User:", userMessage);
    console.log("History:", cleanHistory.length, "msgs");

    // ─── TOOL CALL LOOP ───
    let iteration = 0;
    let lastToolCall: { name: string; params: any; result: any } | null = null;

    while (iteration < MAX_TOOL_ITERATIONS) {
      iteration++;

      const groqResult = await callGroq(messages, PHASE2_TOOLS);

      if (!groqResult.ok) {
        // Check if it's a rate limit we couldn't retry
        if (groqResult.status === 429) {
          return NextResponse.json({
            message: `⚠️ ${groqResult.error || "Rate limit reached. Please wait a moment and try again."}`,
            action: null,
          });
        }
        return NextResponse.json({
          message: `⚠️ AI service error. Please try again.`,
          action: null,
        });
      }

      const choice = groqResult.data?.choices?.[0];
      if (!choice) {
        return NextResponse.json({
          message: "⚠️ Empty AI response. Please try again.",
          action: null,
        });
      }

      const assistantMessage = choice.message;
      console.log(`--- Iter ${iteration} | finish: ${choice.finish_reason} ---`);

      // ─── CASE 1: Tool call ───
      if (
        choice.finish_reason === "tool_calls" &&
        assistantMessage.tool_calls?.length > 0
      ) {
        const toolCall = assistantMessage.tool_calls[0];
        const toolName = toolCall.function.name;
        let toolParams: any;

        try {
          toolParams = JSON.parse(toolCall.function.arguments);
        } catch {
          toolParams = {};
        }

        console.log(`Tool: ${toolName}(${JSON.stringify(toolParams)})`);

        // ─── Handle merged convert_lead with directToAccount ───
        let actualToolName = toolName;
        if (toolName === "convert_lead" && toolParams.directToAccount) {
          actualToolName = "convert_lead_to_account";
          delete toolParams.directToAccount;
        }

        const toolResult = await executeTool(actualToolName, toolParams);
        console.log("Result:", JSON.stringify(toolResult).substring(0, 300));

        lastToolCall = { name: actualToolName, params: toolParams, result: toolResult };

        // If needs confirmation, return immediately (don't burn another LLM call)
        if (toolResult.needsConfirmation) {
          return NextResponse.json({
            message: toolResult.message,
            action: { type: "confirmation_needed", tool: actualToolName, params: toolParams },
          });
        }

        // Feed result back to LLM
        messages.push(assistantMessage);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(toolResult),
        });

        continue;
      }

      // ─── CASE 2: Text response ───
      const responseText = assistantMessage.content || "Done.";
      console.log("Response:", responseText.substring(0, 150));

      // Build frontend action metadata
      let action: any = null;
      if (lastToolCall) {
        const { name, result } = lastToolCall;

        if (name === "create_lead" && result.success)
          action = { type: "lead_created", leadId: result.LeadId };
        else if (name === "update_lead" && result.success)
          action = { type: "lead_updated", leadId: result.LeadId || lastToolCall.params.leadId };
        else if (name === "delete_lead" && result.success)
          action = { type: "lead_deleted", leadId: lastToolCall.params.leadId };
        else if (name === "search_lead" && result.success)
          action = { type: "search_results", leads: result.leads };
        else if (name === "get_lead_details" && result.success)
          action = { type: "lead_details", lead: result };
        else if ((name === "convert_lead" || name === "convert_lead_to_account") && result.success)
          action = { type: "lead_converted", leadId: lastToolCall.params.leadId, from: result.from, to: result.to };
        else if (name === "add_activity" && result.success)
          action = { type: "activity_added", leadId: lastToolCall.params.leadId, activityId: result.ActivityId };
        else if (name === "add_reminder" && result.success)
          action = { type: "reminder_created", leadId: lastToolCall.params.leadId, reminderId: result.ReminderId };
      }

      return NextResponse.json({ message: responseText, action });
    }

    return NextResponse.json({
      message: "Could not process that. Please rephrase.",
      action: null,
    });
  } catch (error: any) {
    console.error("=== AI AGENT CRASH ===", error.message);
    return NextResponse.json({
      message: `⚠️ Server error: ${error.message}`,
      action: null,
    });
  }
}